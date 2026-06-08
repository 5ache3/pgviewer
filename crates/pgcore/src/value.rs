//! Conversion from PostgreSQL's statically-typed column values into a tagged
//! union the frontend can render without losing type information.
//!
//! Reading is generic: [`Cell`] implements [`FromSql`] for *every* column type
//! by dispatching on the runtime [`Type`]. Common families (numbers, bool,
//! text, numeric, timestamps, uuid, json, bytea) get first-class handling;
//! anything else (enums, and other text-encoded types) falls back to its text
//! representation so a value is always shown rather than erroring the whole row.

use std::error::Error as StdError;

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use postgres_types::{FromSql, Type};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

type BoxError = Box<dyn StdError + Sync + Send>;

/// Number of leading BYTEA bytes included as a hex preview.
const BYTEA_PREVIEW_BYTES: usize = 16;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "t")]
pub enum CellValue {
    #[serde(rename = "null")]
    Null,
    #[serde(rename = "bool")]
    Bool { v: bool },
    #[serde(rename = "int")]
    Int { v: i64 },
    #[serde(rename = "real")]
    Real { v: f64 },
    /// Arbitrary-precision NUMERIC/DECIMAL, kept as text to preserve precision.
    #[serde(rename = "num")]
    Num { v: String },
    #[serde(rename = "text")]
    Text { v: String },
    #[serde(rename = "json")]
    Json { v: String },
    #[serde(rename = "bytea")]
    Bytea {
        size: usize,
        #[serde(rename = "hexPreview")]
        hex_preview: String,
    },
}

/// Newtype wrapper so we can implement [`FromSql`] generically over any column
/// type and read every column with `row.try_get::<usize, Cell>(i)`.
#[derive(Debug, Clone)]
pub struct Cell(pub CellValue);

impl<'a> FromSql<'a> for Cell {
    fn from_sql(ty: &Type, raw: &'a [u8]) -> Result<Cell, BoxError> {
        Ok(Cell(decode(ty, raw)?))
    }

    fn from_sql_null(_ty: &Type) -> Result<Cell, BoxError> {
        Ok(Cell(CellValue::Null))
    }

    fn accepts(_ty: &Type) -> bool {
        true
    }
}

fn decode(ty: &Type, raw: &[u8]) -> Result<CellValue, BoxError> {
    let v = if *ty == Type::BOOL {
        CellValue::Bool {
            v: bool::from_sql(ty, raw)?,
        }
    } else if *ty == Type::INT2 {
        CellValue::Int {
            v: i16::from_sql(ty, raw)? as i64,
        }
    } else if *ty == Type::INT4 {
        CellValue::Int {
            v: i32::from_sql(ty, raw)? as i64,
        }
    } else if *ty == Type::INT8 {
        CellValue::Int {
            v: i64::from_sql(ty, raw)?,
        }
    } else if *ty == Type::OID {
        CellValue::Int {
            v: u32::from_sql(ty, raw)? as i64,
        }
    } else if *ty == Type::FLOAT4 {
        CellValue::Real {
            v: f32::from_sql(ty, raw)? as f64,
        }
    } else if *ty == Type::FLOAT8 {
        CellValue::Real {
            v: f64::from_sql(ty, raw)?,
        }
    } else if *ty == Type::NUMERIC {
        CellValue::Num {
            v: Decimal::from_sql(ty, raw)?.to_string(),
        }
    } else if *ty == Type::JSON || *ty == Type::JSONB {
        CellValue::Json {
            v: serde_json::Value::from_sql(ty, raw)?.to_string(),
        }
    } else if *ty == Type::UUID {
        CellValue::Text {
            v: Uuid::from_sql(ty, raw)?.to_string(),
        }
    } else if *ty == Type::TIMESTAMP {
        CellValue::Text {
            v: NaiveDateTime::from_sql(ty, raw)?
                .format("%Y-%m-%d %H:%M:%S%.f")
                .to_string(),
        }
    } else if *ty == Type::TIMESTAMPTZ {
        CellValue::Text {
            v: DateTime::<Utc>::from_sql(ty, raw)?.to_rfc3339(),
        }
    } else if *ty == Type::DATE {
        CellValue::Text {
            v: NaiveDate::from_sql(ty, raw)?.to_string(),
        }
    } else if *ty == Type::TIME {
        CellValue::Text {
            v: NaiveTime::from_sql(ty, raw)?.to_string(),
        }
    } else if *ty == Type::BYTEA {
        let bytes = <Vec<u8>>::from_sql(ty, raw)?;
        CellValue::Bytea {
            size: bytes.len(),
            hex_preview: hex_preview(&bytes),
        }
    } else if is_text_like(ty) {
        CellValue::Text {
            v: <String>::from_sql(ty, raw)?,
        }
    } else {
        // Enums and any other type we don't special-case: its binary encoding
        // is its text label for enums, and a best-effort UTF-8 view otherwise.
        CellValue::Text {
            v: String::from_utf8_lossy(raw).into_owned(),
        }
    };
    Ok(v)
}

fn is_text_like(ty: &Type) -> bool {
    matches!(
        *ty,
        Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME | Type::UNKNOWN
    )
}

fn hex_preview(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(BYTEA_PREVIEW_BYTES * 2);
    for b in bytes.iter().take(BYTEA_PREVIEW_BYTES) {
        out.push_str(&format!("{b:02x}"));
    }
    out
}
