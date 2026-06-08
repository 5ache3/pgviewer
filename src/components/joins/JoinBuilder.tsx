import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import * as api from "@/ipc/commands";
import type { JoinKind, JoinSuggestion } from "@/ipc/types";
import { useSchemaStore } from "@/stores/schemaStore";
import { useTableViewStore } from "@/stores/tableViewStore";

const JOIN_KINDS: JoinKind[] = ["INNER", "LEFT", "RIGHT", "FULL", "CROSS"];

const selectClass =
  "h-7 rounded border border-border bg-surface-2 px-1.5 text-xs focus:border-accent focus:outline-none";

/**
 * Visual join builder. Lists active joins (editable kind), offers one-click
 * foreign-key suggestions, and provides a manual form to join any table on any
 * columns (no FK required). Each change reruns the query in Rust.
 */
export function JoinBuilder() {
  const activeTable = useTableViewStore((s) => s.activeTable);
  const joins = useTableViewStore((s) => s.joins);
  const addJoin = useTableViewStore((s) => s.addJoin);
  const removeJoin = useTableViewStore((s) => s.removeJoin);
  const setJoinKind = useTableViewStore((s) => s.setJoinKind);

  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<JoinSuggestion[]>([]);

  useEffect(() => {
    if (!activeTable) return;
    let cancelled = false;
    void api.joinSuggestions(activeTable).then((s) => {
      if (!cancelled) setSuggestions(s);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTable]);

  if (!activeTable) return null;

  const joinedTables = new Set(joins.map((j) => j.table));
  const available = suggestions.filter((s) => !joinedTables.has(s.table));

  return (
    <div className="shrink-0 border-b border-border bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted hover:text-fg"
      >
        <span className="w-3 text-center">{open ? "▾" : "▸"}</span>
        <span>Joins</span>
        {joins.length > 0 && (
          <span className="rounded bg-accent/20 px-1.5 text-accent">{joins.length}</span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {/* Active joins */}
          {joins.map((join, i) => (
            <div key={`${join.table}-${i}`} className="flex items-center gap-2 text-xs">
              <select
                className={selectClass}
                value={join.kind}
                onChange={(e) => void setJoinKind(i, e.target.value as JoinKind)}
              >
                {JOIN_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <span className="font-mono">{join.table}</span>
              {join.on.length > 0 && (
                <span className="truncate text-2xs text-muted">
                  ON {join.on.map((o) => `${o.left} = ${o.right}`).join(" AND ")}
                </span>
              )}
              <button
                onClick={() => void removeJoin(i)}
                title="Remove join"
                className="ml-auto h-6 w-6 shrink-0 rounded border border-border text-muted hover:bg-surface-2 hover:text-fg"
              >
                ×
              </button>
            </div>
          ))}

          {/* Suggestions */}
          {available.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-2xs text-muted">Suggested (from foreign keys):</span>
              <div className="flex flex-wrap gap-1.5">
                {available.map((s, i) => (
                  <button
                    key={`${s.table}-${i}`}
                    onClick={() =>
                      void addJoin({
                        kind: "INNER",
                        table: s.table,
                        on: [{ left: s.left, right: s.right }],
                      })
                    }
                    title={`${s.left} = ${s.right}`}
                    className={cn(
                      "rounded border px-2 py-0.5 text-2xs hover:bg-surface-2",
                      s.direction === "outgoing"
                        ? "border-sky-500/40 text-sky-300"
                        : "border-emerald-500/40 text-emerald-300",
                    )}
                  >
                    + {s.table}
                  </button>
                ))}
              </div>
            </div>
          )}

          <ManualJoinForm joinedTables={joinedTables} />
        </div>
      )}
    </div>
  );
}

/** Manual join: choose any table, a join kind, and an equality column pair. */
function ManualJoinForm({ joinedTables }: { joinedTables: Set<string> }) {
  const activeTable = useTableViewStore((s) => s.activeTable)!;
  const joins = useTableViewStore((s) => s.joins);
  const addJoin = useTableViewStore((s) => s.addJoin);
  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const ensureColumns = useSchemaStore((s) => s.ensureColumns);

  const [open, setOpen] = useState(false);
  const [table, setTable] = useState("");
  const [kind, setKind] = useState<JoinKind>("INNER");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [leftOptions, setLeftOptions] = useState<string[]>([]);
  const [rightOptions, setRightOptions] = useState<string[]>([]);

  const targets = [...tables.map((t) => t.name), ...views.map((v) => v.name)].filter(
    (n) => n !== activeTable && !joinedTables.has(n),
  );

  // Left side: columns from the base table plus any already-joined tables.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const base = (await ensureColumns(activeTable)).map((c) => `${activeTable}.${c.name}`);
      let all = [...base];
      for (const j of joins) {
        const cols = (await ensureColumns(j.table)).map((c) => `${j.table}.${c.name}`);
        all = all.concat(cols);
      }
      if (!cancelled) setLeftOptions(all);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeTable, joins, ensureColumns]);

  // Right side: columns of the chosen target table.
  useEffect(() => {
    if (!table) {
      setRightOptions([]);
      return;
    }
    let cancelled = false;
    void ensureColumns(table).then((cols) => {
      if (!cancelled) setRightOptions(cols.map((c) => `${table}.${c.name}`));
    });
    return () => {
      cancelled = true;
    };
  }, [table, ensureColumns]);

  const needsOn = kind !== "CROSS";
  const canAdd = table !== "" && (!needsOn || (left !== "" && right !== ""));

  const onAdd = () => {
    if (!canAdd) return;
    void addJoin({ kind, table, on: needsOn ? [{ left, right }] : [] });
    setTable("");
    setLeft("");
    setRight("");
    setKind("INNER");
    setOpen(false);
  };

  if (targets.length === 0 && !open) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="self-start rounded border border-border px-2 py-0.5 text-2xs text-muted hover:bg-surface-2 hover:text-fg"
        >
          + Manual join
        </button>
      ) : (
        <div className="flex flex-col gap-1.5 rounded-md border border-border/70 bg-surface-2/40 p-2">
          <div className="flex items-center gap-1.5">
            <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as JoinKind)}>
              {JOIN_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select className={cn(selectClass, "flex-1")} value={table} onChange={(e) => setTable(e.target.value)}>
              <option value="">table…</option>
              {targets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {needsOn && (
            <div className="flex items-center gap-1.5">
              <select className={cn(selectClass, "min-w-0 flex-1")} value={left} onChange={(e) => setLeft(e.target.value)}>
                <option value="">left column…</option>
                {leftOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span className="text-2xs text-muted">=</span>
              <select className={cn(selectClass, "min-w-0 flex-1")} value={right} onChange={(e) => setRight(e.target.value)}>
                <option value="">right column…</option>
                {rightOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <button
              onClick={onAdd}
              disabled={!canAdd}
              className="rounded border border-border px-2 py-0.5 text-2xs text-muted hover:bg-surface hover:text-fg disabled:opacity-40"
            >
              Add join
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded border border-border px-2 py-0.5 text-2xs text-muted hover:bg-surface hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
