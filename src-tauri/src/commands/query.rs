//! Table-browsing command. Returns the generated SQL alongside the result so
//! the SQL preview panel always reflects exactly what executed.

use serde::Serialize;
use tauri::State;

use pgcore::builder;
use pgcore::query::{self, QueryResult, SortDir};
use pgcore::spec::QuerySpec;

use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseResponse {
    pub sql: String,
    pub result: QueryResult,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltSql {
    pub sql: String,
    pub param_count: usize,
}

/// Browse one page of a table, optionally sorted by a single column.
#[tauri::command]
pub fn browse_table(
    table: String,
    limit: i64,
    offset: i64,
    sort_column: Option<String>,
    sort_dir: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<BrowseResponse> {
    let mut conn = state.conn()?;

    let order_by = sort_column.as_deref().map(|col| {
        let dir = sort_dir.as_deref().map(SortDir::parse).unwrap_or(SortDir::Asc);
        (col, dir)
    });

    let (sql, result) = query::browse_table(&mut conn, &table, order_by, limit, offset)?;
    Ok(BrowseResponse { sql, result })
}

/// Generate SQL from a visual query spec without executing it. Used to keep the
/// SQL preview panel live as the user edits filters/joins. Pure (no DB access).
#[tauri::command]
pub fn build_sql(spec: QuerySpec) -> AppResult<BuiltSql> {
    let built = builder::build_select(&spec)?;
    Ok(BuiltSql {
        sql: builder::display_sql(&built),
        param_count: built.params.len(),
    })
}

/// Build SQL from a visual query spec, execute it, and return the generated SQL
/// alongside the resulting page of rows.
#[tauri::command]
pub fn run_query(spec: QuerySpec, state: State<'_, AppState>) -> AppResult<BrowseResponse> {
    let mut conn = state.conn()?;
    let (sql, result) = query::run_select(&mut conn, &spec)?;
    Ok(BrowseResponse { sql, result })
}
