/**
 * VW-TABLE — Tabular email view with resizable, reorderable columns and
 * inline metadata editing.
 *
 * Column order and widths are persisted per-workspace via Zustand.
 * Drag the grip handle (⋮⋮) to reorder; drag the right-edge resize handle
 * to adjust column width. Click status, priority, labels, or tags cells to
 * edit inline.
 */
import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronUp,
  ChevronDown as ChevronDownIcon,
  GripVertical,
  Plus,
  Check,
} from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { useVisibleMessages, useStatuses, useLabels } from "@/storage/useStore";
import { localStore } from "@/storage/local";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Tag } from "@/components/ui/Tag";
import { TagBar } from "@/components/inspector/TagBar";
import { LabelCombobox } from "@/components/inspector/LabelCombobox";
import { CustomFieldCellEditor } from "@/components/customfields/CustomFieldStrip";
import type { Message, MetadataFilter, CustomFieldDef, CustomFieldValue } from "@/data/types";

// ─── Column definitions ───────────────────────────────────────────────────────

type SortKey = NonNullable<MetadataFilter["sortBy"]>;

interface ColDef {
  key: string;
  label: string;
  sortKey?: SortKey;
  defaultWidth: number;
  minWidth: number;
}

const CORE_COLS: ColDef[] = [
  { key: "sender",   label: "Sender",  sortKey: "sender",    defaultWidth: 160, minWidth: 80  },
  { key: "subject",  label: "Subject",                        defaultWidth: 280, minWidth: 120 },
  { key: "status",   label: "Status",  sortKey: "status",    defaultWidth: 120, minWidth: 80  },
  { key: "priority", label: "Pri",     sortKey: "priority",  defaultWidth: 60,  minWidth: 50  },
  { key: "labels",   label: "Labels",                         defaultWidth: 160, minWidth: 80  },
  { key: "tags",     label: "Tags",                           defaultWidth: 120, minWidth: 80  },
  { key: "date",     label: "Date",    sortKey: "receivedAt", defaultWidth: 88,  minWidth: 70  },
];

const ROW_HEIGHT = 36;

// ─── Inline status editor ─────────────────────────────────────────────────────

function CreateStatusForm({ onDone }: { onDone: () => void }) {
  const createStatus = useWorkspace((s) => s.createStatus);
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(1);
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { ref.current?.focus(); }, []);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    createStatus({ id: `sta-${trimmed.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`, vaultId: "local", name: trimmed, color, position: 999 });
    onDone();
  }

  return (
    <div className="space-y-2 p-2">
      <input
        ref={ref}
        placeholder="Status name…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          else if (e.key === "Escape") { e.preventDefault(); onDone(); }
        }}
        className="h-6 w-full rounded-xs border border-border-subtle bg-surface-1 px-2 text-body text-text-primary outline-none placeholder:text-text-tertiary"
      />
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)}
            className={cn("size-4 rounded-full border-2 transition-colors", color === c ? "border-text-primary" : "border-transparent")}
            style={{ backgroundColor: `var(--color-link-${c})` }} />
        ))}
      </div>
      <button type="button" onClick={submit}
        className="h-6 w-full rounded-xs bg-accent px-2 text-body text-text-on-accent hover:opacity-90">
        Create
      </button>
    </div>
  );
}

function InlineStatusEditor({ msg }: { msg: Message }) {
  const statuses = useStatuses();
  const setStatus = useWorkspace((s) => s.setStatus);
  const clearStatus = useWorkspace((s) => s.clearStatus);
  const [creating, setCreating] = React.useState(false);
  const current = statuses.find((s) => s.id === msg.statusId);

  return (
    <DropdownMenu.Root onOpenChange={(open) => { if (!open) setCreating(false); }}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex h-full w-full cursor-pointer items-center px-2 focus:outline-none"
        >
          {current ? (
            <span
              className="inline-flex h-[18px] items-center gap-1 rounded-xs px-1.5 font-mono text-mono-xs uppercase"
              style={{
                color: `var(--color-link-${current.color})`,
                backgroundColor: `color-mix(in oklch, var(--color-link-${current.color}) 18%, transparent)`,
              }}
            >
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-link-${current.color})` }} />
              {current.name}
            </span>
          ) : (
            <span className="text-text-muted">—</span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[180px] overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          sideOffset={4} align="start"
        >
          {creating ? (
            <CreateStatusForm onDone={() => setCreating(false)} />
          ) : (
            <>
              {msg.statusId && (
                <DropdownMenu.Item
                  onSelect={() => clearStatus(msg.id)}
                  className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-tertiary outline-none focus:bg-surface-3 focus:text-text-primary"
                >
                  Clear status
                </DropdownMenu.Item>
              )}
              {statuses.map((s) => (
                <DropdownMenu.Item
                  key={s.id}
                  onSelect={() => setStatus(msg.id, s.id)}
                  className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-link-${s.color})` }} />
                  {s.name}
                  {s.id === msg.statusId && <Check size={12} className="ml-auto text-accent" />}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
              <DropdownMenu.Item
                onSelect={(e) => { e.preventDefault(); setCreating(true); }}
                className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-tertiary outline-none focus:bg-surface-3 focus:text-text-primary"
              >
                <Plus size={12} /> Create new status
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ─── Inline priority editor ───────────────────────────────────────────────────

const PRI_LEVELS = [
  { value: 1 as const, label: "Urgent", color: "oklch(0.62 0.16 25)" },
  { value: 2 as const, label: "High",   color: "oklch(0.62 0.14 78)" },
  { value: 3 as const, label: "Normal", color: "var(--color-text-secondary)" },
  { value: 4 as const, label: "Low",    color: "var(--color-text-tertiary)" },
];
const PRI_BANGS: Record<number, number> = { 1: 3, 2: 2, 3: 1, 4: 1 };

function InlinePriorityEditor({ msg }: { msg: Message }) {
  const setPriority = useWorkspace((s) => s.setPriority);
  const clearPriority = useWorkspace((s) => s.clearPriority);
  const level = PRI_LEVELS.find((l) => l.value === msg.priority);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex h-full w-full cursor-pointer items-center px-2 focus:outline-none"
        >
          {level ? (
            <span className="font-mono text-mono-xs font-semibold" style={{ color: level.color }}>
              {"!".repeat(PRI_BANGS[level.value] ?? 1)} {level.label}
            </span>
          ) : (
            <span className="text-text-muted">—</span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[160px] overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          sideOffset={4} align="start"
        >
          {PRI_LEVELS.map((l) => (
            <DropdownMenu.Item
              key={l.value}
              onSelect={() => setPriority(msg.id, l.value)}
              className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body outline-none focus:bg-surface-3"
            >
              <span className="w-5 font-mono text-mono-xs font-semibold" style={{ color: l.color }}>
                {"!".repeat(PRI_BANGS[l.value] ?? 1)}
              </span>
              <span className={cn("text-text-secondary", msg.priority === l.value && "text-text-primary")}>
                {l.label}
              </span>
              {msg.priority === l.value && <Check size={12} className="ml-auto text-accent" />}
            </DropdownMenu.Item>
          ))}
          {msg.priority && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
              <DropdownMenu.Item
                onSelect={() => clearPriority(msg.id)}
                className="flex h-7 cursor-pointer items-center rounded-xs px-2 text-body text-text-tertiary outline-none focus:bg-surface-3 focus:text-text-primary"
              >
                Clear priority
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ─── Inline labels editor ─────────────────────────────────────────────────────

function InlineLabelsEditor({ msg }: { msg: Message }) {
  const allLabels = useLabels();
  const removeLabel = useWorkspace((s) => s.removeLabel);
  const [open, setOpen] = React.useState(false);
  const userLabels = allLabels.filter((l) => msg.labelIds.includes(l.id) && l.kind === "user");

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-full w-full cursor-pointer items-center gap-0.5 px-2 focus:outline-none"
        >
          {userLabels.length > 0 ? (
            <>
              {userLabels.slice(0, 2).map((l) => (
                <Tag key={l.id} color={l.color as 1|2|3|4|5|6|7|8} size="sm">{l.name}</Tag>
              ))}
              {userLabels.length > 2 && (
                <span className="font-mono text-mono-xs text-text-muted">+{userLabels.length - 2}</span>
              )}
            </>
          ) : (
            <span className="text-text-muted">—</span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-64 rounded-md border border-border-default bg-surface-4 p-3 shadow-l3 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          sideOffset={4} align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {userLabels.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {userLabels.map((l) => (
                <Tag
                  key={l.id}
                  color={l.color as 1|2|3|4|5|6|7|8}
                  size="md"
                  removable
                  onRemove={() => removeLabel(msg.id, l.id)}
                >
                  {l.name}
                </Tag>
              ))}
            </div>
          )}
          <LabelCombobox messageId={msg.id} activeLabelIds={msg.labelIds} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Inline tags editor ───────────────────────────────────────────────────────

function InlineTagsEditor({ msg }: { msg: Message }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-full w-full cursor-pointer items-center gap-0.5 px-2 focus:outline-none"
        >
          {msg.tags.length > 0 ? (
            <>
              {msg.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="inline-flex h-[18px] items-center rounded-xs bg-surface-3 px-1.5 font-mono text-mono-xs text-text-tertiary">
                  #{tag}
                </span>
              ))}
              {msg.tags.length > 2 && (
                <span className="font-mono text-mono-xs text-text-muted">+{msg.tags.length - 2}</span>
              )}
            </>
          ) : (
            <span className="text-text-muted">—</span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-64 rounded-md border border-border-default bg-surface-4 p-3 shadow-l3 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          sideOffset={4} align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <TagBar messageId={msg.id} tags={msg.tags} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Inline custom field editor ───────────────────────────────────────────────

function InlineCfdEditor({ msg, def }: { msg: Message; def: CustomFieldDef }) {
  const setCustomFieldValue = useWorkspace((s) => s.setCustomFieldValue);
  const clearCustomFieldValue = useWorkspace((s) => s.clearCustomFieldValue);
  const [open, setOpen] = React.useState(false);
  const value = msg.customFields[def.id] ?? null;

  const displayVal =
    value == null ? null :
    typeof value === "boolean" ? (value ? "Yes" : "No") :
    value instanceof Date ? value.toLocaleDateString() :
    Array.isArray(value) ? `${value.length} selected` :
    typeof value === "object" && "addr" in value ? (value as { addr: string }).addr :
    String(value);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-full w-full cursor-pointer items-center px-2 focus:outline-none"
        >
          {displayVal != null ? (
            <span className="truncate font-mono text-mono-xs text-text-secondary">{displayVal}</span>
          ) : (
            <span className="text-text-muted">—</span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-64 rounded-md border border-border-default bg-surface-4 p-3 shadow-l3 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          sideOffset={4} align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <p className="mb-2 text-small text-text-tertiary">{def.name}</p>
          <CustomFieldCellEditor
            def={def}
            value={value}
            onChange={(v) => {
              if (v === null) clearCustomFieldValue(msg.id, def.id);
              else setCustomFieldValue(msg.id, def.id, v as CustomFieldValue);
            }}
            onClear={() => clearCustomFieldValue(msg.id, def.id)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Column resize handle ─────────────────────────────────────────────────────

function ResizeHandle({
  colKey,
  currentWidth,
  minWidth,
  onDelta,
  onCommit,
}: {
  colKey: string;
  currentWidth: number;
  minWidth: number;
  onDelta: (key: string, width: number) => void;
  onCommit: (key: string, width: number) => void;
}) {
  const startRef = React.useRef<{ x: number; w: number } | null>(null);
  const liveWidthRef = React.useRef(currentWidth);

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    startRef.current = { x: e.clientX, w: currentWidth };
    liveWidthRef.current = currentWidth;

    function onMove(ev: PointerEvent) {
      if (!startRef.current) return;
      const newW = Math.max(minWidth, startRef.current.w + ev.clientX - startRef.current.x);
      liveWidthRef.current = newW;
      onDelta(colKey, newW);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onCommit(colKey, liveWidthRef.current);
      startRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-accent"
      onPointerDown={onPointerDown}
      onDragStart={(e) => e.preventDefault()}
    />
  );
}

// ─── Resolved column type ─────────────────────────────────────────────────────

interface ResolvedCol {
  key: string;
  label: string;
  sortKey?: SortKey;
  width: number;
  minWidth: number;
  isCfd: boolean;
  cfdDef?: CustomFieldDef;
}

// ─── Table row ────────────────────────────────────────────────────────────────

const TableRow = React.memo(function TableRow({
  msg,
  columns,
  isSelected,
  onClick,
}: {
  msg: Message;
  columns: ResolvedCol[];
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="row"
      aria-selected={isSelected}
      onClick={onClick}
      className={cn(
        "flex cursor-default border-b border-border-subtle",
        "transition-colors duration-fast hover:bg-surface-2",
        isSelected && "bg-accent-soft",
        msg.flags.read ? "opacity-75" : "",
      )}
      style={{ height: ROW_HEIGHT }}
    >
      {columns.map((col) => {
        // Editable cells: the editor component provides its own full-height button trigger.
        // Non-editable: standard padded div.
        if (!col.isCfd) {
          switch (col.key) {
            case "status":
              return (
                <div key={col.key} className="shrink-0 overflow-hidden" style={{ width: col.width, height: ROW_HEIGHT }}>
                  <InlineStatusEditor msg={msg} />
                </div>
              );
            case "priority":
              return (
                <div key={col.key} className="shrink-0 overflow-hidden" style={{ width: col.width, height: ROW_HEIGHT }}>
                  <InlinePriorityEditor msg={msg} />
                </div>
              );
            case "labels":
              return (
                <div key={col.key} className="shrink-0 overflow-hidden" style={{ width: col.width, height: ROW_HEIGHT }}>
                  <InlineLabelsEditor msg={msg} />
                </div>
              );
            case "tags":
              return (
                <div key={col.key} className="shrink-0 overflow-hidden" style={{ width: col.width, height: ROW_HEIGHT }}>
                  <InlineTagsEditor msg={msg} />
                </div>
              );
            case "sender":
              return (
                <div key={col.key} className="shrink-0 overflow-hidden px-2" style={{ width: col.width }}>
                  <span className={cn("flex items-center h-full truncate text-body", !msg.flags.read && "font-semibold text-text-primary")}>
                    {msg.fromAddr.name}
                  </span>
                </div>
              );
            case "subject":
              return (
                <div key={col.key} className="shrink-0 overflow-hidden px-2" style={{ width: col.width }}>
                  <span className={cn("flex items-center h-full truncate text-body", !msg.flags.read && "font-semibold text-text-primary")}>
                    {msg.subject}
                  </span>
                </div>
              );
            case "date":
              return (
                <div key={col.key} className="shrink-0 overflow-hidden px-2" style={{ width: col.width }}>
                  <span className="flex items-center h-full font-mono text-mono-xs text-text-tertiary">
                    {formatRelativeTime(new Date(msg.receivedAt))}
                  </span>
                </div>
              );
            default:
              return null;
          }
        }

        // CFD column
        if (!col.cfdDef) return null;
        return (
          <div key={col.key} className="shrink-0 overflow-hidden" style={{ width: col.width, height: ROW_HEIGHT }}>
            <InlineCfdEditor msg={msg} def={col.cfdDef} />
          </div>
        );
      })}
    </div>
  );
});

// ─── Main view ────────────────────────────────────────────────────────────────

export function TableView() {
  const [sortBy, setSortBy] = React.useState<SortKey>("receivedAt");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const messages = useVisibleMessages(sortBy, sortDir);
  const setSelectedEmail = useWorkspace((s) => s.setSelectedEmail);
  const selectedEmailId = useWorkspace((s) => s.selectedEmailId);

  const tableColumnOrder = useWorkspace((s) => s.tableColumnOrder);
  const tableColumnWidths = useWorkspace((s) => s.tableColumnWidths);
  const setTableColumnOrder = useWorkspace((s) => s.setTableColumnOrder);
  const setTableColumnWidths = useWorkspace((s) => s.setTableColumnWidths);

  // In-progress resize widths (applied immediately for smooth dragging).
  const [widthOverrides, setWidthOverrides] = React.useState<Record<string, number>>({});

  const parentRef = React.useRef<HTMLDivElement>(null);

  // Custom field defs (stable reference)
  const cfdDefs = React.useMemo(
    () => Array.from(localStore.customFieldDefs.values()).sort((a, b) => a.position - b.position),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Resolve column order and widths from workspace state + defaults.
  const columns: ResolvedCol[] = React.useMemo(() => {
    const allDefs: ResolvedCol[] = [
      ...CORE_COLS.map((c) => ({ key: c.key, label: c.label, sortKey: c.sortKey, width: c.defaultWidth, minWidth: c.minWidth, isCfd: false })),
      ...cfdDefs.map((d) => ({ key: d.id, label: d.name, width: 120, minWidth: 60, isCfd: true, cfdDef: d })),
    ];
    const defMap = new Map(allDefs.map((d) => [d.key, d]));

    const savedOrder = tableColumnOrder.filter((k) => defMap.has(k));
    const unsaved = allDefs.filter((d) => !savedOrder.includes(d.key)).map((d) => d.key);
    const order = savedOrder.length > 0 ? [...savedOrder, ...unsaved] : allDefs.map((d) => d.key);

    return order.map((key) => {
      const def = defMap.get(key)!;
      const storedWidth = tableColumnWidths[key];
      const liveWidth = widthOverrides[key];
      return { ...def, width: liveWidth ?? storedWidth ?? def.width };
    });
  }, [tableColumnOrder, tableColumnWidths, widthOverrides, cfdDefs]);

  const totalWidth = columns.reduce((s, c) => s + c.width, 0);

  // ── Resize handlers ──────────────────────────────────────────────────────────

  function handleResizeDelta(key: string, width: number) {
    setWidthOverrides((prev) => ({ ...prev, [key]: width }));
  }

  function handleResizeCommit(key: string, width: number) {
    const stored = useWorkspace.getState().tableColumnWidths;
    setTableColumnWidths({ ...stored, [key]: width });
    setWidthOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // ── Drag-and-drop reorder ────────────────────────────────────────────────────

  const [dragSource, setDragSource] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);

  function handleDragStart(key: string, e: React.DragEvent) {
    setDragSource(key);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key);
  }

  function handleDragOver(key: string, e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (key !== dragSource) setDragOver(key);
  }

  function handleDrop(key: string, e: React.DragEvent) {
    e.preventDefault();
    const src = dragSource;
    setDragSource(null);
    setDragOver(null);
    if (!src || src === key) return;

    const order = columns.map((c) => c.key);
    const fromIdx = order.indexOf(src);
    const toIdx = order.indexOf(key);
    if (fromIdx === -1 || toIdx === -1) return;

    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, src);
    setTableColumnOrder(order);
  }

  function handleDragEnd() {
    setDragSource(null);
    setDragOver(null);
  }

  // ── Sort ─────────────────────────────────────────────────────────────────────

  function handleColSort(key?: SortKey) {
    if (!key) return;
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("desc"); }
  }

  // ── Virtualizer ──────────────────────────────────────────────────────────────

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Scroll the selected row into view when it changes (supports keyboard navigation)
  React.useEffect(() => {
    if (!selectedEmailId) return;
    const idx = messages.findIndex((m) => m.id === selectedEmailId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmailId]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Sticky header ────────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 border-b border-border-subtle bg-surface-1"
        style={{ minWidth: totalWidth }}
      >
        {columns.map((col) => {
          const isSorted = sortBy === col.sortKey;
          const isDragTarget = dragOver === col.key;
          const isDragging = dragSource === col.key;

          return (
            <div
              key={col.key}
              className={cn(
                "group relative flex shrink-0 items-center",
                isDragTarget && "border-l-2 border-accent",
                isDragging && "opacity-40",
              )}
              style={{ width: col.width }}
              onDragOver={(e) => handleDragOver(col.key, e)}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => handleDrop(col.key, e)}
            >
              {/* Drag grip */}
              <div
                draggable
                onDragStart={(e) => handleDragStart(col.key, e)}
                onDragEnd={handleDragEnd}
                className="flex shrink-0 cursor-grab items-center px-1 text-text-muted opacity-30 group-hover:opacity-70 active:cursor-grabbing active:opacity-100"
              >
                <GripVertical size={10} />
              </div>

              {/* Sort button */}
              <button
                type="button"
                disabled={!col.sortKey}
                onClick={() => handleColSort(col.sortKey)}
                className={cn(
                  "flex flex-1 items-center gap-0.5 py-1.5 pr-3 pl-1",
                  "font-mono text-mono-xs uppercase text-text-tertiary",
                  col.sortKey && "cursor-pointer hover:text-text-secondary",
                  isSorted && "text-text-primary",
                )}
              >
                {col.label}
                {isSorted && (sortDir === "asc" ? <ChevronUp size={10} /> : <ChevronDownIcon size={10} />)}
              </button>

              {/* Resize handle */}
              <ResizeHandle
                colKey={col.key}
                currentWidth={col.width}
                minWidth={col.minWidth}
                onDelta={handleResizeDelta}
                onCommit={handleResizeCommit}
              />
            </div>
          );
        })}
      </div>

      {/* ── Virtualized rows ─────────────────────────────────────────────────── */}
      <div
        ref={parentRef}
        className="nx-scroll flex-1 overflow-auto"
        style={{ minWidth: totalWidth }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const msg = messages[vi.index]!;
            return (
              <div
                key={msg.id}
                data-index={vi.index}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
              >
                <TableRow
                  msg={msg}
                  columns={columns}
                  isSelected={selectedEmailId === msg.id}
                  onClick={() => setSelectedEmail(msg.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
