//! Schema discovery commands — thin wrappers over `pgcore::schema`.

use tauri::State;

use pgcore::pool;
use pgcore::schema::{
    self, ColumnMeta, ForeignKeyMeta, IndexMeta, JoinSuggestion, RowCount, TableMeta, TriggerMeta,
    ViewMeta,
};

use crate::commands::blocking;
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn list_tables(state: State<'_, AppState>) -> AppResult<Vec<TableMeta>> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(schema::list_tables(&mut conn)?)
    })
    .await
}

#[tauri::command]
pub async fn list_views(state: State<'_, AppState>) -> AppResult<Vec<ViewMeta>> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(schema::list_views(&mut conn)?)
    })
    .await
}

#[tauri::command]
pub async fn list_indexes(state: State<'_, AppState>) -> AppResult<Vec<IndexMeta>> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(schema::list_indexes(&mut conn)?)
    })
    .await
}

#[tauri::command]
pub async fn list_triggers(state: State<'_, AppState>) -> AppResult<Vec<TriggerMeta>> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(schema::list_triggers(&mut conn)?)
    })
    .await
}

#[tauri::command]
pub async fn table_columns(
    table: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<ColumnMeta>> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(schema::table_columns(&mut conn, &table)?)
    })
    .await
}

#[tauri::command]
pub async fn table_foreign_keys(
    table: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<ForeignKeyMeta>> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(schema::table_foreign_keys(&mut conn, &table)?)
    })
    .await
}

#[tauri::command]
pub async fn row_count(
    table: String,
    exact: bool,
    state: State<'_, AppState>,
) -> AppResult<RowCount> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(schema::row_count(&mut conn, &table, exact)?)
    })
    .await
}

#[tauri::command]
pub async fn join_suggestions(
    table: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<JoinSuggestion>> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(schema::suggest_joins(&mut conn, &table)?)
    })
    .await
}
