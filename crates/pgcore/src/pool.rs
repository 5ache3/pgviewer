//! r2d2 connection pool over the synchronous `postgres` client.
//!
//! Unlike the SQLite viewer (which opens a local file read-only), PostgreSQL
//! connections are network sessions described by host/port/credentials. We keep
//! a small pool so concurrent commands (grid page, row counts, schema reads)
//! never block on one shared connection. The visual builder only ever emits
//! `SELECT`s; writes happen exclusively through the explicit, user-initiated
//! [`crate::mutate`] path (cell edits and column add/drop).

use std::time::Duration;

use native_tls::TlsConnector;
use postgres::config::{Host, SslMode as PgSslMode};
use postgres::Config;
use postgres_native_tls::MakeTlsConnector;
use r2d2_postgres::PostgresConnectionManager;

use crate::error::{Error, Result};

pub type Manager = PostgresConnectionManager<MakeTlsConnector>;
pub type DbPool = r2d2::Pool<Manager>;
pub type PooledConn = r2d2::PooledConnection<Manager>;

/// How to negotiate TLS, mirroring the common libpq sslmodes the UI exposes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SslMode {
    /// Never use TLS.
    Disable,
    /// Use TLS if the server supports it, else fall back to plaintext.
    Prefer,
    /// Require TLS (but, like libpq's `require`, do not verify the certificate).
    Require,
}

/// Everything needed to open a connection. Passwords live only in memory for
/// the session; persistence of connection *profiles* is the app layer's job.
#[derive(Debug, Clone)]
pub struct ConnectOpts {
    pub host: String,
    pub port: u16,
    pub dbname: String,
    pub user: String,
    pub password: Option<String>,
    pub ssl_mode: SslMode,
}

impl ConnectOpts {
    fn to_config(&self) -> Config {
        let mut config = Config::new();
        config
            .host(&self.host)
            .port(self.port)
            .dbname(&self.dbname)
            .user(&self.user)
            .application_name("pgviewer")
            .connect_timeout(Duration::from_secs(10))
            .ssl_mode(match self.ssl_mode {
                SslMode::Disable => PgSslMode::Disable,
                SslMode::Prefer => PgSslMode::Prefer,
                SslMode::Require => PgSslMode::Require,
            });
        if let Some(password) = &self.password {
            config.password(password);
        }
        config
    }
}

/// `require`/`prefer` encrypt the transport but, like libpq's `require`, do not
/// verify the server certificate — matching how DB GUI tools behave.
fn make_tls() -> Result<MakeTlsConnector> {
    let connector = TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| Error::Msg(format!("tls setup failed: {e}")))?;
    Ok(MakeTlsConnector::new(connector))
}

/// Build a connection pool from a fully-formed [`Config`]. The pool eagerly
/// opens one connection so bad host/credentials fail fast with a clear error
/// instead of on first use.
pub fn open_pool_with_config(config: Config) -> Result<DbPool> {
    let manager = PostgresConnectionManager::new(config, make_tls()?);
    Ok(r2d2::Pool::builder()
        .max_size(4)
        .connection_timeout(Duration::from_secs(10))
        .build(manager)?)
}

/// Build a connection pool from structured [`ConnectOpts`].
pub fn open_pool(opts: &ConnectOpts) -> Result<DbPool> {
    open_pool_with_config(opts.to_config())
}

/// Parse a libpq connection string — either URI form
/// (`postgres://user:pass@host:5432/db?sslmode=require`) or key=value form
/// (`host=... dbname=...`) — into a [`Config`].
pub fn parse_config(conn_str: &str) -> Result<Config> {
    conn_str
        .parse::<Config>()
        .map_err(|e| Error::Msg(format!("invalid connection string: {e}")))
}

/// The TCP host and port a [`Config`] will connect to, for display in the UI.
pub fn config_endpoint(config: &Config) -> (String, i32) {
    let host = config
        .get_hosts()
        .iter()
        .find_map(|h| match h {
            Host::Tcp(s) => Some(s.clone()),
            _ => None,
        })
        .unwrap_or_else(|| "localhost".to_string());
    let port = config.get_ports().first().copied().unwrap_or(5432) as i32;
    (host, port)
}

/// Borrow a connection from the pool, mapping pool errors into [`crate::Error`].
pub fn get_conn(pool: &DbPool) -> Result<PooledConn> {
    Ok(pool.get()?)
}
