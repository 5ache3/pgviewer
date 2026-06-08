//! Query-history and saved-query commands, backed by [`crate::storage::Store`].

use tauri::State;

use crate::error::AppResult;
use crate::storage::{HistoryEntry, SavedQuery, Store};

#[tauri::command]
pub fn list_history(store: State<'_, Store>) -> Vec<HistoryEntry> {
    store.list_history()
}

#[tauri::command]
pub fn add_history(
    sql: String,
    table: Option<String>,
    row_count: Option<i64>,
    elapsed_ms: f64,
    store: State<'_, Store>,
) -> AppResult<()> {
    store.add_history(sql, table, row_count, elapsed_ms)
}

#[tauri::command]
pub fn clear_history(store: State<'_, Store>) -> AppResult<()> {
    store.clear_history()
}

#[tauri::command]
pub fn list_saved(store: State<'_, Store>) -> Vec<SavedQuery> {
    store.list_saved()
}

#[tauri::command]
pub fn save_query(name: String, sql: String, store: State<'_, Store>) -> AppResult<SavedQuery> {
    store.save_query(name, sql)
}

#[tauri::command]
pub fn delete_saved(id: String, store: State<'_, Store>) -> AppResult<()> {
    store.delete_saved(&id)
}
