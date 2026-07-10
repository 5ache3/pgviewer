/**
 * TypeScript mirror of the Rust IPC DTOs.
 *
 * These types MUST stay in sync with the `#[derive(Serialize)]` structs in
 * `src-tauri/src`. Rust serializes with `rename_all = "camelCase"`, so field
 * names here are camelCase.
 */

// ---------------------------------------------------------------------------
// Connection / database
// ---------------------------------------------------------------------------

export type SslMode = "disable" | "prefer" | "require";

export interface DatabaseInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  serverVersion: string;
  /** On-disk size of the current database, in bytes. */
  sizeBytes: number;
  encoding: string;
}

/** Parameters sent to the `connect` command. */
export interface ConnectRequest {
  host: string;
  port: number;
  dbname: string;
  user: string;
  password?: string | null;
  sslMode?: SslMode;
}

/** A persisted connection profile (mirrors the Rust `ConnectionProfile`). */
export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  dbname: string;
  user: string;
  password?: string | null;
  sslMode: SslMode;
  /** When set, this profile is a raw connection string; fields above are unused. */
  connectionString?: string | null;
  savePassword: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Schema metadata (Phase 1)
// ---------------------------------------------------------------------------

export interface ColumnMeta {
  name: string;
  dataType: string;
  notNull: boolean;
  /** Position in the primary key (0 = not part of PK, 1-based otherwise). */
  pk: number;
  defaultValue: string | null;
}

export interface ForeignKeyMeta {
  id: number;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onUpdate: string;
  onDelete: string;
}

export type ObjectKind = "table" | "view" | "index" | "trigger";

export interface TableMeta {
  name: string;
}

export interface ViewMeta {
  name: string;
}

export interface IndexMeta {
  name: string;
  table: string;
  unique: boolean;
  columns: string[];
}

export interface TriggerMeta {
  name: string;
  table: string;
}

export interface RowCount {
  table: string;
  count: number;
  exact: boolean;
}

// ---------------------------------------------------------------------------
// Cell values — preserve PostgreSQL's column types
// ---------------------------------------------------------------------------

export type CellValue =
  | { t: "null" }
  | { t: "bool"; v: boolean }
  | { t: "int"; v: number }
  | { t: "real"; v: number }
  /** NUMERIC/DECIMAL kept as text to preserve precision. */
  | { t: "num"; v: string }
  | { t: "text"; v: string }
  | { t: "json"; v: string }
  | { t: "bytea"; size: number; hexPreview: string };

// ---------------------------------------------------------------------------
// Query spec — drives the Rust SQL builder (Phases 2/3)
// ---------------------------------------------------------------------------

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "notLike"
  | "startsWith"
  | "endsWith"
  | "contains"
  | "notContains"
  | "in"
  | "notIn"
  | "isNull"
  | "isNotNull"
  | "between";

export interface Filter {
  column: string;
  op: FilterOp;
  value?: unknown;
  value2?: unknown;
}

export interface FilterGroup {
  combinator: "AND" | "OR";
  children: Array<Filter | FilterGroup>;
}

export type JoinKind = "INNER" | "LEFT" | "RIGHT" | "FULL" | "CROSS";

export interface Join {
  kind: JoinKind;
  table: string;
  on: Array<{ left: string; right: string }>;
}

/** An FK-derived join the UI can offer with one click. */
export interface JoinSuggestion {
  table: string;
  left: string;
  right: string;
  direction: "outgoing" | "incoming";
}

export interface SortRule {
  column: string;
  dir: "ASC" | "DESC";
}

export type AggregateFn = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

export interface Aggregate {
  fn: AggregateFn;
  column: string;
  alias?: string;
}

export interface QuerySpec {
  baseTable: string;
  distinct?: boolean;
  columns?: string[];
  aggregates?: Aggregate[];
  joins?: Join[];
  where?: FilterGroup;
  groupBy?: string[];
  having?: FilterGroup;
  orderBy?: SortRule[];
  limit?: number;
  offset?: number;
}

export interface PageRequest {
  limit: number;
  offset: number;
}

export interface ResultColumn {
  name: string;
  dataType: string | null;
}

export interface QueryResult {
  columns: ResultColumn[];
  rows: CellValue[][];
  rowsAffected: number | null;
  elapsedMs: number;
  truncated: boolean;
}

/** Response from `browse_table`: generated SQL + the page of results. */
export interface BrowseResponse {
  sql: string;
  result: QueryResult;
}

export interface BuiltSql {
  sql: string;
  paramCount: number;
}

// ---------------------------------------------------------------------------
// Dependent rows (cascade delete)
// ---------------------------------------------------------------------------

/** Rows in one table that reference the rows being deleted, with a preview. */
export interface DependentGroup {
  table: string;
  /** FK path description, e.g. `user_id → users.id`. */
  via: string;
  count: number;
  columns: string[];
  /** Sample rows (capped by the backend). */
  rows: CellValue[][];
}

export interface DependentReport {
  groups: DependentGroup[];
  /** Total dependent rows across all groups (the deleted rows excluded). */
  total: number;
  /** True when the scan hit its cap — even more rows may be affected. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Export, history, saved queries (Phase 4)
// ---------------------------------------------------------------------------

export type ExportFormat = "csv" | "json" | "xlsx";
export type ExportScope = "page" | "all";

export interface ExportResult {
  path: string;
  rowCount: number;
}

export interface HistoryEntry {
  id: string;
  sql: string;
  table: string | null;
  rowCount: number | null;
  elapsedMs: number;
  timestamp: number;
}

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface AppError {
  code: string;
  message: string;
}

export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "message" in e
  );
}

export function errorMessage(e: unknown): string {
  if (isAppError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
