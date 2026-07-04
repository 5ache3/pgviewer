//! Export the current query result to a file. Rows stream from Rust to disk via
//! `pgcore::export`; nothing passes through the frontend.

use serde::Serialize;
use tauri::State;

use pgcore::builder;
use pgcore::export::{self, ExportFormat};
use pgcore::pool;
use pgcore::spec::QuerySpec;

use crate::commands::blocking;
use crate::error::AppResult;
use crate::state::AppState;

/// Which rows to export.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportScope {
    /// Just the current page (spec's LIMIT/OFFSET).
    Page,
    /// Every row matching the filters/joins (no LIMIT).
    All,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub row_count: u64,
}

#[tauri::command]
pub async fn export_query(
    spec: QuerySpec,
    format: ExportFormat,
    scope: ExportScope,
    dest: String,
    state: State<'_, AppState>,
) -> AppResult<ExportResult> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        let query = match scope {
            ExportScope::Page => builder::build_select(&spec)?,
            ExportScope::All => builder::build_unbounded(&spec)?,
        };
        let row_count = export::export(&mut conn, &query, format, &dest)?;
        Ok(ExportResult { path: dest, row_count })
    })
    .await
}
