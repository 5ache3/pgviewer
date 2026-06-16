/**
 * Thin, typed wrappers around Tauri's `invoke`. The rest of the app calls these
 * functions instead of using raw command-name strings, so the IPC surface is
 * discoverable and type-checked in one place.
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  BrowseResponse,
  BuiltSql,
  ColumnMeta,
  ConnectionProfile,
  ConnectRequest,
  DatabaseInfo,
  ExportFormat,
  ExportResult,
  ExportScope,
  ForeignKeyMeta,
  HistoryEntry,
  IndexMeta,
  JoinSuggestion,
  QueryResult,
  QuerySpec,
  RowCount,
  SavedQuery,
  TableMeta,
  TriggerMeta,
  ViewMeta,
} from "./types";

// --- Connection ------------------------------------------------------------

export function connect(req: ConnectRequest): Promise<DatabaseInfo> {
  return invoke<DatabaseInfo>("connect", { req });
}

/** Connect with a libpq connection string (URI or key=value form). */
export function connectString(connStr: string): Promise<DatabaseInfo> {
  return invoke<DatabaseInfo>("connect_string", { connStr });
}

export function databaseInfo(): Promise<DatabaseInfo> {
  return invoke<DatabaseInfo>("database_info");
}

export function closeDatabase(): Promise<void> {
  return invoke<void>("close_database");
}

// --- Saved connection profiles ---------------------------------------------

export function listConnections(): Promise<ConnectionProfile[]> {
  return invoke<ConnectionProfile[]>("list_connections");
}

export function saveConnection(profile: ConnectionProfile): Promise<ConnectionProfile> {
  return invoke<ConnectionProfile>("save_connection", { profile });
}

export function deleteConnection(id: string): Promise<void> {
  return invoke<void>("delete_connection", { id });
}

// --- Schema ----------------------------------------------------------------

export function listTables(): Promise<TableMeta[]> {
  return invoke<TableMeta[]>("list_tables");
}

export function listViews(): Promise<ViewMeta[]> {
  return invoke<ViewMeta[]>("list_views");
}

export function listIndexes(): Promise<IndexMeta[]> {
  return invoke<IndexMeta[]>("list_indexes");
}

export function listTriggers(): Promise<TriggerMeta[]> {
  return invoke<TriggerMeta[]>("list_triggers");
}

export function tableColumns(table: string): Promise<ColumnMeta[]> {
  return invoke<ColumnMeta[]>("table_columns", { table });
}

export function tableForeignKeys(table: string): Promise<ForeignKeyMeta[]> {
  return invoke<ForeignKeyMeta[]>("table_foreign_keys", { table });
}

export function rowCount(table: string, exact: boolean): Promise<RowCount> {
  return invoke<RowCount>("row_count", { table, exact });
}

export function joinSuggestions(table: string): Promise<JoinSuggestion[]> {
  return invoke<JoinSuggestion[]>("join_suggestions", { table });
}

// --- Browse ----------------------------------------------------------------

export interface BrowseArgs {
  table: string;
  limit: number;
  offset: number;
  sortColumn?: string;
  sortDir?: "ASC" | "DESC";
}

export function browseTable(args: BrowseArgs): Promise<BrowseResponse> {
  return invoke<BrowseResponse>("browse_table", { ...args });
}

// --- Visual query builder --------------------------------------------------

/** Generate SQL from a spec without executing (keeps the preview live). */
export function buildSql(spec: QuerySpec): Promise<BuiltSql> {
  return invoke<BuiltSql>("build_sql", { spec });
}

/** Build SQL from a spec, execute it, and return SQL + the page of rows. */
export function runQuery(spec: QuerySpec): Promise<BrowseResponse> {
  return invoke<BrowseResponse>("run_query", { spec });
}

/** Execute an arbitrary, user-edited SQL string and return the result. */
export function runRawSql(sql: string): Promise<QueryResult> {
  return invoke<QueryResult>("run_raw_sql", { sql });
}

// --- Mutations (edit cell, add/drop column) --------------------------------

/** A primary-key predicate identifying the row to update. */
export interface PkPredicate {
  column: string;
  value: unknown;
}

/** Update one cell, keyed on the row's primary key. Returns rows affected. */
export function updateCell(args: {
  table: string;
  column: string;
  value: unknown;
  pk: PkPredicate[];
}): Promise<number> {
  return invoke<number>("update_cell", { ...args });
}

/** Delete one row, keyed on its primary key. Returns rows affected. */
export function deleteRow(args: {
  table: string;
  pk: PkPredicate[];
}): Promise<number> {
  return invoke<number>("delete_row", { ...args });
}

export function addColumn(args: {
  table: string;
  name: string;
  dataType: string;
  nullable: boolean;
}): Promise<void> {
  return invoke<void>("add_column", { ...args });
}

export function dropColumn(table: string, name: string): Promise<void> {
  return invoke<void>("drop_column", { table, name });
}

// --- Export ----------------------------------------------------------------

export function exportQuery(args: {
  spec: QuerySpec;
  format: ExportFormat;
  scope: ExportScope;
  dest: string;
}): Promise<ExportResult> {
  return invoke<ExportResult>("export_query", { ...args });
}

// --- History & saved queries -----------------------------------------------

export function listHistory(): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("list_history");
}

export function addHistory(args: {
  sql: string;
  table: string | null;
  rowCount: number | null;
  elapsedMs: number;
}): Promise<void> {
  return invoke<void>("add_history", { ...args });
}

export function clearHistory(): Promise<void> {
  return invoke<void>("clear_history");
}

export function listSaved(): Promise<SavedQuery[]> {
  return invoke<SavedQuery[]>("list_saved");
}

export function saveQuery(name: string, sql: string): Promise<SavedQuery> {
  return invoke<SavedQuery>("save_query", { name, sql });
}

export function deleteSaved(id: string): Promise<void> {
  return invoke<void>("delete_saved", { id });
}
