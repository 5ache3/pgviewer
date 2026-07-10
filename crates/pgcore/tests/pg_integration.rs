//! End-to-end tests against a real PostgreSQL server.
//!
//! These are skipped unless a server is configured via environment variables,
//! so the suite still passes on machines without PostgreSQL:
//!
//! ```sh
//! PGCORE_TEST_HOST=localhost PGCORE_TEST_USER=postgres \
//! PGCORE_TEST_DB=postgres cargo test -p pgcore -- --nocapture
//! ```

use pgcore::mutate::PkPredicate;
use pgcore::pool::{self, ConnectOpts, SslMode};
use pgcore::value::CellValue;
use pgcore::{cascade, mutate, query, schema};

/// Build connect options from the environment, or `None` to skip.
fn opts() -> Option<ConnectOpts> {
    let host = std::env::var("PGCORE_TEST_HOST").ok()?;
    Some(ConnectOpts {
        host,
        port: std::env::var("PGCORE_TEST_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(5432),
        dbname: std::env::var("PGCORE_TEST_DB").unwrap_or_else(|_| "postgres".into()),
        user: std::env::var("PGCORE_TEST_USER").unwrap_or_else(|_| "postgres".into()),
        password: std::env::var("PGCORE_TEST_PASSWORD").ok(),
        ssl_mode: SslMode::Prefer,
    })
}

#[test]
fn end_to_end_browse_filter_and_introspect() {
    let Some(opts) = opts() else {
        eprintln!("skipping: set PGCORE_TEST_HOST to run the live PostgreSQL test");
        return;
    };

    let pool = pool::open_pool(&opts).expect("connect");
    let mut conn = pool::get_conn(&pool).expect("checkout");

    // Isolated scratch schema so we never touch the user's objects.
    conn.batch_execute(
        "DROP SCHEMA IF EXISTS pgcore_test CASCADE; \
         CREATE SCHEMA pgcore_test; \
         CREATE TABLE pgcore_test.users ( \
             id serial PRIMARY KEY, name text, age int, country text, joined timestamptz); \
         CREATE TABLE pgcore_test.orders ( \
             id serial PRIMARY KEY, user_id int REFERENCES pgcore_test.users(id), total numeric(10,2)); \
         INSERT INTO pgcore_test.users (name, age, country, joined) VALUES \
             ('Alice', 30, 'US', now()), ('Bob', 25, 'CA', now()), ('Chen', 41, 'SG', now()); \
         INSERT INTO pgcore_test.orders (user_id, total) VALUES (1, 9.50), (1, 4.00), (2, 7.25);",
    )
    .expect("seed");

    // Schema discovery sees the qualified tables.
    let tables = schema::list_tables(&mut conn).expect("tables");
    assert!(tables.iter().any(|t| t.name == "pgcore_test.users"));

    let cols = schema::table_columns(&mut conn, "pgcore_test.users").expect("columns");
    let id = cols.iter().find(|c| c.name == "id").expect("id column");
    assert_eq!(id.pk, 1, "id is the primary key");

    let fks = schema::table_foreign_keys(&mut conn, "pgcore_test.orders").expect("fks");
    assert_eq!(fks.len(), 1);
    assert_eq!(fks[0].to_table, "pgcore_test.users");

    // Filtered browse with a bound integer parameter.
    let spec = serde_json::from_value(serde_json::json!({
        "baseTable": "pgcore_test.users",
        "columns": ["name", "age"],
        "where": { "combinator": "AND", "children": [
            { "column": "age", "op": "gte", "value": 30 }
        ]},
        "orderBy": [{ "column": "age", "dir": "ASC" }]
    }))
    .unwrap();
    let (_, result) = query::run_select(&mut conn, &spec).expect("run");
    assert_eq!(result.rows.len(), 2); // Alice (30) and Chen (41)
    assert!(matches!(&result.rows[0][0], CellValue::Text { v } if v == "Alice"));

    // Numeric column comes back as precise text.
    let (_, totals) = query::run_select(
        &mut conn,
        &serde_json::from_value(serde_json::json!({
            "baseTable": "pgcore_test.orders",
            "columns": ["total"],
            "orderBy": [{ "column": "total", "dir": "ASC" }]
        }))
        .unwrap(),
    )
    .expect("run totals");
    assert!(matches!(&totals.rows[0][0], CellValue::Num { v } if v == "4.00"));

    conn.batch_execute("DROP SCHEMA pgcore_test CASCADE;").ok();
}

/// A single-column integer PK predicate.
fn pk(id: i64) -> Vec<PkPredicate> {
    vec![PkPredicate {
        column: "id".into(),
        value: serde_json::json!(id),
    }]
}

#[test]
fn dependent_rows_and_cascade_delete() {
    let Some(opts) = opts() else {
        eprintln!("skipping: set PGCORE_TEST_HOST to run the live PostgreSQL test");
        return;
    };

    let pool = pool::open_pool(&opts).expect("connect");
    let mut conn = pool::get_conn(&pool).expect("checkout");

    // Own scratch schema (tests run in parallel with the other live test).
    // users ← orders ← order_items: two levels of dependents, plus a
    // self-referencing employees chain.
    conn.batch_execute(
        "DROP SCHEMA IF EXISTS pgcore_casc CASCADE; \
         CREATE SCHEMA pgcore_casc; \
         CREATE TABLE pgcore_casc.users (id serial PRIMARY KEY, name text); \
         CREATE TABLE pgcore_casc.orders ( \
             id serial PRIMARY KEY, user_id int REFERENCES pgcore_casc.users(id)); \
         CREATE TABLE pgcore_casc.order_items ( \
             id serial PRIMARY KEY, order_id int REFERENCES pgcore_casc.orders(id), sku text); \
         CREATE TABLE pgcore_casc.employees ( \
             id serial PRIMARY KEY, manager_id int REFERENCES pgcore_casc.employees(id)); \
         INSERT INTO pgcore_casc.users (name) VALUES ('Alice'), ('Bob'); \
         INSERT INTO pgcore_casc.orders (user_id) VALUES (1), (1), (2); \
         INSERT INTO pgcore_casc.order_items (order_id, sku) VALUES (1, 'a'), (1, 'b'), (3, 'c'); \
         INSERT INTO pgcore_casc.employees (manager_id) VALUES (NULL), (1), (2);",
    )
    .expect("seed");

    // A plain delete of a referenced row fails with a FK violation.
    let err = mutate::delete_row(&mut conn, "pgcore_casc.users", &pk(1))
        .expect_err("delete of referenced row must fail");
    assert!(err.is_fk_violation(), "unexpected error: {err}");

    // The report sees both direct (orders) and transitive (order_items) rows.
    let report =
        cascade::dependent_rows(&mut conn, "pgcore_casc.users", &[pk(1)]).expect("report");
    assert_eq!(report.total, 4, "2 orders + 2 items: {report:?}");
    assert!(!report.truncated);
    let orders = report
        .groups
        .iter()
        .find(|g| g.table == "pgcore_casc.orders")
        .expect("orders group");
    assert_eq!(orders.count, 2);
    assert_eq!(orders.rows.len(), 2, "preview rows fetched");
    let items = report
        .groups
        .iter()
        .find(|g| g.table == "pgcore_casc.order_items")
        .expect("items group");
    assert_eq!(items.count, 2);

    // Cascade delete removes the closure (and only it) in one transaction.
    let deleted =
        cascade::delete_rows_cascade(&mut conn, "pgcore_casc.users", &[pk(1)]).expect("cascade");
    assert_eq!(deleted, 5, "1 user + 2 orders + 2 items");
    let remaining = |table: &str, conn: &mut postgres::Client| -> i64 {
        conn.query_one(&format!("SELECT COUNT(*) FROM {table}"), &[])
            .unwrap()
            .get(0)
    };
    assert_eq!(remaining("pgcore_casc.users", &mut conn), 1);
    assert_eq!(remaining("pgcore_casc.orders", &mut conn), 1);
    assert_eq!(remaining("pgcore_casc.order_items", &mut conn), 1);

    // Self-referencing chain: deleting the root manager takes the whole chain.
    let deleted = cascade::delete_rows_cascade(&mut conn, "pgcore_casc.employees", &[pk(1)])
        .expect("cascade employees");
    assert_eq!(deleted, 3);
    assert_eq!(remaining("pgcore_casc.employees", &mut conn), 0);

    conn.batch_execute("DROP SCHEMA pgcore_casc CASCADE;").ok();
}
