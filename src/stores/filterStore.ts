import { create } from "zustand";

import type { Filter, FilterGroup, FilterOp } from "@/ipc/types";
import { arityOf, coerceList, coerceScalar } from "@/lib/operators";

/**
 * Editable filter tree for the active table.
 *
 * The UI tree carries client-side `id`s and raw string inputs for ergonomic
 * editing; [`toFilterGroup`] projects it into the clean `FilterGroup` the
 * backend consumes, pruning incomplete conditions so partial typing never
 * produces invalid SQL.
 */

export interface UiCondition {
  id: string;
  kind: "condition";
  column: string;
  op: FilterOp;
  value: string;
  value2: string;
}

export interface UiGroup {
  id: string;
  kind: "group";
  combinator: "AND" | "OR";
  children: UiNode[];
}

export type UiNode = UiCondition | UiGroup;

const uid = () => crypto.randomUUID();

function newCondition(column = ""): UiCondition {
  return { id: uid(), kind: "condition", column, op: "eq", value: "", value2: "" };
}

function newGroup(): UiGroup {
  return { id: uid(), kind: "group", combinator: "AND", children: [] };
}

// --- Immutable tree helpers ------------------------------------------------

function editGroup(node: UiGroup, groupId: string, fn: (g: UiGroup) => UiGroup): UiGroup {
  const next = node.id === groupId ? fn(node) : node;
  return {
    ...next,
    children: next.children.map((c) => (c.kind === "group" ? editGroup(c, groupId, fn) : c)),
  };
}

function removeFrom(node: UiGroup, id: string): UiGroup {
  return {
    ...node,
    children: node.children
      .filter((c) => c.id !== id)
      .map((c) => (c.kind === "group" ? removeFrom(c, id) : c)),
  };
}

function editCondition(node: UiGroup, id: string, patch: Partial<UiCondition>): UiGroup {
  return {
    ...node,
    children: node.children.map((c) => {
      if (c.kind === "group") return editCondition(c, id, patch);
      return c.id === id ? { ...c, ...patch } : c;
    }),
  };
}

// --- Projection to the backend FilterGroup ---------------------------------

function conditionToFilter(c: UiCondition): Filter | null {
  if (!c.column) return null;
  const arity = arityOf(c.op);
  if (arity === "none") return { column: c.column, op: c.op };
  if (arity === "list") {
    const value = coerceList(c.value);
    return value.length ? { column: c.column, op: c.op, value } : null;
  }
  if (arity === "two") {
    if (c.value === "" || c.value2 === "") return null;
    return { column: c.column, op: c.op, value: coerceScalar(c.value), value2: coerceScalar(c.value2) };
  }
  if (c.value === "") return null;
  return { column: c.column, op: c.op, value: coerceScalar(c.value) };
}

/** Project the UI tree to a `FilterGroup`, or `null` when there are no
 * complete conditions. */
export function toFilterGroup(node: UiGroup): FilterGroup | null {
  const children = node.children
    .map((c) => (c.kind === "group" ? toFilterGroup(c) : conditionToFilter(c)))
    .filter((c): c is Filter | FilterGroup => c !== null);

  if (children.length === 0) return null;
  return { combinator: node.combinator, children };
}

// --- Store -----------------------------------------------------------------

interface FilterState {
  root: UiGroup;
  /** Column names of the active table, for the column dropdowns. */
  columns: string[];

  setColumns: (columns: string[]) => void;
  addCondition: (groupId: string) => void;
  addGroup: (groupId: string) => void;
  remove: (id: string) => void;
  updateCondition: (id: string, patch: Partial<UiCondition>) => void;
  setCombinator: (groupId: string, combinator: "AND" | "OR") => void;
  reset: () => void;
}

export const useFilterStore = create<FilterState>((set, get) => ({
  root: newGroup(),
  columns: [],

  setColumns: (columns) => set({ columns }),

  addCondition: (groupId) =>
    set((s) => ({
      root: editGroup(s.root, groupId, (g) => ({
        ...g,
        children: [...g.children, newCondition(get().columns[0] ?? "")],
      })),
    })),

  addGroup: (groupId) =>
    set((s) => ({
      root: editGroup(s.root, groupId, (g) => ({ ...g, children: [...g.children, newGroup()] })),
    })),

  remove: (id) => set((s) => ({ root: removeFrom(s.root, id) })),

  updateCondition: (id, patch) => set((s) => ({ root: editCondition(s.root, id, patch) })),

  setCombinator: (groupId, combinator) =>
    set((s) => ({ root: editGroup(s.root, groupId, (g) => ({ ...g, combinator })) })),

  reset: () => set({ root: newGroup() }),
}));
