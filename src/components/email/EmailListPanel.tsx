import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  Inbox,
  Layers,
  List,
  Trello,
  Table2,
  RefreshCw,
  Settings2,
  PanelRightClose,
  Search,
  X,
  Link,
  Unlink,
  Archive,
  Trash2,
  MailOpen,
  Mail,
  CheckCheck,
  Bookmark,
  Tag,
  MessagesSquare,
  ArrowDownUp,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelEmpty } from "@/components/panel/PanelEmpty";
import { FilterBar } from "@/components/filter/FilterBar";
import { KanbanView } from "@/components/views/KanbanView";
import { TableView } from "@/components/views/TableView";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { EmailRow } from "./EmailRow";
import { EmailRowContextMenu } from "./EmailRowContextMenu";
import { LabelPickerDialog } from "@/components/email/LabelPickerPopover";
import { FolderPickerDialog } from "@/components/email/FolderPickerDialog";
import { useWorkspace, getDockviewApi, newPanelId } from "@/state/workspace";
import { useVisibleMessagesForPanel, useSelectionTitle, useUserLabels } from "@/storage/useStore";
import { localStore } from "@/storage/local";
import { bodyStore } from "@/storage/bodyStore";
import { isTauri, getMessageBody } from "@/storage/tauri";
import * as Mut from "@/state/mutations";
import { cn } from "@/lib/utils";
import type { Density } from "@/design-system/tokens";
import type { Message, MetadataFilter, Status, Label } from "@/data/types";

const HEIGHT_BY_DENSITY: Record<Density, number> = {
  compact: 28,
  comfortable: 36,
  cozy: 48,
};

// Group header row height is always 28px
const GROUP_HEADER_HEIGHT = 28;

type SortBy = NonNullable<MetadataFilter["sortBy"]>;

const SORT_LABELS: Record<SortBy, string> = {
  receivedAt: "Newest",
  priority: "Priority",
  status: "Status",
  sender: "Sender",
};

// Virtual list items — either a message row or a group header
type VItem =
  | { kind: "row"; msg: Message }
  | { kind: "header"; label: string };

export function EmailListPanel({ panelId }: { panelId: string }) {
  const density = useWorkspace((s) => s.density);
  const cycleDensity = useWorkspace((s) => s.cycleDensity);
  const showSnippets = useWorkspace((s) => s.showSnippets);
  const selectedEmailIds = useWorkspace((s) => s.selectedEmailIds);
  const selectedEmailId = useWorkspace((s) => s.selectedEmailId);
  const focusedRowId = useWorkspace((s) => s.focusedRowId);
  const activePanelId = useWorkspace((s) => s.activePanelId);
  const setSelectedEmail = useWorkspace((s) => s.setSelectedEmail);
  const openComposer = useWorkspace((s) => s.openComposer);
  const toggleEmailSelection = useWorkspace((s) => s.toggleEmailSelection);
  const setSelectionRange = useWorkspace((s) => s.setSelectionRange);
  const setFocusedRow = useWorkspace((s) => s.setFocusedRow);
  const selectionAnchorId = useWorkspace((s) => s.selectionAnchorId);
  const setStarred = useWorkspace((s) => s.setStarred);
  const viewMode = useWorkspace((s) => s.viewMode);
  const setViewMode = useWorkspace((s) => s.setViewMode);
  const globalSetFilterAxis = useWorkspace((s) => s.setFilterAxis);
  const globalRemoveFilterAxis = useWorkspace((s) => s.removeFilterAxis);
  const globalActiveFilter = useWorkspace((s) => s.activeFilter);
  const panelLocalState = useWorkspace((s) => s.listPanelState[panelId] ?? null);
  const isDetached = panelLocalState !== null;
  const detachListPanel = useWorkspace((s) => s.detachListPanel);
  const attachListPanel = useWorkspace((s) => s.attachListPanel);
  const _setListPanelAxis = useWorkspace((s) => s.setListPanelAxis);
  const _removeListPanelAxis = useWorkspace((s) => s.removeListPanelAxis);
  const saveCurrentFilter = useWorkspace((s) => s.saveCurrentFilter);
  const threadedView = useWorkspace((s) => s.threadedView);
  const toggleThreadedView = useWorkspace((s) => s.toggleThreadedView);

  const [saveViewOpen, setSaveViewOpen] = React.useState(false);
  const [saveViewName, setSaveViewName] = React.useState("");
  const [labelPickerMsgId, setLabelPickerMsgId] = React.useState<string | null>(null);
  const [folderPickerMsgId, setFolderPickerMsgId] = React.useState<string | null>(null);

  const activeFilter = panelLocalState?.filter ?? globalActiveFilter;
  const setFilterAxis = React.useCallback(
    (axis: Partial<MetadataFilter>) =>
      isDetached ? _setListPanelAxis(panelId, axis) : globalSetFilterAxis(axis),
    [isDetached, panelId, _setListPanelAxis, globalSetFilterAxis],
  );
  const removeFilterAxis = React.useCallback(
    (key: keyof MetadataFilter) =>
      isDetached ? _removeListPanelAxis(panelId, key) : globalRemoveFilterAxis(key),
    [isDetached, panelId, _removeListPanelAxis, globalRemoveFilterAxis],
  );

  const [searchValue, setSearchValue] = React.useState(activeFilter.textQuery ?? "");
  const searchRef = React.useRef<HTMLInputElement>(null);

  // Sync search input when filter is cleared externally (e.g. via FilterBar pill removal)
  React.useEffect(() => {
    if (!activeFilter.textQuery && searchValue !== "") setSearchValue("");
  }, [activeFilter.textQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced FTS — 200ms after last keystroke
  React.useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = searchValue.trim();
      if (trimmed) {
        setFilterAxis({ textQuery: trimmed });
      } else {
        removeFilterAxis("textQuery");
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // "/" shortcut focuses search when panel has keyboard focus
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [sortBy, setSortBy] = React.useState<SortBy>("receivedAt");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [groupBySta, setGroupBySta] = React.useState(false);

  const title = useSelectionTitle();
  const allMessages = useVisibleMessagesForPanel(panelId, sortBy, sortDir);

  // Collapse to one row per threadId when threaded view is active
  const messages = React.useMemo(() => {
    if (!threadedView) return allMessages;
    const seen = new Set<string>();
    return allMessages.filter((msg) => {
      if (seen.has(msg.threadId)) return false;
      seen.add(msg.threadId);
      return true;
    });
  }, [allMessages, threadedView]);

  // Resolve label/status for each message (looked up from localStore at render time)
  const resolvedLabels = React.useMemo((): Map<string, Label[]> => {
    const m = new Map<string, Label[]>();
    for (const msg of messages) {
      const lbls: Label[] = [];
      for (const lid of msg.labelIds) {
        const l = localStore.labels.get(lid);
        if (l && l.kind === "user") lbls.push(l);
      }
      m.set(msg.id, lbls);
    }
    return m;
  }, [messages]);

  const resolvedStatuses = React.useMemo((): Map<string, Status | null> => {
    const m = new Map<string, Status | null>();
    for (const msg of messages) {
      m.set(msg.id, msg.statusId ? (localStore.statuses.get(msg.statusId) ?? null) : null);
    }
    return m;
  }, [messages]);

  // Build virtual item list
  const vItems = React.useMemo((): VItem[] => {
    if (!groupBySta) {
      return messages.map((msg) => ({ kind: "row" as const, msg }));
    }
    // Group by status: sort by statusId, add group headers
    const groups = new Map<string | null, Message[]>();
    for (const msg of messages) {
      const key = msg.statusId ?? null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(msg);
    }
    const items: VItem[] = [];
    // No-status group first, then ordered by statusId
    const noStatus = groups.get(null);
    if (noStatus?.length) {
      items.push({ kind: "header", label: "No Status" });
      for (const msg of noStatus) items.push({ kind: "row", msg });
    }
    for (const [statusId, msgs] of groups) {
      if (statusId === null) continue;
      const status = localStore.statuses.get(statusId);
      items.push({ kind: "header", label: status?.name ?? statusId });
      for (const msg of msgs) items.push({ kind: "row", msg });
    }
    return items;
  }, [messages, groupBySta]);

  const msgList = vItems.filter((v): v is { kind: "row"; msg: Message } => v.kind === "row").map((v) => v.msg);

  const parentRef = React.useRef<HTMLDivElement>(null);
  const rowSize = HEIGHT_BY_DENSITY[density];

  const virtualizer = useVirtualizer({
    count: vItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => vItems[i]?.kind === "header" ? GROUP_HEADER_HEIGHT : rowSize,
    overscan: 8,
    getItemKey: (i) => {
      const item = vItems[i];
      return item?.kind === "row" ? item.msg.id : `header-${i}`;
    },
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // Preload bodies for the first 30 visible messages so clicking them is instant.
  // Each fetch is fire-and-forget; bodyStore.get() guards against redundant calls.
  React.useEffect(() => {
    if (!isTauri()) return;
    const toPreload = messages.slice(0, 30).filter((m) => !bodyStore.get(m.bodyRef));
    if (toPreload.length === 0) return;
    for (const msg of toPreload) {
      getMessageBody(msg.bodyRef)
        .then((html) => { if (html) bodyStore.set(msg.bodyRef, html); })
        .catch(() => {});
    }
  }, [messages]);

  const isPanelFocused = activePanelId === panelId;

  // Opens an email, auto-spawning a new viewer to the right of this list panel
  // when every existing viewer panel is pinned to a specific message.
  const openEmail = React.useCallback((emailId: string) => {
    const api = getDockviewApi();
    if (api) {
      const viewerPinState = useWorkspace.getState().viewerPinState;
      const viewerPanels = api.panels.filter((p) => p.id.startsWith("viewer"));
      const allPinned =
        viewerPanels.length > 0 &&
        viewerPanels.every((p) => !!viewerPinState[p.id]);
      if (allPinned) {
        api.addPanel({
          id: newPanelId("viewer"),
          component: "viewer",
          title: "Message",
          initialWidth: 400,
          minimumWidth: 300,
          position: { direction: "right", referencePanel: panelId },
        });
      }
    }
    setSelectedEmail(emailId);
  }, [panelId, setSelectedEmail]);

  // Keyboard navigation + actions
  React.useEffect(() => {
    if (!isPanelFocused) return;
    function onKey(e: KeyboardEvent) {
      if (
        document.activeElement &&
        ["INPUT", "TEXTAREA"].includes((document.activeElement as HTMLElement).tagName)
      ) {
        return;
      }

      const activeId = focusedRowId ?? selectedEmailId;
      const idx = msgList.findIndex((m) => m.id === activeId);
      const activeMsg = activeId ? localStore.messages.get(activeId) : null;

      function scrollToMsg(id: string) {
        // Only scroll the list virtualizer; TableView handles its own reactive scroll
        if (viewMode !== "list") return;
        const vIdx = vItems.findIndex((v) => v.kind === "row" && v.msg.id === id);
        if (vIdx >= 0) virtualizer.scrollToIndex(vIdx, { align: "auto" });
      }

      function advanceAfterAction() {
        // After archive/delete, move focus to next message (or prev if at end)
        const next = msgList[Math.min(msgList.length - 1, Math.max(0, idx + 1))];
        const target = next && next.id !== activeId ? next : msgList[Math.max(0, idx - 1)];
        if (target) {
          openEmail(target.id);
          scrollToMsg(target.id);
        }
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = msgList[Math.min(msgList.length - 1, Math.max(0, idx + 1))];
        if (next) { openEmail(next.id); scrollToMsg(next.id); }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = msgList[Math.max(0, (idx === -1 ? 0 : idx) - 1)];
        if (prev) { openEmail(prev.id); scrollToMsg(prev.id); }
      } else if (e.key === "Enter" || e.key === " ") {
        if (activeId) { e.preventDefault(); openEmail(activeId); }

      // ── Action shortcuts ─────────────────────────────────────────
      } else if (e.key === "e" && !e.metaKey && !e.ctrlKey) {
        if (!activeMsg) return;
        e.preventDefault();
        Mut.archiveMessage(localStore, activeMsg.id);
        advanceAfterAction();
      } else if (e.key === "#" || (e.key === "Delete" && !e.metaKey)) {
        if (!activeMsg) return;
        e.preventDefault();
        Mut.deleteMessage(localStore, activeMsg.id);
        advanceAfterAction();
      } else if (e.key === "u" && !e.metaKey && !e.ctrlKey) {
        if (!activeMsg) return;
        e.preventDefault();
        if (activeMsg.flags.read) Mut.unreadMessage(localStore, activeMsg.id);
        else Mut.readMessage(localStore, activeMsg.id);
      } else if (e.key === "s" && !e.metaKey && !e.ctrlKey) {
        if (!activeMsg) return;
        e.preventDefault();
        if (activeMsg.star) Mut.clearStar(localStore, activeMsg.id);
        else Mut.setStar(localStore, activeMsg.id, "yellow");
      } else if ((e.key === "l" || e.key === "L") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (activeId) setLabelPickerMsgId(activeId);
      } else if ((e.key === "v" || e.key === "V") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (activeId) setFolderPickerMsgId(activeId);
        return;
      } else if (e.key === "r" && !e.metaKey && !e.ctrlKey) {
        if (!activeMsg) return;
        e.preventDefault();
        openComposer({ mode: "reply", replyToMessage: activeMsg });
      } else if (e.key === "f" && !e.metaKey && !e.ctrlKey) {
        if (!activeMsg) return;
        e.preventDefault();
        openComposer({ mode: "forward", replyToMessage: activeMsg });
      } else if (e.key === "h" && !e.metaKey && !e.ctrlKey) {
        if (!activeMsg) return;
        e.preventDefault();
        // Snooze: tomorrow 08:00 — quick one-key default
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(8, 0, 0, 0);
        Mut.snoozeMessage(localStore, activeMsg.id, tomorrow.getTime());
        advanceAfterAction();
      } else if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        openComposer();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPanelFocused, viewMode, msgList, vItems, focusedRowId, selectedEmailId, setFocusedRow, openEmail, openComposer]);

  function handleRowClick(emailId: string, e: React.MouseEvent) {
    if (e.shiftKey && selectionAnchorId) {
      const ai = msgList.findIndex((m) => m.id === selectionAnchorId);
      const bi = msgList.findIndex((m) => m.id === emailId);
      if (ai !== -1 && bi !== -1) {
        const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
        const range = msgList.slice(lo, hi + 1).map((m) => m.id);
        setSelectionRange(range);
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      toggleEmailSelection(emailId);
      return;
    }
    openEmail(emailId);
  }

  const header = (
    <PanelHeader
      title={title}
      meta={`${msgList.length}${selectedEmailIds.size > 1 ? ` · ${selectedEmailIds.size} selected` : ""}`}
      actions={
        <>
          {/* View mode switcher */}
          <div className="flex items-center rounded-xs border border-border-subtle bg-surface-2 p-0.5">
            <Tooltip label="List view">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-pressed={viewMode === "list"}
                className={cn(
                  "flex size-5 items-center justify-center rounded-xs transition-colors",
                  viewMode === "list" ? "bg-surface-3 text-text-primary" : "text-text-tertiary hover:text-text-secondary",
                )}
              >
                <List size={11} />
              </button>
            </Tooltip>
            <Tooltip label="Kanban view">
              <button
                type="button"
                onClick={() => setViewMode("kanban")}
                aria-pressed={viewMode === "kanban"}
                className={cn(
                  "flex size-5 items-center justify-center rounded-xs transition-colors",
                  viewMode === "kanban" ? "bg-surface-3 text-text-primary" : "text-text-tertiary hover:text-text-secondary",
                )}
              >
                <Trello size={11} />
              </button>
            </Tooltip>
            <Tooltip label="Table view">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                aria-pressed={viewMode === "table"}
                className={cn(
                  "flex size-5 items-center justify-center rounded-xs transition-colors",
                  viewMode === "table" ? "bg-surface-3 text-text-primary" : "text-text-tertiary hover:text-text-secondary",
                )}
              >
                <Table2 size={11} />
              </button>
            </Tooltip>
          </div>

          {/* Save current filter as a view */}
          <Popover.Root open={saveViewOpen} onOpenChange={(v) => { setSaveViewOpen(v); if (v) setSaveViewName(title); }}>
            <Popover.Trigger asChild>
              <span>
                <Tooltip label="Save current filter as a view">
                  <Button variant="ghost" size="sm" iconOnly aria-label="Save view">
                    <Bookmark />
                  </Button>
                </Tooltip>
              </span>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                sideOffset={6}
                align="end"
                className={cn(
                  "z-50 w-64 rounded-md border border-border-subtle bg-surface-2 p-3 shadow-lg",
                  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
                  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
                )}
              >
                <p className="mb-2 text-caption text-text-tertiary">Save current filter as a view</p>
                <input
                  autoFocus
                  value={saveViewName}
                  onChange={(e) => setSaveViewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const name = saveViewName.trim();
                      if (name) { saveCurrentFilter(name); setSaveViewOpen(false); }
                    } else if (e.key === "Escape") {
                      setSaveViewOpen(false);
                    }
                  }}
                  placeholder="View name…"
                  className="mb-2 w-full rounded-xs border border-border-default bg-canvas px-2 py-1.5 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setSaveViewOpen(false)}>Cancel</Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      const name = saveViewName.trim();
                      if (name) { saveCurrentFilter(name); setSaveViewOpen(false); }
                    }}
                  >
                    Save view
                  </Button>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <Tooltip label={`Density: ${density}`} shortcut="D">
            <Button variant="ghost" size="sm" iconOnly aria-label="Cycle density" onClick={cycleDensity}>
              <Settings2 />
            </Button>
          </Tooltip>
          <Tooltip label="Refresh" shortcut="⌘R">
            <Button variant="ghost" size="sm" iconOnly aria-label="Refresh">
              <RefreshCw />
            </Button>
          </Tooltip>
          <Tooltip label="Collapse panel">
            <Button variant="ghost" size="sm" iconOnly aria-label="Collapse">
              <PanelRightClose />
            </Button>
          </Tooltip>
          <Tooltip label={isDetached ? "Re-attach to navigation" : "Detach — independent filter"}>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={isDetached ? "Attach list panel" : "Detach list panel"}
              className={isDetached ? "text-accent" : ""}
              onClick={() => isDetached ? attachListPanel(panelId) : detachListPanel(panelId)}
            >
              {isDetached ? <Unlink size={11} /> : <Link size={11} />}
            </Button>
          </Tooltip>
        </>
      }
    />
  );

  const searchBar = (
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-1 px-2">
      <Search size={12} className="shrink-0 text-text-tertiary" />
      <input
        ref={searchRef}
        type="search"
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        placeholder="Search subject, body, notes… (/)"
        aria-label="Search messages"
        className={cn(
          "min-w-0 flex-1 bg-transparent font-mono text-mono-sm text-text-primary outline-none",
          "placeholder:text-text-tertiary",
        )}
        onKeyDown={(e) => { if (e.key === "Escape") { setSearchValue(""); searchRef.current?.blur(); } }}
      />
      {searchValue && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => { setSearchValue(""); searchRef.current?.focus(); }}
          className="shrink-0 rounded-xs p-0.5 text-text-tertiary hover:text-text-primary"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );

  // Non-list views bypass the virtualizer entirely
  if (viewMode === "kanban") {
    return (
      <Panel panelId={panelId} type="stage" header={header}>
        {searchBar}
        <FilterBar />
        <KanbanView />
      </Panel>
    );
  }

  if (viewMode === "table") {
    return (
      <Panel panelId={panelId} type="stage" header={header}>
        {searchBar}
        <FilterBar />
        <TableView />
      </Panel>
    );
  }

  if (msgList.length === 0) {
    return (
      <Panel panelId={panelId} type="stage" header={header}>
        {searchBar}
        <FilterBar />
        <PanelEmpty
          icon={Inbox}
          title="No messages match"
          body="Try a different search or clear the filters."
          action={<Button variant="secondary" size="md" onClick={() => { setSearchValue(""); removeFilterAxis("textQuery"); }}>Clear search</Button>}
        />
      </Panel>
    );
  }

  return (
    <Panel panelId={panelId} type="stage" header={header}>
      {/* Search bar (EP-3 FTS) */}
      {searchBar}
      {/* Filter pills bar */}
      <FilterBar />

      {/* Sub-toolbar: sort + group-by */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-1 px-2">
        {/* Sort picker */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className={cn(
                "flex h-6 items-center gap-1 rounded-xs px-1.5 text-caption text-text-tertiary",
                "hover:bg-surface-2 hover:text-text-secondary",
              )}
            >
              Sort: {SORT_LABELS[sortBy]}
              <ChevronDown size={10} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={cn(
                "z-50 min-w-[140px] overflow-hidden rounded-md border border-border-subtle",
                "bg-surface-2 p-1 shadow-lg",
                "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
                "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
              )}
              sideOffset={4}
              align="start"
            >
              {(Object.keys(SORT_LABELS) as SortBy[]).map((key) => (
                <DropdownMenu.Item
                  key={key}
                  onSelect={() => setSortBy(key)}
                  className={cn(
                    "flex h-7 cursor-pointer items-center rounded-xs px-2 text-body outline-none",
                    "text-text-secondary focus:bg-surface-3 focus:text-text-primary",
                    key === sortBy && "text-text-primary",
                  )}
                >
                  {SORT_LABELS[key]}
                  {key === sortBy && <span className="ml-auto font-mono text-mono-xs text-text-tertiary">✓</span>}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Sort direction toggle — only shown for receivedAt (time-based sorts) */}
        {sortBy === "receivedAt" && (
          <Tooltip label={sortDir === "desc" ? "Showing newest first" : "Showing oldest first"}>
            <button
              type="button"
              onClick={() => setSortDir((d) => d === "desc" ? "asc" : "desc")}
              className={cn(
                "flex h-6 items-center gap-1 rounded-xs px-1.5 text-caption",
                "hover:bg-surface-2 hover:text-text-secondary",
                sortDir === "asc" ? "text-text-secondary" : "text-text-tertiary",
              )}
            >
              <ArrowDownUp size={10} />
              {sortDir === "desc" ? "Newest" : "Oldest"}
            </button>
          </Tooltip>
        )}

        <span className="text-caption text-text-muted">·</span>

        {/* Group-by STA toggle */}
        <Tooltip label={groupBySta ? "Ungroup" : "Group by status"}>
          <button
            type="button"
            onClick={() => setGroupBySta((v) => !v)}
            className={cn(
              "flex h-6 items-center gap-1 rounded-xs px-1.5 text-caption",
              "transition-colors hover:bg-surface-2",
              groupBySta
                ? "bg-accent-soft text-text-primary"
                : "text-text-tertiary hover:text-text-secondary",
            )}
            aria-pressed={groupBySta}
          >
            <Layers size={11} />
            {groupBySta ? "Grouped" : "Group by Status"}
          </button>
        </Tooltip>

        {/* Threaded view toggle */}
        <Tooltip label={threadedView ? "Showing conversations — click for flat view" : "Showing all messages — click for conversation view"}>
          <button
            type="button"
            onClick={toggleThreadedView}
            className={cn(
              "flex h-6 items-center gap-1 rounded-xs px-1.5 text-caption",
              "transition-colors hover:bg-surface-2",
              threadedView
                ? "bg-accent-soft text-text-primary"
                : "text-text-tertiary hover:text-text-secondary",
            )}
            aria-pressed={threadedView}
          >
            <MessagesSquare size={11} />
            {threadedView ? "Threaded" : "Flat"}
          </button>
        </Tooltip>

        {/* Mark all as read */}
        {msgList.some((m) => !m.flags.read) && (
          <Tooltip label={`Mark all ${msgList.filter((m) => !m.flags.read).length} as read`}>
            <button
              type="button"
              onClick={() => {
                for (const msg of msgList) {
                  if (!msg.flags.read) Mut.readMessage(localStore, msg.id);
                }
              }}
              className="ml-auto flex h-6 items-center gap-1 rounded-xs px-1.5 text-caption text-text-tertiary hover:bg-surface-2 hover:text-text-secondary"
            >
              <CheckCheck size={11} />
              Mark all read
            </button>
          </Tooltip>
        )}
      </div>

      {/* Virtualized list */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={parentRef}
          data-scroll
          role="grid"
          aria-multiselectable
          aria-label="Email list"
          className="nx-scroll h-full overflow-auto outline-none"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const item = vItems[vi.index];
              if (!item) return null;

              if (item.kind === "header") {
                return (
                  <div
                    key={`h-${vi.index}`}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      minHeight: GROUP_HEADER_HEIGHT,
                      transform: `translateY(${vi.start}px)`,
                    }}
                    className="flex items-center border-b border-border-subtle bg-surface-1 px-4"
                  >
                    <span className="text-overline uppercase text-text-tertiary">
                      {item.label}
                    </span>
                  </div>
                );
              }

              const { msg } = item;
              const isSelected = selectedEmailIds.has(msg.id);
              const isSinglySelected = selectedEmailId === msg.id;
              const isFocused = focusedRowId === msg.id;
              const msgLabels = resolvedLabels.get(msg.id) ?? [];
              const msgStatus = resolvedStatuses.get(msg.id) ?? null;

              return (
                <div
                  key={msg.id}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <EmailRowContextMenu
                    message={msg}
                    onArchive={() => {
                      Mut.archiveMessage(localStore, msg.id);
                      const i = msgList.findIndex((m) => m.id === msg.id);
                      const next = msgList[i + 1] ?? msgList[i - 1];
                      if (next) openEmail(next.id);
                    }}
                    onDelete={() => {
                      Mut.deleteMessage(localStore, msg.id);
                      const i = msgList.findIndex((m) => m.id === msg.id);
                      const next = msgList[i + 1] ?? msgList[i - 1];
                      if (next) openEmail(next.id);
                    }}
                  >
                    <EmailRow
                      message={msg}
                      density={density}
                      showSnippets={showSnippets}
                      selected={isSelected || isSinglySelected}
                      focused={isFocused}
                      ghosted={!isPanelFocused}
                      inSelectionSet={isSelected}
                      labels={msgLabels}
                      status={msgStatus}
                      threadCount={localStore.messagesByThread.get(msg.threadId)?.size}
                      onFocus={() => setFocusedRow(msg.id)}
                      onSelect={(e) => handleRowClick(msg.id, e)}
                      onToggleStar={() => setStarred(msg.id, !msg.star)}
                      onToggleCheck={(c) => {
                        if (c && !isSelected) toggleEmailSelection(msg.id);
                        if (!c && isSelected) toggleEmailSelection(msg.id);
                      }}
                      onMoveToFolder={() => setFolderPickerMsgId(msg.id)}
                    />
                  </EmailRowContextMenu>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bulk action bar — floats above the list when ≥2 emails are checked */}
        {selectedEmailIds.size > 1 && (
          <BulkActionBar
            selectedIds={selectedEmailIds}
            onClear={() => useWorkspace.getState().clearSelection()}
          />
        )}
      </div>

      {/* Label picker dialog — opened via L key shortcut */}
      <LabelPickerDialog
        messageId={labelPickerMsgId}
        open={!!labelPickerMsgId}
        onClose={() => setLabelPickerMsgId(null)}
      />
      {/* Folder picker dialog — opened via V key shortcut */}
      <FolderPickerDialog
        messageId={folderPickerMsgId}
        open={!!folderPickerMsgId}
        onClose={() => setFolderPickerMsgId(null)}
      />
    </Panel>
  );
}

// ─── Bulk label picker ────────────────────────────────────────────────────────

function BulkLabelPicker({ selectedIds }: { selectedIds: Set<string> }) {
  const [open, setOpen] = React.useState(false);
  const labels = useUserLabels();

  if (labels.length === 0) return null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Tooltip label="Apply label to all">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-xs px-2 py-1 text-caption text-text-secondary hover:bg-surface-4 hover:text-text-primary"
          >
            <Tag size={13} />
            Label
          </button>
        </Tooltip>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="center"
          side="top"
          className="z-50 w-52 overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          {labels.map((lbl) => (
            <button
              key={lbl.id}
              type="button"
              onClick={() => {
                for (const id of selectedIds) {
                  Mut.addLabel(localStore, id, lbl.id);
                }
                setOpen(false);
              }}
              className="flex h-8 w-full items-center gap-2 rounded-xs px-2 text-body text-text-secondary hover:bg-surface-3 hover:text-text-primary"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--color-link-${lbl.color})` }}
              />
              <span className="flex-1 text-left">{lbl.name}</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────

function BulkActionBar({
  selectedIds,
  onClear,
}: {
  selectedIds: Set<string>;
  onClear: () => void;
}) {
  const count = selectedIds.size;

  function archiveAll() {
    for (const id of selectedIds) Mut.archiveMessage(localStore, id);
    onClear();
  }

  function deleteAll() {
    for (const id of selectedIds) Mut.deleteMessage(localStore, id);
    onClear();
  }

  function markReadAll() {
    for (const id of selectedIds) {
      const msg = localStore.messages.get(id);
      if (msg && !msg.flags.read) Mut.readMessage(localStore, id);
    }
  }

  function markUnreadAll() {
    for (const id of selectedIds) {
      const msg = localStore.messages.get(id);
      if (msg && msg.flags.read) Mut.unreadMessage(localStore, id);
    }
  }

  return (
    <div
      className={cn(
        "absolute bottom-4 left-1/2 -translate-x-1/2",
        "flex items-center gap-1 rounded-lg border border-border-default",
        "bg-surface-3 px-2 py-1.5 shadow-l4 backdrop-blur-sm",
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-150",
      )}
    >
      <span className="px-2 font-mono text-mono-sm text-text-secondary">
        {count} selected
      </span>
      <span className="h-4 w-px bg-border-subtle" />

      <Tooltip label="Archive all (E)">
        <button
          type="button"
          onClick={archiveAll}
          className="flex items-center gap-1.5 rounded-xs px-2 py-1 text-caption text-text-secondary hover:bg-surface-4 hover:text-text-primary"
        >
          <Archive size={13} />
          Archive
        </button>
      </Tooltip>

      <Tooltip label="Delete all (#)">
        <button
          type="button"
          onClick={deleteAll}
          className="flex items-center gap-1.5 rounded-xs px-2 py-1 text-caption text-text-secondary hover:bg-surface-4 hover:text-error"
        >
          <Trash2 size={13} />
          Delete
        </button>
      </Tooltip>

      <BulkLabelPicker selectedIds={selectedIds} />

      <span className="h-4 w-px bg-border-subtle" />

      <Tooltip label="Mark all as read">
        <button
          type="button"
          onClick={markReadAll}
          className="flex items-center gap-1.5 rounded-xs px-2 py-1 text-caption text-text-secondary hover:bg-surface-4 hover:text-text-primary"
        >
          <MailOpen size={13} />
          Read
        </button>
      </Tooltip>

      <Tooltip label="Mark all as unread">
        <button
          type="button"
          onClick={markUnreadAll}
          className="flex items-center gap-1.5 rounded-xs px-2 py-1 text-caption text-text-secondary hover:bg-surface-4 hover:text-text-primary"
        >
          <Mail size={13} />
          Unread
        </button>
      </Tooltip>

      <span className="h-4 w-px bg-border-subtle" />

      <Tooltip label="Clear selection (Esc)">
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 rounded-xs px-2 py-1 text-caption text-text-tertiary hover:bg-surface-4 hover:text-text-primary"
        >
          <X size={12} />
        </button>
      </Tooltip>
    </div>
  );
}
