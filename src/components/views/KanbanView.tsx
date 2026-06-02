/**
 * VW-KANBAN-BY-STATUS — Kanban board view.
 *
 * Columns = STA values + a "No Status" column.
 * Cards = messages grouped by statusId.
 * Drag a card → SET_STATUS mutation.
 */
import * as React from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useWorkspace } from "@/state/workspace";
import { useStatuses, useVisibleMessages, useContactByEmail } from "@/storage/useStore";
import { localStore } from "@/storage/local";
import { cn, formatRelativeTime } from "@/lib/utils";
import { pickPanelLink, type PanelLink } from "@/design-system/tokens";
import { Avatar } from "@/components/ui/Avatar";
import { Tag } from "@/components/ui/Tag";
import type { Message, Status } from "@/data/types";

// ─── Kanban card ──────────────────────────────────────────────────────────────

interface CardProps {
  message: Message;
  isDragging?: boolean;
}

function KanbanCard({ message: msg, isDragging }: CardProps) {
  const setSelectedEmail = useWorkspace((s) => s.setSelectedEmail);
  const selectedEmailId = useWorkspace((s) => s.selectedEmailId);
  const isSelected = selectedEmailId === msg.id;
  const colorSeed = pickPanelLink(msg.fromAddr.email);
  const senderContact = useContactByEmail(msg.fromAddr.email);

  const userLabels = React.useMemo(() => {
    const lbls = [];
    for (const lid of msg.labelIds) {
      const l = localStore.labels.get(lid);
      if (l && l.kind === "user") lbls.push(l);
    }
    return lbls;
  }, [msg.labelIds]);

  return (
    <div
      className={cn(
        "rounded-md border bg-surface-2 p-2.5 shadow-sm",
        "cursor-pointer transition-all duration-fast",
        isSelected ? "border-accent ring-1 ring-accent/30" : "border-border-subtle hover:border-border-default",
        isDragging && "opacity-50 ring-2 ring-accent",
      )}
      onClick={() => setSelectedEmail(msg.id)}
    >
      {/* From + date */}
      <div className="flex items-center gap-1.5">
        <Avatar name={msg.fromAddr.name} size={16} colorSeed={colorSeed} src={senderContact?.photoUrl ?? localStore.accountPhotoUrlForEmail(msg.fromAddr.email)} email={msg.fromAddr.email} />
        <span className="min-w-0 flex-1 truncate font-sans text-small font-medium text-text-secondary">
          {msg.fromAddr.name}
        </span>
        <span className="shrink-0 font-mono text-mono-xs text-text-muted">
          {formatRelativeTime(new Date(msg.receivedAt))}
        </span>
      </div>

      {/* Subject */}
      <p
        className={cn(
          "mt-1 line-clamp-2 text-body",
          msg.flags.read ? "text-text-secondary" : "font-semibold text-text-primary",
        )}
      >
        {msg.subject}
      </p>

      {/* Snippet */}
      <p className="mt-0.5 line-clamp-1 text-small text-text-tertiary">{msg.snippet}</p>

      {/* Meta chips */}
      {(userLabels.length > 0 || msg.tags.length > 0 || msg.priority != null) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {msg.priority != null && msg.priority <= 2 && (
            <span
              className="inline-flex h-[18px] items-center rounded-xs px-1.5 font-mono text-mono-xs font-bold"
              style={{
                color: msg.priority === 1 ? "var(--color-link-1)" : "oklch(0.66 0.16 55)",
              }}
            >
              {"!".repeat(msg.priority === 1 ? 3 : 2)}
            </span>
          )}
          {userLabels.slice(0, 2).map((l) => (
            <Tag key={l.id} color={l.color as PanelLink} size="sm">
              {l.name}
            </Tag>
          ))}
          {msg.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="inline-flex h-[18px] items-center rounded-xs bg-surface-3 px-1.5 font-mono text-mono-xs text-text-tertiary"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Draggable card wrapper ───────────────────────────────────────────────────

function DraggableCard({ message }: { message: Message }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: message.id,
    data: { message },
  });

  return (
    <div ref={setNodeRef} {...attributes} {...listeners}>
      <KanbanCard message={message} isDragging={isDragging} />
    </div>
  );
}

// ─── Kanban column ────────────────────────────────────────────────────────────

interface ColumnProps {
  columnId: string;
  title: string;
  color?: number;
  messages: Message[];
}

function KanbanColumn({ columnId, title, color, messages }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 4,
    gap: 8,
  });

  return (
    <div className="flex w-64 shrink-0 flex-col rounded-lg border border-border-subtle bg-surface-1">
      {/* Column header */}
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        {color != null && (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: `var(--color-link-${color})` }}
          />
        )}
        <span className="font-mono text-mono-sm font-medium text-text-secondary">{title}</span>
        <span className="ml-auto font-mono text-mono-xs text-text-muted">{messages.length}</span>
      </div>

      {/* Cards */}
      <div
        ref={(el) => { setNodeRef(el); (parentRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
        className={cn(
          "nx-scroll flex-1 overflow-y-auto p-2 transition-colors",
          isOver && "bg-accent/5",
        )}
        style={{ minHeight: 120, maxHeight: "calc(100vh - 160px)" }}
      >
        {messages.length === 0 ? (
          <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-border-subtle text-small text-text-muted">
            Drop here
          </div>
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const msg = messages[vi.index]!;
              return (
                <div
                  key={msg.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <DraggableCard message={msg} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

const NO_STATUS_COL = "__no_status__";

export function KanbanView() {
  const statuses = useStatuses();
  const messages = useVisibleMessages();
  const setStatus = useWorkspace((s) => s.setStatus);
  const clearStatus = useWorkspace((s) => s.clearStatus);
  const [activeMsg, setActiveMsg] = React.useState<Message | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Group messages by statusId
  const grouped = React.useMemo(() => {
    const map = new Map<string, Message[]>();
    map.set(NO_STATUS_COL, []);
    for (const s of statuses) map.set(s.id, []);
    for (const msg of messages) {
      const key = msg.statusId ?? NO_STATUS_COL;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(msg);
    }
    return map;
  }, [messages, statuses]);

  function handleDragStart(event: DragStartEvent) {
    const msg = (event.active.data.current as { message: Message } | undefined)?.message;
    if (msg) setActiveMsg(msg);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveMsg(null);
    const msg = (event.active.data.current as { message: Message } | undefined)?.message;
    if (!msg || !event.over) return;
    const target = event.over.id as string;
    if (target === NO_STATUS_COL) {
      clearStatus(msg.id);
    } else if (target !== msg.statusId) {
      setStatus(msg.id, target);
    }
  }

  const columns: { id: string; title: string; color?: number; status?: Status }[] = [
    { id: NO_STATUS_COL, title: "No Status" },
    ...statuses.map((s) => ({ id: s.id, title: s.name, color: s.color, status: s })),
  ];

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-full gap-4 overflow-x-auto p-4">
        {columns.map(({ id, title, color }) => (
          <KanbanColumn
            key={id}
            columnId={id}
            title={title}
            color={color}
            messages={grouped.get(id) ?? []}
          />
        ))}
      </div>

      <DragOverlay>
        {activeMsg && <KanbanCard message={activeMsg} />}
      </DragOverlay>
    </DndContext>
  );
}
