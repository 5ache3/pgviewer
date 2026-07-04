//! Write commands: edit a cell, add a column, drop a column. Thin wrappers over
//! `pgcore::mutate`.

use tauri::State;

use pgcore::mutate::{self, PkPredicate};
use pgcore::pool;

use crate::commands::blocking;
use crate::error::AppResult;
use crate::state::AppState;

/// Update a single cell, identifying the row by its primary key. Returns the
/// number of rows affected (0 if the row no longer matches).
#[tauri::command]
pub async fn update_cell(
    table: String,
    column: String,
    value: serde_json::Value,
    pk: Vec<PkPredicate>,
    state: State<'_, AppState>,
) -> AppResult<u64> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(mutate::update_cell(&mut conn, &table, &column, &value, &pk)?)
    })
    .await
}

/// Delete a single row, identifying it by its primary key. Destructive — the
/// frontend confirms with the user first. Returns rows affected (0 if gone).
#[tauri::command]
pub async fn delete_row(
    table: String,
    pk: Vec<PkPredicate>,
    state: State<'_, AppState>,
) -> AppResult<u64> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(mutate::delete_row(&mut conn, &table, &pk)?)
    })
    .await
}

#[tauri::command]
pub async fn add_column(
    table: String,
    name: String,
    data_type: String,
    nullable: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(mutate::add_column(&mut conn, &table, &name, &data_type, nullable)?)
    })
    .await
}

#[tauri::command]
pub async fn drop_column(
    table: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(mutate::drop_column(&mut conn, &table, &name)?)
    })
    .await
}
