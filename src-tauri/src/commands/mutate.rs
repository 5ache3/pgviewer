//! Write commands: edit a cell, add a column, drop a column. Thin wrappers over
//! `pgcore::mutate`.

use tauri::State;

use pgcore::mutate::{self, PkPredicate};

use crate::error::AppResult;
use crate::state::AppState;

/// Update a single cell, identifying the row by its primary key. Returns the
/// number of rows affected (0 if the row no longer matches).
#[tauri::command]
pub fn update_cell(
    table: String,
    column: String,
    value: serde_json::Value,
    pk: Vec<PkPredicate>,
    state: State<'_, AppState>,
) -> AppResult<u64> {
    let mut conn = state.conn()?;
    Ok(mutate::update_cell(&mut conn, &table, &column, &value, &pk)?)
}

/// Delete a single row, identifying it by its primary key. Destructive — the
/// frontend confirms with the user first. Returns rows affected (0 if gone).
#[tauri::command]
pub fn delete_row(
    table: String,
    pk: Vec<PkPredicate>,
    state: State<'_, AppState>,
) -> AppResult<u64> {
    let mut conn = state.conn()?;
    Ok(mutate::delete_row(&mut conn, &table, &pk)?)
}

#[tauri::command]
pub fn add_column(
    table: String,
    name: String,
    data_type: String,
    nullable: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let mut conn = state.conn()?;
    Ok(mutate::add_column(&mut conn, &table, &name, &data_type, nullable)?)
}

#[tauri::command]
pub fn drop_column(table: String, name: String, state: State<'_, AppState>) -> AppResult<()> {
    let mut conn = state.conn()?;
    Ok(mutate::drop_column(&mut conn, &table, &name)?)
}
