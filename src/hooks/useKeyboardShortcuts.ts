import { useEffect } from "react";

import { useUiStore } from "@/stores/uiStore";

import { useOpenDatabase } from "./useOpenDatabase";

/**
 * Registers global keyboard shortcuts:
 *   Cmd/Ctrl + O — open database
 *   Cmd/Ctrl + B — toggle the left sidebar
 *   Cmd/Ctrl + J — toggle the SQL panel
 *
 * More shortcuts (search, focus SQL, run query, palette) are added in later
 * phases as the corresponding features land.
 */
export function useKeyboardShortcuts() {
  const openDatabase = useOpenDatabase();
  const toggleLeftSidebar = useUiStore((s) => s.toggleLeftSidebar);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);

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
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openDatabase, toggleLeftSidebar, toggleRightPanel]);
}
