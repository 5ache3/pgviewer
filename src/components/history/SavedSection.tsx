import { useState } from "react";

import { useHistoryStore } from "@/stores/historyStore";
import { useTableViewStore } from "@/stores/tableViewStore";

/** Collapsible "Saved" section: name and store the current SQL, list, copy, delete. */
export function SavedSection() {
  const saved = useHistoryStore((s) => s.saved);
  const save = useHistoryStore((s) => s.save);
  const remove = useHistoryStore((s) => s.remove);
  const currentSql = useTableViewStore((s) => s.sql);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const canSave = name.trim().length > 0 && currentSql.length > 0;

  const onSave = async () => {
    if (!canSave) return;
    await save(name.trim(), currentSql);
    setName("");
  };

  return (
    <div className="border-b border-border/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted hover:text-fg"
      >
        <span className="w-3 text-center">{open ? "▾" : "▸"}</span>
        <span>Saved</span>
        <span className="ml-auto rounded bg-surface-2 px-1.5 tabular-nums">{saved.length}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-1 pb-2">
          <div className="flex items-center gap-1 px-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void onSave()}
              placeholder="name current SQL"
              className="h-7 min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 text-xs focus:border-accent focus:outline-none"
            />
            <button
              onClick={() => void onSave()}
              disabled={!canSave}
              className="h-7 shrink-0 rounded border border-border px-2 text-2xs text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            >
              Save
            </button>
          </div>

          {saved.map((q) => (
            <div key={q.id} className="flex items-center gap-2 px-3 py-0.5 text-xs">
              <button
                onClick={() => void navigator.clipboard.writeText(q.sql)}
                title={q.sql}
                className="truncate text-left hover:text-accent"
              >
                {q.name}
              </button>
              <button
                onClick={() => void remove(q.id)}
                title="Delete"
                className="ml-auto h-5 w-5 shrink-0 rounded border border-border text-2xs text-muted hover:bg-surface-2 hover:text-fg"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
