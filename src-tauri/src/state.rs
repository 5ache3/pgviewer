//! Application state held by Tauri's managed-state container.
//!
//! At most one database connection is open at a time. Connections are served
//! from a `pgcore` r2d2 pool so concurrent commands (grid page, row counts,
//! schema reads) never block on a single shared connection.

use std::sync::RwLock;

use pgcore::pool::DbPool;

use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct AppState {
    db: RwLock<Option<Database>>,
}

pub struct Database {
    /// Host we connected to (kept for `database_info`, which reports it back).
    pub host: String,
    pub port: i32,
    pub pool: DbPool,
}

impl AppState {
    /// Replace the current connection (closing any previous one).
    pub fn set(&self, db: Database) {
        *self.db.write().expect("state lock poisoned") = Some(db);
    }

    /// Close the current connection, dropping the pool and all its connections.
    pub fn clear(&self) {
        *self.db.write().expect("state lock poisoned") = None;
    }

    /// `(host, port)` of the active connection.
    pub fn endpoint(&self) -> AppResult<(String, i32)> {
        let guard = self.db.read().expect("state lock poisoned");
        let db = guard.as_ref().ok_or(AppError::NoDatabase)?;
        Ok((db.host.clone(), db.port))
    }

    /// Clone a handle to the active pool. Cheap (the pool is an `Arc`
    /// internally), so blocking work can borrow connections on a background
    /// thread without holding the state lock.
    pub fn pool(&self) -> AppResult<DbPool> {
        let guard = self.db.read().expect("state lock poisoned");
        let db = guard.as_ref().ok_or(AppError::NoDatabase)?;
        Ok(db.pool.clone())
    }
}
