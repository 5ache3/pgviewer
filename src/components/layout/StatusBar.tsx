import { useConnectionStore } from "@/stores/connectionStore";
import { formatBytes } from "@/lib/format";

/** Bottom status bar: connection endpoint, database size, and server version. */
export function StatusBar() {
  const info = useConnectionStore((s) => s.info);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-surface px-3 text-2xs text-muted">
      {info ? (
        <>
          <span className="truncate" title={`${info.host}:${info.port}`}>
            {info.user}@{info.host}:{info.port}/{info.database}
          </span>
          <span className="ml-auto">{formatBytes(info.sizeBytes)}</span>
          <span>PostgreSQL {info.serverVersion}</span>
          <span>{info.encoding}</span>
        </>
      ) : (
        <span className="ml-auto">Not connected</span>
      )}
    </footer>
  );
}
