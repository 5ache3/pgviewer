//! Tauri command modules.
//!
//! The `postgres` client is synchronous, so every command that touches the
//! network runs its pgcore calls through [`blocking`] on the async runtime's
//! blocking thread pool. Nothing database-related ever runs on the UI thread —
//! an unreachable host or a slow query must never freeze the window.

pub mod connection;
pub mod export;
pub mod history;
pub mod mutate;
pub mod query;
pub mod schema;

use crate::error::{AppError, AppResult};

/// Run blocking database work off the UI thread.
pub(crate) async fn blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Msg(format!("database task failed: {e}")))?
}
