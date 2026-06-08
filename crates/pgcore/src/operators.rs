//! Translation of a single [`Filter`] into a SQL fragment plus bound
//! parameters.
//!
//! Safety model: column names are quoted identifiers ([`ident`]); every user
//! value is bound as a `$N` parameter (collected into `params`) and never
//! interpolated. `LIKE` patterns we construct (startsWith/contains/…) escape
//! the wildcard metacharacters and declare an `ESCAPE` clause so user input is
//! matched literally. The convenience operators use `ILIKE` (case-insensitive)
//! to match the forgiving feel users expect from a visual search builder.

use crate::bind::BoundValue;
use crate::error::{Error, Result};
use crate::ident;
use crate::spec::{Filter, FilterOp};

/// Render `filter` into SQL, pushing any bound values onto `params`. Each bound
/// value gets the next positional placeholder (`$1`, `$2`, …).
pub fn render(filter: &Filter, params: &mut Vec<BoundValue>) -> Result<String> {
    let col = ident::quote_qualified(&filter.column);

    use FilterOp::*;
    let sql = match filter.op {
        IsNull => format!("{col} IS NULL"),
        IsNotNull => format!("{col} IS NOT NULL"),

        Eq => binary(&col, "=", filter, params)?,
        Neq => binary(&col, "<>", filter, params)?,
        Gt => binary(&col, ">", filter, params)?,
        Gte => binary(&col, ">=", filter, params)?,
        Lt => binary(&col, "<", filter, params)?,
        Lte => binary(&col, "<=", filter, params)?,

        // Raw patterns: the user supplies the full pattern, used verbatim
        // (case-sensitive, like SQL `LIKE`).
        Like => {
            let ph = bind(params, BoundValue::Text(value_text(filter)?));
            format!("{col} LIKE {ph}")
        }
        NotLike => {
            let ph = bind(params, BoundValue::Text(value_text(filter)?));
            format!("{col} NOT LIKE {ph}")
        }

        // Constructed patterns: escape metacharacters, match literally and
        // case-insensitively (ILIKE).
        StartsWith => like_wrapped(&col, "ILIKE", filter, params, |t| format!("{t}%"))?,
        EndsWith => like_wrapped(&col, "ILIKE", filter, params, |t| format!("%{t}"))?,
        Contains => like_wrapped(&col, "ILIKE", filter, params, |t| format!("%{t}%"))?,
        NotContains => like_wrapped(&col, "NOT ILIKE", filter, params, |t| format!("%{t}%"))?,

        In => in_clause(&col, "IN", "FALSE", filter, params)?,
        NotIn => in_clause(&col, "NOT IN", "TRUE", filter, params)?,

        Between => between(&col, filter, params)?,
    };
    Ok(sql)
}

/// Push a value as the next positional parameter, returning its `$N` placeholder.
fn bind(params: &mut Vec<BoundValue>, value: BoundValue) -> String {
    params.push(value);
    format!("${}", params.len())
}

fn binary(col: &str, op: &str, filter: &Filter, params: &mut Vec<BoundValue>) -> Result<String> {
    let value = filter
        .value
        .as_ref()
        .ok_or_else(|| Error::Msg(format!("operator '{op}' requires a value")))?;
    let ph = bind(params, BoundValue::from_json(value));
    Ok(format!("{col} {op} {ph}"))
}

fn like_wrapped(
    col: &str,
    op: &str,
    filter: &Filter,
    params: &mut Vec<BoundValue>,
    wrap: impl Fn(&str) -> String,
) -> Result<String> {
    let pattern = wrap(&escape_like(&value_text(filter)?));
    let ph = bind(params, BoundValue::Text(pattern));
    Ok(format!("{col} {op} {ph} ESCAPE '\\'"))
}

fn in_clause(
    col: &str,
    op: &str,
    empty_literal: &str,
    filter: &Filter,
    params: &mut Vec<BoundValue>,
) -> Result<String> {
    let items = match filter.value.as_ref() {
        Some(serde_json::Value::Array(items)) => items,
        _ => return Err(Error::Msg(format!("operator '{op}' requires an array value"))),
    };
    // `col IN ()` is a syntax error; an empty set is a constant truth value.
    if items.is_empty() {
        return Ok(empty_literal.to_string());
    }
    let placeholders: Vec<String> = items
        .iter()
        .map(|item| bind(params, BoundValue::from_json(item)))
        .collect();
    Ok(format!("{col} {op} ({})", placeholders.join(", ")))
}

fn between(col: &str, filter: &Filter, params: &mut Vec<BoundValue>) -> Result<String> {
    let low = filter
        .value
        .as_ref()
        .ok_or_else(|| Error::Msg("BETWEEN requires a lower bound".into()))?;
    let high = filter
        .value2
        .as_ref()
        .ok_or_else(|| Error::Msg("BETWEEN requires an upper bound".into()))?;
    let p1 = bind(params, BoundValue::from_json(low));
    let p2 = bind(params, BoundValue::from_json(high));
    Ok(format!("{col} BETWEEN {p1} AND {p2}"))
}

/// Extract a value as text (for LIKE patterns). Coerces numbers/bools to their
/// textual form; errors when no value was supplied.
fn value_text(filter: &Filter) -> Result<String> {
    match filter.value.as_ref() {
        Some(serde_json::Value::String(s)) => Ok(s.clone()),
        Some(serde_json::Value::Number(n)) => Ok(n.to_string()),
        Some(serde_json::Value::Bool(b)) => Ok(b.to_string()),
        Some(serde_json::Value::Null) | None => {
            Err(Error::Msg("this operator requires a value".into()))
        }
        Some(other) => Ok(other.to_string()),
    }
}

/// Escape SQL `LIKE` metacharacters so user text matches literally under
/// `ESCAPE '\'`.
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
