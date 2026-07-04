//! Connection open/close/info commands plus saved connection profiles.

use serde::Deserialize;
use tauri::State;

use pgcore::info::{self, DatabaseInfo};
use pgcore::pool::{self, ConnectOpts, SslMode};

use crate::commands::blocking;
use crate::error::{AppError, AppResult};
use crate::state::{AppState, Database};
use crate::storage::{ConnectionProfile, Store};

/// Connection parameters sent from the connection form.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    pub host: String,
    pub port: i32,
    pub dbname: String,
    pub user: String,
    #[serde(default)]
    pub password: Option<String>,
    /// "disable" | "prefer" | "require" (defaults to "prefer").
    #[serde(default)]
    pub ssl_mode: Option<String>,
}

fn parse_ssl(mode: Option<&str>) -> SslMode {
    match mode.unwrap_or("prefer") {
        "disable" => SslMode::Disable,
        "require" => SslMode::Require,
        _ => SslMode::Prefer,
    }
}

/// Connect to a PostgreSQL server and make it the active connection.
#[tauri::command]
pub async fn connect(req: ConnectRequest, state: State<'_, AppState>) -> AppResult<DatabaseInfo> {
    let port = u16::try_from(req.port).map_err(|_| AppError::Msg("invalid port".into()))?;
    let opts = ConnectOpts {
        host: req.host.clone(),
        port,
        dbname: req.dbname,
        user: req.user,
        password: req.password,
        ssl_mode: parse_ssl(req.ssl_mode.as_deref()),
    };

    // Building the pool eagerly opens a connection, so bad host/credentials fail
    // here with a clear error rather than on first query. That can block for the
    // full connect timeout on an unreachable host, hence `blocking`.
    let display_port = req.port;
    let (pool, info) = blocking(move || {
        let pool = pool::open_pool(&opts)?;
        let mut conn = pool::get_conn(&pool)?;
        let info = info::database_info(&mut conn, &opts.host, display_port)?;
        Ok((pool, info))
    })
    .await?;

    state.set(Database {
        host: req.host,
        port: req.port,
        pool,
    });
    Ok(info)
}

/// Connect using a libpq connection string (URI or key=value form) and make it
/// the active connection.
#[tauri::command]
pub async fn connect_string(
    conn_str: String,
    state: State<'_, AppState>,
) -> AppResult<DatabaseInfo> {
    let config = pool::parse_config(conn_str.trim())?;
    let (host, port) = pool::config_endpoint(&config);

    let info_host = host.clone();
    let (pool, info) = blocking(move || {
        let pool = pool::open_pool_with_config(config)?;
        let mut conn = pool::get_conn(&pool)?;
        let info = info::database_info(&mut conn, &info_host, port)?;
        Ok((pool, info))
    })
    .await?;

    state.set(Database { host, port, pool });
    Ok(info)
}

/// Metadata about the currently connected database.
#[tauri::command]
pub async fn database_info(state: State<'_, AppState>) -> AppResult<DatabaseInfo> {
    let (host, port) = state.endpoint()?;
    let pool = state.pool()?;
    blocking(move || {
        let mut conn = pool::get_conn(&pool)?;
        Ok(info::database_info(&mut conn, &host, port)?)
    })
    .await
}

/// Close the active connection, releasing all pooled connections.
#[tauri::command]
pub fn close_database(state: State<'_, AppState>) -> AppResult<()> {
    state.clear();
    Ok(())
}

// --- Saved connection profiles ---------------------------------------------

#[tauri::command]
pub fn list_connections(store: State<'_, Store>) -> Vec<ConnectionProfile> {
    store.list_connections()
}

#[tauri::command]
pub fn save_connection(
    profile: ConnectionProfile,
    store: State<'_, Store>,
) -> AppResult<ConnectionProfile> {
    store.save_connection(profile)
}

#[tauri::command]
pub fn delete_connection(id: String, store: State<'_, Store>) -> AppResult<()> {
    store.delete_connection(&id)
}
