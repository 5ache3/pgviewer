import type { FilterOp } from "@/ipc/types";

/** How many value inputs an operator needs. */
export type Arity = "none" | "one" | "two" | "list";

interface OperatorMeta {
  value: FilterOp;
  label: string;
  arity: Arity;
}

/** Operators in the order shown in the dropdown. */
export const OPERATORS: OperatorMeta[] = [
  { value: "eq", label: "=", arity: "one" },
  { value: "neq", label: "≠", arity: "one" },
  { value: "gt", label: ">", arity: "one" },
  { value: "gte", label: "≥", arity: "one" },
  { value: "lt", label: "<", arity: "one" },
  { value: "lte", label: "≤", arity: "one" },
  { value: "contains", label: "contains", arity: "one" },
  { value: "notContains", label: "not contains", arity: "one" },
  { value: "startsWith", label: "starts with", arity: "one" },
  { value: "endsWith", label: "ends with", arity: "one" },
  { value: "like", label: "LIKE", arity: "one" },
  { value: "notLike", label: "NOT LIKE", arity: "one" },
  { value: "in", label: "IN", arity: "list" },
  { value: "notIn", label: "NOT IN", arity: "list" },
  { value: "between", label: "BETWEEN", arity: "two" },
  { value: "isNull", label: "IS NULL", arity: "none" },
  { value: "isNotNull", label: "IS NOT NULL", arity: "none" },
];

const ARITY = new Map<FilterOp, Arity>(OPERATORS.map((o) => [o.value, o.arity]));

export function arityOf(op: FilterOp): Arity {
  return ARITY.get(op) ?? "one";
}

/**
 * Coerce a raw text input into a JSON scalar. Numeric-looking input becomes a
 * number so comparisons against numeric columns bind cleanly; everything else
 * stays a string (the Rust binder adapts it to the column's actual type).
 */
export function coerceScalar(raw: string): string | number {
  const trimmed = raw.trim();
  if (trimmed !== "" && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return raw;
}

/** Split a comma-separated input into coerced list items (for IN / NOT IN). */
export function coerceList(raw: string): Array<string | number> {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(coerceScalar);
}
