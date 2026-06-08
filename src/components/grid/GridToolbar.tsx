import { Button } from "@/components/common/Button";
import { ExportMenu } from "@/components/export/ExportMenu";
import { formatCount } from "@/lib/format";
import { useSchemaStore } from "@/stores/schemaStore";
import { useTableViewStore } from "@/stores/tableViewStore";

/** Pagination + status bar above the data grid. */
export function GridToolbar() {
  const table = useTableViewStore((s) => s.activeTable);
  const offset = useTableViewStore((s) => s.offset);
  const pageSize = useTableViewStore((s) => s.pageSize);
  const rows = useTableViewStore((s) => s.rows);
  const loading = useTableViewStore((s) => s.loading);
  const elapsedMs = useTableViewStore((s) => s.elapsedMs);
  const nextPage = useTableViewStore((s) => s.nextPage);
  const prevPage = useTableViewStore((s) => s.prevPage);

  const rowCount = useSchemaStore((s) => (table ? s.rowCounts[table] : undefined));

  if (!table) return null;

  const from = rows.length === 0 ? 0 : offset + 1;
  const to = offset + rows.length;
  const atStart = offset === 0;
  const atEnd = rows.length < pageSize;

  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 text-xs">
      <span className="font-semibold">{table}</span>
      {rowCount && (
        <span className="text-muted">
          {rowCount.exact ? "" : "~"}
          {formatCount(rowCount.count)} rows
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <span className="tabular-nums text-muted">
          {formatCount(from)}–{formatCount(to)}
        </span>
        <Button variant="ghost" onClick={() => void prevPage()} disabled={atStart || loading}>
          ‹ Prev
        </Button>
        <Button variant="ghost" onClick={() => void nextPage()} disabled={atEnd || loading}>
          Next ›
        </Button>
        <span className="w-16 text-right tabular-nums text-muted">
          {loading ? "…" : `${elapsedMs.toFixed(1)} ms`}
        </span>
        <ExportMenu />
      </div>
    </div>
  );
}
