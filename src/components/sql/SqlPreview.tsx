import { useState } from "react";
import Editor from "@monaco-editor/react";

import { Button } from "@/components/common/Button";
import { useTableViewStore } from "@/stores/tableViewStore";
import "@/lib/monaco"; // side effect: configure offline Monaco workers

/**
 * Always-visible generated SQL. In Phase 1 the SQL is read-only (the browse
 * query is fully derived from the table + sort + page). Editing/executing
 * arbitrary SQL arrives with the query builder in later phases.
 */
export function SqlPreview() {
  const sql = useTableViewStore((s) => s.sql);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!sql) return;
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted">
          Generated SQL
        </span>
        <div className="ml-auto">
          <Button variant="ghost" onClick={() => void copy()} disabled={!sql}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language="sql"
          theme="vs-dark"
          value={sql || "-- Select a table to generate SQL"}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "off",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            padding: { top: 8 },
            renderLineHighlight: "none",
            overviewRulerLanes: 0,
            scrollbar: { vertical: "auto", horizontal: "auto" },
          }}
        />
      </div>
    </div>
  );
}
