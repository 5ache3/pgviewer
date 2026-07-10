import { create } from "zustand";

import * as api from "@/ipc/commands";
import {
  errorMessage,
  isAppError,
  type Aggregate,
  type CellValue,
  type FilterGroup,
  type Join,
  type JoinKind,
  type QuerySpec,
  type ResultColumn,
} from "@/ipc/types";

import { cellToJson } from "@/components/grid/CellView";

import { useHistoryStore } from "./historyStore";
import { useSchemaStore } from "./schemaStore";

const DEFAULT_PAGE_SIZE = 500;

interface SortState {
  column: string;
  dir: "ASC" | "DESC";
}

/**
 * A delete that PostgreSQL rejected because other rows reference the selected
 * ones. Holds the captured PKs so the cascade dialog can show the dependents
 * and, on confirmation, delete everything.
 */
interface DeleteBlocked {
  table: string;
  pks: api.PkPredicate[][];
  message: string;
}

interface TableViewState {
  activeTable: string | null;
  pageSize: number;
  offset: number;
  /** Ordered list of sort columns (multi-column sort). */
  sorts: SortState[];
  filter: FilterGroup | null;
  joins: Join[];
  /** SELECT DISTINCT. */
  distinct: boolean;
  /** GROUP BY columns. */
  groupBy: string[];
  /** Aggregate expressions (COUNT/SUM/AVG/MIN/MAX). */
  aggregates: Aggregate[];

  // Last loaded page.
  sql: string;
  columns: ResultColumn[];
  rows: CellValue[][];
  elapsedMs: number;
  loading: boolean;
  error: string | null;
  /**
   * Transient message from the last raw-SQL run (e.g. "12 rows affected" for a
   * statement that returns no result set). Cleared whenever a new query runs.
   */
  notice: string | null;
  /** Set when a delete failed on a FK violation; drives the cascade dialog. */
  deleteBlocked: DeleteBlocked | null;

  selectTable: (table: string) => Promise<void>;
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;
  /** Toggle sort on a column. `additive` (shift-click) keeps existing sorts. */
  toggleSort: (column: string, additive?: boolean) => Promise<void>;
  applyFilter: (filter: FilterGroup | null) => Promise<void>;
  addJoin: (join: Join) => Promise<void>;
  removeJoin: (index: number) => Promise<void>;
  setJoinKind: (index: number, kind: JoinKind) => Promise<void>;
  /** Replace the grouping/aggregation state and rerun the query. */
  setGrouping: (grouping: {
    distinct: boolean;
    groupBy: string[];
    aggregates: Aggregate[];
  }) => Promise<void>;
  /** The current query spec (for export), or null if no table is active. */
  getSpec: () => QuerySpec | null;
  /**
   * Edit one cell: write it back via an UPDATE keyed on the row's primary key,
   * then refresh the page. No-ops (with an error) when a join is active or the
   * table has no primary key.
   */
  editCell: (rowIndex: number, colIndex: number, raw: string) => Promise<void>;
  /** Whether cells can be edited in the current view (single table + PK). */
  canEdit: () => boolean;
  /**
   * Delete one or more rows by their primary keys, then refresh the page. PKs are
   * captured up front so row indices don't shift mid-delete. No-ops (with an
   * error) when the view isn't a single table with a primary key. Destructive —
   * callers must confirm with the user first.
   */
  deleteRows: (rowIndexes: number[]) => Promise<void>;
  /**
   * Delete the rows of the blocked delete plus everything referencing them, in
   * one transaction. Only callable while `deleteBlocked` is set; the cascade
   * dialog shows the affected rows and confirms before calling this.
   */
  cascadeDelete: () => Promise<void>;
  /** Dismiss the cascade dialog without deleting anything. */
  cancelCascadeDelete: () => void;
  /** Re-run the current query (e.g. after a schema change). */
  reload: () => Promise<void>;
  /**
   * Execute an arbitrary, user-edited SQL string and show its result in the grid.
   * Used by the editable SQL panel. Schema-changing statements (the caller
   * passes `refreshSchema: true`) reload the sidebar afterwards.
   */
  runSql: (sql: string, opts?: { refreshSchema?: boolean }) => Promise<void>;
  reset: () => void;
}

const blankPage = {
  sql: "",
  columns: [] as ResultColumn[],
  rows: [] as CellValue[][],
  elapsedMs: 0,
  error: null as string | null,
  notice: null as string | null,
  deleteBlocked: null as DeleteBlocked | null,
};

/** Per-table query state, reset whenever the active table changes. */
const blankView = {
  offset: 0,
  sorts: [] as SortState[],
  filter: null as FilterGroup | null,
  joins: [] as Join[],
  distinct: false,
  groupBy: [] as string[],
  aggregates: [] as Aggregate[],
};

export const useTableViewStore = create<TableViewState>((set, get) => ({
  activeTable: null,
  pageSize: DEFAULT_PAGE_SIZE,
  ...blankView,
  ...blankPage,
  loading: false,

  selectTable: async (table) => {
    if (get().activeTable === table) return;
    set({ activeTable: table, ...blankView, ...blankPage });
    await load(get, set);
  },

  nextPage: async () => {
    const { offset, pageSize, rows } = get();
    // Only advance if the current page looks full (a short page = last page).
    if (rows.length < pageSize) return;
    set({ offset: offset + pageSize });
    await load(get, set);
  },

  prevPage: async () => {
    const { offset, pageSize } = get();
    if (offset === 0) return;
    set({ offset: Math.max(0, offset - pageSize) });
    await load(get, set);
  },

  toggleSort: async (column, additive = false) => {
    const { sorts } = get();
    const existing = sorts.find((s) => s.column === column);
    let next: SortState[];
    if (additive) {
      // Shift-click: append the column, then cycle ASC → DESC → removed.
      if (!existing) next = [...sorts, { column, dir: "ASC" }];
      else if (existing.dir === "ASC")
        next = sorts.map((s) => (s.column === column ? { column, dir: "DESC" } : s));
      else next = sorts.filter((s) => s.column !== column);
    } else {
      // Plain click: sort by this column alone, toggling direction.
      const dir: "ASC" | "DESC" =
        existing && sorts.length === 1 && existing.dir === "ASC" ? "DESC" : "ASC";
      next = [{ column, dir }];
    }
    set({ sorts: next, offset: 0 });
    await load(get, set);
  },

  applyFilter: async (filter) => {
    // Skip redundant reloads (e.g. editing an incomplete condition).
    if (JSON.stringify(get().filter) === JSON.stringify(filter)) return;
    set({ filter, offset: 0 });
    await load(get, set);
  },

  addJoin: async (join) => {
    set({ joins: [...get().joins, join], offset: 0 });
    await load(get, set);
  },

  removeJoin: async (index) => {
    set({ joins: get().joins.filter((_, i) => i !== index), offset: 0 });
    await load(get, set);
  },

  setJoinKind: async (index, kind) => {
    set({ joins: get().joins.map((j, i) => (i === index ? { ...j, kind } : j)), offset: 0 });
    await load(get, set);
  },

  setGrouping: async ({ distinct, groupBy, aggregates }) => {
    set({ distinct, groupBy, aggregates, offset: 0 });
    await load(get, set);
  },

  getSpec: () => {
    const s = get();
    return s.activeTable ? currentSpec(s) : null;
  },

  canEdit: () => {
    const s = get();
    if (!s.activeTable || s.joins.length > 0) return false;
    if (s.groupBy.length > 0 || s.aggregates.length > 0 || s.distinct) return false;
    const meta = useSchemaStore.getState().columns[s.activeTable];
    return !!meta && meta.some((c) => c.pk > 0);
  },

  editCell: async (rowIndex, colIndex, raw) => {
    const state = get();
    const table = state.activeTable;
    if (!table) return;
    if (state.joins.length > 0) {
      set({ error: "Editing is disabled while a join is active." });
      return;
    }
    if (state.groupBy.length > 0 || state.aggregates.length > 0 || state.distinct) {
      set({ error: "Editing is disabled for grouped/aggregated results." });
      return;
    }
    const col = state.columns[colIndex];
    const row = state.rows[rowIndex];
    if (!col || !row) return;

    // Identify the row by its primary key.
    const meta = await useSchemaStore
      .getState()
      .ensureColumns(table)
      .catch(() => []);
    const pkCols = meta.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
    if (pkCols.length === 0) {
      set({ error: "Cannot edit: this table has no primary key." });
      return;
    }
    const indexByName = new Map(state.columns.map((c, i) => [c.name, i]));
    const pk = pkCols.map((pc) => {
      const idx = indexByName.get(pc.name);
      return { column: pc.name, value: idx === undefined ? null : cellToJson(row[idx]) };
    });

    // An empty input clears the cell to NULL; otherwise the binder coerces the
    // text to the column's actual type.
    const value = raw === "" ? null : raw;
    try {
      await api.updateCell({ table, column: col.name, value, pk });
      await load(get, set);
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  deleteRows: async (rowIndexes) => {
    const state = get();
    const table = state.activeTable;
    if (!table || rowIndexes.length === 0) return;
    if (state.joins.length > 0) {
      set({ error: "Deleting is disabled while a join is active." });
      return;
    }
    if (state.groupBy.length > 0 || state.aggregates.length > 0 || state.distinct) {
      set({ error: "Deleting is disabled for grouped/aggregated results." });
      return;
    }

    // Identify rows by their primary key.
    const meta = await useSchemaStore
      .getState()
      .ensureColumns(table)
      .catch(() => []);
    const pkCols = meta.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
    if (pkCols.length === 0) {
      set({ error: "Cannot delete: this table has no primary key." });
      return;
    }
    const indexByName = new Map(state.columns.map((c, i) => [c.name, i]));
    // Capture every row's PK before issuing any delete, so reloading the page
    // can't shift the indices out from under us.
    const pks = rowIndexes
      .map((rowIndex) => state.rows[rowIndex])
      .filter((row): row is CellValue[] => row != null)
      .map((row) =>
        pkCols.map((pc) => {
          const idx = indexByName.get(pc.name);
          return { column: pc.name, value: idx === undefined ? null : cellToJson(row[idx]) };
        }),
      );

    try {
      for (const pk of pks) {
        await api.deleteRow({ table, pk });
      }
      await load(get, set);
    } catch (e) {
      // Other rows reference the selected ones: hand off to the cascade-delete
      // dialog instead of surfacing a bare error. All captured PKs are kept —
      // roots already deleted simply have no dependents left.
      if (isAppError(e) && e.code === "FK_VIOLATION") {
        set({ deleteBlocked: { table, pks, message: e.message } });
        await load(get, set);
        return;
      }
      set({ error: errorMessage(e) });
    }
  },

  cascadeDelete: async () => {
    const blocked = get().deleteBlocked;
    if (!blocked) return;
    set({ deleteBlocked: null });
    try {
      const n = await api.deleteRowsCascade({ table: blocked.table, pks: blocked.pks });
      set({ notice: `${n} row(s) deleted` });
      await load(get, set);
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  cancelCascadeDelete: () => set({ deleteBlocked: null }),

  reload: async () => {
    await load(get, set);
  },

  runSql: async (sql, opts) => {
    const trimmed = sql.trim();
    if (!trimmed) return;

    set({ loading: true, error: null, notice: null });
    const started = performance.now();
    try {
      const result = await api.runRawSql(trimmed);
      // A command with no result set (INSERT/UPDATE/DELETE/DDL) reports affected
      // rows instead of columns; surface that as a notice and keep the old grid.
      const isCommand = result.columns.length === 0 && result.rowsAffected !== null;
      set({
        sql: trimmed,
        loading: false,
        elapsedMs: result.elapsedMs,
        notice: isCommand ? `${result.rowsAffected} row(s) affected` : null,
        ...(isCommand
          ? {}
          : { columns: result.columns, rows: result.rows }),
      });

      const rowCount = isCommand ? result.rowsAffected : result.rows.length;
      void api
        .addHistory({
          sql: trimmed,
          table: get().activeTable,
          rowCount,
          elapsedMs: result.elapsedMs,
        })
        .then(() => useHistoryStore.getState().refresh())
        .catch(() => undefined);

      // DDL/DML may have changed the schema (new table, dropped column, …).
      if (opts?.refreshSchema) {
        void useSchemaStore.getState().loadSchema();
      }
    } catch (e) {
      set({ loading: false, elapsedMs: performance.now() - started, error: errorMessage(e) });
    }
  },

  reset: () => set({ activeTable: null, ...blankView, ...blankPage }),
}));

type Get = () => TableViewState;
type Set = (partial: Partial<TableViewState>) => void;

/** Build the current `QuerySpec` from the view state. */
function currentSpec(state: TableViewState): QuerySpec {
  const grouped = state.groupBy.length > 0;
  return {
    baseTable: state.activeTable as string,
    distinct: state.distinct || undefined,
    // When grouping, the raw select list is the GROUP BY columns; aggregates are
    // appended by the builder. Without grouping we leave columns unset (SELECT *).
    columns: grouped ? state.groupBy : undefined,
    // Drop blank aliases so the builder emits a bare expression, not `AS ""`.
    aggregates: state.aggregates.length
      ? state.aggregates.map((a) => ({ ...a, alias: a.alias?.trim() ? a.alias.trim() : undefined }))
      : undefined,
    joins: state.joins.length ? state.joins : undefined,
    where: state.filter ?? undefined,
    groupBy: grouped ? state.groupBy : undefined,
    orderBy: state.sorts.length ? state.sorts : undefined,
    limit: state.pageSize,
    offset: state.offset,
  };
}

/** Shared loader: builds a spec and runs it in Rust, updating SQL + rows. */
async function load(get: Get, set: Set): Promise<void> {
  const state = get();
  if (!state.activeTable) return;

  set({ loading: true, error: null });
  try {
    const { sql, result } = await api.runQuery(currentSpec(state));
    set({
      sql,
      columns: result.columns,
      rows: result.rows,
      elapsedMs: result.elapsedMs,
      loading: false,
    });
    // Record in history (backend dedupes consecutive identical SQL).
    void api
      .addHistory({
        sql,
        table: state.activeTable,
        rowCount: result.rows.length,
        elapsedMs: result.elapsedMs,
      })
      .then(() => useHistoryStore.getState().refresh())
      .catch(() => undefined);
  } catch (e) {
    set({ loading: false, error: errorMessage(e) });
  }
}
