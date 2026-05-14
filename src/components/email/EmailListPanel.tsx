import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  Inbox,
  Layers,
  RefreshCw,
  Settings2,
  ListFilter,
  PanelRightClose,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelEmpty } from "@/components/panel/PanelEmpty";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { EmailRow } from "./EmailRow";
import { useWorkspace } from "@/state/workspace";
import { useVisibleMessages, useSelectionTitle } from "@/storage/useStore";
import { localStore } from "@/storage/local";
import { cn } from "@/lib/utils";
import type { Density } from "@/design-system/tokens";
import type { Message, MetadataFilter, Status, Label } from "@/data/types";

const HEIGHT_BY_DENSITY: Record<Density, number> = {
  compact: 28,
  comfortable: 36,
  cozy: 48,
};

const PANEL_ID = "list";

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

export function EmailListPanel() {
  const density = useWorkspace((s) => s.density);
  const cycleDensity = useWorkspace((s) => s.cycleDensity);
  const selectedEmailIds = useWorkspace((s) => s.selectedEmailIds);
  const selectedEmailId = useWorkspace((s) => s.selectedEmailId);
  const focusedRowId = useWorkspace((s) => s.focusedRowId);
  const activePanelId = useWorkspace((s) => s.activePanelId);
  const setSelectedEmail = useWorkspace((s) => s.setSelectedEmail);
  const toggleEmailSelection = useWorkspace((s) => s.toggleEmailSelection);
  const setSelectionRange = useWorkspace((s) => s.setSelectionRange);
  const setFocusedRow = useWorkspace((s) => s.setFocusedRow);
  const selectionAnchorId = useWorkspace((s) => s.selectionAnchorId);
  const setStarred = useWorkspace((s) => s.setStarred);

  const [sortBy, setSortBy] = React.useState<SortBy>("receivedAt");
  const [groupBySta, setGroupBySta] = React.useState(false);

  const title = useSelectionTitle();
  const messages = useVisibleMessages(sortBy);

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
  });

  const isPanelFocused = activePanelId === PANEL_ID;

  // Keyboard navigation
  React.useEffect(() => {
    if (!isPanelFocused) return;
    function onKey(e: KeyboardEvent) {
      if (
        document.activeElement &&
        ["INPUT", "TEXTAREA"].includes((document.activeElement as HTMLElement).tagName)
      ) {
        return;
      }
      const idx = msgList.findIndex((m) => m.id === focusedRowId);
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = msgList[Math.min(msgList.length - 1, Math.max(0, idx + 1))];
        if (next) {
          setFocusedRow(next.id);
          const vIdx = vItems.findIndex((v) => v.kind === "row" && v.msg.id === next.id);
          if (vIdx >= 0) virtualizer.scrollToIndex(vIdx, { align: "auto" });
        }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = msgList[Math.max(0, (idx === -1 ? 0 : idx) - 1)];
        if (prev) {
          setFocusedRow(prev.id);
          const vIdx = vItems.findIndex((v) => v.kind === "row" && v.msg.id === prev.id);
          if (vIdx >= 0) virtualizer.scrollToIndex(vIdx, { align: "auto" });
        }
      } else if (e.key === "Enter" || e.key === " ") {
        if (focusedRowId) {
          e.preventDefault();
          setSelectedEmail(focusedRowId);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPanelFocused, msgList, vItems, focusedRowId, setFocusedRow, setSelectedEmail]);

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
    setSelectedEmail(emailId);
  }

  const header = (
    <PanelHeader
      title={title}
      meta={`${msgList.length}${selectedEmailIds.size > 1 ? ` · ${selectedEmailIds.size} selected` : ""}`}
      actions={
        <>
          <Tooltip label={`Density: ${density}`} shortcut="D">
            <Button variant="ghost" size="sm" iconOnly aria-label="Cycle density" onClick={cycleDensity}>
              <Settings2 />
            </Button>
          </Tooltip>
          <Tooltip label="Filter">
            <Button variant="ghost" size="sm" iconOnly aria-label="Filter">
              <ListFilter />
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
        </>
      }
    />
  );

  if (msgList.length === 0) {
    return (
      <Panel panelId={PANEL_ID} type="stage" header={header}>
        <PanelEmpty
          icon={Inbox}
          title="No emails in this view"
          body="Try clearing filters or selecting a different folder."
          action={<Button variant="secondary" size="md">Clear filters</Button>}
        />
      </Panel>
    );
  }

  return (
    <Panel panelId={PANEL_ID} type="stage" header={header}>
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
      </div>

      {/* Virtualized list */}
      <div
        ref={parentRef}
        data-scroll
        role="grid"
        aria-multiselectable
        aria-label="Email list"
        className="nx-scroll relative h-full overflow-auto outline-none"
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
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: vi.size,
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
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <EmailRow
                  message={msg}
                  density={density}
                  selected={isSelected || isSinglySelected}
                  focused={isFocused}
                  ghosted={!isPanelFocused}
                  inSelectionSet={isSelected}
                  labels={msgLabels}
                  status={msgStatus}
                  onFocus={() => setFocusedRow(msg.id)}
                  onSelect={(e) => handleRowClick(msg.id, e)}
                  onToggleStar={() => setStarred(msg.id, !msg.star)}
                  onToggleCheck={(c) => {
                    if (c && !isSelected) toggleEmailSelection(msg.id);
                    if (!c && isSelected) toggleEmailSelection(msg.id);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
