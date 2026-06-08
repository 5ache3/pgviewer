import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import * as api from "@/ipc/commands";
import { errorMessage, type ColumnMeta, type ForeignKeyMeta } from "@/ipc/types";
import { useSchemaStore } from "@/stores/schemaStore";
import { useTableViewStore } from "@/stores/tableViewStore";

const PANEL_OPEN_HEIGHT = "h-56";

/**
 * Bottom-left panel: columns of the active table with PK / FK / not-null
 * annotations, plus add-column and drop-column actions (ALTER TABLE).
 */
export function ColumnsPanel() {
  const table = useTableViewStore((s) => s.activeTable);
  const reloadGrid = useTableViewStore((s) => s.reload);
  const ensureColumns = useSchemaStore((s) => s.ensureColumns);
  const refreshColumns = useSchemaStore((s) => s.refreshColumns);
  const ensureForeignKeys = useSchemaStore((s) => s.ensureForeignKeys);

  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [fks, setFks] = useState<ForeignKeyMeta[]>([]);
  const [open, setOpen] = useState(true);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("text");
  const [newNullable, setNewNullable] = useState(true);
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!table) {
      setColumns([]);
      setFks([]);
      return;
    }
    let active = true;
    void Promise.all([ensureColumns(table), ensureForeignKeys(table)]).then(([cols, f]) => {
      if (active) {
        setColumns(cols);
        setFks(f);
      }
    });
    return () => {
      active = false;
    };
  }, [table, ensureColumns, ensureForeignKeys]);

  if (!table) return null;
  const activeTable = table;

  const fkByColumn = new Map(fks.map((f) => [f.fromColumn, f]));

  /** Refresh column metadata + the grid after a schema change. */
  async function afterDdl() {
    const cols = await refreshColumns(activeTable);
    setColumns(cols);
    await reloadGrid();
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await api.addColumn({ table: activeTable, name, dataType: newType, nullable: newNullable });
      await afterDdl();
      setAdding(false);
      setNewName("");
      setNewType("text");
      setNewNullable(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDrop(name: string) {
    setBusy(true);
    setError(null);
    try {
      await api.dropColumn(activeTable, name);
      await afterDdl();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirmDrop(null);
    }
  }

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col border-t border-border bg-surface",
        open && `${PANEL_OPEN_HEIGHT} overflow-y-auto`,
      )}
    >
      <div className="flex items-center">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-1.5 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted hover:text-fg"
        >
          <span className="w-3 text-center">{open ? "▾" : "▸"}</span>
          <span className="truncate">Columns · {table}</span>
        </button>
        {open && (
          <button
            onClick={() => setAdding((a) => !a)}
            title="Add column"
            className="px-2 py-1.5 text-xs text-muted hover:text-fg"
          >
            + Column
          </button>
        )}
      </div>

      {open && (
        <>
          {adding && (
            <div className="mx-3 mb-1 space-y-1.5 rounded border border-border bg-surface-2 p-2">
              <input
                autoFocus
                value={newName}
                placeholder="column_name"
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-fg placeholder:text-muted/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              />
              <input
                value={newType}
                placeholder="type (e.g. text, integer, varchar(255))"
                onChange={(e) => setNewType(e.target.value)}
                className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-fg placeholder:text-muted/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-2xs text-muted">
                  <input
                    type="checkbox"
                    checked={newNullable}
                    onChange={(e) => setNewNullable(e.target.checked)}
                  />
                  Nullable
                </label>
                <div className="flex gap-1">
                  <button
                    onClick={() => setAdding(false)}
                    className="rounded px-2 py-0.5 text-2xs text-muted hover:text-fg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleAdd()}
                    disabled={busy || !newName.trim()}
                    className="rounded bg-accent px-2 py-0.5 text-2xs font-medium text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && <p className="px-3 pb-1 text-2xs text-red-400">{error}</p>}

          <ul className="pb-2">
            {columns.map((col) => {
              const fk = fkByColumn.get(col.name);
              const confirming = confirmDrop === col.name;
              return (
                <li
                  key={col.name}
                  className="group flex items-center gap-2 px-3 py-0.5 text-xs"
                >
                  <span className="truncate font-mono">{col.name}</span>
                  <span className="text-muted">{col.dataType || "—"}</span>
                  <div className="ml-auto flex items-center gap-1">
                    {col.pk > 0 && <Badge className="bg-amber-500/20 text-amber-300">PK</Badge>}
                    {fk && (
                      <Badge
                        className="bg-sky-500/20 text-sky-300"
                        title={`→ ${fk.toTable}.${fk.toColumn}`}
                      >
                        FK
                      </Badge>
                    )}
                    {col.notNull && <Badge className="bg-surface-2 text-muted">NN</Badge>}
                    {confirming ? (
                      <span className="flex items-center gap-1">
                        <button
                          onClick={() => void handleDrop(col.name)}
                          disabled={busy}
                          className="rounded px-1 text-2xs text-red-400 hover:bg-red-500/10"
                          title="Confirm drop"
                        >
                          Drop?
                        </button>
                        <button
                          onClick={() => setConfirmDrop(null)}
                          className="rounded px-1 text-2xs text-muted hover:text-fg"
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDrop(col.name)}
                        title="Drop column"
                        className="hidden px-1 text-muted hover:text-red-400 group-hover:block"
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function Badge({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span title={title} className={cn("rounded px-1 text-2xs font-medium", className)}>
      {children}
    </span>
  );
}
