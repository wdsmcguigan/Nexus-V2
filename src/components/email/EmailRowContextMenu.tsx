/**
 * Right-click context menu for email rows in the list panel.
 * Wraps children with a Radix ContextMenu.
 * When the right-clicked message is part of a multi-selection, all actions
 * apply to the full selection set.
 */
import * as React from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  Reply,
  ReplyAll,
  Forward,
  Archive,
  Trash2,
  MailOpen,
  Mail,
  Star,
  StarOff,
  AlarmClock,
  Folder,
  ChevronRight,
  Pin,
  PinOff,
  BellOff,
  Bell,
  Tag as TagIcon,
  Circle,
  Flag,
  Zap,
  ArrowUp,
  Minus,
  ArrowDown,
  Printer,
  FileDown,
  Check,
  X,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/storage/local";
import * as Mut from "@/state/mutations";
import { createTaskFromEntity } from "@/modules/tasks/mutations";
import { TASKS_MAIN_PANEL_KEY } from "@/modules/tasks";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";
import type { Message, StarStyle, CustomFieldType } from "@/data/types";
import { STAR_ENTRIES } from "@/components/inspector/StarPalette";
import { useStatuses, useCustomFieldDefs } from "@/storage/useStore";
import { printMessages } from "@/lib/print";
import { exportMessageEml, exportMessagesAsMbox } from "@/lib/export";
import { loadBodies } from "@/lib/loadBodies";

// ─── Shared menu item styles ──────────────────────────────────────────────────

const itemCls = cn(
  "group relative flex h-7 cursor-default select-none items-center gap-2 rounded-xs px-2 pl-6 text-body outline-none",
  "text-text-secondary data-[highlighted]:bg-surface-3 data-[highlighted]:text-text-primary",
  "transition-colors duration-fast",
);
const destructCls = cn(itemCls, "data-[highlighted]:bg-error/10 data-[highlighted]:text-error");
const subTriggerCls = cn(itemCls, "data-[state=open]:bg-surface-3");
const separatorCls = "my-1 h-px bg-border-subtle";
const labelCls = "px-6 py-0.5 text-overline uppercase text-text-muted";
const shortcutCls = "ml-auto font-mono text-mono-xs text-text-muted";
const subContentCls = cn(
  "z-50 min-w-[180px] max-h-[320px] overflow-y-auto overflow-x-hidden",
  "rounded-md border border-border-subtle bg-surface-2 p-1 shadow-l3",
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
);

// ─── Snooze presets ───────────────────────────────────────────────────────────

function snoozeDate(preset: "later-today" | "tomorrow" | "weekend" | "next-week"): number {
  const d = new Date();
  switch (preset) {
    case "later-today":
      d.setHours(17, 0, 0, 0);
      if (d <= new Date()) d.setDate(d.getDate() + 1); // already past 5pm → tomorrow
      break;
    case "tomorrow":
      d.setDate(d.getDate() + 1);
      d.setHours(8, 0, 0, 0);
      break;
    case "weekend": {
      const day = d.getDay(); // 0=Sun 6=Sat
      const daysUntilSat = day === 6 ? 7 : 6 - day;
      d.setDate(d.getDate() + daysUntilSat);
      d.setHours(9, 0, 0, 0);
      break;
    }
    case "next-week":
      d.setDate(d.getDate() + (8 - d.getDay())); // next Monday
      d.setHours(8, 0, 0, 0);
      break;
  }
  return d.getTime();
}

// ─── Priority config ──────────────────────────────────────────────────────────

const PRIORITIES: { value: 1 | 2 | 3 | 4; label: string; icon: React.ElementType; color: string }[] = [
  { value: 1, label: "Urgent",  icon: Zap,       color: "text-link-1" },
  { value: 2, label: "High",    icon: ArrowUp,   color: "text-link-2" },
  { value: 3, label: "Normal",  icon: Minus,     color: "text-text-tertiary" },
  { value: 4, label: "Low",     icon: ArrowDown, color: "text-link-5" },
];

// ─── Types that can be set from a context submenu ─────────────────────────────

const INLINE_CF_TYPES: CustomFieldType[] = ["boolean", "select", "multi-select"];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  message: Message;
  /** Full selection set from workspace. When msg.id is included here (and size > 1),
   *  all context-menu actions apply to every selected ID. */
  selectedIds: Set<string>;
  children: React.ReactNode;
  /** Called after single-message archive so the list can advance focus. */
  onArchive?: () => void;
  /** Called after single-message delete so the list can advance focus. */
  onDelete?: () => void;
}

export function EmailRowContextMenu({
  message: msg,
  selectedIds,
  children,
  onArchive,
  onDelete,
}: Props) {
  const openComposer = useWorkspace((s) => s.openComposer);
  const unarchive    = useWorkspace((s) => s.unarchive);
  const statuses     = useStatuses();
  const cfDefs       = useCustomFieldDefs().filter((d) => INLINE_CF_TYPES.includes(d.type));

  // Effective IDs: if the right-clicked message is part of the selection, act on all.
  const isMulti = selectedIds.has(msg.id) && selectedIds.size > 1;
  const effectiveIds: string[] = isMulti ? Array.from(selectedIds) : [msg.id];

  // Per-message state (only meaningful for single selection)
  const isRead    = msg.flags.read;
  const isPinned  = msg.pinned;
  const isMuted   = msg.muted;

  // All labels sorted by position
  const allLabels = Array.from(localStore.labels.values()).sort((a, b) => a.position - b.position);
  // Current message's applied label IDs
  const msgLabelIds = new Set(msg.labelIds);

  // All known tags sorted by usage
  const allTags = Array.from(localStore.tagUsage.values())
    .sort((a, b) => b.count - a.count)
    .map((t) => t.tag);
  const msgTags = new Set(msg.tags);

  // Folders for "Move to" submenu
  const folders = Array.from(localStore.folders.values()).filter(
    (f) => !f.systemKind && f.id !== msg.folderId,
  );

  // ─── Bulk helpers ───────────────────────────────────────────────────────────

  function forAll(fn: (id: string) => void) {
    for (const id of effectiveIds) fn(id);
  }

  function markAllRead()   { forAll((id) => Mut.readMessage(localStore, id)); }
  function markAllUnread() { forAll((id) => Mut.unreadMessage(localStore, id)); }
  function archiveAll()    { forAll((id) => Mut.archiveMessage(localStore, id)); }
  function deleteAll()     { forAll((id) => Mut.deleteMessage(localStore, id)); }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={cn(
            "z-50 min-w-[220px] overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-l3",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          {/* ── Selection header (multi-select) ── */}
          {isMulti && (
            <>
              <div className={labelCls}>{effectiveIds.length} messages selected</div>
              <ContextMenu.Separator className={separatorCls} />
            </>
          )}

          {/* ── Compose actions (single only) ── */}
          {!isMulti && (
            <>
              <ContextMenu.Item className={itemCls} onSelect={() => openComposer({ mode: "reply", replyToMessage: msg })}>
                <Reply size={12} className="absolute left-2 text-text-tertiary" />
                Reply
                <span className={shortcutCls}>R</span>
              </ContextMenu.Item>
              <ContextMenu.Item className={itemCls} onSelect={() => openComposer({ mode: "reply-all", replyToMessage: msg })}>
                <ReplyAll size={12} className="absolute left-2 text-text-tertiary" />
                Reply all
              </ContextMenu.Item>
              <ContextMenu.Item className={itemCls} onSelect={() => openComposer({ mode: "forward", replyToMessage: msg })}>
                <Forward size={12} className="absolute left-2 text-text-tertiary" />
                Forward
                <span className={shortcutCls}>F</span>
              </ContextMenu.Item>
              <ContextMenu.Item
                className={itemCls}
                onSelect={() => {
                  createTaskFromEntity("nexus/email.message", msg.id, msg.subject || "(no subject)", localStore);
                  useWorkspace.getState().openModulePanel(TASKS_MAIN_PANEL_KEY, "Tasks");
                  toast.success("Task created");
                }}
              >
                <ListChecks size={12} className="absolute left-2 text-text-tertiary" />
                Create task from this email
              </ContextMenu.Item>
              <ContextMenu.Separator className={separatorCls} />
            </>
          )}

          {/* ── Read / unread ── */}
          {!isMulti ? (
            <ContextMenu.Item
              className={itemCls}
              onSelect={() => { if (isRead) markAllUnread(); else markAllRead(); }}
            >
              {isRead
                ? <Mail size={12} className="absolute left-2 text-text-tertiary" />
                : <MailOpen size={12} className="absolute left-2 text-text-tertiary" />}
              {isRead ? "Mark as unread" : "Mark as read"}
              <span className={shortcutCls}>U</span>
            </ContextMenu.Item>
          ) : (
            <>
              <ContextMenu.Item className={itemCls} onSelect={markAllRead}>
                <Mail size={12} className="absolute left-2 text-text-tertiary" />
                Mark all as read
              </ContextMenu.Item>
              <ContextMenu.Item className={itemCls} onSelect={markAllUnread}>
                <MailOpen size={12} className="absolute left-2 text-text-tertiary" />
                Mark all as unread
              </ContextMenu.Item>
            </>
          )}

          {/* ── Star submenu ── */}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={subTriggerCls}>
              <Star size={12} className="absolute left-2 text-text-tertiary" />
              {!isMulti && msg.star ? "Change star" : "Star"}
              <ChevronRight size={10} className="ml-auto text-text-muted" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={subContentCls} sideOffset={4}>
                <ContextMenu.Label className={labelCls}>Star style</ContextMenu.Label>
                {STAR_ENTRIES.map((entry) => {
                  const Icon = entry.icon;
                  const active = !isMulti && msg.star === entry.style;
                  return (
                    <ContextMenu.Item
                      key={entry.style}
                      className={itemCls}
                      onSelect={() => forAll((id) => Mut.setStar(localStore, id, entry.style as StarStyle))}
                    >
                      <Icon size={12} className="absolute left-2" style={{ color: entry.color }} />
                      {entry.label}
                      {active && <Check size={10} className="ml-auto text-text-tertiary" />}
                    </ContextMenu.Item>
                  );
                })}
                {!isMulti && msg.star && (
                  <>
                    <ContextMenu.Separator className={separatorCls} />
                    <ContextMenu.Item
                      className={itemCls}
                      onSelect={() => Mut.clearStar(localStore, msg.id)}
                    >
                      <StarOff size={12} className="absolute left-2 text-text-tertiary" />
                      Remove star
                    </ContextMenu.Item>
                  </>
                )}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Separator className={separatorCls} />

          {/* ── Labels submenu ── */}
          {allLabels.length > 0 && (
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={subTriggerCls}>
                <TagIcon size={12} className="absolute left-2 text-text-tertiary" />
                Label
                <ChevronRight size={10} className="ml-auto text-text-muted" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={subContentCls} sideOffset={4}>
                  <ContextMenu.Label className={labelCls}>Labels</ContextMenu.Label>
                  {allLabels.map((lbl) => {
                    const applied = !isMulti && msgLabelIds.has(lbl.id);
                    return (
                      <ContextMenu.Item
                        key={lbl.id}
                        className={itemCls}
                        onSelect={() => {
                          if (applied) {
                            Mut.removeLabel(localStore, msg.id, lbl.id);
                          } else {
                            forAll((id) => Mut.addLabel(localStore, id, lbl.id));
                          }
                        }}
                      >
                        <Circle
                          size={8}
                          className="absolute left-2"
                          fill={`var(--color-link-${lbl.color})`}
                          style={{ color: `var(--color-link-${lbl.color})` }}
                        />
                        {lbl.name}
                        {applied && <Check size={10} className="ml-auto text-text-tertiary" />}
                      </ContextMenu.Item>
                    );
                  })}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          )}

          {/* ── Tags submenu ── */}
          {allTags.length > 0 && (
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={subTriggerCls}>
                <TagIcon size={12} className="absolute left-2 text-text-tertiary" />
                Tag
                <ChevronRight size={10} className="ml-auto text-text-muted" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={subContentCls} sideOffset={4}>
                  <ContextMenu.Label className={labelCls}>Tags</ContextMenu.Label>
                  {allTags.map((tag) => {
                    const applied = !isMulti && msgTags.has(tag);
                    return (
                      <ContextMenu.Item
                        key={tag}
                        className={itemCls}
                        onSelect={() => {
                          if (applied) {
                            Mut.removeTag(localStore, msg.id, tag);
                          } else {
                            forAll((id) => Mut.addTag(localStore, id, tag));
                          }
                        }}
                      >
                        <span className="absolute left-2 font-mono text-mono-xs text-text-muted">#</span>
                        {tag}
                        {applied && <Check size={10} className="ml-auto text-text-tertiary" />}
                      </ContextMenu.Item>
                    );
                  })}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          )}

          {/* ── Status submenu ── */}
          {statuses.length > 0 && (
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={subTriggerCls}>
                <Circle size={12} className="absolute left-2 text-text-tertiary" />
                Status
                <ChevronRight size={10} className="ml-auto text-text-muted" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={subContentCls} sideOffset={4}>
                  <ContextMenu.Label className={labelCls}>Status</ContextMenu.Label>
                  {statuses.map((s) => {
                    const active = !isMulti && msg.statusId === s.id;
                    return (
                      <ContextMenu.Item
                        key={s.id}
                        className={itemCls}
                        onSelect={() => forAll((id) => Mut.setStatus(localStore, id, s.id))}
                      >
                        <Circle
                          size={8}
                          className="absolute left-2"
                          fill={`var(--color-link-${s.color})`}
                          style={{ color: `var(--color-link-${s.color})` }}
                        />
                        {s.name}
                        {active && <Check size={10} className="ml-auto text-text-tertiary" />}
                      </ContextMenu.Item>
                    );
                  })}
                  {!isMulti && msg.statusId && (
                    <>
                      <ContextMenu.Separator className={separatorCls} />
                      <ContextMenu.Item
                        className={itemCls}
                        onSelect={() => Mut.clearStatus(localStore, msg.id)}
                      >
                        <X size={10} className="absolute left-2 text-text-tertiary" />
                        Clear status
                      </ContextMenu.Item>
                    </>
                  )}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          )}

          {/* ── Priority submenu ── */}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={subTriggerCls}>
              <Flag size={12} className="absolute left-2 text-text-tertiary" />
              Priority
              <ChevronRight size={10} className="ml-auto text-text-muted" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={subContentCls} sideOffset={4}>
                <ContextMenu.Label className={labelCls}>Priority</ContextMenu.Label>
                {PRIORITIES.map((p) => {
                  const Icon = p.icon;
                  const active = !isMulti && msg.priority === p.value;
                  return (
                    <ContextMenu.Item
                      key={p.value}
                      className={itemCls}
                      onSelect={() => forAll((id) => Mut.setPriority(localStore, id, p.value))}
                    >
                      <Icon size={12} className={cn("absolute left-2", p.color)} />
                      {p.label}
                      {active && <Check size={10} className="ml-auto text-text-tertiary" />}
                    </ContextMenu.Item>
                  );
                })}
                {!isMulti && msg.priority && (
                  <>
                    <ContextMenu.Separator className={separatorCls} />
                    <ContextMenu.Item
                      className={itemCls}
                      onSelect={() => Mut.clearPriority(localStore, msg.id)}
                    >
                      <X size={10} className="absolute left-2 text-text-tertiary" />
                      Clear priority
                    </ContextMenu.Item>
                  </>
                )}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          {/* ── Custom fields submenu (select / multi-select / boolean only) ── */}
          {cfDefs.length > 0 && (
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={subTriggerCls}>
                <Circle size={12} className="absolute left-2 text-text-tertiary" />
                Custom fields
                <ChevronRight size={10} className="ml-auto text-text-muted" />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={subContentCls} sideOffset={4}>
                  {cfDefs.map((def) => {
                    if (def.type === "boolean") {
                      const val = !isMulti && !!msg.customFields[def.id];
                      return (
                        <ContextMenu.Item
                          key={def.id}
                          className={itemCls}
                          onSelect={() => forAll((id) => {
                            const m = localStore.messages.get(id);
                            if (!m) return;
                            const cur = !!m.customFields[def.id];
                            if (cur) Mut.clearCustomFieldValue(localStore, id, def.id);
                            else Mut.setCustomFieldValue(localStore, id, def.id, true);
                          })}
                        >
                          <Check size={10} className={cn("absolute left-2", val ? "text-accent" : "text-transparent")} />
                          {def.name}
                          <span className="ml-auto font-mono text-mono-xs text-text-muted">toggle</span>
                        </ContextMenu.Item>
                      );
                    }

                    // select / multi-select — show options as nested submenu
                    const options = def.options ?? [];
                    if (options.length === 0) return null;
                    const currentVal = !isMulti ? (msg.customFields[def.id] ?? null) : null;
                    const currentIds = Array.isArray(currentVal) ? currentVal as string[]
                      : typeof currentVal === "string" ? [currentVal] : [];

                    return (
                      <ContextMenu.Sub key={def.id}>
                        <ContextMenu.SubTrigger className={subTriggerCls}>
                          {def.name}
                          <ChevronRight size={10} className="ml-auto text-text-muted" />
                        </ContextMenu.SubTrigger>
                        <ContextMenu.Portal>
                          <ContextMenu.SubContent className={subContentCls} sideOffset={4}>
                            <ContextMenu.Label className={labelCls}>{def.name}</ContextMenu.Label>
                            {options.sort((a, b) => a.position - b.position).map((opt) => {
                              const active = currentIds.includes(opt.id);
                              return (
                                <ContextMenu.Item
                                  key={opt.id}
                                  className={itemCls}
                                  onSelect={() => {
                                    if (def.type === "multi-select") {
                                      forAll((id) => {
                                        const m = localStore.messages.get(id);
                                        if (!m) return;
                                        const cur = Array.isArray(m.customFields[def.id])
                                          ? m.customFields[def.id] as string[]
                                          : [];
                                        const next = cur.includes(opt.id)
                                          ? cur.filter((x) => x !== opt.id)
                                          : [...cur, opt.id];
                                        if (next.length === 0) Mut.clearCustomFieldValue(localStore, id, def.id);
                                        else Mut.setCustomFieldValue(localStore, id, def.id, next);
                                      });
                                    } else {
                                      // select — toggle: clicking active clears it
                                      forAll((id) => {
                                        if (active) Mut.clearCustomFieldValue(localStore, id, def.id);
                                        else Mut.setCustomFieldValue(localStore, id, def.id, opt.id);
                                      });
                                    }
                                  }}
                                >
                                  <Circle
                                    size={8}
                                    className="absolute left-2"
                                    fill={`var(--color-link-${opt.color})`}
                                    style={{ color: `var(--color-link-${opt.color})` }}
                                  />
                                  {opt.label}
                                  {active && <Check size={10} className="ml-auto text-text-tertiary" />}
                                </ContextMenu.Item>
                              );
                            })}
                          </ContextMenu.SubContent>
                        </ContextMenu.Portal>
                      </ContextMenu.Sub>
                    );
                  })}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          )}

          <ContextMenu.Separator className={separatorCls} />

          {/* ── Snooze submenu ── */}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={subTriggerCls}>
              <AlarmClock size={12} className="absolute left-2 text-text-tertiary" />
              Snooze
              <ChevronRight size={10} className="ml-auto text-text-muted" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={subContentCls} sideOffset={4}>
                <ContextMenu.Label className={labelCls}>Snooze until</ContextMenu.Label>
                {(["later-today", "tomorrow", "weekend", "next-week"] as const).map((preset) => {
                  const labels = {
                    "later-today": "Later today (5 pm)",
                    "tomorrow":    "Tomorrow morning (8 am)",
                    "weekend":     "This weekend (Sat 9 am)",
                    "next-week":   "Next week (Mon 8 am)",
                  };
                  return (
                    <ContextMenu.Item
                      key={preset}
                      className={itemCls}
                      onSelect={() => {
                        const until = snoozeDate(preset);
                        forAll((id) => Mut.snoozeMessage(localStore, id, until));
                      }}
                    >
                      <AlarmClock size={12} className="absolute left-2 text-text-tertiary" />
                      {labels[preset]}
                    </ContextMenu.Item>
                  );
                })}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          {/* ── Pin / mute ── */}
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => forAll((id) => {
              const m = localStore.messages.get(id);
              if (m) Mut.setPinned(localStore, id, !m.pinned);
            })}
          >
            {isPinned && !isMulti
              ? <PinOff size={12} className="absolute left-2 text-text-tertiary" />
              : <Pin size={12} className="absolute left-2 text-text-tertiary" />}
            {isPinned && !isMulti ? "Unpin" : "Pin to top"}
          </ContextMenu.Item>
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => forAll((id) => {
              const m = localStore.messages.get(id);
              if (m) Mut.setMuted(localStore, id, !m.muted);
            })}
          >
            {isMuted && !isMulti
              ? <Bell size={12} className="absolute left-2 text-text-tertiary" />
              : <BellOff size={12} className="absolute left-2 text-text-tertiary" />}
            {isMuted && !isMulti ? "Unmute thread" : "Mute thread"}
          </ContextMenu.Item>

          {/* ── Move to folder ── */}
          {folders.length > 0 && (
            <>
              <ContextMenu.Separator className={separatorCls} />
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={subTriggerCls}>
                  <Folder size={12} className="absolute left-2 text-text-tertiary" />
                  Move to folder
                  <ChevronRight size={10} className="ml-auto text-text-muted" />
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className={subContentCls} sideOffset={4}>
                    <ContextMenu.Label className={labelCls}>Folders</ContextMenu.Label>
                    {folders.map((f) => (
                      <ContextMenu.Item
                        key={f.id}
                        className={itemCls}
                        onSelect={() => forAll((id) => Mut.moveToFolder(localStore, id, f.id))}
                      >
                        <Folder size={12} className="absolute left-2 text-text-tertiary" />
                        {f.name}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            </>
          )}

          <ContextMenu.Separator className={separatorCls} />

          {/* ── Print / Export ── */}
          <ContextMenu.Item
            className={itemCls}
            onSelect={async () => {
              const msgs = effectiveIds
                .map((id) => localStore.messages.get(id))
                .filter((m): m is Message => !!m);
              const bodies = await loadBodies(msgs);
              printMessages(msgs, bodies);
            }}
          >
            <Printer size={12} className="absolute left-2 text-text-tertiary" />
            Print{isMulti ? ` ${effectiveIds.length} messages` : ""}
          </ContextMenu.Item>
          {!isMulti ? (
            <ContextMenu.Item
              className={itemCls}
              onSelect={async () => {
                const bodies = await loadBodies([msg]);
                await exportMessageEml(msg, bodies.get(msg.bodyRef) ?? `<p>${msg.snippet}</p>`);
              }}
            >
              <FileDown size={12} className="absolute left-2 text-text-tertiary" />
              Export as EML
            </ContextMenu.Item>
          ) : (
            <ContextMenu.Item
              className={itemCls}
              onSelect={async () => {
                const msgs = effectiveIds
                  .map((id) => localStore.messages.get(id))
                  .filter((m): m is Message => !!m)
                  .sort((a, b) => a.receivedAt - b.receivedAt);
                const bodies = await loadBodies(msgs);
                await exportMessagesAsMbox(msgs, bodies, `${msgs.length} messages`);
              }}
            >
              <FileDown size={12} className="absolute left-2 text-text-tertiary" />
              Export as MBOX
            </ContextMenu.Item>
          )}

          <ContextMenu.Separator className={separatorCls} />

          {/* ── Archive / Delete ── */}
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => {
              if (isMulti) {
                archiveAll();
                toast(`Archived ${effectiveIds.length} messages`);
              } else {
                onArchive?.();
                toast("Archived", { action: { label: "Undo", onClick: () => unarchive(msg.id) } });
              }
            }}
          >
            <Archive size={12} className="absolute left-2 text-text-tertiary" />
            {isMulti ? `Archive ${effectiveIds.length} messages` : "Archive"}
            {!isMulti && <span className={shortcutCls}>E</span>}
          </ContextMenu.Item>
          <ContextMenu.Item
            className={destructCls}
            onSelect={() => {
              if (isMulti) {
                deleteAll();
                toast(`Moved ${effectiveIds.length} messages to Trash`);
              } else {
                onDelete?.();
                toast("Moved to Trash");
              }
            }}
          >
            <Trash2 size={12} className="absolute left-2" />
            {isMulti ? `Delete ${effectiveIds.length} messages` : "Delete"}
            {!isMulti && <span className={shortcutCls}>#</span>}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
