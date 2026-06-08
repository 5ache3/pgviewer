import { cn } from "@/lib/cn";
import type { CellValue } from "@/ipc/types";

/** Render a single PostgreSQL cell value, styled by its column type. */
export function CellView({ value }: { value: CellValue }) {
  switch (value.t) {
    case "null":
      return <span className="italic text-muted/70">NULL</span>;
    case "bool":
      return <span className="tabular-nums">{value.v ? "true" : "false"}</span>;
    case "int":
    case "real":
      return <span className="text-right tabular-nums">{value.v}</span>;
    case "num":
      return <span className="text-right tabular-nums">{value.v}</span>;
    case "text":
      return <span className="truncate">{value.v}</span>;
    case "json":
      return <span className="truncate text-accent/80">{value.v}</span>;
    case "bytea":
      return (
        <span className="italic text-muted" title={`0x${value.hexPreview}…`}>
          {`<${value.size} bytes>`}
        </span>
      );
  }
}

/** Plain-text form of a cell, used for copy-to-clipboard. */
export function cellToText(value: CellValue): string {
  switch (value.t) {
    case "null":
      return "";
    case "bool":
      return value.v ? "true" : "false";
    case "int":
    case "real":
      return String(value.v);
    case "num":
    case "text":
    case "json":
      return value.v;
    case "bytea":
      return `<${value.size} bytes>`;
  }
}

/** JSON-serializable form of a cell, used to send primary-key values to Rust. */
export function cellToJson(value: CellValue): unknown {
  switch (value.t) {
    case "null":
      return null;
    case "bool":
      return value.v;
    case "int":
    case "real":
      return value.v;
    case "num":
    case "text":
    case "json":
      return value.v;
    case "bytea":
      return null;
  }
}

export function cellClass(value: CellValue): string {
  return cn(
    "px-2 py-1 text-xs",
    (value.t === "int" || value.t === "real" || value.t === "num") && "text-right font-mono",
    (value.t === "text" || value.t === "json") && "font-mono",
  );
}
