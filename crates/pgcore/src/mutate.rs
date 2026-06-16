//! Write operations: editing a cell and adding/dropping columns.
//!
//! The visual *browser* only ever generates `SELECT`s; these are the explicit,
//! user-initiated mutations. Every value is bound as a `$N` parameter and every
//! identifier is quoted, so neither cell values nor column names can inject SQL.
//! A column **type** can't be quoted (it's not an identifier), so it is passed
//! through a strict allow-list ([`validate_type`]) instead.

use postgres::types::ToSql;
use postgres::Client;
use serde::Deserialize;

use crate::bind::BoundValue;
use crate::error::{Error, Result};
use crate::ident;

/// A single `column = value` predicate identifying the row to update — the
/// table's primary key, sent by the frontend with the row's current PK values.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PkPredicate {
    pub column: String,
    pub value: serde_json::Value,
}

/// Build a parameterized `UPDATE` that sets one column on the row matched by the
/// primary-key predicates. `$1` is the new value; `$2..` are the PK values.
fn build_update_sql(table: &str, column: &str, pk_columns: &[&str]) -> String {
    let where_clause = pk_columns
        .iter()
        .enumerate()
        .map(|(i, col)| format!("{} = ${}", ident::quote(col), i + 2))
        .collect::<Vec<_>>()
        .join(" AND ");
    format!(
        "UPDATE {} SET {} = $1 WHERE {}",
        ident::quote_qualified(table),
        ident::quote(column),
        where_clause
    )
}

/// Set `column` to `value` on the single row identified by `pk`. Returns the
/// number of rows affected (0 means the predicate matched nothing).
pub fn update_cell(
    conn: &mut Client,
    table: &str,
    column: &str,
    value: &serde_json::Value,
    pk: &[PkPredicate],
) -> Result<u64> {
    if pk.is_empty() {
        return Err(Error::Msg(
            "cannot edit: this table has no primary key to identify the row".into(),
        ));
    }

    let pk_columns: Vec<&str> = pk.iter().map(|p| p.column.as_str()).collect();
    let sql = build_update_sql(table, column, &pk_columns);

    let mut params: Vec<BoundValue> = Vec::with_capacity(pk.len() + 1);
    params.push(BoundValue::from_json(value));
    for p in pk {
        params.push(BoundValue::from_json(&p.value));
    }
    let bound: Vec<&(dyn ToSql + Sync)> = params.iter().map(|p| p as &(dyn ToSql + Sync)).collect();

    Ok(conn.execute(sql.as_str(), &bound)?)
}

/// Build a parameterized `DELETE` matching the row identified by the
/// primary-key predicates. `$1..` are the PK values.
fn build_delete_sql(table: &str, pk_columns: &[&str]) -> String {
    let where_clause = pk_columns
        .iter()
        .enumerate()
        .map(|(i, col)| format!("{} = ${}", ident::quote(col), i + 1))
        .collect::<Vec<_>>()
        .join(" AND ");
    format!(
        "DELETE FROM {} WHERE {}",
        ident::quote_qualified(table),
        where_clause
    )
}

/// Delete the single row identified by `pk`. Destructive — callers must confirm
/// with the user. Returns the number of rows affected (0 means nothing matched).
pub fn delete_row(conn: &mut Client, table: &str, pk: &[PkPredicate]) -> Result<u64> {
    if pk.is_empty() {
        return Err(Error::Msg(
            "cannot delete: this table has no primary key to identify the row".into(),
        ));
    }

    let pk_columns: Vec<&str> = pk.iter().map(|p| p.column.as_str()).collect();
    let sql = build_delete_sql(table, &pk_columns);

    let params: Vec<BoundValue> = pk.iter().map(|p| BoundValue::from_json(&p.value)).collect();
    let bound: Vec<&(dyn ToSql + Sync)> = params.iter().map(|p| p as &(dyn ToSql + Sync)).collect();

    Ok(conn.execute(sql.as_str(), &bound)?)
}

/// Add a column to a table. `data_type` is validated against an allow-list
/// before interpolation since a type name cannot be parameterized or quoted.
pub fn add_column(
    conn: &mut Client,
    table: &str,
    name: &str,
    data_type: &str,
    nullable: bool,
) -> Result<()> {
    let ty = validate_type(data_type)?;
    let not_null = if nullable { "" } else { " NOT NULL" };
    let sql = format!(
        "ALTER TABLE {} ADD COLUMN {} {}{}",
        ident::quote_qualified(table),
        ident::quote(name),
        ty,
        not_null
    );
    conn.batch_execute(&sql)?;
    Ok(())
}

/// Drop a column from a table. Destructive — callers must confirm with the user.
pub fn drop_column(conn: &mut Client, table: &str, name: &str) -> Result<()> {
    let sql = format!(
        "ALTER TABLE {} DROP COLUMN {}",
        ident::quote_qualified(table),
        ident::quote(name)
    );
    conn.batch_execute(&sql)?;
    Ok(())
}

/// Validate a SQL type name. Allows letters/digits and the punctuation real PG
/// types use — `varchar(255)`, `numeric(10, 2)`, `timestamptz`, `int[]` — and
/// rejects anything that could break out of the type position (quotes, `;`, …).
fn validate_type(data_type: &str) -> Result<String> {
    let s = data_type.trim();
    if s.is_empty() {
        return Err(Error::Msg("column type is required".into()));
    }
    let allowed = s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '_' | '(' | ')' | ',' | '[' | ']'));
    if !allowed || s.len() > 64 {
        return Err(Error::Msg(format!("invalid column type: {s:?}")));
    }
    Ok(s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_sql_quotes_and_numbers_placeholders() {
        let sql = build_update_sql("public.users", "name", &["id"]);
        assert_eq!(sql, "UPDATE \"public\".\"users\" SET \"name\" = $1 WHERE \"id\" = $2");
    }

    #[test]
    fn update_sql_supports_composite_keys() {
        let sql = build_update_sql("orders", "total", &["order_id", "line"]);
        assert_eq!(
            sql,
            "UPDATE \"orders\" SET \"total\" = $1 WHERE \"order_id\" = $2 AND \"line\" = $3"
        );
    }

    #[test]
    fn delete_sql_quotes_and_numbers_placeholders() {
        let sql = build_delete_sql("public.users", &["id"]);
        assert_eq!(sql, "DELETE FROM \"public\".\"users\" WHERE \"id\" = $1");
    }

    #[test]
    fn delete_sql_supports_composite_keys() {
        let sql = build_delete_sql("orders", &["order_id", "line"]);
        assert_eq!(
            sql,
            "DELETE FROM \"orders\" WHERE \"order_id\" = $1 AND \"line\" = $2"
        );
    }

    #[test]
    fn type_validation_accepts_real_types_and_rejects_injection() {
        assert!(validate_type("integer").is_ok());
        assert!(validate_type("varchar(255)").is_ok());
        assert!(validate_type("numeric(10, 2)").is_ok());
        assert!(validate_type("int[]").is_ok());
        assert!(validate_type("timestamptz").is_ok());

        assert!(validate_type("text; DROP TABLE users").is_err());
        assert!(validate_type("text\"").is_err());
        assert!(validate_type("").is_err());
    }
}
