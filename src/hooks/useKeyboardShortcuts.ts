import { useEffect } from "react";

import { useConnectionStore } from "@/stores/connectionStore";
import { useUiStore } from "@/stores/uiStore";
import { FOCUS_FILTER_EVENT, FOCUS_SQL_EVENT, emit } from "@/lib/events";
import { refreshAll } from "@/lib/refresh";

import { useOpenDatabase } from "./useOpenDatabase";

/**
 * Registers global keyboard shortcuts:
 *   Cmd/Ctrl + O — open database
 *   Cmd/Ctrl + B — toggle the left sidebar
 *   Cmd/Ctrl + J — toggle the SQL panel
 *   Cmd/Ctrl + K — command palette
 *   Cmd/Ctrl + L — focus the SQL editor
 *   Cmd/Ctrl + F — focus the filter builder
 *   Cmd/Ctrl + R — refresh schema & data
 */
export function useKeyboardShortcuts() {
  const openDatabase = useOpenDatabase();
  const toggleLeftSidebar = useUiStore((s) => s.toggleLeftSidebar);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
  const toggleCommandPalette = useUiStore((s) => s.toggleCommandPalette);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      switch (e.key.toLowerCase()) {
        case "o":
          e.preventDefault();
          void openDatabase();
          break;
        case "b":
          e.preventDefault();
          toggleLeftSidebar();
          break;
        case "j":
          e.preventDefault();
          toggleRightPanel();
          break;
        case "k":
          e.preventDefault();
          toggleCommandPalette();
          break;
        case "l": {
          // Focus the SQL editor (revealing the panel first if it's hidden).
          e.preventDefault();
          const wasHidden = !useUiStore.getState().rightPanelVisible;
          if (wasHidden) toggleRightPanel();
          // Defer so a just-revealed (lazily loaded) editor mounts its listener.
          setTimeout(() => emit(FOCUS_SQL_EVENT), wasHidden ? 150 : 0);
          break;
        }
        case "f":
          e.preventDefault();
          emit(FOCUS_FILTER_EVENT);
          break;
        case "r":
          // Swallow the webview's own reload even when not connected.
          e.preventDefault();
          if (useConnectionStore.getState().status === "open") void refreshAll();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openDatabase, toggleLeftSidebar, toggleRightPanel, toggleCommandPalette]);
}
