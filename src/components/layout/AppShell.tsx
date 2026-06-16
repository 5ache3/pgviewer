import { lazy, Suspense, useEffect, type MouseEvent as ReactMouseEvent } from "react";

import { useConnectionStore } from "@/stores/connectionStore";
import { useSchemaStore } from "@/stores/schemaStore";
import { useTableViewStore } from "@/stores/tableViewStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useUiStore } from "@/stores/uiStore";
import { useOpenDatabase } from "@/hooks/useOpenDatabase";
import { Button } from "@/components/common/Button";
import { cn } from "@/lib/cn";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ColumnsPanel } from "@/components/sidebar/ColumnsPanel";
import { DataGrid } from "@/components/grid/DataGrid";
import { GridToolbar } from "@/components/grid/GridToolbar";
import { FilterBuilder } from "@/components/filters/FilterBuilder";
import { JoinBuilder } from "@/components/joins/JoinBuilder";
import { AggregateBuilder } from "@/components/aggregate/AggregateBuilder";
import { ConnectionDialog } from "@/components/connection/ConnectionDialog";
import { CommandPalette } from "@/components/palette/CommandPalette";

import { StatusBar } from "./StatusBar";

// Monaco is heavy; load it as a separate chunk so the app shell starts instantly.
const SqlPreview = lazy(() =>
  import("@/components/sql/SqlPreview").then((m) => ({ default: m.SqlPreview })),
);

export function AppShell() {
  const status = useConnectionStore((s) => s.status);
  const info = useConnectionStore((s) => s.info);
  const error = useConnectionStore((s) => s.error);
  const openDatabase = useOpenDatabase();
  const connLabel = info ? `${info.database} @ ${info.host}` : null;

  const loadSchema = useSchemaStore((s) => s.loadSchema);
  const resetSchema = useSchemaStore((s) => s.reset);
  const resetTableView = useTableViewStore((s) => s.reset);
  const refreshHistory = useHistoryStore((s) => s.refresh);

  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const leftVisible = useUiStore((s) => s.leftSidebarVisible);
  const rightVisible = useUiStore((s) => s.rightPanelVisible);
  const leftWidth = useUiStore((s) => s.leftSidebarWidth);
  const rightWidth = useUiStore((s) => s.rightPanelWidth);
  const toggleLeft = useUiStore((s) => s.toggleLeftSidebar);
  const toggleRight = useUiStore((s) => s.toggleRightPanel);
  const setLeftWidth = useUiStore((s) => s.setLeftSidebarWidth);
  const setRightWidth = useUiStore((s) => s.setRightPanelWidth);
  const isOpen = status === "open";

  // Load schema when a database opens; reset everything when it closes.
  useEffect(() => {
    if (status === "open") {
      void loadSchema();
      void refreshHistory();
    } else {
      resetSchema();
      resetTableView();
    }
  }, [status, connLabel, loadSchema, resetSchema, resetTableView, refreshHistory]);

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
        {isOpen && (
          <PanelToggle
            onClick={toggleLeft}
            active={leftVisible}
            title="Toggle sidebar (⌘/Ctrl+B)"
            side="left"
          />
        )}
        <span className="text-sm font-semibold tracking-tight">Postgres Explorer</span>
        {connLabel && (
          <span className="truncate text-xs text-muted" title={connLabel}>
            {connLabel}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle theme={theme} onClick={toggleTheme} />
          <Button onClick={() => openDatabase()}>{isOpen ? "Connect…" : "Connect"}</Button>
          {isOpen && (
            <PanelToggle
              onClick={toggleRight}
              active={rightVisible}
              title="Toggle SQL panel (⌘/Ctrl+J)"
              side="right"
            />
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        {isOpen ? (
          <>
            {leftVisible && (
              <div className="relative flex shrink-0 flex-col" style={{ width: leftWidth }}>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <Sidebar />
                </div>
                <ColumnsPanel />
                <ResizeHandle edge="right" onResize={(x) => setLeftWidth(x)} />
              </div>
            )}

            <section className="flex min-w-0 flex-1 flex-col border-x border-border">
              <GridToolbar />
              <JoinBuilder />
              <FilterBuilder />
              <AggregateBuilder />
              <div className="min-h-0 flex-1">
                <DataGrid />
              </div>
            </section>

            {rightVisible && (
              <div className="relative shrink-0" style={{ width: rightWidth }}>
                <ResizeHandle
                  edge="left"
                  onResize={(x) => setRightWidth(window.innerWidth - x)}
                />
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center text-xs text-muted">
                      Loading editor…
                    </div>
                  }
                >
                  <SqlPreview />
                </Suspense>
              </div>
            )}
          </>
        ) : (
          <Welcome onOpen={() => openDatabase()} error={status === "error" ? error : null} />
        )}
      </main>

      <StatusBar />
      <ConnectionDialog />
      <CommandPalette />
    </div>
  );
}

/**
 * A thin draggable strip on a panel's edge. Reports the pointer's X position
 * during the drag; the parent converts that into a width (and the store snaps
 * the panel hidden when it gets too small).
 */
function ResizeHandle({
  edge,
  onResize,
}: {
  edge: "left" | "right";
  onResize: (clientX: number) => void;
}) {
  const onMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => onResize(ev.clientX);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      title="Drag to resize · drag to the edge to hide"
      className={cn(
        "absolute top-0 z-30 h-full w-1.5 cursor-col-resize select-none",
        "transition-colors hover:bg-accent/60",
        edge === "right" ? "-right-0.5" : "-left-0.5",
      )}
    />
  );
}

/** A small button that toggles a side panel, showing its open/closed state. */
function PanelToggle({
  onClick,
  active,
  title,
  side,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  side: "left" | "right";
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded border border-border text-muted",
        "hover:bg-surface-2 hover:text-fg",
        active && "text-fg",
      )}
    >
      {/* Panel glyph: a box with a filled bar on the toggled side. */}
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
        <rect
          x={side === "left" ? 2 : 10}
          y="3"
          width="4"
          height="10"
          fill={active ? "currentColor" : "none"}
          opacity={active ? 0.5 : 0.25}
        />
        <line
          x1={side === "left" ? 6 : 10}
          y1="2.5"
          x2={side === "left" ? 6 : 10}
          y2="13.5"
          stroke="currentColor"
        />
      </svg>
    </button>
  );
}

/** Toggles between the dark and light palettes, showing the icon for the
 * theme you'd switch to. */
function ThemeToggle({ theme, onClick }: { theme: "dark" | "light"; onClick: () => void }) {
  const isDark = theme === "dark";
  return (
    <button
      onClick={onClick}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded border border-border text-muted",
        "hover:bg-surface-2 hover:text-fg",
      )}
    >
      {isDark ? (
        // Sun: switch to light.
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        // Moon: switch to dark.
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function Welcome({ onOpen, error }: { onOpen: () => void; error: string | null }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-xl font-semibold">Connect to a PostgreSQL database</h1>
        <p className="text-sm text-muted">
          Enter your server host, database and credentials to begin — or pick a
          saved connection. Press{" "}
          <kbd className="rounded border border-border px-1">⌘/Ctrl + O</kbd>.
        </p>
        <Button onClick={onOpen}>Connect</Button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
