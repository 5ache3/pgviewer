import { useEffect, useState } from "react";

import { Button } from "@/components/common/Button";
import * as api from "@/ipc/commands";
import { errorMessage, type DependentReport } from "@/ipc/types";
import { useTableViewStore } from "@/stores/tableViewStore";

import { cellToText } from "./CellView";

/**
 * Shown when a delete failed with a foreign-key violation. Lists every row in
 * other tables that references the selected rows (transitively), then offers
 * to delete them all in one transaction, children first.
 */
export function CascadeDeleteDialog() {
  const blocked = useTableViewStore((s) => s.deleteBlocked);
  const cascadeDelete = useTableViewStore((s) => s.cascadeDelete);
  const cancel = useTableViewStore((s) => s.cancelCascadeDelete);

  const [report, setReport] = useState<DependentReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    setError(null);
    if (!blocked) return;
    let alive = true;
    api
      .dependentRows({ table: blocked.table, pks: blocked.pks })
      .then((r) => alive && setReport(r))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [blocked]);

  useEffect(() => {
    if (!blocked) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [blocked, cancel]);

  if (!blocked) return null;

  const rootCount = blocked.pks.length;
  const total = report?.total ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={cancel}
    >
      <div
        className="flex max-h-[75vh] w-[640px] max-w-[90vw] flex-col rounded-lg border border-border bg-surface-2 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">
            Rows in other tables depend on this data
          </h2>
          <p className="mt-1 text-xs text-muted">
            The selected {rootCount === 1 ? "row is" : `${rootCount} rows are`} referenced by
            other rows through foreign keys, so PostgreSQL rejected the delete. The rows below
            would have to be deleted too.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && <p className="text-xs text-red-400">{error}</p>}
          {!report && !error && <p className="text-xs text-muted">Scanning foreign keys…</p>}
          {report && report.groups.length === 0 && (
            <p className="text-xs text-muted">
              No dependent rows were found — they may have been deleted in the meantime.
              Deleting again should now succeed.
            </p>
          )}

          {report?.groups.map((g, i) => (
            <div key={i} className="mb-3 last:mb-0">
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-xs font-semibold text-fg">{g.table}</span>
                <span className="text-2xs text-muted">
                  {g.count.toLocaleString()} {g.count === 1 ? "row" : "rows"} · via {g.via}
                </span>
              </div>
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-left font-mono text-2xs">
                  <thead>
                    <tr className="border-b border-border bg-surface">
                      {g.columns.map((c) => (
                        <th
                          key={c}
                          className="whitespace-nowrap px-2 py-1 font-semibold text-muted"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((row, ri) => (
                      <tr key={ri} className="border-b border-border/50 last:border-0">
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="max-w-[16rem] truncate whitespace-nowrap px-2 py-1 text-fg"
                          >
                            {cellToText(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {g.count > g.rows.length && (
                <p className="mt-0.5 text-2xs text-muted">
                  … and {(g.count - g.rows.length).toLocaleString()} more
                </p>
              )}
            </div>
          ))}

          {report?.truncated && (
            <p className="mt-2 text-2xs text-amber-500">
              The dependency scan was cut short — even more rows may be affected.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <button
            disabled={!report}
            onClick={() => void cascadeDelete()}
            className="inline-flex items-center rounded-md border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-sm font-medium text-red-400 transition hover:bg-red-500/25 disabled:pointer-events-none disabled:opacity-50"
          >
            {report && total > 0
              ? `Delete all ${(total + rootCount).toLocaleString()} rows`
              : "Delete anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}
