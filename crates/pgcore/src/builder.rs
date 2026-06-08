//! Turn a [`QuerySpec`] into executable SQL.
//!
//! Output is a [`BuiltQuery`]: SQL with `$N` placeholders plus the ordered bound
//! parameters. For the always-visible preview panel, [`display_sql`] inlines
//! those parameters as safely-formatted literals — the single source of truth
//! is the parameter list, so the preview can never diverge from what executes.
//!
//! A `LIMIT` is *always* emitted (defaulting and clamping the spec's value) so
//! the builder can never produce a query that loads an entire table.

use crate::bind::BoundValue;
use crate::error::Result;
use crate::ident;
use crate::operators;
use crate::spec::{FilterGroup, FilterNode, QuerySpec};

/// Default page size when a spec omits `limit`.
pub const DEFAULT_LIMIT: i64 = 500;
/// Hard cap on page size, regardless of the requested `limit`.
pub const MAX_LIMIT: i64 = 5000;

pub struct BuiltQuery {
    pub sql: String,
    pub params: Vec<BoundValue>,
}

/// Build a parameterized, **paginated** `SELECT` from `spec` (always emits a
/// clamped `LIMIT`). Used for browsing and the SQL preview.
pub fn build_select(spec: &QuerySpec) -> Result<BuiltQuery> {
    build(spec, true)
}

/// Build a parameterized `SELECT` with **no `LIMIT`/`OFFSET`** — for streaming
/// exports of an entire (optionally filtered/joined) result set.
pub fn build_unbounded(spec: &QuerySpec) -> Result<BuiltQuery> {
    build(spec, false)
}

fn build(spec: &QuerySpec, bounded: bool) -> Result<BuiltQuery> {
    let mut params: Vec<BoundValue> = Vec::new();

    let distinct = if spec.distinct { "DISTINCT " } else { "" };
    let select_list = build_select_list(spec);
    let mut sql = format!(
        "SELECT {distinct}{select_list}\nFROM {}",
        ident::quote_qualified(&spec.base_table)
    );

    if let Some(joins) = &spec.joins {
        for join in joins {
            sql.push_str(&format!(
                "\n{} {}",
                join.kind.keyword(),
                ident::quote_qualified(&join.table)
            ));
            if join.kind.takes_on() && !join.on.is_empty() {
                let conditions: Vec<String> = join
                    .on
                    .iter()
                    .map(|pair| {
                        format!(
                            "{} = {}",
                            ident::quote_qualified(&pair.left),
                            ident::quote_qualified(&pair.right)
                        )
                    })
                    .collect();
                sql.push_str(&format!(" ON {}", conditions.join(" AND ")));
            }
        }
    }

    if let Some(group) = &spec.filter {
        if let Some(fragment) = render_group(group, &mut params)? {
            sql.push_str(&format!("\nWHERE {fragment}"));
        }
    }

    if let Some(group_by) = &spec.group_by {
        if !group_by.is_empty() {
            sql.push_str(&format!("\nGROUP BY {}", quote_list(group_by)));
        }
    }

    if let Some(having) = &spec.having {
        if let Some(fragment) = render_group(having, &mut params)? {
            sql.push_str(&format!("\nHAVING {fragment}"));
        }
    }

    if let Some(order_by) = &spec.order_by {
        if !order_by.is_empty() {
            let parts: Vec<String> = order_by
                .iter()
                .map(|rule| {
                    format!(
                        "{} {}",
                        ident::quote_qualified(&rule.column),
                        rule.dir.keyword()
                    )
                })
                .collect();
            sql.push_str(&format!("\nORDER BY {}", parts.join(", ")));
        }
    }

    if bounded {
        // LIMIT/OFFSET are clamped integers (never user text), so inlining them
        // keeps all `$N` placeholders reserved for bound filter values.
        let limit = spec.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        let offset = spec.offset.unwrap_or(0).max(0);
        sql.push_str(&format!("\nLIMIT {limit} OFFSET {offset}"));
    }

    Ok(BuiltQuery { sql, params })
}

fn build_select_list(spec: &QuerySpec) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(columns) = &spec.columns {
        parts.extend(columns.iter().map(|c| ident::quote_qualified(c)));
    }
    if let Some(aggregates) = &spec.aggregates {
        for agg in aggregates {
            let func = format!("{:?}", agg.func).to_uppercase();
            let col = if agg.column == "*" {
                "*".to_string()
            } else {
                ident::quote_qualified(&agg.column)
            };
            let expr = format!("{func}({col})");
            match &agg.alias {
                Some(alias) => parts.push(format!("{expr} AS {}", ident::quote(alias))),
                None => parts.push(expr),
            }
        }
    }

    if parts.is_empty() {
        "*".to_string()
    } else {
        parts.join(", ")
    }
}

fn quote_list(columns: &[String]) -> String {
    columns
        .iter()
        .map(|c| ident::quote_qualified(c))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Render a filter group, returning `None` if it contributes no conditions.
fn render_group(group: &FilterGroup, params: &mut Vec<BoundValue>) -> Result<Option<String>> {
    let mut parts: Vec<String> = Vec::new();
    for child in &group.children {
        match child {
            FilterNode::Condition(filter) => parts.push(operators::render(filter, params)?),
            FilterNode::Group(nested) => {
                if let Some(fragment) = render_group(nested, params)? {
                    parts.push(fragment);
                }
            }
        }
    }

    Ok(match parts.len() {
        0 => None,
        1 => Some(parts.pop().unwrap()),
        _ => Some(format!("({})", parts.join(group.combinator.joiner()))),
    })
}

/// Inline the bound parameters into the SQL as literals, for the preview panel.
/// We only emit `$N` placeholders, so we substitute each `$N` with the literal
/// form of `params[N-1]`.
pub fn display_sql(query: &BuiltQuery) -> String {
    let mut out = String::with_capacity(query.sql.len() + 16);
    let mut chars = query.sql.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '$' && chars.peek().is_some_and(|c| c.is_ascii_digit()) {
            let mut digits = String::new();
            while let Some(c) = chars.peek() {
                if c.is_ascii_digit() {
                    digits.push(*c);
                    chars.next();
                } else {
                    break;
                }
            }
            match digits.parse::<usize>().ok().and_then(|n| query.params.get(n - 1)) {
                Some(value) => out.push_str(&format_literal(value)),
                None => {
                    out.push('$');
                    out.push_str(&digits);
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn format_literal(value: &BoundValue) -> String {
    match value {
        BoundValue::Null => "NULL".to_string(),
        BoundValue::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        BoundValue::Int(i) => i.to_string(),
        BoundValue::Float(f) => f.to_string(),
        BoundValue::Text(s) => format!("'{}'", s.replace('\'', "''")),
    }
}
