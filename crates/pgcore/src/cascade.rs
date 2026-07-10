//! Dependent-row discovery and cascading deletes.
//!
//! Deleting a row that other rows reference via foreign keys fails with a
//! constraint violation. These helpers walk the FK graph *backwards* from the
//! rows the user wants to delete: [`dependent_rows`] reports every row that
//! would have to go too (so the UI can show them before asking), and
//! [`delete_rows_cascade`] deletes the whole closure in one transaction,
//! children before parents. As everywhere else, identifiers are quoted and
//! values are bound — nothing user-controlled is interpolated into SQL.

use std::collections::{HashMap, HashSet, VecDeque};

use postgres::types::ToSql;
use postgres::{Client, GenericClient};
use serde::Serialize;

use crate::bind::BoundValue;
use crate::error::{Error, Result};
use crate::ident;
use crate::mutate::PkPredicate;
use crate::value::{Cell, CellValue};

/// Traversal cap for the report: enough to show the full picture on any sane
/// schema without letting a pathological graph stall the dialog.
const REPORT_MAX_SELECTORS: usize = 200;

/// Traversal cap for the actual cascade — beyond this we refuse rather than
/// issue an unbounded number of deletes.
const CASCADE_MAX_SELECTORS: usize = 10_000;

/// Sample rows fetched per dependent group for the dialog.
const PREVIEW_ROWS_PER_GROUP: usize = 10;

/// One foreign-key constraint as a child → parent edge with paired columns.
#[derive(Debug, Clone)]
struct FkEdge {
    child_table: String,
    parent_table: String,
    child_cols: Vec<String>,
    parent_cols: Vec<String>,
}

impl FkEdge {
    /// Short human description for the dialog: `user_id → users.id`.
    fn describe(&self) -> String {
        format!(
            "{} → {}.{}",
            self.child_cols.join(", "),
            self.parent_table,
            self.parent_cols.join(", ")
        )
    }
}

/// Display a `(schema, name)` pair the way the rest of the app does: bare for
/// `public`, qualified otherwise.
fn qualify(schema: &str, name: &str) -> String {
    if schema == "public" {
        name.to_string()
    } else {
        format!("{schema}.{name}")
    }
}

/// Every FK constraint in the database, as child → parent edges. One catalog
/// query up front beats re-querying per traversal level.
fn load_fk_edges<C: GenericClient>(conn: &mut C) -> Result<Vec<FkEdge>> {
    let rows = conn.query(
        "SELECT n.nspname, cl.relname, n2.nspname, cl2.relname, \
                array_agg(att.attname::text ORDER BY k.ord) AS child_cols, \
                array_agg(att2.attname::text ORDER BY k.ord) AS parent_cols \
         FROM pg_constraint con \
         JOIN pg_class cl ON cl.oid = con.conrelid \
         JOIN pg_namespace n ON n.oid = cl.relnamespace \
         JOIN pg_class cl2 ON cl2.oid = con.confrelid \
         JOIN pg_namespace n2 ON n2.oid = cl2.relnamespace \
         JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true \
         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum \
         JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord \
         JOIN pg_attribute att2 ON att2.attrelid = con.confrelid AND att2.attnum = fk.attnum \
         WHERE con.contype = 'f' \
         GROUP BY con.oid, n.nspname, cl.relname, n2.nspname, cl2.relname",
        &[],
    )?;
    Ok(rows
        .iter()
        .map(|r| FkEdge {
            child_table: qualify(r.get::<_, &str>(0), r.get::<_, &str>(1)),
            parent_table: qualify(r.get::<_, &str>(2), r.get::<_, &str>(3)),
            child_cols: r.get(4),
            parent_cols: r.get(5),
        })
        .collect())
}

/// A set of rows in one table matched by `column = value` predicates: either a
/// root row (matched by its PK) or the rows referencing a parent through one FK.
#[derive(Debug, Clone)]
struct Selector {
    table: String,
    /// FK edge description ([`FkEdge::describe`]); empty for root selectors.
    via: String,
    preds: Vec<(String, serde_json::Value)>,
    /// Matching rows at discovery time (roots keep 0 — the caller knows them).
    count: i64,
}

/// Stable identity for the visited set: same table + same predicates.
fn selector_key(sel: &Selector) -> String {
    format!(
        "{}|{}",
        sel.table,
        serde_json::to_string(&sel.preds).unwrap_or_default()
    )
}

/// `"a" = $1 AND "b" = $2` plus the bound values, from a predicate list.
fn where_clause(preds: &[(String, serde_json::Value)]) -> (String, Vec<BoundValue>) {
    let clause = preds
        .iter()
        .enumerate()
        .map(|(i, (col, _))| format!("{} = ${}", ident::quote(col), i + 1))
        .collect::<Vec<_>>()
        .join(" AND ");
    let params = preds.iter().map(|(_, v)| BoundValue::from_json(v)).collect();
    (clause, params)
}

fn bind(params: &[BoundValue]) -> Vec<&(dyn ToSql + Sync)> {
    params.iter().map(|p| p as &(dyn ToSql + Sync)).collect()
}

/// Re-encode a fetched cell as JSON so it can be bound back into a predicate
/// (the binder parses text back into uuid/timestamp/numeric as needed).
/// `None` for values that can't round-trip (BYTEA is only ever a preview).
fn cell_to_json(v: &CellValue) -> Option<serde_json::Value> {
    use serde_json::Value as J;
    Some(match v {
        CellValue::Null => J::Null,
        CellValue::Bool { v } => J::Bool(*v),
        CellValue::Int { v } => J::from(*v),
        CellValue::Real { v } => J::Number(serde_json::Number::from_f64(*v)?),
        CellValue::Num { v } | CellValue::Text { v } | CellValue::Json { v } => {
            J::String(v.clone())
        }
        CellValue::Bytea { .. } => return None,
    })
}

struct Traversal {
    /// Dependent selectors in discovery (BFS) order — parents before children.
    order: Vec<Selector>,
    /// True when the walk stopped at `max_selectors`.
    truncated: bool,
}

/// Breadth-first walk of the reverse-FK graph from `roots`. For each reached
/// row set, every FK pointing at its table yields the referencing rows, which
/// are visited in turn — so the result covers transitive dependents. A visited
/// set keyed on (table, predicates) breaks reference cycles.
fn collect_dependents<C: GenericClient>(
    conn: &mut C,
    roots: &[Selector],
    edges: &[FkEdge],
    max_selectors: usize,
) -> Result<Traversal> {
    let mut order: Vec<Selector> = Vec::new();
    let mut truncated = false;
    let mut visited: HashSet<String> = roots.iter().map(selector_key).collect();
    let mut queue: VecDeque<Selector> = roots.iter().cloned().collect();

    'bfs: while let Some(sel) = queue.pop_front() {
        for edge in edges.iter().filter(|e| e.parent_table == sel.table) {
            // The referenced values live on the *parent* rows (usually their PK,
            // but an FK may target any unique columns) — read them first.
            let cols = edge
                .parent_cols
                .iter()
                .map(|c| ident::quote(c))
                .collect::<Vec<_>>()
                .join(", ");
            let (clause, params) = where_clause(&sel.preds);
            let sql = format!(
                "SELECT DISTINCT {cols} FROM {} WHERE {clause}",
                ident::quote_qualified(&sel.table)
            );
            let rows = conn.query(sql.as_str(), &bind(&params))?;

            for row in &rows {
                let mut values = Vec::with_capacity(edge.parent_cols.len());
                for i in 0..edge.parent_cols.len() {
                    let cell: Cell = row.try_get(i)?;
                    match cell_to_json(&cell.0) {
                        // A NULL referenced value can't be pointed at by any FK.
                        Some(v) if !v.is_null() => values.push(v),
                        _ => break,
                    }
                }
                if values.len() < edge.parent_cols.len() {
                    continue;
                }

                let mut child = Selector {
                    table: edge.child_table.clone(),
                    via: edge.describe(),
                    preds: edge.child_cols.iter().cloned().zip(values).collect(),
                    count: 0,
                };
                if !visited.insert(selector_key(&child)) {
                    continue;
                }

                let (clause, params) = where_clause(&child.preds);
                let count_sql = format!(
                    "SELECT COUNT(*) FROM {} WHERE {clause}",
                    ident::quote_qualified(&child.table)
                );
                child.count = conn.query_one(count_sql.as_str(), &bind(&params))?.get(0);
                if child.count == 0 {
                    continue;
                }

                if order.len() >= max_selectors {
                    truncated = true;
                    break 'bfs;
                }
                order.push(child.clone());
                queue.push_back(child);
            }
        }
    }

    Ok(Traversal { order, truncated })
}

/// One table's worth of rows that reference the rows being deleted (directly
/// or transitively), with a small preview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependentGroup {
    pub table: String,
    /// FK path description, e.g. `user_id → users.id`.
    pub via: String,
    pub count: i64,
    pub columns: Vec<String>,
    /// Up to [`PREVIEW_ROWS_PER_GROUP`] sample rows.
    pub rows: Vec<Vec<CellValue>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependentReport {
    pub groups: Vec<DependentGroup>,
    /// Total dependent rows across all groups (the roots themselves excluded).
    pub total: i64,
    /// True when the scan hit its cap — even more rows may be affected.
    pub truncated: bool,
}

fn build_roots(table: &str, pks: &[Vec<PkPredicate>]) -> Result<Vec<Selector>> {
    if pks.is_empty() || pks.iter().any(|pk| pk.is_empty()) {
        return Err(Error::Msg(
            "cannot resolve dependents: this table has no primary key to identify the rows".into(),
        ));
    }
    Ok(pks
        .iter()
        .map(|pk| Selector {
            table: table.to_string(),
            via: String::new(),
            preds: pk.iter().map(|p| (p.column.clone(), p.value.clone())).collect(),
            count: 0,
        })
        .collect())
}

/// Report every row that would have to be deleted before the rows identified
/// by `pks` can go, grouped per (table, FK path) with preview rows.
pub fn dependent_rows(
    conn: &mut Client,
    table: &str,
    pks: &[Vec<PkPredicate>],
) -> Result<DependentReport> {
    let roots = build_roots(table, pks)?;
    let edges = load_fk_edges(conn)?;
    let traversal = collect_dependents(conn, &roots, &edges, REPORT_MAX_SELECTORS)?;

    let mut groups: Vec<DependentGroup> = Vec::new();
    let mut index: HashMap<(String, String), usize> = HashMap::new();
    for sel in &traversal.order {
        let idx = *index
            .entry((sel.table.clone(), sel.via.clone()))
            .or_insert_with(|| {
                groups.push(DependentGroup {
                    table: sel.table.clone(),
                    via: sel.via.clone(),
                    count: 0,
                    columns: Vec::new(),
                    rows: Vec::new(),
                });
                groups.len() - 1
            });
        let group = &mut groups[idx];
        group.count += sel.count;

        let remaining = PREVIEW_ROWS_PER_GROUP.saturating_sub(group.rows.len());
        if remaining == 0 {
            continue;
        }
        let (clause, params) = where_clause(&sel.preds);
        let sql = format!(
            "SELECT * FROM {} WHERE {clause} LIMIT {remaining}",
            ident::quote_qualified(&sel.table)
        );
        let stmt = conn.prepare(&sql)?;
        if group.columns.is_empty() {
            group.columns = stmt.columns().iter().map(|c| c.name().to_string()).collect();
        }
        for row in conn.query(&stmt, &bind(&params))? {
            let mut record = Vec::with_capacity(row.len());
            for i in 0..row.len() {
                let cell: Cell = row.try_get(i)?;
                record.push(cell.0);
            }
            group.rows.push(record);
        }
    }

    Ok(DependentReport {
        total: traversal.order.iter().map(|s| s.count).sum(),
        groups,
        truncated: traversal.truncated,
    })
}

fn delete_selector<C: GenericClient>(conn: &mut C, sel: &Selector) -> Result<u64> {
    let (clause, params) = where_clause(&sel.preds);
    let sql = format!(
        "DELETE FROM {} WHERE {clause}",
        ident::quote_qualified(&sel.table)
    );
    Ok(conn.execute(sql.as_str(), &bind(&params))?)
}

/// Delete the rows identified by `pks` **and** everything that references them,
/// in a single transaction. Destructive — callers must confirm with the user
/// (the UI shows [`dependent_rows`] first). Returns total rows deleted.
pub fn delete_rows_cascade(
    conn: &mut Client,
    table: &str,
    pks: &[Vec<PkPredicate>],
) -> Result<u64> {
    let roots = build_roots(table, pks)?;
    let mut tx = conn.transaction()?;

    // Re-walk the graph inside the transaction so the plan and the deletes see
    // the same data.
    let edges = load_fk_edges(&mut tx)?;
    let traversal = collect_dependents(&mut tx, &roots, &edges, CASCADE_MAX_SELECTORS)?;
    if traversal.truncated {
        return Err(Error::Msg(format!(
            "cascade delete aborted: more than {CASCADE_MAX_SELECTORS} dependent row groups"
        )));
    }

    // Every selector was discovered from the rows it references, so reverse
    // discovery order deletes referencing rows before the rows they point at.
    let mut deleted = 0u64;
    for sel in traversal.order.iter().rev() {
        deleted += delete_selector(&mut tx, sel)?;
    }
    for root in &roots {
        deleted += delete_selector(&mut tx, root)?;
    }

    tx.commit()?;
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn where_clause_quotes_and_numbers_placeholders() {
        let preds = vec![
            ("user id".to_string(), serde_json::json!(7)),
            ("line".to_string(), serde_json::json!("a")),
        ];
        let (clause, params) = where_clause(&preds);
        assert_eq!(clause, "\"user id\" = $1 AND \"line\" = $2");
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn edge_description_is_compact() {
        let edge = FkEdge {
            child_table: "orders".into(),
            parent_table: "users".into(),
            child_cols: vec!["user_id".into()],
            parent_cols: vec!["id".into()],
        };
        assert_eq!(edge.describe(), "user_id → users.id");
    }

    #[test]
    fn roots_require_a_primary_key() {
        assert!(build_roots("users", &[]).is_err());
        assert!(build_roots("users", &[vec![]]).is_err());

        let pk = vec![PkPredicate {
            column: "id".into(),
            value: serde_json::json!(1),
        }];
        let roots = build_roots("users", &[pk]).unwrap();
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].preds, vec![("id".to_string(), serde_json::json!(1))]);
    }

    #[test]
    fn selector_key_distinguishes_predicates() {
        let a = Selector {
            table: "t".into(),
            via: String::new(),
            preds: vec![("id".into(), serde_json::json!(1))],
            count: 0,
        };
        let mut b = a.clone();
        b.preds = vec![("id".into(), serde_json::json!(2))];
        assert_ne!(selector_key(&a), selector_key(&b));
        assert_eq!(selector_key(&a), selector_key(&a.clone()));
    }
}
