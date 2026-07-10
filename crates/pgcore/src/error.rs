use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("database error: {0}")]
    Postgres(#[from] postgres::Error),

    #[error("connection pool error: {0}")]
    Pool(#[from] r2d2::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Msg(String),
}

impl Error {
    /// Whether this is a foreign-key constraint violation (SQLSTATE 23503) —
    /// the UI offers a cascade delete when a row delete fails with this.
    pub fn is_fk_violation(&self) -> bool {
        matches!(
            self,
            Error::Postgres(e)
                if e.code() == Some(&postgres::error::SqlState::FOREIGN_KEY_VIOLATION)
        )
    }
}
