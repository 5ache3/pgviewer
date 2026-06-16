import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import type { Aggregate, AggregateFn } from "@/ipc/types";
import { useSchemaStore } from "@/stores/schemaStore";
import { useTableViewStore } from "@/stores/tableViewStore";

const AGG_FNS: AggregateFn[] = ["COUNT", "SUM", "AVG", "MIN", "MAX"];

const selectClass =
  "h-7 rounded border border-border bg-surface-2 px-1.5 text-xs focus:border-accent focus:outline-none";

/**
 * Visual GROUP BY / aggregation builder. Lets the user pick group-by columns,
 * add aggregate expressions (COUNT/SUM/AVG/MIN/MAX), and toggle DISTINCT — all
 * feeding the same Rust query spec/builder as the rest of the visual browser, so
 * the generated SQL stays live in the preview panel.
 */
export function AggregateBuilder() {
  const activeTable = useTableViewStore((s) => s.activeTable);
  const joins = useTableViewStore((s) => s.joins);
  const distinct = useTableViewStore((s) => s.distinct);
  const groupBy = useTableViewStore((s) => s.groupBy);
  const aggregates = useTableViewStore((s) => s.aggregates);
  const setGrouping = useTableViewStore((s) => s.setGrouping);
  const ensureColumns = useSchemaStore((s) => s.ensureColumns);

  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);

  // Column options: base table, plus joined tables qualified to avoid ambiguity.
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
  }, [activeTable, joins, ensureColumns]);

  const ungrouped = useMemo(
    () => columns.filter((c) => !groupBy.includes(c)),
    [columns, groupBy],
  );

  const activeCount = groupBy.length + aggregates.length + (distinct ? 1 : 0);

  if (!activeTable) return null;

  const apply = (next: {
    distinct?: boolean;
    groupBy?: string[];
    aggregates?: Aggregate[];
  }) =>
    void setGrouping({
      distinct: next.distinct ?? distinct,
      groupBy: next.groupBy ?? groupBy,
      aggregates: next.aggregates ?? aggregates,
    });

  return (
    <div className="shrink-0 border-b border-border bg-surface">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted hover:text-fg"
      >
        <span className="w-3 text-center">{open ? "▾" : "▸"}</span>
        <span>Group &amp; aggregate</span>
        {activeCount > 0 && (
          <span className="rounded bg-accent/20 px-1.5 text-accent">{activeCount}</span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3 text-xs">
          <label className="flex items-center gap-1.5 text-muted">
            <input
              type="checkbox"
              checked={distinct}
              onChange={(e) => apply({ distinct: e.target.checked })}
            />
            SELECT DISTINCT
          </label>

          {/* GROUP BY ------------------------------------------------------ */}
          <div className="flex flex-col gap-1">
            <span className="text-2xs text-muted">Group by</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {groupBy.map((col) => (
                <span
                  key={col}
                  className="flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-2xs text-accent"
                >
                  <span className="font-mono">{col}</span>
                  <button
                    onClick={() => apply({ groupBy: groupBy.filter((c) => c !== col) })}
                    title="Remove"
                    className="text-accent/70 hover:text-accent"
                  >
                    ×
                  </button>
                </span>
              ))}
              {ungrouped.length > 0 && (
                <select
                  className={selectClass}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) apply({ groupBy: [...groupBy, e.target.value] });
                  }}
                >
                  <option value="">+ column…</option>
                  {ungrouped.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Aggregates ---------------------------------------------------- */}
          <div className="flex flex-col gap-1">
            <span className="text-2xs text-muted">Aggregates</span>
            {aggregates.map((agg, i) => (
              <AggregateRow
                key={i}
                agg={agg}
                columns={columns}
                onChange={(next) =>
                  apply({ aggregates: aggregates.map((a, j) => (j === i ? next : a)) })
                }
                onRemove={() => apply({ aggregates: aggregates.filter((_, j) => j !== i) })}
              />
            ))}
            <button
              onClick={() =>
                apply({
                  aggregates: [
                    ...aggregates,
                    { fn: "COUNT", column: "*", alias: "" },
                  ],
                })
              }
              className="self-start rounded border border-border px-2 py-0.5 text-2xs text-muted hover:bg-surface-2 hover:text-fg"
            >
              + Aggregate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A single aggregate expression: fn(column) AS alias. */
function AggregateRow({
  agg,
  columns,
  onChange,
  onRemove,
}: {
  agg: Aggregate;
  columns: string[];
  onChange: (next: Aggregate) => void;
  onRemove: () => void;
}) {
  // COUNT supports *, the others need a concrete column.
  const columnOptions = agg.fn === "COUNT" ? ["*", ...columns] : columns;

  return (
    <div className="flex items-center gap-1.5">
      <select
        className={selectClass}
        value={agg.fn}
        onChange={(e) => {
          const fn = e.target.value as AggregateFn;
          // Switching away from COUNT invalidates a "*" column.
          const column = fn !== "COUNT" && agg.column === "*" ? (columns[0] ?? "") : agg.column;
          onChange({ ...agg, fn, column });
        }}
      >
        {AGG_FNS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <select
        className={cn(selectClass, "min-w-0 flex-1")}
        value={agg.column}
        onChange={(e) => onChange({ ...agg, column: e.target.value })}
      >
        {columnOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <span className="text-2xs text-muted">AS</span>
      <input
        value={agg.alias ?? ""}
        onChange={(e) => onChange({ ...agg, alias: e.target.value })}
        placeholder="alias"
        className="h-7 w-20 min-w-0 rounded border border-border bg-surface-2 px-1.5 text-xs focus:border-accent focus:outline-none"
      />
      <button
        onClick={onRemove}
        title="Remove aggregate"
        className="h-6 w-6 shrink-0 rounded border border-border text-muted hover:bg-surface-2 hover:text-fg"
      >
        ×
      </button>
    </div>
  );
}
