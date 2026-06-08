import { create } from "zustand";

import * as api from "@/ipc/commands";
import { errorMessage, type ConnectRequest, type DatabaseInfo } from "@/ipc/types";

type ConnectionStatus = "idle" | "opening" | "open" | "error";

interface ConnectionState {
  status: ConnectionStatus;
  info: DatabaseInfo | null;
  error: string | null;
  /** Connect with the given parameters; returns true on success. */
  connect: (req: ConnectRequest) => Promise<boolean>;
  /** Connect with a libpq connection string; returns true on success. */
  connectString: (connStr: string) => Promise<boolean>;
  close: () => Promise<void>;
}

/**
 * Owns the lifecycle of the active database connection. All PostgreSQL work
 * happens in Rust; this store only tracks status and the returned metadata.
 */
export const useConnectionStore = create<ConnectionState>((set) => ({
  status: "idle",
  info: null,
  error: null,

  connect: async (req) => {
    set({ status: "opening", error: null });
    try {
      const info = await api.connect(req);
      set({ status: "open", info, error: null });
      return true;
    } catch (e) {
      set({ status: "error", error: errorMessage(e), info: null });
      return false;
    }
  },

  connectString: async (connStr) => {
    set({ status: "opening", error: null });
    try {
      const info = await api.connectString(connStr);
      set({ status: "open", info, error: null });
      return true;
    } catch (e) {
      set({ status: "error", error: errorMessage(e), info: null });
      return false;
    }
  },

  close: async () => {
    await api.closeDatabase().catch(() => undefined);
    set({ status: "idle", info: null, error: null });
  },
}));
