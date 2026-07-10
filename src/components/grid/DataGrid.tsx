import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import { cn } from "@/lib/cn";
import type { CellValue } from "@/ipc/types";
import { useTableViewStore } from "@/stores/tableViewStore";
import { useSchemaStore } from "@/stores/schemaStore";

import { CascadeDeleteDialog } from "./CascadeDeleteDialog";
import { CellView, cellClass, cellToText } from "./CellView";
import { useCellSelection } from "./useCellSelection";

type Row = CellValue[];

const ROW_HEIGHT = 30;

/**
 * Virtualized data grid. Only the visible window of rows is rendered (via
 * TanStack Virtual), so a 500-row page — or far more — scrolls at 60fps.
 * Sorting is delegated to the backend through the store (server-side ORDER BY).
 */
export function DataGrid() {
  const columnsMeta = useTableViewStore((s) => s.columns);
  const rows = useTableViewStore((s) => s.rows);
  const sorts = useTableViewStore((s) => s.sorts);
  const toggleSort = useTableViewStore((s) => s.toggleSort);
  const activeTable = useTableViewStore((s) => s.activeTable);
  const joins = useTableViewStore((s) => s.joins);
  const editCell = useTableViewStore((s) => s.editCell);
  const deleteRows = useTableViewStore((s) => s.deleteRows);
  const ensureColumns = useSchemaStore((s) => s.ensureColumns);

  // Cells are editable only for a single-table view with a primary key.
  const [pkPresent, setPkPresent] = useState(false);
  useEffect(() => {
    if (!activeTable) {
      setPkPresent(false);
      return;
    }
    let alive = true;
    ensureColumns(activeTable)
      .then((cols) => alive && setPkPresent(cols.some((c) => c.pk > 0)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [activeTable, ensureColumns]);
  const editable = joins.length === 0 && pkPresent;

  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
  const [draft, setDraft] = useState("");

  function startEdit(row: number, col: number, value: CellValue) {
    if (!editable) return;
    setEditing({ row, col });
    setDraft(cellToText(value));
  }
  function commitEdit() {
    if (!editing) return;
    const { row, col } = editing;
    setEditing(null);
    void editCell(row, col, draft);
  }

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      columnsMeta.map((col, i) => ({
        id: `${i}:${col.name}`,
        header: col.name,
        accessorFn: (row) => row[i],
        size: 180,
        minSize: 60,
        cell: (ctx) => <CellView value={ctx.getValue() as CellValue} />,
      })),
    [columnsMeta],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
    defaultColumn: { minSize: 60, maxSize: 1200 },
  });

  const selection = useCellSelection(rows);

  // Rows can be deleted under the same conditions cells can be edited
  // (single-table view with a primary key). The store re-checks and reports any
  // edge cases (grouped/aggregated views).
  const deletable = editable;
  const selectedRows = selection.selectedRows;

  function deleteSelectedRows() {
    if (!deletable || selectedRows.length === 0) return;
    const n = selectedRows.length;
    const ok = window.confirm(
      `Delete ${n} ${n === 1 ? "row" : "rows"} from "${activeTable}"? This cannot be undone.`,
    );
    if (!ok) return;
    void deleteRows(selectedRows);
    selection.clear();
  }

  // Delete/Backspace removes the selected rows (when not editing a cell or typing
  // in a form control).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (editing || !deletable || selectedRows.length === 0) return;
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      )
        return;
      e.preventDefault();
      deleteSelectedRows();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // deleteSelectedRows closes over current selection/state; re-bind each render.
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const tableRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });

  const totalWidth = table.getTotalSize();

  if (columnsMeta.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Select a table to browse its data.
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div ref={parentRef} className="h-full overflow-auto bg-bg">
        <div style={{ width: totalWidth }} className="relative">
        {/* Header */}
        <div className="sticky top-0 z-10 flex border-b border-border bg-surface-2">
          {table.getHeaderGroups()[0]?.headers.map((header) => {
            const name = header.column.columnDef.header as string;
            const sortIndex = sorts.findIndex((s) => s.column === name);
            const active = sortIndex >= 0;
            const rule = active ? sorts[sortIndex] : null;
            return (
              <div
                key={header.id}
                style={{ width: header.getSize() }}
                className="group relative flex items-center"
              >
                <button
                  onClick={(e) => void toggleSort(name, e.shiftKey)}
                  className="flex w-full items-center gap-1 truncate px-2 py-1.5 text-left text-2xs font-semibold uppercase tracking-wide text-muted hover:text-fg"
                  title={`${name}\nClick to sort · Shift-click to add a sort`}
                >
                  <span className="truncate">{name}</span>
                  {active && (
                    <span className="flex items-center text-accent">
                      {rule?.dir === "ASC" ? "▲" : "▼"}
                      {sorts.length > 1 && (
                        <span className="ml-0.5 tabular-nums text-2xs">{sortIndex + 1}</span>
                      )}
                    </span>
                  )}
                </button>
                <div
                  onMouseDown={header.getResizeHandler()}
                  onTouchStart={header.getResizeHandler()}
                  className={cn(
                    "absolute right-0 top-0 h-full w-1 cursor-col-resize select-none",
                    "opacity-0 group-hover:opacity-100",
                    header.column.getIsResizing() ? "bg-accent opacity-100" : "bg-border",
                  )}
                />
              </div>
            );
          })}
        </div>

        {/* Virtualized body */}
        <div style={{ height: virtualizer.getTotalSize() }} className="relative">
          {virtualizer.getVirtualItems().map((vItem) => {
            const row = tableRows[vItem.index];
            return (
              <div
                key={row.id}
                style={{
                  height: vItem.size,
                  transform: `translateY(${vItem.start}px)`,
                }}
                className="absolute left-0 top-0 flex w-full border-b border-border/50 hover:bg-surface/60"
              >
                {row.getVisibleCells().map((cell, colIndex) => {
                  const value = cell.getValue() as CellValue;
                  const selected = selection.isSelected(vItem.index, colIndex);
                  const isEditing =
                    editing?.row === vItem.index && editing?.col === colIndex;
                  return (
                    <div
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      onMouseDown={(e) =>
                        selection.onCellMouseDown(
                          { row: vItem.index, col: colIndex },
                          e.shiftKey,
                        )
                      }
                      onMouseEnter={() =>
                        selection.onCellMouseEnter({ row: vItem.index, col: colIndex })
                      }
                      onDoubleClick={() => startEdit(vItem.index, colIndex, value)}
                      title={editable ? "Double-click to edit" : undefined}
                      className={cn(
                        "flex select-none items-center overflow-hidden",
                        cellClass(value),
                        !isEditing &&
                          (selected
                            ? "bg-accent/30 ring-1 ring-inset ring-accent/50"
                            : "hover:bg-surface/40"),
                      )}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitEdit();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setEditing(null);
                            }
                          }}
                          onBlur={commitEdit}
                          className="w-full bg-bg px-2 py-1 font-mono text-xs text-fg outline-none ring-1 ring-inset ring-accent"
                        />
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        </div>
      </div>

      {/* Selection hint — an overlay so showing/hiding it never shifts the grid. */}
      {selection.cellCount > 0 && (
        <div className="absolute bottom-2 left-2 z-20 flex items-center gap-2">
          <div className="pointer-events-none rounded border border-border bg-surface-2/95 px-2 py-0.5 text-2xs text-muted shadow">
            {selection.cellCount} {selection.cellCount === 1 ? "cell" : "cells"} · ⌘/Ctrl+C to copy
          </div>
          {deletable && (
            <button
              onClick={deleteSelectedRows}
              title="Delete the selected row(s) (Del)"
              className="rounded border border-red-500/40 bg-surface-2/95 px-2 py-0.5 text-2xs font-medium text-red-400 shadow hover:bg-red-500/15 hover:text-red-300"
            >
              Delete {selectedRows.length} {selectedRows.length === 1 ? "row" : "rows"}
            </button>
          )}
        </div>
      )}

      {/* Opens when a delete was rejected because other rows reference these. */}
      <CascadeDeleteDialog />
    </div>
  );
}
