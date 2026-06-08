//! Schema discovery from `information_schema` and `pg_catalog`.
//!
//! All of these are cheap, index-backed catalog reads — schema discovery must
//! feel instant even on large databases. Row counts are intentionally *not*
//! part of schema discovery (see [`row_count`]); they are fetched lazily so
//! opening a table never blocks on a `COUNT(*)`.
//!
//! PostgreSQL has multiple schemas. Objects in `public` are named bare
//! (`users`); objects in any other user schema are qualified (`sales.orders`).
//! [`quote_qualified`](crate::ident::quote_qualified) turns either form into a
//! safely-quoted reference.

use postgres::Client;
use serde::Serialize;

use crate::error::Result;
use crate::ident;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMeta {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewMeta {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMeta {
    pub name: String,
    pub table: String,
    pub unique: bool,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerMeta {
    pub name: String,
    pub table: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
    pub not_null: bool,
    /// Position within the primary key (0 = not part of the PK, 1-based otherwise).
    pub pk: i64,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyMeta {
    pub id: i64,
    pub from_column: String,
    pub to_table: String,
    pub to_column: String,
    pub on_update: String,
    pub on_delete: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowCount {
    pub table: String,
    pub count: i64,
    pub exact: bool,
}

/// Schemas we always hide from the explorer.
const SYSTEM_SCHEMAS: &str = "('pg_catalog', 'information_schema', 'pg_toast')";

/// Display a `(schema, name)` pair: bare for `public`, qualified otherwise.
fn qualify(schema: &str, name: &str) -> String {
    if schema == "public" {
        name.to_string()
    } else {
        format!("{schema}.{name}")
    }
}

/// Split a possibly-qualified object name into `(schema, name)`, defaulting the
/// schema to `public`.
fn split_table(table: &str) -> (&str, &str) {
    match table.split_once('.') {
        Some((schema, name)) => (schema, name),
        None => ("public", table),
    }
}

/// User tables across all non-system schemas, alphabetically.
pub fn list_tables(conn: &mut Client) -> Result<Vec<TableMeta>> {
    let rows = conn.query(
        &format!(
            "SELECT table_schema, table_name \
             FROM information_schema.tables \
             WHERE table_type = 'BASE TABLE' \
               AND table_schema NOT IN {SYSTEM_SCHEMAS} \
             ORDER BY table_schema, table_name"
        ),
        &[],
    )?;
    Ok(rows
        .iter()
        .map(|r| TableMeta {
            name: qualify(r.get::<_, &str>(0), r.get::<_, &str>(1)),
        })
        .collect())
}

/// All views (including materialized views), alphabetically.
pub fn list_views(conn: &mut Client) -> Result<Vec<ViewMeta>> {
    // information_schema.views omits materialized views, so read from pg_class.
    let rows = conn.query(
        &format!(
            "SELECT n.nspname, c.relname \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE c.relkind IN ('v', 'm') \
               AND n.nspname NOT IN {SYSTEM_SCHEMAS} \
             ORDER BY n.nspname, c.relname"
        ),
        &[],
    )?;
    Ok(rows
        .iter()
        .map(|r| ViewMeta {
            name: qualify(r.get::<_, &str>(0), r.get::<_, &str>(1)),
        })
        .collect())
}

/// All user indexes with their columns and uniqueness.
pub fn list_indexes(conn: &mut Client) -> Result<Vec<IndexMeta>> {
    let rows = conn.query(
        &format!(
            "SELECT n.nspname, ic.relname AS index_name, tc.relname AS table_name, \
                    ix.indisunique AS is_unique, \
                    array_to_string( \
                        array_agg(a.attname ORDER BY k.ord) \
                            FILTER (WHERE a.attname IS NOT NULL), ',') AS columns \
             FROM pg_index ix \
             JOIN pg_class ic ON ic.oid = ix.indexrelid \
             JOIN pg_class tc ON tc.oid = ix.indrelid \
             JOIN pg_namespace n ON n.oid = ic.relnamespace \
             JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true \
             LEFT JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum \
             WHERE n.nspname NOT IN {SYSTEM_SCHEMAS} \
             GROUP BY n.nspname, ic.relname, tc.relname, ix.indisunique \
             ORDER BY n.nspname, ic.relname"
        ),
        &[],
    )?;
    Ok(rows
        .iter()
        .map(|r| {
            let schema: &str = r.get(0);
            let columns: Option<String> = r.get(4);
            IndexMeta {
                name: qualify(schema, r.get::<_, &str>(1)),
                table: qualify(schema, r.get::<_, &str>(2)),
                unique: r.get(3),
                columns: columns
                    .map(|c| c.split(',').filter(|s| !s.is_empty()).map(str::to_string).collect())
                    .unwrap_or_default(),
            }
        })
        .collect())
}

/// All triggers, alphabetically. `information_schema.triggers` has one row per
/// event, so dedupe by trigger name.
pub fn list_triggers(conn: &mut Client) -> Result<Vec<TriggerMeta>> {
    let rows = conn.query(
        &format!(
            "SELECT DISTINCT trigger_name, event_object_schema, event_object_table \
             FROM information_schema.triggers \
             WHERE trigger_schema NOT IN {SYSTEM_SCHEMAS} \
             ORDER BY trigger_name"
        ),
        &[],
    )?;
    Ok(rows
        .iter()
        .map(|r| TriggerMeta {
            name: r.get::<_, &str>(0).to_string(),
            table: qualify(r.get::<_, &str>(1), r.get::<_, &str>(2)),
        })
        .collect())
}

/// Columns of a table or view, in declaration order, with precise type names,
/// nullability, defaults and primary-key position.
pub fn table_columns(conn: &mut Client, table: &str) -> Result<Vec<ColumnMeta>> {
    let (schema, name) = split_table(table);
    let rows = conn.query(
        "SELECT a.attname, \
                format_type(a.atttypid, a.atttypmod) AS data_type, \
                a.attnotnull AS not_null, \
                pg_get_expr(d.adbin, d.adrelid) AS default_value, \
                COALESCE(pk.ord, 0) AS pk \
         FROM pg_attribute a \
         JOIN pg_class t ON t.oid = a.attrelid \
         JOIN pg_namespace n ON n.oid = t.relnamespace \
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
         LEFT JOIN LATERAL ( \
             SELECT k.ord \
             FROM pg_index i \
             JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true \
             WHERE i.indrelid = a.attrelid AND i.indisprimary AND k.attnum = a.attnum \
             LIMIT 1 \
         ) pk ON true \
         WHERE n.nspname = $1 AND t.relname = $2 \
           AND a.attnum > 0 AND NOT a.attisdropped \
         ORDER BY a.attnum",
        &[&schema, &name],
    )?;
    Ok(rows
        .iter()
        .map(|r| ColumnMeta {
            name: r.get::<_, &str>(0).to_string(),
            data_type: r.get::<_, &str>(1).to_string(),
            not_null: r.get(2),
            default_value: r.get::<_, Option<String>>(3),
            pk: r.get(4),
        })
        .collect())
}

/// Foreign keys declared on a table (its outgoing references).
pub fn table_foreign_keys(conn: &mut Client, table: &str) -> Result<Vec<ForeignKeyMeta>> {
    let (schema, name) = split_table(table);
    let rows = conn.query(
        "SELECT con.oid::int8 AS id, \
                att.attname AS from_column, \
                n2.nspname AS to_schema, \
                cl2.relname AS to_table, \
                att2.attname AS to_column, \
                CASE con.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' \
                    WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' \
                    WHEN 'd' THEN 'SET DEFAULT' ELSE '' END AS on_update, \
                CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' \
                    WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' \
                    WHEN 'd' THEN 'SET DEFAULT' ELSE '' END AS on_delete \
         FROM pg_constraint con \
         JOIN pg_class cl ON cl.oid = con.conrelid \
         JOIN pg_namespace n ON n.oid = cl.relnamespace \
         JOIN pg_class cl2 ON cl2.oid = con.confrelid \
         JOIN pg_namespace n2 ON n2.oid = cl2.relnamespace \
         JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true \
         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum \
         JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord \
         JOIN pg_attribute att2 ON att2.attrelid = con.confrelid AND att2.attnum = fk.attnum \
         WHERE con.contype = 'f' AND n.nspname = $1 AND cl.relname = $2 \
         ORDER BY con.oid, k.ord",
        &[&schema, &name],
    )?;
    Ok(rows
        .iter()
        .map(|r| ForeignKeyMeta {
            id: r.get(0),
            from_column: r.get::<_, &str>(1).to_string(),
            to_table: qualify(r.get::<_, &str>(2), r.get::<_, &str>(3)),
            to_column: r.get::<_, &str>(4).to_string(),
            on_update: r.get::<_, &str>(5).to_string(),
            on_delete: r.get::<_, &str>(6).to_string(),
        })
        .collect())
}

/// Whether a suggested join was found via the base table's own foreign keys
/// (outgoing) or via another table referencing the base table (incoming).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JoinDirection {
    Outgoing,
    Incoming,
}

/// A foreign-key-derived join the UI can offer with one click.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinSuggestion {
    /// The other table to join in.
    pub table: String,
    /// Equality pairs as `"table.column"` references (base side, other side).
    pub left: String,
    pub right: String,
    pub direction: JoinDirection,
}

/// Suggest joins for `base_table` from foreign-key relationships, prioritizing
/// the table's own FKs (outgoing) then tables that reference it (incoming).
pub fn suggest_joins(conn: &mut Client, base_table: &str) -> Result<Vec<JoinSuggestion>> {
    let mut out = Vec::new();

    // Outgoing: base_table.from_column -> other.to_column
    for fk in table_foreign_keys(conn, base_table)? {
        out.push(JoinSuggestion {
            left: format!("{base_table}.{}", fk.from_column),
            right: format!("{}.{}", fk.to_table, fk.to_column),
            table: fk.to_table,
            direction: JoinDirection::Outgoing,
        });
    }

    // Incoming: other.from_column -> base_table.to_column
    let (schema, name) = split_table(base_table);
    let rows = conn.query(
        "SELECT n.nspname AS from_schema, cl.relname AS from_table, \
                att.attname AS from_column, att2.attname AS to_column \
         FROM pg_constraint con \
         JOIN pg_class cl ON cl.oid = con.conrelid \
         JOIN pg_namespace n ON n.oid = cl.relnamespace \
         JOIN pg_class cl2 ON cl2.oid = con.confrelid \
         JOIN pg_namespace n2 ON n2.oid = cl2.relnamespace \
         JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true \
         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum \
         JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord \
         JOIN pg_attribute att2 ON att2.attrelid = con.confrelid AND att2.attnum = fk.attnum \
         WHERE con.contype = 'f' AND n2.nspname = $1 AND cl2.relname = $2 \
         ORDER BY con.oid, k.ord",
        &[&schema, &name],
    )?;
    for r in &rows {
        let other = qualify(r.get::<_, &str>(0), r.get::<_, &str>(1));
        out.push(JoinSuggestion {
            left: format!("{base_table}.{}", r.get::<_, &str>(3)),
            right: format!("{}.{}", other, r.get::<_, &str>(2)),
            table: other,
            direction: JoinDirection::Incoming,
        });
    }

    Ok(out)
}

/// Row count for a table.
///
/// `exact = true` runs `COUNT(*)` (O(n), but accurate). `exact = false` returns
/// the planner's `reltuples` estimate from `pg_class` — instant even on huge
/// tables, at the cost of being approximate (and stale until the table is
/// analyzed). Falls back to an exact count when no estimate is available.
pub fn row_count(conn: &mut Client, table: &str, exact: bool) -> Result<RowCount> {
    if exact {
        let quoted = ident::quote_qualified(table);
        let row = conn.query_one(&format!("SELECT COUNT(*)::int8 FROM {quoted}"), &[])?;
        return Ok(RowCount {
            table: table.to_string(),
            count: row.get(0),
            exact: true,
        });
    }

    let (schema, name) = split_table(table);
    let estimate: Option<i64> = conn
        .query_opt(
            "SELECT c.reltuples::int8 \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2",
            &[&schema, &name],
        )?
        .map(|r| r.get(0));

    match estimate {
        // A negative estimate means "never analyzed"; fall back to an exact count.
        Some(count) if count >= 0 => Ok(RowCount {
            table: table.to_string(),
            count,
            exact: false,
        }),
        _ => row_count(conn, table, true),
    }
}
