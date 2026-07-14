import { create } from "zustand";

import * as api from "@/ipc/commands";
import {
  errorMessage,
  type ColumnMeta,
  type ForeignKeyMeta,
  type IndexMeta,
  type RowCount,
  type TableMeta,
  type TriggerMeta,
  type ViewMeta,
} from "@/ipc/types";

interface SchemaState {
  tables: TableMeta[];
  views: ViewMeta[];
  indexes: IndexMeta[];
  triggers: TriggerMeta[];
  /** Per-table lazy caches. */
  columns: Record<string, ColumnMeta[]>;
  foreignKeys: Record<string, ForeignKeyMeta[]>;
  rowCounts: Record<string, RowCount>;
  loading: boolean;
  error: string | null;

  /** Load the four object lists. Schema discovery is cheap and runs on open. */
  loadSchema: () => Promise<void>;
  /**
   * Drop every cached row count and column/FK list, then reload the schema.
   * Used when the database was changed by another client and the UI is stale.
   */
  refresh: () => Promise<void>;
  ensureColumns: (table: string) => Promise<ColumnMeta[]>;
  /** Refetch a table's columns, bypassing the cache (after a DDL change). */
  refreshColumns: (table: string) => Promise<ColumnMeta[]>;
  ensureForeignKeys: (table: string) => Promise<ForeignKeyMeta[]>;
  ensureRowCount: (table: string) => Promise<void>;
  reset: () => void;
}

type SchemaData = Pick<
  SchemaState,
  "tables" | "views" | "indexes" | "triggers" | "columns" | "foreignKeys" | "rowCounts" | "error"
>;

const empty: SchemaData = {
  tables: [],
  views: [],
  indexes: [],
  triggers: [],
  columns: {},
  foreignKeys: {},
  rowCounts: {},
  error: null,
};

export const useSchemaStore = create<SchemaState>((set, get) => ({
  ...empty,
  loading: false,

  loadSchema: async () => {
    set({ loading: true, error: null });
    // Load the four lists independently so one failing query doesn't blank
    // the whole tree; surface the first failure so it's never silent.
    const [tables, views, indexes, triggers] = await Promise.allSettled([
      api.listTables(),
      api.listViews(),
      api.listIndexes(),
      api.listTriggers(),
    ]);
    const results = [tables, views, indexes, triggers];
    const firstError = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    set({
      tables: tables.status === "fulfilled" ? tables.value : [],
      views: views.status === "fulfilled" ? views.value : [],
      indexes: indexes.status === "fulfilled" ? indexes.value : [],
      triggers: triggers.status === "fulfilled" ? triggers.value : [],
      loading: false,
      error: firstError ? errorMessage(firstError.reason) : null,
    });
  },

  refresh: async () => {
    set({ columns: {}, foreignKeys: {}, rowCounts: {} });
    await get().loadSchema();
  },

  ensureColumns: async (table) => {
    const cached = get().columns[table];
    if (cached) return cached;
    const cols = await api.tableColumns(table);
    set((s) => ({ columns: { ...s.columns, [table]: cols } }));
    return cols;
  },

  refreshColumns: async (table) => {
    const cols = await api.tableColumns(table);
    set((s) => ({ columns: { ...s.columns, [table]: cols } }));
    return cols;
  },

  ensureForeignKeys: async (table) => {
    const cached = get().foreignKeys[table];
    if (cached) return cached;
    const fks = await api.tableForeignKeys(table);
    set((s) => ({ foreignKeys: { ...s.foreignKeys, [table]: fks } }));
    return fks;
  },

  ensureRowCount: async (table) => {
    if (get().rowCounts[table]) return;
    // Exact COUNT(*). The planner's reltuples estimate can be stale until the
    // table is analyzed, so we count for real. It's fetched lazily/async and
    // never blocks opening a table (the grid's first page loads separately).
    const rc = await api.rowCount(table, true).catch(() => null);
    if (rc) set((s) => ({ rowCounts: { ...s.rowCounts, [table]: rc } }));
  },

  reset: () => set({ ...empty }),
}));
