//! Streaming export of a query result to CSV / JSON / Excel.
//!
//! Rows are streamed from PostgreSQL in batches via `query_raw` straight to the
//! destination file — they are never collected into memory in bulk and never
//! round-trip through the frontend. This keeps exports of entire (filtered)
//! tables viable on large databases.

use std::fs::File;
use std::io::{BufWriter, Write};

use postgres::fallible_iterator::FallibleIterator;
use postgres::types::{ToSql, Type};
use postgres::{Client, Row};
use serde::Deserialize;

use crate::builder::BuiltQuery;
use crate::error::{Error, Result};
use crate::value::{Cell, CellValue};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Csv,
    Json,
    Xlsx,
}

/// Export the rows produced by `query` to `dest`, returning the row count.
pub fn export(
    conn: &mut Client,
    query: &BuiltQuery,
    format: ExportFormat,
    dest: &str,
) -> Result<u64> {
    match format {
        ExportFormat::Csv => export_csv(conn, query, dest),
        ExportFormat::Json => export_json(conn, query, dest),
        ExportFormat::Xlsx => export_xlsx(conn, query, dest),
    }
}

/// Column names and types for the prepared query.
fn prepare(conn: &mut Client, query: &BuiltQuery) -> Result<(Vec<String>, Vec<Type>)> {
    let stmt = conn.prepare(&query.sql)?;
    let names = stmt.columns().iter().map(|c| c.name().to_string()).collect();
    let types = stmt.columns().iter().map(|c| c.type_().clone()).collect();
    Ok((names, types))
}

fn export_csv(conn: &mut Client, query: &BuiltQuery, dest: &str) -> Result<u64> {
    let (names, types) = prepare(conn, query)?;
    let n = names.len();

    let mut writer = csv::Writer::from_path(dest).map_err(csv_err)?;
    writer.write_record(&names).map_err(csv_err)?;

    let mut count = 0u64;
    let mut rows = conn.query_raw(&query.sql, params(query))?;
    while let Some(row) = rows.next()? {
        let record: Vec<String> = (0..n)
            .map(|i| value_to_string(&row, i, &types[i]))
            .collect::<Result<_>>()?;
        writer.write_record(&record).map_err(csv_err)?;
        count += 1;
    }
    writer.flush()?;
    Ok(count)
}

fn export_json(conn: &mut Client, query: &BuiltQuery, dest: &str) -> Result<u64> {
    let (names, types) = prepare(conn, query)?;

    let mut file = BufWriter::new(File::create(dest)?);
    file.write_all(b"[")?;

    let mut count = 0u64;
    let mut rows = conn.query_raw(&query.sql, params(query))?;
    while let Some(row) = rows.next()? {
        file.write_all(if count == 0 { b"\n" } else { b",\n" })?;
        let mut map = serde_json::Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            map.insert(name.clone(), value_to_json(&row, i, &types[i])?);
        }
        serde_json::to_writer(&mut file, &serde_json::Value::Object(map))
            .map_err(|e| Error::Msg(format!("json: {e}")))?;
        count += 1;
    }

    file.write_all(b"\n]\n")?;
    file.flush()?;
    Ok(count)
}

fn export_xlsx(conn: &mut Client, query: &BuiltQuery, dest: &str) -> Result<u64> {
    use rust_xlsxwriter::Workbook;

    let (names, types) = prepare(conn, query)?;

    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();

    for (col, name) in names.iter().enumerate() {
        sheet.write_string(0, col as u16, name.as_str()).map_err(xlsx_err)?;
    }

    let mut count = 0u64;
    let mut rows = conn.query_raw(&query.sql, params(query))?;
    while let Some(row) = rows.next()? {
        let r = (count + 1) as u32;
        for i in 0..names.len() {
            let c = i as u16;
            match cell(&row, i, &types[i])? {
                CellValue::Null => {}
                CellValue::Bool { v } => {
                    sheet.write_boolean(r, c, v).map_err(xlsx_err)?;
                }
                CellValue::Int { v } => {
                    sheet.write_number(r, c, v as f64).map_err(xlsx_err)?;
                }
                CellValue::Real { v } => {
                    sheet.write_number(r, c, v).map_err(xlsx_err)?;
                }
                CellValue::Num { v } => {
                    match v.parse::<f64>() {
                        Ok(n) => sheet.write_number(r, c, n).map_err(xlsx_err)?,
                        Err(_) => sheet.write_string(r, c, v.as_str()).map_err(xlsx_err)?,
                    };
                }
                CellValue::Text { v } | CellValue::Json { v } => {
                    sheet.write_string(r, c, v.as_str()).map_err(xlsx_err)?;
                }
                CellValue::Bytea { size, .. } => {
                    sheet
                        .write_string(r, c, format!("<{size} bytes>"))
                        .map_err(xlsx_err)?;
                }
            }
        }
        count += 1;
    }

    workbook.save(dest).map_err(xlsx_err)?;
    Ok(count)
}

// --- Value extraction ------------------------------------------------------

/// Bound parameters as an iterator of trait objects for `query_raw`.
fn params(query: &BuiltQuery) -> impl ExactSizeIterator<Item = &(dyn ToSql + Sync)> {
    query.params.iter().map(|p| p as &(dyn ToSql + Sync))
}

/// Decode a single cell. BYTEA is read in full (not just a preview) so exports
/// carry the complete value; everything else reuses the browse decoder.
fn cell(row: &Row, i: usize, ty: &Type) -> Result<CellValue> {
    if *ty == Type::BYTEA {
        let bytes: Option<Vec<u8>> = row.try_get(i)?;
        return Ok(match bytes {
            None => CellValue::Null,
            Some(b) => CellValue::Text { v: to_hex(&b) },
        });
    }
    let c: Cell = row.try_get(i)?;
    Ok(c.0)
}

fn value_to_string(row: &Row, i: usize, ty: &Type) -> Result<String> {
    Ok(match cell(row, i, ty)? {
        CellValue::Null => String::new(),
        CellValue::Bool { v } => v.to_string(),
        CellValue::Int { v } => v.to_string(),
        CellValue::Real { v } => v.to_string(),
        CellValue::Num { v } | CellValue::Text { v } | CellValue::Json { v } => v,
        CellValue::Bytea { hex_preview, .. } => hex_preview,
    })
}

fn value_to_json(row: &Row, i: usize, ty: &Type) -> Result<serde_json::Value> {
    use serde_json::Value as J;
    Ok(match cell(row, i, ty)? {
        CellValue::Null => J::Null,
        CellValue::Bool { v } => J::Bool(v),
        CellValue::Int { v } => J::from(v),
        CellValue::Real { v } => J::from(v),
        CellValue::Num { v } => J::String(v),
        CellValue::Text { v } => J::String(v),
        // Already-serialized JSON: embed it as structured JSON, not a string.
        CellValue::Json { v } => serde_json::from_str(&v).unwrap_or(J::String(v)),
        CellValue::Bytea { hex_preview, .. } => J::String(hex_preview),
    })
}

fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn csv_err(e: csv::Error) -> Error {
    Error::Msg(format!("csv: {e}"))
}

fn xlsx_err(e: rust_xlsxwriter::XlsxError) -> Error {
    Error::Msg(format!("xlsx: {e}"))
}
