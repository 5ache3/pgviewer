import { useState } from "react";

import { useHistoryStore } from "@/stores/historyStore";

/** Collapsible "History" section for the sidebar. Click an entry to copy its SQL. */
export function HistorySection() {
  const history = useHistoryStore((s) => s.history);
  const clear = useHistoryStore((s) => s.clearHistory);
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border/60">
      <div className="flex items-center">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-1.5 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted hover:text-fg"
        >
          <span className="w-3 text-center">{open ? "▾" : "▸"}</span>
          <span>History</span>
          <span className="ml-auto rounded bg-surface-2 px-1.5 tabular-nums">{history.length}</span>
        </button>
        {open && history.length > 0 && (
          <button
            onClick={() => void clear()}
            className="px-2 text-2xs text-muted hover:text-fg"
            title="Clear history"
          >
            clear
          </button>
        )}
      </div>

      {open && (
        <div className="pb-1">
          {history.length === 0 ? (
            <p className="px-3 py-1 text-2xs text-muted">No queries yet.</p>
          ) : (
            history.map((entry) => (
              <button
                key={entry.id}
                onClick={() => void navigator.clipboard.writeText(entry.sql)}
                title="Click to copy SQL"
                className="flex w-full flex-col gap-0.5 px-3 py-1 text-left hover:bg-surface-2"
              >
                <span className="truncate font-mono text-2xs text-fg/80">
                  {entry.sql.replace(/\s+/g, " ")}
                </span>
                <span className="text-2xs text-muted">
                  {new Date(entry.timestamp).toLocaleTimeString()} · {entry.elapsedMs.toFixed(1)} ms
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
