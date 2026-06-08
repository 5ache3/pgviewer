import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { useSchemaStore } from "@/stores/schemaStore";
import { useTableViewStore } from "@/stores/tableViewStore";
import { useUiStore } from "@/stores/uiStore";
import { HistorySection } from "@/components/history/HistorySection";
import { SavedSection } from "@/components/history/SavedSection";

/** Left sidebar: schema tree of tables, views, indexes, triggers. */
export function Sidebar() {
  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const indexes = useSchemaStore((s) => s.indexes);
  const triggers = useSchemaStore((s) => s.triggers);
  const loading = useSchemaStore((s) => s.loading);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface">
      {loading && <p className="p-3 text-xs text-muted">Loading schema…</p>}

      <Section title="Tables" count={tables.length} defaultOpen>
        <TablesBody names={tables.map((t) => t.name)} />
      </Section>

      <Section title="Views" count={views.length}>
        {views.map((v) => (
          <TableRow key={v.name} name={v.name} muted />
        ))}
      </Section>

      <Section title="Indexes" count={indexes.length}>
        {indexes.map((i) => (
          <LeafRow key={i.name} label={i.name} hint={`${i.table}${i.unique ? " · unique" : ""}`} />
        ))}
      </Section>

      <Section title="Triggers" count={triggers.length}>
        {triggers.map((t) => (
          <LeafRow key={t.name} label={t.name} hint={t.table} />
        ))}
      </Section>

      <HistorySection />
      <SavedSection />
    </aside>
  );
}

function Section({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted hover:text-fg"
      >
        <span className="w-3 text-center">{open ? "▾" : "▸"}</span>
        <span>{title}</span>
        <span className="ml-auto rounded bg-surface-2 px-1.5 tabular-nums">{count}</span>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

/**
 * Tables grouped as: pinned (top) · non-empty · empty (collapsed at the bottom).
 * Row counts drive the empty/non-empty split, so we eagerly fetch estimates.
 */
function TablesBody({ names }: { names: string[] }) {
  const counts = useSchemaStore((s) => s.rowCounts);
  const ensureRowCount = useSchemaStore((s) => s.ensureRowCount);
  const pinned = useUiStore((s) => s.pinnedTables);
  const [showEmpty, setShowEmpty] = useState(false);

  useEffect(() => {
    names.forEach((name) => void ensureRowCount(name));
  }, [names, ensureRowCount]);

  const pinnedSet = new Set(pinned);
  const isEmpty = (name: string) => counts[name]?.count === 0;

  const pinnedNames = names.filter((n) => pinnedSet.has(n));
  const rest = names.filter((n) => !pinnedSet.has(n));
  const nonEmpty = rest.filter((n) => !isEmpty(n));
  const empty = rest.filter((n) => isEmpty(n));

  return (
    <>
      {pinnedNames.map((n) => (
        <TableRow key={n} name={n} />
      ))}
      {pinnedNames.length > 0 && nonEmpty.length > 0 && (
        <div className="my-1 border-t border-border/40" />
      )}
      {nonEmpty.map((n) => (
        <TableRow key={n} name={n} />
      ))}

      {empty.length > 0 && (
        <>
          <button
            onClick={() => setShowEmpty((o) => !o)}
            className="flex w-full items-center gap-1.5 px-3 py-1 text-2xs text-muted hover:text-fg"
          >
            <span className="w-3 text-center">{showEmpty ? "▾" : "▸"}</span>
            <span>Empty tables ({empty.length})</span>
          </button>
          {showEmpty && empty.map((n) => <TableRow key={n} name={n} dim />)}
        </>
      )}
    </>
  );
}

/** A table/view row: selectable, with a lazy row-count estimate and (for
 * tables) a pin toggle. */
function TableRow({
  name,
  muted = false,
  dim = false,
}: {
  name: string;
  muted?: boolean;
  dim?: boolean;
}) {
  const select = useTableViewStore((s) => s.selectTable);
  const active = useTableViewStore((s) => s.activeTable === name);
  const ensureRowCount = useSchemaStore((s) => s.ensureRowCount);
  const rowCount = useSchemaStore((s) => s.rowCounts[name]);
  const pinned = useUiStore((s) => s.pinnedTables.includes(name));
  const togglePin = useUiStore((s) => s.togglePin);

  useEffect(() => {
    void ensureRowCount(name);
  }, [name, ensureRowCount]);

  return (
    <div
      className={cn(
        "group flex items-center pr-1",
        active ? "bg-accent/15" : "hover:bg-surface-2",
      )}
    >
      <button
        onClick={() => void select(name)}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1 text-left text-sm"
      >
        <span className={cn("truncate", muted && "italic", dim && "text-muted")}>{name}</span>
        {rowCount && (
          <span className="ml-auto text-2xs tabular-nums text-muted">
            {rowCount.exact ? "" : "~"}
            {formatCount(rowCount.count)}
          </span>
        )}
      </button>
      {!muted && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            togglePin(name);
          }}
          title={pinned ? "Unpin" : "Pin to top"}
          className={cn(
            "shrink-0 px-1 text-xs",
            pinned ? "text-accent" : "text-muted opacity-0 group-hover:opacity-100 hover:text-fg",
          )}
        >
          {pinned ? "★" : "☆"}
        </button>
      )}
    </div>
  );
}

function LeafRow({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-sm text-fg/80">
      <span className="truncate">{label}</span>
      {hint && <span className="ml-auto truncate text-2xs text-muted">{hint}</span>}
    </div>
  );
}
