import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";
import { useUiStore } from "@/stores/uiStore";
import { useSchemaStore } from "@/stores/schemaStore";
import { useTableViewStore } from "@/stores/tableViewStore";
import { FOCUS_FILTER_EVENT, FOCUS_SQL_EVENT, emit } from "@/lib/events";
import { useOpenDatabase } from "@/hooks/useOpenDatabase";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * ⌘/Ctrl+K command palette. Fuzzy-ish (substring) search over actions and every
 * table/view, with full keyboard navigation. Opening a table or running an
 * action closes the palette.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const close = useUiStore((s) => s.closeCommandPalette);
  const toggleLeft = useUiStore((s) => s.toggleLeftSidebar);
  const toggleRight = useUiStore((s) => s.toggleRightPanel);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const theme = useUiStore((s) => s.theme);
  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const selectTable = useTableViewStore((s) => s.selectTable);
  const openDatabase = useOpenDatabase();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const actions: Command[] = [
      { id: "connect", label: "Connect to database…", hint: "⌘O", run: () => void openDatabase() },
      { id: "focus-sql", label: "Focus SQL editor", hint: "⌘L", run: () => emit(FOCUS_SQL_EVENT) },
      { id: "focus-filter", label: "Add filter", hint: "⌘F", run: () => emit(FOCUS_FILTER_EVENT) },
      { id: "toggle-left", label: "Toggle sidebar", hint: "⌘B", run: toggleLeft },
      { id: "toggle-right", label: "Toggle SQL panel", hint: "⌘J", run: toggleRight },
      {
        id: "toggle-theme",
        label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        hint: "theme",
        run: toggleTheme,
      },
    ];
    const tableCmds: Command[] = [
      ...tables.map((t) => ({
        id: `table:${t.name}`,
        label: t.name,
        hint: "table",
        run: () => void selectTable(t.name),
      })),
      ...views.map((v) => ({
        id: `view:${v.name}`,
        label: v.name,
        hint: "view",
        run: () => void selectTable(v.name),
      })),
    ];
    return [...actions, ...tableCmds];
  }, [tables, views, selectTable, openDatabase, toggleLeft, toggleRight, toggleTheme, theme]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  // Reset and focus when the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Focus after the dialog paints.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep the active index in range as results shrink.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Keep the highlighted row visible while arrow-navigating.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (cmd: Command | undefined) => {
    if (!cmd) return;
    close();
    cmd.run();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={close}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search tables and actions…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted"
        />
        <div ref={listRef} className="max-h-80 overflow-auto py-1">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted">No matches.</p>
          ) : (
            results.map((cmd, i) => (
              <button
                key={cmd.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(cmd)}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm",
                  i === active ? "bg-accent/20 text-fg" : "text-fg/80",
                )}
              >
                <span className="truncate">{cmd.label}</span>
                {cmd.hint && (
                  <span className="ml-auto shrink-0 text-2xs text-muted">{cmd.hint}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
