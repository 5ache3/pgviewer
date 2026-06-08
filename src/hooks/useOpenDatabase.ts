import { useUiStore } from "@/stores/uiStore";

/**
 * Returns a callback that opens the connection dialog. (PostgreSQL connections
 * are described by host/credentials, not a file path, so "open" means "show the
 * connect form" rather than a native file picker.)
 */
export function useOpenDatabase() {
  return useUiStore((s) => s.openConnectionDialog);
}
