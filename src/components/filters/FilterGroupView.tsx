import { cn } from "@/lib/cn";
import { useFilterStore, type UiGroup } from "@/stores/filterStore";

import { FilterRow } from "./FilterRow";

/**
 * Recursive view of a filter group: an AND/OR toggle plus its children
 * (conditions or nested groups). Nested groups are indented and bordered to
 * make the boolean structure visible — mirroring the parenthesized SQL.
 */
export function FilterGroupView({ group, isRoot = false }: { group: UiGroup; isRoot?: boolean }) {
  const addCondition = useFilterStore((s) => s.addCondition);
  const addGroup = useFilterStore((s) => s.addGroup);
  const setCombinator = useFilterStore((s) => s.setCombinator);
  const remove = useFilterStore((s) => s.remove);

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        !isRoot && "rounded-md border border-border/70 bg-surface-2/40 p-2",
      )}
    >
      <div className="flex items-center gap-2">
        <CombinatorToggle
          value={group.combinator}
          onChange={(c) => setCombinator(group.id, c)}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <SmallButton onClick={() => addCondition(group.id)}>+ Condition</SmallButton>
          <SmallButton onClick={() => addGroup(group.id)}>+ Group</SmallButton>
          {!isRoot && (
            <SmallButton onClick={() => remove(group.id)} title="Remove group">
              × Group
            </SmallButton>
          )}
        </div>
      </div>

      {group.children.length === 0 ? (
        <p className="px-1 text-2xs text-muted">No conditions — showing all rows.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {group.children.map((child) =>
            child.kind === "group" ? (
              <FilterGroupView key={child.id} group={child} />
            ) : (
              <FilterRow key={child.id} condition={child} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function CombinatorToggle({
  value,
  onChange,
}: {
  value: "AND" | "OR";
  onChange: (c: "AND" | "OR") => void;
}) {
  return (
    <div className="flex overflow-hidden rounded border border-border text-2xs">
      {(["AND", "OR"] as const).map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            "px-2 py-0.5 font-semibold",
            value === c ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-fg",
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function SmallButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded border border-border px-1.5 py-0.5 text-2xs text-muted hover:bg-surface-2 hover:text-fg"
    >
      {children}
    </button>
  );
}
