import { create } from "zustand";

type Theme = "dark" | "light";

const PINNED_KEY = "pinnedTables";
const LEFT_WIDTH_KEY = "leftSidebarWidth";
const RIGHT_WIDTH_KEY = "rightPanelWidth";
const THEME_KEY = "theme";

/** Read the persisted theme, falling back to the dark-first default. */
function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Reflect the theme onto <html> (the `dark` class drives the CSS variables). */
function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Smallest a panel can be dragged before it snaps fully hidden. */
export const PANEL_SNAP = 110;
/** Minimum kept width once a panel stays visible. */
export const PANEL_MIN = 160;
const LEFT_DEFAULT = 256;
const LEFT_MAX = 560;
const RIGHT_DEFAULT = 420;
const RIGHT_MAX = 760;

function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function loadWidth(key: string, fallback: number): number {
  try {
    const n = parseInt(localStorage.getItem(key) ?? "", 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function saveWidth(key: string, w: number): void {
  try {
    localStorage.setItem(key, String(w));
  } catch {
    // ignore storage failures
  }
}

interface UiState {
  theme: Theme;
  /** Left panel (schema tree + columns) visibility. */
  leftSidebarVisible: boolean;
  /** Right panel (SQL preview) visibility. */
  rightPanelVisible: boolean;
  /** Left panel width in px (persisted). */
  leftSidebarWidth: number;
  /** Right panel width in px (persisted). */
  rightPanelWidth: number;
  /** Pinned table names, shown at the top of the sidebar (persisted). */
  pinnedTables: string[];
  /** Whether the connection dialog is open. */
  connectionDialogOpen: boolean;
  /** Whether the command palette (⌘/Ctrl+K) is open. */
  commandPaletteOpen: boolean;

  toggleTheme: () => void;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  /** Resize the left panel; widths under PANEL_SNAP snap it hidden. */
  setLeftSidebarWidth: (w: number) => void;
  /** Resize the right panel; widths under PANEL_SNAP snap it hidden. */
  setRightPanelWidth: (w: number) => void;
  togglePin: (table: string) => void;
  openConnectionDialog: () => void;
  closeConnectionDialog: () => void;
  toggleCommandPalette: () => void;
  closeCommandPalette: () => void;
}

// Apply the persisted theme before first paint so there's no flash of the
// wrong palette.
const initialTheme = loadTheme();
applyTheme(initialTheme);

/** Global UI preferences. Dark-first per the design spec. */
export const useUiStore = create<UiState>((set) => ({
  theme: initialTheme,
  leftSidebarVisible: true,
  rightPanelVisible: true,
  leftSidebarWidth: loadWidth(LEFT_WIDTH_KEY, LEFT_DEFAULT),
  rightPanelWidth: loadWidth(RIGHT_WIDTH_KEY, RIGHT_DEFAULT),
  pinnedTables: loadPinned(),
  connectionDialogOpen: false,
  commandPaletteOpen: false,

  toggleTheme: () =>
    set((s) => {
      const theme = s.theme === "dark" ? "light" : "dark";
      applyTheme(theme);
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        // ignore storage failures
      }
      return { theme };
    }),

  toggleLeftSidebar: () => set((s) => ({ leftSidebarVisible: !s.leftSidebarVisible })),
  toggleRightPanel: () => set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),

  setLeftSidebarWidth: (w) =>
    set(() => {
      // Dragging below the snap point hides the panel, keeping its last width.
      if (w < PANEL_SNAP) return { leftSidebarVisible: false };
      const width = Math.min(Math.max(w, PANEL_MIN), LEFT_MAX);
      saveWidth(LEFT_WIDTH_KEY, width);
      return { leftSidebarWidth: width, leftSidebarVisible: true };
    }),

  setRightPanelWidth: (w) =>
    set(() => {
      if (w < PANEL_SNAP) return { rightPanelVisible: false };
      const width = Math.min(Math.max(w, PANEL_MIN), RIGHT_MAX);
      saveWidth(RIGHT_WIDTH_KEY, width);
      return { rightPanelWidth: width, rightPanelVisible: true };
    }),

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

  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
}));
