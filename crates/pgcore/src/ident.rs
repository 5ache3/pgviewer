//! PostgreSQL identifier quoting.
//!
//! Values are always bound as parameters (`$1`, `$2`, …), but identifiers
//! (table/column names) cannot be parameterized, so every identifier that
//! reaches a SQL string MUST pass through [`quote`]. Double-quoting with
//! internal `"` doubling is the SQL-standard (and PostgreSQL) way to quote an
//! identifier and neutralizes injection via crafted names.

/// Quote an identifier for safe interpolation into SQL.
///
/// `users` -> `"users"`, `a"b` -> `"a""b"`.
pub fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

/// Quote a possibly-qualified reference, quoting each dotted part.
///
/// `orders.user_id` -> `"orders"."user_id"`,
/// `public.orders.user_id` -> `"public"."orders"."user_id"`.
pub fn quote_qualified(reference: &str) -> String {
    reference
        .split('.')
        .map(quote)
        .collect::<Vec<_>>()
        .join(".")
}
