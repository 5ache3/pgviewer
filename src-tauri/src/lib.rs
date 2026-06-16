//! PostgreSQL Explorer backend.
//!
//! Rust is the single source of truth for all database access and SQL
//! generation. The frontend never touches PostgreSQL directly — it sends typed
//! requests over Tauri IPC and renders the typed responses. The actual database
//! logic lives in the `pgcore` crate; this crate is the Tauri command layer.

mod commands;
mod error;
mod state;
mod storage;

use state::AppState;
use storage::Store;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            // History, saved queries and connection profiles live in the
            // app-config directory.
            let dir = app.path().app_config_dir()?;
            app.manage(Store::load(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection::connect,
            commands::connection::connect_string,
            commands::connection::close_database,
            commands::connection::database_info,
            commands::connection::list_connections,
            commands::connection::save_connection,
            commands::connection::delete_connection,
            commands::schema::list_tables,
            commands::schema::list_views,
            commands::schema::list_indexes,
            commands::schema::list_triggers,
            commands::schema::table_columns,
            commands::schema::table_foreign_keys,
            commands::schema::row_count,
            commands::schema::join_suggestions,
            commands::query::browse_table,
            commands::query::build_sql,
            commands::query::run_query,
            commands::query::run_raw_sql,
            commands::mutate::update_cell,
            commands::mutate::delete_row,
            commands::mutate::add_column,
            commands::mutate::drop_column,
            commands::export::export_query,
            commands::history::list_history,
            commands::history::add_history,
            commands::history::clear_history,
            commands::history::list_saved,
            commands::history::save_query,
            commands::history::delete_saved,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
