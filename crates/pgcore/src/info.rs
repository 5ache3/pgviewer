//! Server- and database-level metadata.

use postgres::Client;
use serde::Serialize;

use crate::error::Result;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub host: String,
    pub port: i32,
    pub database: String,
    pub user: String,
    pub server_version: String,
    /// On-disk size of the current database, in bytes.
    pub size_bytes: i64,
    pub encoding: String,
}

/// Gather metadata about the connected database. `host`/`port` are supplied by
/// the caller (they describe how we connected); everything else comes from the
/// server.
pub fn database_info(conn: &mut Client, host: &str, port: i32) -> Result<DatabaseInfo> {
    let row = conn.query_one(
        "SELECT current_database(), \
                current_user, \
                current_setting('server_version'), \
                pg_database_size(current_database())::int8, \
                current_setting('server_encoding')",
        &[],
    )?;

    Ok(DatabaseInfo {
        host: host.to_string(),
        port,
        database: row.get::<_, &str>(0).to_string(),
        user: row.get::<_, &str>(1).to_string(),
        server_version: row.get::<_, &str>(2).to_string(),
        size_bytes: row.get(3),
        encoding: row.get::<_, &str>(4).to_string(),
    })
}
