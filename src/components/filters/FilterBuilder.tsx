import { useEffect, useState } from "react";

import { useSchemaStore } from "@/stores/schemaStore";
import { useTableViewStore } from "@/stores/tableViewStore";
import { useFilterStore, toFilterGroup } from "@/stores/filterStore";
import { FOCUS_FILTER_EVENT } from "@/lib/events";

import { FilterGroupView } from "./FilterGroupView";

const APPLY_DEBOUNCE_MS = 300;

/**
 * Collapsible filter panel above the grid. Edits build a `FilterGroup` that is
 * applied (debounced) to the table view, which regenerates the SQL and reruns
 * the query in Rust — keeping the preview and grid live as the user types.
 */
export function FilterBuilder() {
  const activeTable = useTableViewStore((s) => s.activeTable);
  const joins = useTableViewStore((s) => s.joins);
  const applyFilter = useTableViewStore((s) => s.applyFilter);
  const root = useFilterStore((s) => s.root);
  const setColumns = useFilterStore((s) => s.setColumns);
  const resetFilters = useFilterStore((s) => s.reset);
  const ensureColumns = useSchemaStore((s) => s.ensureColumns);

  const [open, setOpen] = useState(true);

  // Clear the filter tree when switching tables.
  useEffect(() => {
    if (activeTable) resetFilters();
  }, [activeTable, resetFilters]);

  // ⌘/Ctrl+F: reveal the filter panel and start a condition if none exist.
  useEffect(() => {
    const focus = () => {
      setOpen(true);
      const { root: tree, addCondition: add } = useFilterStore.getState();
      if (tree.children.length === 0) add(tree.id);
    };
    window.addEventListener(FOCUS_FILTER_EVENT, focus);
    return () => window.removeEventListener(FOCUS_FILTER_EVENT, focus);
  }, []);

  // Populate column options for the base table plus any joined tables. With
  // joins, columns are qualified (`table.column`) to avoid ambiguity.
  useEffect(() => {
    if (!activeTable) return;
    let cancelled = false;
    void (async () => {
      const base = (await ensureColumns(activeTable)).map((c) => c.name);
      if (joins.length === 0) {
        if (!cancelled) setColumns(base);
        return;
      }
      let all = base.map((c) => `${activeTable}.${c}`);
      for (const join of joins) {
        const cols = (await ensureColumns(join.table)).map((c) => `${join.table}.${c}`);
        all = all.concat(cols);
      }
      if (!cancelled) setColumns(all);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTable, joins, ensureColumns, setColumns]);

  // Live apply: debounce edits, then push the projected filter to the view.
  useEffect(() => {
    const timer = setTimeout(() => void applyFilter(toFilterGroup(root)), APPLY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [root, applyFilter]);

  if (!activeTable) return null;

  const conditionCount = countConditions(root);

  return (
    <div className="shrink-0 border-b border-border bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted hover:text-fg"
      >
        <span className="w-3 text-center">{open ? "▾" : "▸"}</span>
        <span>Filters</span>
        {conditionCount > 0 && (
          <span className="rounded bg-accent/20 px-1.5 text-accent">{conditionCount}</span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3">
          <FilterGroupView group={root} isRoot />
        </div>
      )}
    </div>
  );
}

function countConditions(node: ReturnType<typeof useFilterStore.getState>["root"]): number {
  return node.children.reduce(
    (n, c) => n + (c.kind === "group" ? countConditions(c) : 1),
    0,
  );
}
