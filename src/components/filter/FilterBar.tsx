/**
 * FLT-BAR — Active filter pills row.
 *
 * Sits above the email list. Shows one pill per active filter axis.
 * "Add filter" button opens a dropdown to pick an axis + value.
 * Each pill has an ✕ to remove that axis. "Save as view…" appears
 * when any filter is active.
 */
import * as React from "react";
import { X, SlidersHorizontal, Bookmark } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useWorkspace } from "@/state/workspace";
import { useStatuses, useUserLabels } from "@/storage/useStore";
import { localStore } from "@/storage/local";
import { cn } from "@/lib/utils";
import type { MetadataFilter } from "@/data/types";

// ─── Pill rendering ───────────────────────────────────────────────────────────

const PRI_LABELS: Record<number, string> = { 1: "Urgent", 2: "High", 3: "Normal", 4: "Low" };

function FilterPill({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full border border-border-subtle bg-accent-soft px-2 font-mono text-mono-xs text-text-secondary">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="ml-0.5 rounded-full p-0.5 hover:bg-surface-3 hover:text-text-primary"
      >
        <X size={9} />
      </button>
    </span>
  );
}

// ─── Add-filter submenu items ─────────────────────────────────────────────────

interface AddFilterMenuProps {
  onClose: () => void;
}

function AddFilterMenu({ onClose }: AddFilterMenuProps) {
  const statuses = useStatuses();
  const labels = useUserLabels();
  const setFilterAxis = useWorkspace((s) => s.setFilterAxis);

  function apply(axis: Partial<MetadataFilter>) {
    setFilterAxis(axis);
    onClose();
  }

  return (
    <>
      {/* Status submenu */}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger className={itemCls}>
          Status
          <span className="ml-auto text-text-muted">›</span>
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent className={contentCls} sideOffset={4}>
            {statuses.map((s) => (
              <DropdownMenu.Item
                key={s.id}
                className={itemCls}
                onSelect={() => apply({ statusId: s.id })}
              >
                <span
                  className="mr-1.5 inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--color-link-${s.color})` }}
                />
                {s.name}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>

      {/* Priority submenu */}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger className={itemCls}>
          Priority
          <span className="ml-auto text-text-muted">›</span>
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent className={contentCls} sideOffset={4}>
            {([1, 2, 3, 4] as const).map((p) => (
              <DropdownMenu.Item
                key={p}
                className={itemCls}
                onSelect={() => apply({ maxPriority: p })}
              >
                ≤ {PRI_LABELS[p]}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>

      {/* Label submenu */}
      {labels.length > 0 && (
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger className={itemCls}>
            Label
            <span className="ml-auto text-text-muted">›</span>
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent className={contentCls} sideOffset={4}>
              {labels.map((l) => (
                <DropdownMenu.Item
                  key={l.id}
                  className={itemCls}
                  onSelect={() => apply({ labelIds: [l.id] })}
                >
                  <span
                    className="mr-1.5 inline-block size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(--color-link-${l.color})` }}
                  />
                  {l.name}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      )}

      <DropdownMenu.Separator className="my-1 border-t border-border-subtle" />

      {/* Read / Unread */}
      <DropdownMenu.Item className={itemCls} onSelect={() => apply({ read: false })}>
        Unread only
      </DropdownMenu.Item>
      <DropdownMenu.Item className={itemCls} onSelect={() => apply({ read: true })}>
        Read only
      </DropdownMenu.Item>

      <DropdownMenu.Separator className="my-1 border-t border-border-subtle" />

      {/* Pinned / Starred */}
      <DropdownMenu.Item className={itemCls} onSelect={() => apply({ pinned: true })}>
        Pinned
      </DropdownMenu.Item>
      <DropdownMenu.Item className={itemCls} onSelect={() => apply({ star: "yellow" })}>
        Starred
      </DropdownMenu.Item>
      <DropdownMenu.Item className={itemCls} onSelect={() => apply({ flagged: true })}>
        Flagged
      </DropdownMenu.Item>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const contentCls = cn(
  "z-50 min-w-[160px] overflow-hidden rounded-md border border-border-subtle",
  "bg-surface-2 p-1 shadow-lg",
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
);
const itemCls = cn(
  "flex h-7 cursor-pointer items-center rounded-xs px-2 text-body outline-none",
  "text-text-secondary focus:bg-surface-3 focus:text-text-primary",
);

export function FilterBar() {
  const activeFilter = useWorkspace((s) => s.activeFilter);
  const removeFilterAxis = useWorkspace((s) => s.removeFilterAxis);
  const clearFilter = useWorkspace((s) => s.clearFilter);
  const saveCurrentFilter = useWorkspace((s) => s.saveCurrentFilter);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);

  // Build pill descriptors from the active filter
  const pills: { key: keyof MetadataFilter; label: string }[] = [];

  if (activeFilter.statusId) {
    const s = localStore.statuses.get(activeFilter.statusId);
    pills.push({ key: "statusId", label: `Status: ${s?.name ?? activeFilter.statusId}` });
  }
  if (activeFilter.maxPriority != null) {
    pills.push({ key: "maxPriority", label: `Priority ≤ ${PRI_LABELS[activeFilter.maxPriority]}` });
  }
  if (activeFilter.labelIds?.length) {
    const lbl = localStore.labels.get(activeFilter.labelIds[0]!);
    pills.push({ key: "labelIds", label: `Label: ${lbl?.name ?? activeFilter.labelIds[0]}` });
  }
  if (activeFilter.read === false) pills.push({ key: "read", label: "Unread" });
  if (activeFilter.read === true) pills.push({ key: "read", label: "Read" });
  if (activeFilter.pinned) pills.push({ key: "pinned", label: "Pinned" });
  if (activeFilter.star) pills.push({ key: "star", label: "Starred" });
  if (activeFilter.flagged) pills.push({ key: "flagged", label: "Flagged" });
  if (activeFilter.tags?.length) {
    pills.push({ key: "tags", label: `#${activeFilter.tags[0]}` });
  }
  if (activeFilter.contactId) {
    const c = localStore.contacts.get(activeFilter.contactId);
    pills.push({ key: "contactId", label: `From: ${c?.name ?? activeFilter.contactId}` });
  }

  const hasFilter = pills.length > 0;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-1 px-2",
        hasFilter ? "min-h-[36px] py-1.5" : "h-8",
      )}
    >
      {/* Filter icon label */}
      <SlidersHorizontal size={12} className="shrink-0 text-text-tertiary" />

      {/* Active pills */}
      {pills.map(({ key, label }) => (
        <FilterPill key={key} label={label} onRemove={() => removeFilterAxis(key)} />
      ))}

      {/* Add filter dropdown */}
      <DropdownMenu.Root open={addOpen} onOpenChange={setAddOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-6 items-center gap-1 rounded-full border border-dashed border-border-subtle px-2",
              "font-mono text-mono-xs text-text-tertiary",
              "hover:border-border-default hover:text-text-secondary",
            )}
          >
            + Add filter
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={contentCls}
            sideOffset={4}
            align="start"
          >
            <AddFilterMenu onClose={() => setAddOpen(false)} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear all */}
      {hasFilter && (
        <button
          type="button"
          onClick={clearFilter}
          className="font-mono text-mono-xs text-text-tertiary hover:text-text-secondary"
        >
          Clear all
        </button>
      )}

      {/* Save as view */}
      {hasFilter && !saveOpen && (
        <button
          type="button"
          onClick={() => { setSaveName(""); setSaveOpen(true); }}
          className="flex h-6 items-center gap-1 rounded-xs px-2 font-mono text-mono-xs text-text-tertiary hover:bg-surface-2 hover:text-text-secondary"
        >
          <Bookmark size={10} />
          Save view…
        </button>
      )}

      {/* Inline save-name input */}
      {saveOpen && (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (saveName.trim()) {
              saveCurrentFilter(saveName.trim());
              setSaveOpen(false);
            }
          }}
        >
          <input
            autoFocus
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setSaveOpen(false); }}
            placeholder="View name…"
            className={cn(
              "h-6 w-32 rounded-xs border border-border-subtle bg-surface-2 px-2",
              "font-mono text-mono-xs text-text-primary outline-none",
              "focus:border-accent focus:ring-1 focus:ring-accent/30",
            )}
          />
          <button
            type="submit"
            disabled={!saveName.trim()}
            className="rounded-xs bg-accent px-2 py-0.5 font-mono text-mono-xs text-white disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setSaveOpen(false)}
            className="font-mono text-mono-xs text-text-tertiary hover:text-text-secondary"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
