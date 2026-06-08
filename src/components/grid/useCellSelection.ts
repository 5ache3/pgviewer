import { useCallback, useEffect, useRef, useState } from "react";

import type { CellValue } from "@/ipc/types";

import { cellToText } from "./CellView";

export interface CellRef {
  row: number;
  col: number;
}

interface Rect {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

function rectOf(a: CellRef, b: CellRef): Rect {
  return {
    minRow: Math.min(a.row, b.row),
    maxRow: Math.max(a.row, b.row),
    minCol: Math.min(a.col, b.col),
    maxCol: Math.max(a.col, b.col),
  };
}

/**
 * Rectangular cell selection for the data grid.
 *
 * - Click a cell to select it; Shift+click or click-drag to extend a rectangle.
 * - Cmd/Ctrl+C copies the selection as TSV (tabs between columns, newlines
 *   between rows), so it pastes cleanly into spreadsheets.
 * - Escape clears the selection.
 *
 * Selection is tracked by row/column index against the current page's `rows`,
 * which keeps it compatible with virtualization (cells unmount when scrolled
 * out but their indices remain stable).
 */
export function useCellSelection(rows: CellValue[][]) {
  const [anchor, setAnchor] = useState<CellRef | null>(null);
  const [focus, setFocus] = useState<CellRef | null>(null);
  const dragging = useRef(false);

  const rect = anchor && focus ? rectOf(anchor, focus) : null;

  const isSelected = useCallback(
    (row: number, col: number) =>
      rect != null &&
      row >= rect.minRow &&
      row <= rect.maxRow &&
      col >= rect.minCol &&
      col <= rect.maxCol,
    [rect],
  );

  const onCellMouseDown = useCallback((cell: CellRef, shiftKey: boolean) => {
    dragging.current = true;
    if (shiftKey) {
      setFocus(cell);
      setAnchor((a) => a ?? cell);
    } else {
      setAnchor(cell);
      setFocus(cell);
    }
  }, []);

  const onCellMouseEnter = useCallback((cell: CellRef) => {
    if (dragging.current) setFocus(cell);
  }, []);

  const clear = useCallback(() => {
    setAnchor(null);
    setFocus(null);
  }, []);

  // End a drag wherever the mouse is released.
  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // Copy (Cmd/Ctrl+C) and clear (Escape) — only when a selection exists and the
  // user isn't typing in a form control.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!rect) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement;
      if (typing) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        const lines: string[] = [];
        for (let r = rect.minRow; r <= rect.maxRow; r++) {
          const cols: string[] = [];
          for (let c = rect.minCol; c <= rect.maxCol; c++) {
            cols.push(cellToText(rows[r]?.[c] ?? { t: "null" }));
          }
          lines.push(cols.join("\t"));
        }
        void navigator.clipboard.writeText(lines.join("\n"));
      } else if (e.key === "Escape") {
        clear();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rect, rows, clear]);

  // Selection no longer makes sense once the underlying page changes.
  useEffect(() => {
    clear();
  }, [rows, clear]);

  const cellCount = rect
    ? (rect.maxRow - rect.minRow + 1) * (rect.maxCol - rect.minCol + 1)
    : 0;

  return { isSelected, onCellMouseDown, onCellMouseEnter, clear, cellCount };
}
