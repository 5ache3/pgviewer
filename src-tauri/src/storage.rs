//! On-disk persistence for query history, saved queries and connection
//! profiles.
//!
//! Stored as JSON in the app-config directory — never inside the user's
//! database. Kept in memory behind a `Mutex` and flushed to disk on change.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const HISTORY_FILE: &str = "history.json";
const SAVED_FILE: &str = "saved.json";
const CONNECTIONS_FILE: &str = "connections.json";
const HISTORY_CAP: usize = 200;

/// A saved connection profile. The password is persisted only when the user
/// opts in (`save_password`); otherwise it is `None` and prompted at connect
/// time. Stored as plaintext JSON in the app-config directory — local only,
/// never synced.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub dbname: String,
    pub user: String,
    #[serde(default)]
    pub password: Option<String>,
    pub ssl_mode: String,
    /// When set, this profile is a raw libpq connection string (URI or
    /// key=value); the discrete host/user/… fields are then unused.
    #[serde(default)]
    pub connection_string: Option<String>,
    #[serde(default)]
    pub save_password: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub sql: String,
    pub table: Option<String>,
    pub row_count: Option<i64>,
    pub elapsed_ms: f64,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub sql: String,
    pub created_at: i64,
}

pub struct Store {
    dir: PathBuf,
    history: Mutex<Vec<HistoryEntry>>,
    saved: Mutex<Vec<SavedQuery>>,
    connections: Mutex<Vec<ConnectionProfile>>,
}

impl Store {
    /// Load existing history/saved/connection files from `dir`, creating the
    /// directory if needed. Missing or unparseable files start empty.
    pub fn load(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        let history = read_json(&dir.join(HISTORY_FILE)).unwrap_or_default();
        let saved = read_json(&dir.join(SAVED_FILE)).unwrap_or_default();
        let connections = read_json(&dir.join(CONNECTIONS_FILE)).unwrap_or_default();
        Store {
            dir,
            history: Mutex::new(history),
            saved: Mutex::new(saved),
            connections: Mutex::new(connections),
        }
    }

    // --- Connection profiles -----------------------------------------------

    pub fn list_connections(&self) -> Vec<ConnectionProfile> {
        self.connections.lock().unwrap().clone()
    }

    /// Insert a new profile or update the existing one with the same `id`.
    pub fn save_connection(&self, mut profile: ConnectionProfile) -> AppResult<ConnectionProfile> {
        if !profile.save_password {
            profile.password = None;
        }
        if profile.id.is_empty() {
            profile.id = new_id();
        }
        if profile.created_at == 0 {
            profile.created_at = now_millis();
        }
        let mut connections = self.connections.lock().unwrap();
        match connections.iter_mut().find(|c| c.id == profile.id) {
            Some(existing) => *existing = profile.clone(),
            None => connections.insert(0, profile.clone()),
        }
        write_json(&self.dir.join(CONNECTIONS_FILE), &*connections)?;
        Ok(profile)
    }

    pub fn delete_connection(&self, id: &str) -> AppResult<()> {
        let mut connections = self.connections.lock().unwrap();
        connections.retain(|c| c.id != id);
        write_json(&self.dir.join(CONNECTIONS_FILE), &*connections)
    }

    // --- History -----------------------------------------------------------

    pub fn list_history(&self) -> Vec<HistoryEntry> {
        self.history.lock().unwrap().clone()
    }

    pub fn add_history(
        &self,
        sql: String,
        table: Option<String>,
        row_count: Option<i64>,
        elapsed_ms: f64,
    ) -> AppResult<()> {
        let mut history = self.history.lock().unwrap();
        // Skip consecutive duplicates (e.g. re-running the same query).
        if history.first().map(|e| e.sql.as_str()) == Some(sql.as_str()) {
            return Ok(());
        }
        history.insert(
            0,
            HistoryEntry {
                id: new_id(),
                sql,
                table,
                row_count,
                elapsed_ms,
                timestamp: now_millis(),
            },
        );
        history.truncate(HISTORY_CAP);
        write_json(&self.dir.join(HISTORY_FILE), &*history)
    }

    pub fn clear_history(&self) -> AppResult<()> {
        let mut history = self.history.lock().unwrap();
        history.clear();
        write_json(&self.dir.join(HISTORY_FILE), &*history)
    }

    // --- Saved queries -----------------------------------------------------

    pub fn list_saved(&self) -> Vec<SavedQuery> {
        self.saved.lock().unwrap().clone()
    }

    pub fn save_query(&self, name: String, sql: String) -> AppResult<SavedQuery> {
        let entry = SavedQuery {
            id: new_id(),
            name,
            sql,
            created_at: now_millis(),
        };
        let mut saved = self.saved.lock().unwrap();
        saved.insert(0, entry.clone());
        write_json(&self.dir.join(SAVED_FILE), &*saved)?;
        Ok(entry)
    }

    pub fn delete_saved(&self, id: &str) -> AppResult<()> {
        let mut saved = self.saved.lock().unwrap();
        saved.retain(|q| q.id != id);
        write_json(&self.dir.join(SAVED_FILE), &*saved)
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Option<T> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> AppResult<()> {
    let json = serde_json::to_vec_pretty(value).map_err(|e| AppError::Msg(e.to_string()))?;
    fs::write(path, json)?;
    Ok(())
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    // Monotonic-enough unique id without pulling in a uuid dependency.
    format!("{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos())
}
