import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import type { LucideIcon } from "lucide-react";
import {
  Search,
  Inbox,
  Star,
  Send,
  Mail,
  Settings as SettingsIcon,
  PenSquare,
  Pin,
  PinOff,
  Archive,
  Trash2,
  Sun,
  Rows3,
  Rows4,
  Rows2,
  Reply,
  Forward,
  AlarmClock,
  BellOff,
  Bell,
  Flag,
  FlagOff,
  Tag as TagIcon,
  Folder,
  CheckCircle2,
  AlertOctagon,
  HelpCircle,
  ChevronRight,
  Info,
  AlertTriangle,
  LayoutPanelLeft,
  LayoutPanelTop,
  Columns2,
  User,
  MessagesSquare,
  Users,
  Calendar as CalendarIcon,
  Plus,
} from "lucide-react";
import { useWorkspace, getDockviewApi, newPanelId } from "@/state/workspace";
import type { WorkspaceSnapshot } from "@/storage/workspaceManager";
import { localStore } from "@/storage/local";
import { queryMessages } from "@/storage/query";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Kbd } from "@/components/ui/Kbd";
import type { Density } from "@/design-system/tokens";
import type { StarStyle } from "@/data/types";

interface CmdItemDef {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  shortcut?: string;
  perform: () => void;
}

const STAR_ICONS: Record<StarStyle, LucideIcon> = {
  yellow: Star,
  red: Star,
  orange: Star,
  green: Star,
  blue: Star,
  purple: Star,
  "check-green": CheckCircle2,
  "bang-red": AlertOctagon,
  "question-purple": HelpCircle,
  "guillemet-orange": ChevronRight,
  "info-blue": Info,
  "bang-yellow": AlertTriangle,
};

export function CommandPalette() {
  const open = useWorkspace((s) => s.paletteOpen);
  const setOpen = useWorkspace((s) => s.setPaletteOpen);
  const setFolder = useWorkspace((s) => s.setSelectedFolder);
  const setComposerOpen = useWorkspace((s) => s.setComposerOpen);
  const openComposer = useWorkspace((s) => s.openComposer);
  const setSelectedEmail = useWorkspace((s) => s.setSelectedEmail);
  const openContactsPanel = useWorkspace((s) => s.openContactsPanel);
  const openCalendarPanel = useWorkspace((s) => s.openCalendarPanel);
  const openEventCreateModal = useWorkspace((s) => s.openEventCreateModal);
  const togglePin = useWorkspace((s) => s.togglePin);
  const toggleTheme = useWorkspace((s) => s.toggleTheme);
  const toggleThreadedView = useWorkspace((s) => s.toggleThreadedView);
  const setDensity = useWorkspace((s) => s.setDensity);
  const setActivePanel = useWorkspace((s) => s.setActivePanel);
  const openSettingsPanel = useWorkspace((s) => s.openSettingsPanel);

  const [query, setQuery] = React.useState("");
  const previousPanelId = useWorkspace((s) => s.previousPanelId);
  const selectedEmailId = useWorkspace((s) => s.selectedEmailId);

  // Workspace mutation actions
  const archive = useWorkspace((s) => s.archive);
  const trash = useWorkspace((s) => s.trash);
  const snooze = useWorkspace((s) => s.snooze);
  const setPinnedAction = useWorkspace((s) => s.setPinned);
  const setMuted = useWorkspace((s) => s.setMuted);
  const setFlag = useWorkspace((s) => s.setFlag);
  const clearFlag = useWorkspace((s) => s.clearFlag);
  const setPriority = useWorkspace((s) => s.setPriority);
  const clearPriority = useWorkspace((s) => s.clearPriority);
  const setStar = useWorkspace((s) => s.setStar);
  const clearStar = useWorkspace((s) => s.clearStar);
  const addLabel = useWorkspace((s) => s.addLabel);
  const removeLabel = useWorkspace((s) => s.removeLabel);
  const addTag = useWorkspace((s) => s.addTag);
  const removeTag = useWorkspace((s) => s.removeTag);
  const setStatus = useWorkspace((s) => s.setStatus);
  const clearStatus = useWorkspace((s) => s.clearStatus);
  const moveToFolder = useWorkspace((s) => s.moveToFolder);
  const setRead = useWorkspace((s) => s.setRead);

  // Workspace management
  const workspaces = useWorkspace((s) => s.workspaces);
  const activeWorkspaceId = useWorkspace((s) => s.activeWorkspaceId);
  const saveWorkspace = useWorkspace((s) => s.saveWorkspace);
  const switchWorkspace = useWorkspace((s) => s.switchWorkspace);

  // Restore focus on close
  const wasOpenRef = React.useRef(false);
  const restoreTargetRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      restoreTargetRef.current = previousPanelId;
    }
    if (!open && wasOpenRef.current) {
      setQuery("");
      const target = restoreTargetRef.current;
      if (target) {
        const el = document.querySelector<HTMLElement>(`[data-panel-id="${target}"]`);
        el?.focus();
      }
      restoreTargetRef.current = null;
    }
    wasOpenRef.current = open;
  }, [open, previousPanelId]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
      if (cmd && e.key === ",") {
        e.preventDefault();
        openSettingsPanel();
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const items: CmdItemDef[] = React.useMemo(() => {
    const mid = selectedEmailId;
    const msg = mid ? localStore.messages.get(mid) : null;
    const all: CmdItemDef[] = [];

    // ── Mail commands ──────────────────────────────────────────────
    all.push({
      id: "compose",
      label: "Compose new email",
      group: "Mail",
      icon: PenSquare,
      shortcut: "C",
      perform: () => { setComposerOpen(true); setActivePanel("composer"); },
    });
    all.push({
      id: "reply",
      label: "Reply",
      group: "Mail",
      icon: Reply,
      shortcut: "R",
      perform: () => msg ? openComposer({ mode: "reply", replyToMessage: msg }) : setComposerOpen(true),
    });
    all.push({
      id: "forward",
      label: "Forward",
      group: "Mail",
      icon: Forward,
      shortcut: "F",
      perform: () => msg ? openComposer({ mode: "forward", replyToMessage: msg }) : setComposerOpen(true),
    });

    // ── Message ops (require selected email) ───────────────────────
    if (mid) {
      all.push({
        id: "archive",
        label: "Archive selected",
        group: "Message",
        icon: Archive,
        shortcut: "E",
        perform: () => archive(mid),
      });
      all.push({
        id: "snooze",
        label: "Snooze selected",
        group: "Message",
        icon: AlarmClock,
        shortcut: "H",
        perform: () => snooze(mid, Date.now() + 24 * 60 * 60 * 1000),
      });
      all.push({
        id: "delete",
        label: "Delete selected",
        group: "Message",
        icon: Trash2,
        perform: () => trash(mid),
      });
      all.push({
        id: "mark-read",
        label: msg?.flags.read ? "Mark as unread" : "Mark as read",
        group: "Message",
        icon: Mail,
        shortcut: "U",
        perform: () => setRead(mid, !msg?.flags.read),
      });

      // PIN
      all.push({
        id: "pin",
        label: msg?.pinned ? "Unpin message" : "Pin message",
        group: "Message",
        icon: msg?.pinned ? PinOff : Pin,
        perform: () => setPinnedAction(mid, !msg?.pinned),
      });

      // MUTE
      all.push({
        id: "mute",
        label: msg?.muted ? "Unmute thread" : "Mute thread",
        group: "Message",
        icon: msg?.muted ? Bell : BellOff,
        perform: () => setMuted(mid, !msg?.muted),
      });

      // FLAG
      all.push({
        id: "flag",
        label: msg?.flag ? "Remove flag" : "Flag for follow-up",
        group: "Message",
        icon: msg?.flag ? FlagOff : Flag,
        perform: () => {
          if (msg?.flag) clearFlag(mid);
          else setFlag(mid, { setAt: Date.now() });
        },
      });
    }

    // ── Priority ────────────────────────────────────────────────────
    if (mid) {
      const pri: { label: string; val: 1 | 2 | 3 | 4; bang: string }[] = [
        { label: "Urgent", val: 1, bang: "!!!" },
        { label: "High", val: 2, bang: "!!" },
        { label: "Normal", val: 3, bang: "!" },
        { label: "Low", val: 4, bang: "" },
      ];
      for (const p of pri) {
        all.push({
          id: `set-priority-${p.val}`,
          label: `Set priority: ${p.label}${msg?.priority === p.val ? " (current)" : ""}`,
          group: "Priority",
          icon: Flag,
          perform: () => setPriority(mid, p.val),
        });
      }
      if (msg?.priority !== null) {
        all.push({
          id: "clear-priority",
          label: "Clear priority",
          group: "Priority",
          icon: FlagOff,
          perform: () => clearPriority(mid),
        });
      }
    }

    // ── Star ────────────────────────────────────────────────────────
    if (mid) {
      const starStyles: StarStyle[] = [
        "yellow", "red", "orange", "green", "blue", "purple",
        "check-green", "bang-red", "question-purple", "guillemet-orange",
        "info-blue", "bang-yellow",
      ];
      for (const style of starStyles) {
        const icon = STAR_ICONS[style] ?? Star;
        all.push({
          id: `set-star-${style}`,
          label: `Star: ${style.replace(/-/g, " ")}${msg?.star === style ? " (active)" : ""}`,
          group: "Star",
          icon,
          perform: () => {
            if (msg?.star === style) clearStar(mid);
            else setStar(mid, style);
          },
        });
      }
      if (msg?.star) {
        all.push({
          id: "clear-star",
          label: "Clear star",
          group: "Star",
          icon: Star,
          perform: () => clearStar(mid),
        });
      }
    }

    // ── Labels ──────────────────────────────────────────────────────
    if (mid && msg) {
      const userLabels = Array.from(localStore.labels.values()).filter((l) => l.kind === "user");
      for (const lbl of userLabels) {
        const has = msg.labelIds.includes(lbl.id);
        all.push({
          id: `label-${lbl.id}`,
          label: has ? `Remove label: ${lbl.name}` : `Add label: ${lbl.name}`,
          group: "Labels",
          icon: TagIcon,
          perform: () => {
            if (has) removeLabel(mid, lbl.id);
            else addLabel(mid, lbl.id);
          },
        });
      }
    }

    // ── Tags ────────────────────────────────────────────────────────
    if (mid && msg) {
      for (const tag of msg.tags) {
        all.push({
          id: `remove-tag-${tag}`,
          label: `Remove tag: #${tag}`,
          group: "Tags",
          icon: TagIcon,
          perform: () => removeTag(mid, tag),
        });
      }
      // "Add tag" opens inspector and focuses tag bar (future: inline text input in palette)
      all.push({
        id: "add-tag",
        label: "Add tag… (open inspector)",
        group: "Tags",
        icon: TagIcon,
        perform: () => setActivePanel("inspector"),
      });
    }

    // ── Status ──────────────────────────────────────────────────────
    if (mid) {
      for (const sta of localStore.statuses.values()) {
        all.push({
          id: `set-status-${sta.id}`,
          label: `Set status: ${sta.name}${msg?.statusId === sta.id ? " (current)" : ""}`,
          group: "Status",
          icon: CheckCircle2,
          perform: () => setStatus(mid, sta.id),
        });
      }
      if (msg?.statusId) {
        all.push({
          id: "clear-status",
          label: "Clear status",
          group: "Status",
          icon: CheckCircle2,
          perform: () => clearStatus(mid),
        });
      }
    }

    // ── Folders ─────────────────────────────────────────────────────
    if (mid) {
      for (const fld of localStore.folders.values()) {
        all.push({
          id: `move-${fld.id}`,
          label: `Move to: ${fld.name}`,
          group: "Folders",
          icon: Folder,
          perform: () => moveToFolder(mid, fld.id),
        });
      }
    }

    // ── Navigate ────────────────────────────────────────────────────
    all.push({ id: "go-inbox", label: "Go to Inbox", group: "Navigate", icon: Inbox, shortcut: "G I", perform: () => setFolder("inbox") });
    all.push({ id: "go-starred", label: "Go to Starred", group: "Navigate", icon: Star, shortcut: "G S", perform: () => setFolder("starred") });
    all.push({ id: "go-sent", label: "Go to Sent", group: "Navigate", icon: Send, shortcut: "G T", perform: () => setFolder("sent") });
    all.push({ id: "go-snoozed", label: "Go to Snoozed", group: "Navigate", icon: AlarmClock, perform: () => setFolder("snoozed") });
    all.push({ id: "go-archive", label: "Go to Archive", group: "Navigate", icon: Archive, perform: () => setFolder("archive") });

    // Navigate to user folders
    for (const fld of localStore.folders.values()) {
      all.push({
        id: `go-folder-${fld.id}`,
        label: `Go to folder: ${fld.name}`,
        group: "Navigate",
        icon: Folder,
        perform: () => setFolder(fld.id),
      });
    }

    // ── Workspace ───────────────────────────────────────────────────
    all.push({ id: "pin-inspector", label: "Pin / unpin Inspector", group: "Workspace", icon: Pin, shortcut: "P", perform: togglePin });
    all.push({ id: "theme", label: "Toggle theme", group: "Workspace", icon: Sun, shortcut: "⌘⇧L", perform: toggleTheme });
    all.push({ id: "threaded-view", label: "Toggle threaded / flat view", group: "Workspace", icon: MessagesSquare, perform: toggleThreadedView });
    all.push({ id: "density-compact", label: "Density: Compact", group: "Workspace", icon: Rows4, perform: () => setDensity("compact" as Density) });
    all.push({ id: "density-comfortable", label: "Density: Comfortable", group: "Workspace", icon: Rows3, perform: () => setDensity("comfortable" as Density) });
    all.push({ id: "density-cozy", label: "Density: Cozy", group: "Workspace", icon: Rows2, perform: () => setDensity("cozy" as Density) });
    all.push({ id: "settings", label: "Open Settings", group: "Workspace", icon: SettingsIcon, shortcut: "⌘,", perform: () => openSettingsPanel() });
    all.push({ id: "contacts", label: "Open Contacts", group: "Workspace", icon: Users, perform: () => openContactsPanel() });
    all.push({ id: "calendar", label: "Open Calendar", group: "Workspace", icon: CalendarIcon, perform: () => openCalendarPanel() });
    all.push({ id: "new-event", label: "New Calendar Event", group: "Workspace", icon: Plus, perform: () => openEventCreateModal() });

    // ── Workspaces ──────────────────────────────────────────────────
    all.push({
      id: "workspace-save",
      label: "Save workspace",
      group: "Workspaces",
      icon: SettingsIcon,
      shortcut: "⌘S",
      perform: saveWorkspace,
    });
    for (const ws of workspaces as WorkspaceSnapshot[]) {
      if (ws.id !== activeWorkspaceId) {
        all.push({
          id: `workspace-switch-${ws.id}`,
          label: `Switch to workspace: ${ws.name}`,
          group: "Workspaces",
          icon: LayoutPanelLeft,
          perform: () => switchWorkspace(ws.id),
        });
      }
    }

    // ── Panels ──────────────────────────────────────────────────────
    all.push({
      id: "panel-add-viewer",
      label: "Add message viewer panel",
      group: "Panels",
      icon: Columns2,
      perform: () => {
        const api = getDockviewApi();
        if (!api) return;
        api.addPanel({ id: newPanelId("viewer"), component: "viewer", title: "Message", initialWidth: 500 });
      },
    });
    all.push({
      id: "panel-add-list",
      label: "Add email list panel",
      group: "Panels",
      icon: LayoutPanelLeft,
      perform: () => {
        const api = getDockviewApi();
        if (!api) return;
        api.addPanel({ id: newPanelId("list"), component: "list", title: "Mail", initialWidth: 380 });
      },
    });
    all.push({
      id: "panel-restore-nav",
      label: "Restore navigation panel",
      group: "Panels",
      icon: LayoutPanelTop,
      perform: () => {
        const api = getDockviewApi();
        if (!api) return;
        if (api.getPanel("nav")) return; // already open
        api.addPanel({ id: "nav", component: "nav", title: "Navigation", initialWidth: 240 });
      },
    });
    all.push({
      id: "panel-restore-inspector",
      label: "Restore inspector panel",
      group: "Panels",
      icon: LayoutPanelTop,
      perform: () => {
        const api = getDockviewApi();
        if (!api) return;
        if (api.getPanel("inspector")) return;
        api.addPanel({ id: "inspector", component: "inspector", title: "Inspector", initialWidth: 320 });
      },
    });

    return all;
  }, [
    selectedEmailId,
    workspaces, activeWorkspaceId, saveWorkspace, switchWorkspace,
    setFolder, setComposerOpen, setActivePanel, togglePin, toggleTheme, toggleThreadedView, setDensity,
    archive, trash, snooze, setPinnedAction, setMuted, setFlag, clearFlag,
    setPriority, clearPriority, setStar, clearStar,
    addLabel, removeLabel, addTag, removeTag, setStatus, clearStatus, moveToFolder, setRead,
  ]);

  const grouped = React.useMemo(() => {
    const map: Record<string, CmdItemDef[]> = {};
    items.forEach((it) => { (map[it.group] ??= []).push(it); });
    return map;
  }, [items]);

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-canvas/60 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <RadixDialog.Content
          aria-label="Command palette"
          className={cn(
            "fixed left-1/2 top-[20vh] z-50 w-[640px] max-w-[92vw] -translate-x-1/2",
            "rounded-xl border border-border-default bg-surface-4 shadow-l3",
            "animate-cmdk-in",
          )}
        >
          <Command label="Command palette" loop>
            <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">
              Search for commands and navigation actions
            </RadixDialog.Description>
            <div className="flex items-center gap-2 border-b border-border-default px-3">
              <Search size={14} className="text-text-tertiary" />
              <Command.Input
                placeholder="Search mail, contacts, or type a command…"
                onValueChange={setQuery}
                className={cn(
                  "h-12 w-full bg-transparent font-sans text-body text-text-primary",
                  "placeholder:text-text-muted focus:outline-none",
                )}
              />
              <Kbd size="sm" className="ml-auto">Esc</Kbd>
            </div>
            <Command.List data-scroll className="nx-scroll max-h-[420px] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-small text-text-tertiary">
                No results
              </Command.Empty>

              {/* Live message search — shows when query ≥ 2 chars */}
              {query.trim().length >= 2 && (() => {
                const q = query.trim();
                const msgResults = queryMessages(
                  { textQuery: q, sortBy: "receivedAt", sortDir: "desc", limit: 8 },
                  localStore,
                ).items;
                const contactResults = Array.from(localStore.contacts.values())
                  .filter((c) =>
                    c.name.toLowerCase().includes(q.toLowerCase()) ||
                    c.emails.some((e) => e.toLowerCase().includes(q.toLowerCase()))
                  )
                  .slice(0, 4);

                return (
                  <>
                    {msgResults.length > 0 && (
                      <Command.Group
                        heading="Messages"
                        className={cn(
                          "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2",
                          "[&_[cmdk-group-heading]]:text-overline [&_[cmdk-group-heading]]:uppercase",
                          "[&_[cmdk-group-heading]]:text-text-tertiary",
                        )}
                      >
                        {msgResults.map((m) => (
                          <Command.Item
                            key={m.id}
                            value={`msg-${m.id}-${m.subject}-${m.fromAddr.name}`}
                            onSelect={() => {
                              setFolder(m.folderId);
                              setSelectedEmail(m.id);
                              setOpen(false);
                            }}
                            className={cn(
                              "flex h-10 cursor-default items-center gap-2 rounded-sm px-2",
                              "text-body text-text-primary",
                              "data-[selected=true]:bg-surface-3",
                              "transition-colors duration-fast",
                            )}
                          >
                            <Mail size={14} className="shrink-0 text-text-tertiary" />
                            <div className="min-w-0 flex-1">
                              <span className={cn(
                                "truncate font-sans",
                                m.flags.read ? "text-text-secondary" : "font-semibold text-text-primary",
                              )}>
                                {m.fromAddr.name}
                              </span>
                              <span className="ml-2 truncate text-small text-text-tertiary">
                                {m.subject}
                              </span>
                            </div>
                            <span className="shrink-0 font-mono text-mono-xs text-text-tertiary">
                              {formatRelativeTime(new Date(m.receivedAt))}
                            </span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {contactResults.length > 0 && (
                      <Command.Group
                        heading="Contacts"
                        className={cn(
                          "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2",
                          "[&_[cmdk-group-heading]]:text-overline [&_[cmdk-group-heading]]:uppercase",
                          "[&_[cmdk-group-heading]]:text-text-tertiary",
                        )}
                      >
                        {contactResults.map((c) => (
                          <Command.Item
                            key={c.id}
                            value={`contact-${c.id}-${c.name}-${c.emails[0] ?? ""}`}
                            onSelect={() => {
                              openContactsPanel(c.id);
                              setOpen(false);
                            }}
                            className={cn(
                              "flex h-9 cursor-default items-center gap-2 rounded-sm px-2",
                              "text-body text-text-primary",
                              "data-[selected=true]:bg-surface-3",
                              "transition-colors duration-fast",
                            )}
                          >
                            <User size={14} className="shrink-0 text-text-tertiary" />
                            <span className="flex-1 truncate">{c.name}</span>
                            <span className="shrink-0 font-mono text-mono-xs text-text-tertiary">
                              {c.emails[0] ?? ""}
                            </span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {(() => {
                      const eventResults = Array.from(localStore.calendarEvents.values())
                        .filter((e) => e.status !== "cancelled" && (
                          e.title.toLowerCase().includes(q.toLowerCase()) ||
                          (e.description ?? "").toLowerCase().includes(q.toLowerCase()) ||
                          (e.location ?? "").toLowerCase().includes(q.toLowerCase())
                        ))
                        .slice(0, 5);
                      if (!eventResults.length) return null;
                      return (
                        <Command.Group
                          heading="Events"
                          className={cn(
                            "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2",
                            "[&_[cmdk-group-heading]]:text-overline [&_[cmdk-group-heading]]:uppercase",
                            "[&_[cmdk-group-heading]]:text-text-tertiary",
                          )}
                        >
                          {eventResults.map((ev) => {
                            const evDate = new Date(ev.startTs).toLocaleDateString("default", {
                              month: "short", day: "numeric",
                            });
                            return (
                              <Command.Item
                                key={ev.id}
                                value={`event-${ev.id}-${ev.title}`}
                                onSelect={() => {
                                  openCalendarPanel();
                                  useWorkspace.getState().setCalendarFocusDate(new Date(ev.startTs).toISOString().slice(0, 10));
                                  setOpen(false);
                                }}
                                className={cn(
                                  "flex h-9 cursor-default items-center gap-2 rounded-sm px-2",
                                  "text-body text-text-primary",
                                  "data-[selected=true]:bg-surface-3",
                                  "transition-colors duration-fast",
                                )}
                              >
                                <CalendarIcon size={14} className="shrink-0 text-text-tertiary" />
                                <span className="flex-1 truncate">{ev.title}</span>
                                <span className="shrink-0 font-mono text-mono-xs text-text-tertiary">{evDate}</span>
                              </Command.Item>
                            );
                          })}
                        </Command.Group>
                      );
                    })()}
                  </>
                );
              })()}

              {/* Commands */}
              {Object.entries(grouped).map(([group, list]) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className={cn(
                    "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2",
                    "[&_[cmdk-group-heading]]:text-overline [&_[cmdk-group-heading]]:uppercase",
                    "[&_[cmdk-group-heading]]:text-text-tertiary",
                  )}
                >
                  {list.map((it) => (
                    <Command.Item
                      key={it.id}
                      value={`${it.group} ${it.label}`}
                      onSelect={() => { it.perform(); setOpen(false); }}
                      className={cn(
                        "flex h-9 cursor-default items-center gap-2 rounded-sm px-2",
                        "text-body text-text-primary",
                        "data-[selected=true]:bg-surface-3 data-[selected=true]:text-text-primary",
                        "transition-colors duration-fast",
                      )}
                    >
                      <it.icon size={14} className="text-text-tertiary" />
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.shortcut && (
                        <span className="font-mono text-mono-xs text-text-tertiary">{it.shortcut}</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            <div className="flex items-center justify-between border-t border-border-default px-3 py-2 text-overline uppercase text-text-tertiary">
              <span className="flex items-center gap-2">
                <Mail size={10} /> NEXUS Command Palette
              </span>
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <Kbd size="xs">↑↓</Kbd> navigate
                </span>
                <span className="flex items-center gap-1">
                  <Kbd size="xs">↵</Kbd> select
                </span>
              </span>
            </div>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
