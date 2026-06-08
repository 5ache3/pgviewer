//! Tests for visual-filter → SQL generation. These exercise the spec
//! deserialization, operator rendering, nested groups, `$N` parameter binding,
//! and the inlined preview. They are pure (no database needed) — for end-to-end
//! execution against a live server, see `pg_integration.rs`.

use pgcore::bind::BoundValue;
use pgcore::builder::{self, DEFAULT_LIMIT};
use pgcore::spec::QuerySpec;

fn spec(json: serde_json::Value) -> QuerySpec {
    serde_json::from_value(json).expect("valid spec")
}

#[test]
fn builds_plain_select_with_default_limit() {
    let q = builder::build_select(&spec(serde_json::json!({ "baseTable": "users" }))).unwrap();
    assert_eq!(
        q.sql,
        format!("SELECT *\nFROM \"users\"\nLIMIT {DEFAULT_LIMIT} OFFSET 0")
    );
    assert!(q.params.is_empty());
}

#[test]
fn qualifies_schema_prefixed_tables() {
    let q = builder::build_select(&spec(serde_json::json!({ "baseTable": "sales.orders" }))).unwrap();
    assert!(q.sql.contains("FROM \"sales\".\"orders\""), "got: {}", q.sql);
}

#[test]
fn binds_values_as_parameters_not_literals() {
    let q = builder::build_select(&spec(serde_json::json!({
        "baseTable": "users",
        "where": { "combinator": "AND", "children": [
            { "column": "age", "op": "gt", "value": 25 }
        ]}
    })))
    .unwrap();
    assert!(q.sql.contains("WHERE \"age\" > $1"), "got: {}", q.sql);
    assert_eq!(q.params, vec![BoundValue::Int(25)]);
    // Preview inlines the literal.
    assert!(builder::display_sql(&q).contains("WHERE \"age\" > 25"));
}

#[test]
fn renders_all_operator_families() {
    let cases: Vec<(serde_json::Value, &str)> = vec![
        (serde_json::json!({ "column": "name", "op": "eq", "value": "x" }), "\"name\" = $1"),
        (serde_json::json!({ "column": "name", "op": "neq", "value": "x" }), "\"name\" <> $1"),
        (serde_json::json!({ "column": "age", "op": "gte", "value": 1 }), "\"age\" >= $1"),
        (serde_json::json!({ "column": "name", "op": "contains", "value": "a" }), "\"name\" ILIKE $1 ESCAPE '\\'"),
        (serde_json::json!({ "column": "name", "op": "startsWith", "value": "a" }), "\"name\" ILIKE $1 ESCAPE '\\'"),
        (serde_json::json!({ "column": "name", "op": "like", "value": "%a%" }), "\"name\" LIKE $1"),
        (serde_json::json!({ "column": "country", "op": "in", "value": ["US", "CA"] }), "\"country\" IN ($1, $2)"),
        (serde_json::json!({ "column": "age", "op": "isNull" }), "\"age\" IS NULL"),
        (serde_json::json!({ "column": "age", "op": "between", "value": 18, "value2": 40 }), "\"age\" BETWEEN $1 AND $2"),
    ];
    for (filter, expected) in cases {
        let q = builder::build_select(&spec(serde_json::json!({
            "baseTable": "users",
            "where": { "combinator": "AND", "children": [filter] }
        })))
        .unwrap();
        assert!(q.sql.contains(expected), "expected `{expected}` in:\n{}", q.sql);
    }
}

#[test]
fn placeholders_are_numbered_sequentially_across_clauses() {
    let q = builder::build_select(&spec(serde_json::json!({
        "baseTable": "users",
        "where": { "combinator": "AND", "children": [
            { "column": "age", "op": "gt", "value": 18 },
            { "column": "country", "op": "eq", "value": "US" }
        ]}
    })))
    .unwrap();
    assert!(q.sql.contains("(\"age\" > $1 AND \"country\" = $2)"), "got: {}", q.sql);
    assert_eq!(q.params, vec![BoundValue::Int(18), BoundValue::Text("US".into())]);
}

#[test]
fn nested_groups_and_or_with_parens() {
    // (age > 18 AND country = 'US') OR (role = 'admin')
    let q = builder::build_select(&spec(serde_json::json!({
        "baseTable": "users",
        "where": { "combinator": "OR", "children": [
            { "combinator": "AND", "children": [
                { "column": "age", "op": "gt", "value": 18 },
                { "column": "country", "op": "eq", "value": "US" }
            ]},
            { "combinator": "AND", "children": [
                { "column": "role", "op": "eq", "value": "admin" }
            ]}
        ]}
    })))
    .unwrap();

    let display = builder::display_sql(&q);
    assert!(
        display.contains("WHERE ((\"age\" > 18 AND \"country\" = 'US') OR \"role\" = 'admin')"),
        "got: {display}"
    );
    assert_eq!(
        q.params,
        vec![
            BoundValue::Int(18),
            BoundValue::Text("US".into()),
            BoundValue::Text("admin".into())
        ]
    );
}

#[test]
fn empty_in_set_is_constant_false() {
    let q = builder::build_select(&spec(serde_json::json!({
        "baseTable": "users",
        "where": { "combinator": "AND", "children": [
            { "column": "country", "op": "in", "value": [] }
        ]}
    })))
    .unwrap();
    assert!(q.sql.contains("WHERE FALSE"), "got: {}", q.sql);
    assert!(q.params.is_empty());
}

#[test]
fn empty_not_in_set_is_constant_true() {
    let q = builder::build_select(&spec(serde_json::json!({
        "baseTable": "users",
        "where": { "combinator": "AND", "children": [
            { "column": "country", "op": "notIn", "value": [] }
        ]}
    })))
    .unwrap();
    assert!(q.sql.contains("WHERE TRUE"), "got: {}", q.sql);
}

#[test]
fn limit_is_clamped_to_max() {
    let q = builder::build_select(&spec(serde_json::json!({
        "baseTable": "users",
        "limit": 1_000_000
    })))
    .unwrap();
    assert!(q.sql.contains(&format!("LIMIT {}", builder::MAX_LIMIT)));
}

#[test]
fn renders_joins_with_on_and_cross() {
    let q = builder::build_select(&spec(serde_json::json!({
        "baseTable": "orders",
        "joins": [{
            "kind": "INNER",
            "table": "users",
            "on": [{ "left": "orders.user_id", "right": "users.id" }]
        }]
    })))
    .unwrap();
    assert!(
        q.sql.contains(
            "FROM \"orders\"\nINNER JOIN \"users\" ON \"orders\".\"user_id\" = \"users\".\"id\""
        ),
        "got: {}",
        q.sql
    );

    // CROSS JOIN takes no ON clause even if provided.
    let cross = builder::build_select(&spec(serde_json::json!({
        "baseTable": "a",
        "joins": [{ "kind": "CROSS", "table": "b", "on": [] }]
    })))
    .unwrap();
    assert!(cross.sql.contains("CROSS JOIN \"b\""));
    assert!(!cross.sql.contains(" ON "));
}

#[test]
fn aggregates_and_group_by() {
    let q = builder::build_select(&spec(serde_json::json!({
        "baseTable": "users",
        "columns": ["country"],
        "aggregates": [{ "fn": "COUNT", "column": "*", "alias": "n" }],
        "groupBy": ["country"],
        "orderBy": [{ "column": "country", "dir": "ASC" }]
    })))
    .unwrap();
    let display = builder::display_sql(&q);
    assert!(display.contains("COUNT(*) AS \"n\""), "got: {display}");
    assert!(display.contains("GROUP BY \"country\""));
    assert!(display.contains("ORDER BY \"country\" ASC"));
}

#[test]
fn like_metacharacters_are_escaped() {
    let q = builder::build_select(&spec(serde_json::json!({
        "baseTable": "users",
        "where": { "combinator": "AND", "children": [
            { "column": "name", "op": "contains", "value": "50%_off" }
        ]}
    })))
    .unwrap();
    // The constructed pattern wraps the escaped text in %…%.
    assert_eq!(q.params, vec![BoundValue::Text("%50\\%\\_off%".into())]);
}
