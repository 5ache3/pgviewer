import { create } from "zustand";

type Theme = "dark" | "light";

const PINNED_KEY = "pinnedTables";

function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

interface UiState {
  theme: Theme;
  /** Left panel (schema tree + columns) visibility. */
  leftSidebarVisible: boolean;
  /** Right panel (SQL preview) visibility. */
  rightPanelVisible: boolean;
  /** Pinned table names, shown at the top of the sidebar (persisted). */
  pinnedTables: string[];
  /** Whether the connection dialog is open. */
  connectionDialogOpen: boolean;

  toggleTheme: () => void;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  togglePin: (table: string) => void;
  openConnectionDialog: () => void;
  closeConnectionDialog: () => void;
}

/** Global UI preferences. Dark-first per the design spec. */
export const useUiStore = create<UiState>((set) => ({
  theme: "dark",
  leftSidebarVisible: true,
  rightPanelVisible: true,
  pinnedTables: loadPinned(),
  connectionDialogOpen: false,

  toggleTheme: () =>
    set((s) => {
      const theme = s.theme === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", theme === "dark");
      return { theme };
    }),

  toggleLeftSidebar: () => set((s) => ({ leftSidebarVisible: !s.leftSidebarVisible })),
  toggleRightPanel: () => set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),

  togglePin: (table) =>
    set((s) => {
      const pinnedTables = s.pinnedTables.includes(table)
        ? s.pinnedTables.filter((t) => t !== table)
        : [...s.pinnedTables, table];
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify(pinnedTables));
      } catch {
        // ignore storage failures
      }
      return { pinnedTables };
    }),

  openConnectionDialog: () => set({ connectionDialogOpen: true }),
  closeConnectionDialog: () => set({ connectionDialogOpen: false }),
}));
