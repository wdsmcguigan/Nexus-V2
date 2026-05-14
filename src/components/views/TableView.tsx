/**
 * VW-TABLE-CUSTOM-FIELDS — Tabular email view.
 *
 * One row per message with sticky column headers.
 * Core columns: Sender, Subject, Status, Priority, Labels, Tags, Date.
 * Custom field columns appended for each defined CFD.
 * Click a row = select message (same behaviour as EmailRow).
 * Click a column header = sort by that axis.
 */
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronUp, ChevronDown as ChevronDownIcon } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { useVisibleMessages } from "@/storage/useStore";
import { localStore } from "@/storage/local";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Tag } from "@/components/ui/Tag";
import type { Message, MetadataFilter } from "@/data/types";

// ─── Column definitions ───────────────────────────────────────────────────────

type SortBy = NonNullable<MetadataFilter["sortBy"]>;

const CORE_COLS: { key: string; label: string; sortKey?: SortBy; width: number }[] = [
  { key: "sender", label: "Sender", sortKey: "sender", width: 160 },
  { key: "subject", label: "Subject", width: 280 },
  { key: "status", label: "Status", sortKey: "status", width: 120 },
  { key: "priority", label: "Pri", sortKey: "priority", width: 60 },
  { key: "labels", label: "Labels", width: 160 },
  { key: "tags", label: "Tags", width: 120 },
  { key: "date", label: "Date", sortKey: "receivedAt", width: 88 },
];

const PRI_LABELS: Record<number, string> = { 1: "Urgent", 2: "High", 3: "Normal", 4: "Low" };
const PRI_COLORS: Record<number, string> = {
  1: "var(--color-link-1)",
  2: "oklch(0.66 0.16 55)",
  3: "var(--color-link-5)",
  4: "var(--color-text-tertiary)",
};

const ROW_HEIGHT = 36;

// ─── Cell renderers ───────────────────────────────────────────────────────────

function StatusCell({ statusId }: { statusId: string | null }) {
  if (!statusId) return <span className="text-text-muted">—</span>;
  const s = localStore.statuses.get(statusId);
  if (!s) return <span className="text-text-muted font-mono text-mono-xs">{statusId}</span>;
  return (
    <span
      className="inline-flex h-[18px] items-center gap-1 rounded-xs px-1.5 font-mono text-mono-xs uppercase"
      style={{
        color: `var(--color-link-${s.color})`,
        backgroundColor: `color-mix(in oklch, var(--color-link-${s.color}) 18%, transparent)`,
      }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-link-${s.color})` }} />
      {s.name}
    </span>
  );
}

function PriorityCell({ priority }: { priority: number | null }) {
  if (priority == null) return <span className="text-text-muted">—</span>;
  return (
    <span
      className="font-mono text-mono-xs font-semibold"
      style={{ color: PRI_COLORS[priority] }}
    >
      {PRI_LABELS[priority] ?? priority}
    </span>
  );
}

function LabelsCell({ labelIds }: { labelIds: string[] }) {
  const labels = labelIds
    .map((id) => localStore.labels.get(id))
    .filter((l): l is NonNullable<typeof l> => l != null && l.kind === "user");
  if (!labels.length) return <span className="text-text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-0.5">
      {labels.slice(0, 2).map((l) => (
        <Tag key={l.id} color={l.color as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8} size="sm">{l.name}</Tag>
      ))}
      {labels.length > 2 && (
        <span className="font-mono text-mono-xs text-text-muted">+{labels.length - 2}</span>
      )}
    </div>
  );
}

function TagsCell({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="text-text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-0.5">
      {tags.slice(0, 2).map((tag) => (
        <span
          key={tag}
          className="inline-flex h-[18px] items-center rounded-xs bg-surface-3 px-1.5 font-mono text-mono-xs text-text-tertiary"
        >
          #{tag}
        </span>
      ))}
    </div>
  );
}

// ─── Table row ────────────────────────────────────────────────────────────────

interface RowProps {
  message: Message;
  columns: typeof CORE_COLS;
  cfdCols: { id: string; name: string; width: number }[];
  isSelected: boolean;
  onClick: () => void;
}

const TableRow = React.memo(function TableRow({
  message: msg,
  columns,
  cfdCols,
  isSelected,
  onClick,
}: RowProps) {
  return (
    <div
      role="row"
      aria-selected={isSelected}
      onClick={onClick}
      className={cn(
        "flex cursor-default items-center border-b border-border-subtle",
        "transition-colors duration-fast hover:bg-surface-2",
        isSelected && "bg-accent-soft",
        msg.flags.read ? "opacity-75" : "",
      )}
      style={{ height: ROW_HEIGHT }}
    >
      {columns.map((col) => {
        let content: React.ReactNode = null;
        switch (col.key) {
          case "sender":
            content = (
              <span className={cn("truncate text-body", !msg.flags.read && "font-semibold text-text-primary")}>
                {msg.fromAddr.name}
              </span>
            );
            break;
          case "subject":
            content = (
              <span className={cn("truncate text-body", !msg.flags.read && "font-semibold text-text-primary")}>
                {msg.subject}
              </span>
            );
            break;
          case "status":
            content = <StatusCell statusId={msg.statusId} />;
            break;
          case "priority":
            content = <PriorityCell priority={msg.priority} />;
            break;
          case "labels":
            content = <LabelsCell labelIds={msg.labelIds} />;
            break;
          case "tags":
            content = <TagsCell tags={msg.tags} />;
            break;
          case "date":
            content = (
              <span className="font-mono text-mono-xs text-text-tertiary">
                {formatRelativeTime(new Date(msg.receivedAt))}
              </span>
            );
            break;
        }
        return (
          <div
            key={col.key}
            className="shrink-0 overflow-hidden px-2"
            style={{ width: col.width }}
          >
            {content}
          </div>
        );
      })}

      {/* Custom field columns */}
      {cfdCols.map((cfd) => {
        const val = msg.customFields[cfd.id];
        return (
          <div
            key={cfd.id}
            className="shrink-0 overflow-hidden px-2"
            style={{ width: cfd.width }}
          >
            <span className="truncate font-mono text-mono-xs text-text-secondary">
              {val != null ? String(val) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
});

// ─── Main view ────────────────────────────────────────────────────────────────

export function TableView() {
  const [sortBy, setSortBy] = React.useState<SortBy>("receivedAt");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const messages = useVisibleMessages(sortBy, sortDir);
  const setSelectedEmail = useWorkspace((s) => s.setSelectedEmail);
  const selectedEmailId = useWorkspace((s) => s.selectedEmailId);

  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Custom field columns
  const cfdCols = React.useMemo(
    () =>
      Array.from(localStore.customFieldDefs.values())
        .sort((a, b) => a.position - b.position)
        .map((cfd) => ({ id: cfd.id, name: cfd.name, width: 120 })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function handleColSort(key?: SortBy) {
    if (!key) return;
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  }

  const totalWidth =
    CORE_COLS.reduce((s, c) => s + c.width, 0) +
    cfdCols.reduce((s, c) => s + c.width, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky header */}
      <div
        className="flex shrink-0 border-b border-border-subtle bg-surface-1"
        style={{ minWidth: totalWidth }}
      >
        {CORE_COLS.map((col) => {
          const isSorted = sortBy === col.sortKey;
          return (
            <button
              key={col.key}
              type="button"
              disabled={!col.sortKey}
              onClick={() => handleColSort(col.sortKey)}
              className={cn(
                "flex shrink-0 items-center gap-0.5 px-2 py-1.5",
                "font-mono text-mono-xs uppercase text-text-tertiary",
                col.sortKey && "cursor-pointer hover:text-text-secondary",
                isSorted && "text-text-primary",
              )}
              style={{ width: col.width }}
            >
              {col.label}
              {isSorted &&
                (sortDir === "asc" ? <ChevronUp size={10} /> : <ChevronDownIcon size={10} />)}
            </button>
          );
        })}
        {cfdCols.map((cfd) => (
          <div
            key={cfd.id}
            className="shrink-0 px-2 py-1.5 font-mono text-mono-xs uppercase text-text-tertiary"
            style={{ width: cfd.width }}
          >
            {cfd.name}
          </div>
        ))}
      </div>

      {/* Virtualized rows */}
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
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <TableRow
                  message={msg}
                  columns={CORE_COLS}
                  cfdCols={cfdCols}
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
