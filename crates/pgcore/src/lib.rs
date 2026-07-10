//! Pure PostgreSQL access and SQL generation.
//!
//! This crate is deliberately free of any UI/Tauri dependency so its logic
//! (schema introspection, value mapping, SQL building, pagination) can be unit
//! tested in isolation. The Tauri app wraps these functions in commands and
//! owns connection state.

pub mod bind;
pub mod builder;
pub mod cascade;
pub mod error;
pub mod export;
pub mod ident;
pub mod info;
pub mod mutate;
pub mod operators;
pub mod pool;
pub mod query;
pub mod schema;
pub mod spec;
pub mod value;

pub use error::{Error, Result};
