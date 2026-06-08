//! Rust mirror of the frontend `QuerySpec`. This is the structured, typed
//! description of a visual query; the [`crate::builder`] turns it into SQL.
//!
//! Field/variant names use serde renames so the JSON shape matches the
//! TypeScript types in `src/ipc/types.ts` exactly.

use serde::Deserialize;

/// A complete query description produced by the visual builder.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuerySpec {
    pub base_table: String,
    #[serde(default)]
    pub distinct: bool,
    #[serde(default)]
    pub columns: Option<Vec<String>>,
    #[serde(default)]
    pub aggregates: Option<Vec<Aggregate>>,
    #[serde(default)]
    pub joins: Option<Vec<Join>>,
    /// WHERE clause (`where` is a Rust keyword, so the field is `filter`).
    #[serde(default, rename = "where")]
    pub filter: Option<FilterGroup>,
    #[serde(default)]
    pub group_by: Option<Vec<String>>,
    #[serde(default)]
    pub having: Option<FilterGroup>,
    #[serde(default)]
    pub order_by: Option<Vec<SortRule>>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

// --- Filters ---------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOp {
    Eq,
    Neq,
    Gt,
    Gte,
    Lt,
    Lte,
    Like,
    NotLike,
    StartsWith,
    EndsWith,
    Contains,
    NotContains,
    In,
    NotIn,
    IsNull,
    IsNotNull,
    Between,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub column: String,
    pub op: FilterOp,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    #[serde(default)]
    pub value2: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Combinator {
    And,
    Or,
}

impl Combinator {
    pub fn joiner(self) -> &'static str {
        match self {
            Combinator::And => " AND ",
            Combinator::Or => " OR ",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterGroup {
    pub combinator: Combinator,
    #[serde(default)]
    pub children: Vec<FilterNode>,
}

/// A child of a [`FilterGroup`] is either a single condition or a nested group.
/// `untagged` disambiguates purely by shape (a group has `combinator`, a
/// condition has `column`+`op`).
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum FilterNode {
    Group(FilterGroup),
    Condition(Filter),
}

// --- Ordering / aggregation / joins ---------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Direction {
    Asc,
    Desc,
}

impl Direction {
    pub fn keyword(self) -> &'static str {
        match self {
            Direction::Asc => "ASC",
            Direction::Desc => "DESC",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortRule {
    pub column: String,
    pub dir: Direction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AggregateFn {
    Count,
    Sum,
    Avg,
    Min,
    Max,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Aggregate {
    #[serde(rename = "fn")]
    pub func: AggregateFn,
    pub column: String,
    #[serde(default)]
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum JoinKind {
    Inner,
    Left,
    Right,
    Full,
    Cross,
}

impl JoinKind {
    pub fn keyword(self) -> &'static str {
        match self {
            JoinKind::Inner => "INNER JOIN",
            JoinKind::Left => "LEFT JOIN",
            JoinKind::Right => "RIGHT JOIN",
            JoinKind::Full => "FULL OUTER JOIN",
            JoinKind::Cross => "CROSS JOIN",
        }
    }

    /// CROSS JOIN takes no ON clause; the others do.
    pub fn takes_on(self) -> bool {
        !matches!(self, JoinKind::Cross)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinOn {
    pub left: String,
    pub right: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Join {
    pub kind: JoinKind,
    pub table: String,
    #[serde(default)]
    pub on: Vec<JoinOn>,
}
