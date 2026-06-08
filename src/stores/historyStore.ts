import { create } from "zustand";

import * as api from "@/ipc/commands";
import { errorMessage, type HistoryEntry, type SavedQuery } from "@/ipc/types";

interface HistoryState {
  history: HistoryEntry[];
  saved: SavedQuery[];
  error: string | null;

  refresh: () => Promise<void>;
  clearHistory: () => Promise<void>;
  save: (name: string, sql: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** Recent query history and saved queries (persisted in the app-config dir). */
export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],
  saved: [],
  error: null,

  refresh: async () => {
    try {
      const [history, saved] = await Promise.all([api.listHistory(), api.listSaved()]);
      set({ history, saved, error: null });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  clearHistory: async () => {
    await api.clearHistory();
    set({ history: [] });
  },

  save: async (name, sql) => {
    await api.saveQuery(name, sql);
    await get().refresh();
  },

  remove: async (id) => {
    await api.deleteSaved(id);
    set((s) => ({ saved: s.saved.filter((q) => q.id !== id) }));
  },
}));
