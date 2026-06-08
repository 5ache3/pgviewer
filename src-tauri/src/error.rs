//! Unified error type shared by every Tauri command.
//!
//! `AppError` serializes to `{ "code": "...", "message": "..." }` so the
//! frontend can branch on a stable machine-readable code while still showing a
//! human-readable message. Database errors bubble up from `pgcore`.

use serde::ser::{Serialize, SerializeStruct, Serializer};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("no database connection is open")]
    NoDatabase,

    #[error(transparent)]
    Core(#[from] pgcore::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Msg(String),
}

impl AppError {
    /// Stable, machine-readable error code for the frontend.
    fn code(&self) -> &'static str {
        match self {
            AppError::NoDatabase => "NO_DATABASE",
            AppError::Core(_) => "DATABASE",
            AppError::Io(_) => "IO",
            AppError::Msg(_) => "ERROR",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
