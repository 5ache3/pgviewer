import { useSchemaStore } from "@/stores/schemaStore";
import { useTableViewStore } from "@/stores/tableViewStore";

/**
 * Refetch everything from the live server without reconnecting: the schema
 * lists, every cached row count and column list, and the current grid page.
 * Used when another client changed the database and the UI is stale.
 */
export async function refreshAll(): Promise<void> {
  await Promise.all([
    useSchemaStore.getState().refresh(),
    useTableViewStore.getState().reload(),
  ]);
  // The sidebar refetches counts for the tables it renders; cover the active
  // table explicitly so the grid toolbar updates even with the sidebar hidden.
  const table = useTableViewStore.getState().activeTable;
  if (table) void useSchemaStore.getState().ensureRowCount(table);
}
