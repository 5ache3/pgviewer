import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";

import { cn } from "@/lib/cn";
import { Button } from "@/components/common/Button";
import * as api from "@/ipc/commands";
import { errorMessage, type ExportFormat, type ExportScope } from "@/ipc/types";
import { useTableViewStore } from "@/stores/tableViewStore";

const FORMATS: { format: ExportFormat; label: string; ext: string }[] = [
  { format: "csv", label: "CSV", ext: "csv" },
  { format: "json", label: "JSON", ext: "json" },
  { format: "xlsx", label: "Excel", ext: "xlsx" },
];

/** Export the current result to CSV/JSON/Excel — current page or all rows. */
export function ExportMenu() {
  const getSpec = useTableViewStore((s) => s.getSpec);
  const table = useTableViewStore((s) => s.activeTable);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function doExport(format: ExportFormat, ext: string, scope: ExportScope) {
    const spec = getSpec();
    if (!spec) return;
    setOpen(false);

    const dest = await save({
      defaultPath: `${table ?? "export"}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (!dest) return;

    setBusy(true);
    setStatus(null);
    try {
      const res = await api.exportQuery({ spec, format, scope, dest });
      setStatus(`Exported ${res.rowCount.toLocaleString()} rows`);
      setTimeout(() => setStatus(null), 3000);
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)} disabled={busy}>
        {busy ? "Exporting…" : "Export ▾"}
      </Button>

      {status && <span className="ml-2 text-2xs text-muted">{status}</span>}

      {open && (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className={cn(
              "absolute right-0 z-30 mt-1 w-52 rounded-md border border-border bg-surface-2 p-1 shadow-lg",
            )}
          >
            {FORMATS.map(({ format, label, ext }) => (
              <div key={format} className="flex items-center gap-1 px-1 py-0.5">
                <span className="w-12 text-xs text-fg">{label}</span>
                <button
                  className="flex-1 rounded px-2 py-1 text-2xs text-muted hover:bg-surface hover:text-fg"
                  onClick={() => void doExport(format, ext, "page")}
                >
                  Current page
                </button>
                <button
                  className="flex-1 rounded px-2 py-1 text-2xs text-muted hover:bg-surface hover:text-fg"
                  onClick={() => void doExport(format, ext, "all")}
                >
                  All rows
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
