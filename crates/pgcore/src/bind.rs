//! Parameter binding for PostgreSQL's `$N` placeholders.
//!
//! The visual builder produces values as untyped JSON (a number, string, bool).
//! PostgreSQL, unlike SQLite, is statically typed: when the server prepares a
//! query like `WHERE created_at > $1` it tells the client the exact type each
//! parameter must be sent as. [`BoundValue`] therefore implements [`ToSql`] by
//! dispatching on that requested [`Type`] and encoding the user's value into the
//! matching Rust type (parsing text into a timestamp/uuid/decimal as needed),
//! falling back to a textual encoding for anything else. Values are *always*
//! bound — never interpolated — so this is the project's injection boundary.

use std::error::Error as StdError;
use std::str::FromStr;

use bytes::BytesMut;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use postgres_types::{to_sql_checked, IsNull, ToSql, Type};
use rust_decimal::Decimal;
use uuid::Uuid;

type BoxError = Box<dyn StdError + Sync + Send>;

/// A value to bind to a parameter placeholder. Mirrors the JSON shapes the
/// frontend can produce for a filter value.
#[derive(Debug, Clone, PartialEq)]
pub enum BoundValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
}

impl BoundValue {
    /// Convert a JSON value from the spec into a bound value.
    pub fn from_json(value: &serde_json::Value) -> BoundValue {
        use serde_json::Value as J;
        match value {
            J::Null => BoundValue::Null,
            J::Bool(b) => BoundValue::Bool(*b),
            J::Number(n) => n
                .as_i64()
                .map(BoundValue::Int)
                .or_else(|| n.as_f64().map(BoundValue::Float))
                .unwrap_or(BoundValue::Null),
            J::String(s) => BoundValue::Text(s.clone()),
            // Arrays/objects reach here only via fallbacks; keep their JSON text
            // so nothing is silently dropped.
            other => BoundValue::Text(other.to_string()),
        }
    }

    /// Textual form, used for the inlined SQL preview and as the text-encoding
    /// fallback for column types we don't special-case.
    pub fn as_text(&self) -> String {
        match self {
            BoundValue::Null => String::new(),
            BoundValue::Bool(b) => b.to_string(),
            BoundValue::Int(i) => i.to_string(),
            BoundValue::Float(f) => f.to_string(),
            BoundValue::Text(s) => s.clone(),
        }
    }

    fn as_bool(&self) -> Result<bool, BoxError> {
        match self {
            BoundValue::Bool(b) => Ok(*b),
            BoundValue::Int(i) => Ok(*i != 0),
            BoundValue::Text(s) => match s.trim().to_ascii_lowercase().as_str() {
                "t" | "true" | "1" | "yes" | "y" | "on" => Ok(true),
                "f" | "false" | "0" | "no" | "n" | "off" => Ok(false),
                _ => Err(msg(format!("cannot interpret {s:?} as a boolean"))),
            },
            BoundValue::Float(_) | BoundValue::Null => Err(msg("expected a boolean value")),
        }
    }

    fn as_i64(&self) -> Result<i64, BoxError> {
        match self {
            BoundValue::Int(i) => Ok(*i),
            BoundValue::Bool(b) => Ok(*b as i64),
            BoundValue::Float(f) => Ok(*f as i64),
            BoundValue::Text(s) => s
                .trim()
                .parse::<i64>()
                .map_err(|_| msg(format!("cannot interpret {s:?} as an integer"))),
            BoundValue::Null => Err(msg("expected an integer value")),
        }
    }

    fn as_f64(&self) -> Result<f64, BoxError> {
        match self {
            BoundValue::Float(f) => Ok(*f),
            BoundValue::Int(i) => Ok(*i as f64),
            BoundValue::Text(s) => s
                .trim()
                .parse::<f64>()
                .map_err(|_| msg(format!("cannot interpret {s:?} as a number"))),
            BoundValue::Bool(_) | BoundValue::Null => Err(msg("expected a numeric value")),
        }
    }

    fn as_decimal(&self) -> Result<Decimal, BoxError> {
        match self {
            BoundValue::Int(i) => Ok(Decimal::from(*i)),
            BoundValue::Float(f) => Decimal::from_str(&f.to_string())
                .map_err(|e| msg(format!("invalid decimal: {e}"))),
            BoundValue::Text(s) => {
                Decimal::from_str(s.trim()).map_err(|e| msg(format!("invalid decimal: {e}")))
            }
            BoundValue::Bool(_) | BoundValue::Null => Err(msg("expected a numeric value")),
        }
    }

    fn as_json(&self) -> Result<serde_json::Value, BoxError> {
        match self {
            BoundValue::Text(s) => serde_json::from_str(s)
                .or_else(|_| Ok(serde_json::Value::String(s.clone()))),
            BoundValue::Int(i) => Ok(serde_json::json!(i)),
            BoundValue::Float(f) => Ok(serde_json::json!(f)),
            BoundValue::Bool(b) => Ok(serde_json::json!(b)),
            BoundValue::Null => Ok(serde_json::Value::Null),
        }
    }

    fn as_uuid(&self) -> Result<Uuid, BoxError> {
        let s = self.as_text();
        Uuid::parse_str(s.trim()).map_err(|e| msg(format!("invalid uuid: {e}")))
    }

    fn as_naive_datetime(&self) -> Result<NaiveDateTime, BoxError> {
        let s = self.as_text();
        let s = s.trim();
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f")
            .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f"))
            .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S"))
            .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
            .or_else(|_| {
                NaiveDate::parse_from_str(s, "%Y-%m-%d").map(|d| d.and_hms_opt(0, 0, 0).unwrap())
            })
            .map_err(|e| msg(format!("invalid timestamp {s:?}: {e}")))
    }

    fn as_utc_datetime(&self) -> Result<DateTime<Utc>, BoxError> {
        let s = self.as_text();
        let s = s.trim();
        DateTime::parse_from_rfc3339(s)
            .map(|dt| dt.with_timezone(&Utc))
            .or_else(|_| self.as_naive_datetime().map(|naive| naive.and_utc()))
            .map_err(|e| msg(format!("invalid timestamptz {s:?}: {e}")))
    }

    fn as_naive_date(&self) -> Result<NaiveDate, BoxError> {
        let s = self.as_text();
        NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d")
            .map_err(|e| msg(format!("invalid date {s:?}: {e}")))
    }

    fn as_naive_time(&self) -> Result<NaiveTime, BoxError> {
        let s = self.as_text();
        let s = s.trim();
        NaiveTime::parse_from_str(s, "%H:%M:%S%.f")
            .or_else(|_| NaiveTime::parse_from_str(s, "%H:%M:%S"))
            .map_err(|e| msg(format!("invalid time {s:?}: {e}")))
    }
}

impl ToSql for BoundValue {
    fn to_sql(&self, ty: &Type, out: &mut BytesMut) -> Result<IsNull, BoxError> {
        if matches!(self, BoundValue::Null) {
            return Ok(IsNull::Yes);
        }

        // PostgreSQL has told us the exact type this placeholder expects; encode
        // the value into the matching Rust type. `Type` is a struct, not an
        // enum, so we compare against its associated consts.
        if *ty == Type::BOOL {
            self.as_bool()?.to_sql(ty, out)
        } else if *ty == Type::INT2 {
            (self.as_i64()? as i16).to_sql(ty, out)
        } else if *ty == Type::INT4 {
            (self.as_i64()? as i32).to_sql(ty, out)
        } else if *ty == Type::INT8 {
            self.as_i64()?.to_sql(ty, out)
        } else if *ty == Type::OID {
            (self.as_i64()? as u32).to_sql(ty, out)
        } else if *ty == Type::FLOAT4 {
            (self.as_f64()? as f32).to_sql(ty, out)
        } else if *ty == Type::FLOAT8 {
            self.as_f64()?.to_sql(ty, out)
        } else if *ty == Type::NUMERIC {
            self.as_decimal()?.to_sql(ty, out)
        } else if *ty == Type::JSON || *ty == Type::JSONB {
            self.as_json()?.to_sql(ty, out)
        } else if *ty == Type::UUID {
            self.as_uuid()?.to_sql(ty, out)
        } else if *ty == Type::TIMESTAMP {
            self.as_naive_datetime()?.to_sql(ty, out)
        } else if *ty == Type::TIMESTAMPTZ {
            self.as_utc_datetime()?.to_sql(ty, out)
        } else if *ty == Type::DATE {
            self.as_naive_date()?.to_sql(ty, out)
        } else if *ty == Type::TIME {
            self.as_naive_time()?.to_sql(ty, out)
        } else {
            // TEXT / VARCHAR / NAME / CHAR / enums / unknown: send as text.
            self.as_text().to_sql(&Type::TEXT, out)
        }
    }

    fn accepts(_ty: &Type) -> bool {
        // We adapt to whatever type the server requests in `to_sql`.
        true
    }

    to_sql_checked!();
}

fn msg(m: impl Into<String>) -> BoxError {
    Box::<dyn StdError + Sync + Send>::from(m.into())
}
