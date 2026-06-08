//! Schema discovery commands — thin wrappers over `pgcore::schema`.

use tauri::State;

use pgcore::schema::{
    self, ColumnMeta, ForeignKeyMeta, IndexMeta, JoinSuggestion, RowCount, TableMeta, TriggerMeta,
    ViewMeta,
};

use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub fn list_tables(state: State<'_, AppState>) -> AppResult<Vec<TableMeta>> {
    let mut conn = state.conn()?;
    Ok(schema::list_tables(&mut conn)?)
}

#[tauri::command]
pub fn list_views(state: State<'_, AppState>) -> AppResult<Vec<ViewMeta>> {
    let mut conn = state.conn()?;
    Ok(schema::list_views(&mut conn)?)
}

#[tauri::command]
pub fn list_indexes(state: State<'_, AppState>) -> AppResult<Vec<IndexMeta>> {
    let mut conn = state.conn()?;
    Ok(schema::list_indexes(&mut conn)?)
}

#[tauri::command]
pub fn list_triggers(state: State<'_, AppState>) -> AppResult<Vec<TriggerMeta>> {
    let mut conn = state.conn()?;
    Ok(schema::list_triggers(&mut conn)?)
}

#[tauri::command]
pub fn table_columns(table: String, state: State<'_, AppState>) -> AppResult<Vec<ColumnMeta>> {
    let mut conn = state.conn()?;
    Ok(schema::table_columns(&mut conn, &table)?)
}

#[tauri::command]
pub fn table_foreign_keys(
    table: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<ForeignKeyMeta>> {
    let mut conn = state.conn()?;
    Ok(schema::table_foreign_keys(&mut conn, &table)?)
}

#[tauri::command]
pub fn row_count(table: String, exact: bool, state: State<'_, AppState>) -> AppResult<RowCount> {
    let mut conn = state.conn()?;
    Ok(schema::row_count(&mut conn, &table, exact)?)
}

#[tauri::command]
pub fn join_suggestions(
    table: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<JoinSuggestion>> {
    let mut conn = state.conn()?;
    Ok(schema::suggest_joins(&mut conn, &table)?)
}
