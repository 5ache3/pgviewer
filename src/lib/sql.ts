/**
 * Small helpers shared by every place that runs user-supplied SQL (the SQL
 * editor, saved queries, and history entries) so the destructive-statement
 * guard and schema-refresh heuristic stay consistent.
 */
import { useTableViewStore } from "@/stores/tableViewStore";

/** Statements we refuse to run without an explicit confirmation. */
const DESTRUCTIVE = /\b(drop|truncate|delete|update|alter|vacuum|grant|revoke)\b/i;
/** Statements that may change the schema, so the sidebar should refresh after. */
const SCHEMA_CHANGING = /\b(create|drop|alter|truncate|comment)\b/i;

export const isDestructive = (sql: string): boolean => DESTRUCTIVE.test(sql);
export const isSchemaChanging = (sql: string): boolean => SCHEMA_CHANGING.test(sql);

/** Returns true if it's safe to proceed (non-destructive, or user confirmed). */
export function confirmIfDestructive(sql: string): boolean {
  if (!isDestructive(sql)) return true;
  return window.confirm("This statement may modify or delete data. Run it anyway?");
}

/**
 * Run an arbitrary SQL string through the table view, after confirming any
 * destructive statement and refreshing the schema when the statement is DDL.
 */
export async function runSqlWithConfirm(sql: string): Promise<void> {
  const trimmed = sql.trim();
  if (!trimmed || !confirmIfDestructive(trimmed)) return;
  await useTableViewStore.getState().runSql(trimmed, {
    refreshSchema: isSchemaChanging(trimmed),
  });
}
