import { cn } from "@/lib/cn";
import { OPERATORS, arityOf } from "@/lib/operators";
import { useFilterStore, type UiCondition } from "@/stores/filterStore";
import type { FilterOp } from "@/ipc/types";

const selectClass =
  "h-7 rounded border border-border bg-surface-2 px-1.5 text-xs text-fg focus:border-accent focus:outline-none";
const inputClass =
  "h-7 rounded border border-border bg-surface-2 px-2 text-xs text-fg focus:border-accent focus:outline-none";

/** A single condition row: column · operator · value(s) · remove. */
export function FilterRow({ condition }: { condition: UiCondition }) {
  const columns = useFilterStore((s) => s.columns);
  const update = useFilterStore((s) => s.updateCondition);
  const remove = useFilterStore((s) => s.remove);

  const arity = arityOf(condition.op);

  return (
    <div className="flex items-center gap-1.5">
      <select
        className={cn(selectClass, "min-w-[7rem]")}
        value={condition.column}
        onChange={(e) => update(condition.id, { column: e.target.value })}
      >
        {/* Allow a column that isn't in the list (e.g. stale) to still show. */}
        {!columns.includes(condition.column) && condition.column === "" && (
          <option value="">column…</option>
        )}
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        className={cn(selectClass, "min-w-[6rem]")}
        value={condition.op}
        onChange={(e) => update(condition.id, { op: e.target.value as FilterOp })}
      >
        {OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {arity === "one" && (
        <input
          className={cn(inputClass, "flex-1")}
          value={condition.value}
          placeholder="value"
          onChange={(e) => update(condition.id, { value: e.target.value })}
        />
      )}

      {arity === "list" && (
        <input
          className={cn(inputClass, "flex-1")}
          value={condition.value}
          placeholder="a, b, c"
          onChange={(e) => update(condition.id, { value: e.target.value })}
        />
      )}

      {arity === "two" && (
        <div className="flex flex-1 items-center gap-1.5">
          <input
            className={cn(inputClass, "min-w-0 flex-1")}
            value={condition.value}
            placeholder="from"
            onChange={(e) => update(condition.id, { value: e.target.value })}
          />
          <span className="text-2xs text-muted">and</span>
          <input
            className={cn(inputClass, "min-w-0 flex-1")}
            value={condition.value2}
            placeholder="to"
            onChange={(e) => update(condition.id, { value2: e.target.value })}
          />
        </div>
      )}

      {arity === "none" && <div className="flex-1" />}

      <button
        onClick={() => remove(condition.id)}
        title="Remove condition"
        className="h-7 w-7 shrink-0 rounded border border-border text-muted hover:bg-surface-2 hover:text-fg"
      >
        ×
      </button>
    </div>
  );
}
