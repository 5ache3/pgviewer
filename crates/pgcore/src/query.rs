//! Query execution and simple paginated table browsing.
//!
//! Browsing builds a [`QuerySpec`] and runs it through the same [`builder`] as
//! the visual query builder, so the SQL preview and the executed query are
//! always identical. Results stream into a [`QueryResult`] of tagged
//! [`CellValue`]s; the caller is responsible for bounding the result via LIMIT
//! (the builder always emits one).

use std::time::Instant;

use postgres::types::ToSql;
use postgres::Client;
use serde::Serialize;

use crate::builder::{self, BuiltQuery};
use crate::error::Result;
use crate::spec::{Direction, QuerySpec, SortRule};
use crate::value::{Cell, CellValue};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultColumn {
    pub name: String,
    pub data_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<CellValue>>,
    pub rows_affected: Option<i64>,
    pub elapsed_ms: f64,
    pub truncated: bool,
}

/// Sort direction for browse queries.
#[derive(Debug, Clone, Copy)]
pub enum SortDir {
    Asc,
    Desc,
}

impl SortDir {
    /// Parse a case-insensitive "asc"/"desc", defaulting to ascending.
    pub fn parse(s: &str) -> Self {
        if s.eq_ignore_ascii_case("desc") {
            SortDir::Desc
        } else {
            SortDir::Asc
        }
    }

    fn direction(self) -> Direction {
        match self {
            SortDir::Asc => Direction::Asc,
            SortDir::Desc => Direction::Desc,
        }
    }
}

/// Execute a built query and collect the (already-paginated) result set.
fn run_built(conn: &mut Client, built: &BuiltQuery) -> Result<QueryResult> {
    let start = Instant::now();

    // Prepare first so column metadata is available even for an empty result.
    let stmt = conn.prepare(&built.sql)?;
    let columns: Vec<ResultColumn> = stmt
        .columns()
        .iter()
        .map(|c| ResultColumn {
            name: c.name().to_string(),
            data_type: Some(c.type_().name().to_string()),
        })
        .collect();
    let col_count = columns.len();

    let params: Vec<&(dyn ToSql + Sync)> = built
        .params
        .iter()
        .map(|p| p as &(dyn ToSql + Sync))
        .collect();
    let rows = conn.query(&stmt, &params)?;

    let mut rows_out: Vec<Vec<CellValue>> = Vec::with_capacity(rows.len());
    for row in &rows {
        let mut record = Vec::with_capacity(col_count);
        for i in 0..col_count {
            let cell: Cell = row.try_get(i)?;
            record.push(cell.0);
        }
        rows_out.push(record);
    }

    Ok(QueryResult {
        columns,
        rows: rows_out,
        rows_affected: None,
        elapsed_ms: start.elapsed().as_secs_f64() * 1000.0,
        truncated: false,
    })
}

/// Build SQL from a visual [`QuerySpec`], execute it, and return both the
/// human-readable (parameters inlined) SQL for the preview panel and the
/// resulting page of rows.
pub fn run_select(conn: &mut Client, spec: &QuerySpec) -> Result<(String, QueryResult)> {
    let built = builder::build_select(spec)?;
    let display = builder::display_sql(&built);
    let result = run_built(conn, &built)?;
    Ok((display, result))
}

/// Convenience: build + run a browse query for one page of a table, optionally
/// sorted by a single column.
pub fn browse_table(
    conn: &mut Client,
    table: &str,
    order_by: Option<(&str, SortDir)>,
    limit: i64,
    offset: i64,
) -> Result<(String, QueryResult)> {
    let order = order_by.map(|(col, dir)| {
        vec![SortRule {
            column: col.to_string(),
            dir: dir.direction(),
        }]
    });
    let spec = QuerySpec {
        base_table: table.to_string(),
        distinct: false,
        columns: None,
        aggregates: None,
        joins: None,
        filter: None,
        group_by: None,
        having: None,
        order_by: order,
        limit: Some(limit),
        offset: Some(offset),
    };
    run_select(conn, &spec)
}
