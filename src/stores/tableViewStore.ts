import { create } from "zustand";

import * as api from "@/ipc/commands";
import {
  errorMessage,
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

interface TableViewState {
  activeTable: string | null;
  pageSize: number;
  offset: number;
  sort: SortState | null;
  filter: FilterGroup | null;
  joins: Join[];

  // Last loaded page.
  sql: string;
  columns: ResultColumn[];
  rows: CellValue[][];
  elapsedMs: number;
  loading: boolean;
  error: string | null;

  selectTable: (table: string) => Promise<void>;
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;
  toggleSort: (column: string) => Promise<void>;
  applyFilter: (filter: FilterGroup | null) => Promise<void>;
  addJoin: (join: Join) => Promise<void>;
  removeJoin: (index: number) => Promise<void>;
  setJoinKind: (index: number, kind: JoinKind) => Promise<void>;
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
  /** Re-run the current query (e.g. after a schema change). */
  reload: () => Promise<void>;
  reset: () => void;
}

const blankPage = {
  sql: "",
  columns: [] as ResultColumn[],
  rows: [] as CellValue[][],
  elapsedMs: 0,
  error: null as string | null,
};

export const useTableViewStore = create<TableViewState>((set, get) => ({
  activeTable: null,
  pageSize: DEFAULT_PAGE_SIZE,
  offset: 0,
  sort: null,
  filter: null,
  joins: [],
  ...blankPage,
  loading: false,

  selectTable: async (table) => {
    if (get().activeTable === table) return;
    set({ activeTable: table, offset: 0, sort: null, filter: null, joins: [], ...blankPage });
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

  toggleSort: async (column) => {
    const { sort } = get();
    const dir: "ASC" | "DESC" =
      sort?.column === column && sort.dir === "ASC" ? "DESC" : "ASC";
    set({ sort: { column, dir }, offset: 0 });
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

  getSpec: () => {
    const s = get();
    return s.activeTable ? currentSpec(s) : null;
  },

  canEdit: () => {
    const s = get();
    if (!s.activeTable || s.joins.length > 0) return false;
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

  reload: async () => {
    await load(get, set);
  },

  reset: () =>
    set({ activeTable: null, offset: 0, sort: null, filter: null, joins: [], ...blankPage }),
}));

type Get = () => TableViewState;
type Set = (partial: Partial<TableViewState>) => void;

/** Build the current `QuerySpec` from the view state. */
function currentSpec(state: TableViewState): QuerySpec {
  return {
    baseTable: state.activeTable as string,
    joins: state.joins.length ? state.joins : undefined,
    where: state.filter ?? undefined,
    orderBy: state.sort ? [{ column: state.sort.column, dir: state.sort.dir }] : undefined,
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
