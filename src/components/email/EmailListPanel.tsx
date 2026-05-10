import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  Inbox,
  ListFilter,
  RefreshCw,
  Settings2,
  PanelRightClose,
} from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelEmpty } from "@/components/panel/PanelEmpty";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { EmailRow } from "./EmailRow";
import { EmailRowMobile, EMAIL_ROW_MOBILE_HEIGHT } from "./EmailRowMobile";
import { useWorkspace, useVisibleEmails } from "@/state/workspace";
import { folders } from "@/data/fixtures";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/lib/useMediaQuery";
import type { Density } from "@/design-system/tokens";

const HEIGHT_BY_DENSITY: Record<Density, number> = {
  compact: 28,
  comfortable: 36,
  cozy: 48,
};

const DENSITY_LABEL: Record<Density, string> = {
  compact: "Compact",
  comfortable: "Comfortable",
  cozy: "Cozy",
};

const PANEL_ID = "list";

export function EmailListPanel() {
  const density = useWorkspace((s) => s.density);
  const cycleDensity = useWorkspace((s) => s.cycleDensity);
  const folderId = useWorkspace((s) => s.selectedFolderId);
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
  const setMobileView = useWorkspace((s) => s.setMobileView);
  const isMobile = useIsMobile();

  const folder = folders.find((f) => f.id === folderId);
  const list = useVisibleEmails(folderId);

  const parentRef = React.useRef<HTMLDivElement>(null);
  const rowSize = isMobile ? EMAIL_ROW_MOBILE_HEIGHT : HEIGHT_BY_DENSITY[density];

  const virtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowSize,
    overscan: 8,
    getItemKey: (i) => list[i]?.id ?? i,
  });

  const isPanelFocused = activePanelId === PANEL_ID;

  // Keyboard navigation (j/k, Space, Esc) when panel is focused
  React.useEffect(() => {
    if (!isPanelFocused) return;
    function onKey(e: KeyboardEvent) {
      if (
        document.activeElement &&
        ["INPUT", "TEXTAREA"].includes(
          (document.activeElement as HTMLElement).tagName,
        )
      ) {
        return;
      }
      const idx = list.findIndex((m) => m.id === focusedRowId);
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = list[Math.min(list.length - 1, Math.max(0, idx + 1))];
        if (next) {
          setFocusedRow(next.id);
          virtualizer.scrollToIndex(list.indexOf(next), { align: "auto" });
        }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = list[Math.max(0, (idx === -1 ? 0 : idx) - 1)];
        if (prev) {
          setFocusedRow(prev.id);
          virtualizer.scrollToIndex(list.indexOf(prev), { align: "auto" });
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
    // virtualizer ref is stable from useVirtualizer; intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPanelFocused, list, focusedRowId, setFocusedRow, setSelectedEmail]);

  function handleRowClick(emailId: string, e: React.MouseEvent) {
    if (e.shiftKey && selectionAnchorId) {
      const ai = list.findIndex((m) => m.id === selectionAnchorId);
      const bi = list.findIndex((m) => m.id === emailId);
      if (ai !== -1 && bi !== -1) {
        const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
        const range = list.slice(lo, hi + 1).map((m) => m.id);
        setSelectionRange(range);
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      toggleEmailSelection(emailId);
      return;
    }
    setSelectedEmail(emailId);
    if (isMobile) setMobileView("viewer");
  }

  if (list.length === 0) {
    return (
      <Panel
        panelId={PANEL_ID}
        type="stage"
        header={
          isMobile ? undefined : (
            <PanelHeader
              title={folder?.name ?? "Mail"}
              actions={
                <Tooltip label="Refresh" shortcut="⌘R">
                  <Button variant="ghost" size="sm" iconOnly aria-label="Refresh">
                    <RefreshCw />
                  </Button>
                </Tooltip>
              }
            />
          )
        }
      >
        <PanelEmpty
          icon={Inbox}
          title="No emails in this view"
          body="Try clearing filters or selecting a different folder."
          action={
            <Button variant="secondary" size="md">
              Clear filters
            </Button>
          }
        />
      </Panel>
    );
  }

  return (
    <Panel
      panelId={PANEL_ID}
      type="stage"
      header={
        isMobile ? undefined : (
          <PanelHeader
            title={folder?.name ?? "Mail"}
            meta={`${list.length}${selectedEmailIds.size > 1 ? ` · ${selectedEmailIds.size} selected` : ""}`}
            actions={
              <>
                <Tooltip label={`Density: ${DENSITY_LABEL[density]}`} shortcut="D">
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label="Cycle density"
                    onClick={cycleDensity}
                  >
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
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label="Collapse"
                  >
                    <PanelRightClose />
                  </Button>
                </Tooltip>
              </>
            }
          />
        )
      }
    >
      {/* Sub-toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-1 px-2">
        <button
          className={cn(
            "flex h-6 items-center gap-1 rounded-xs px-1.5 text-caption text-text-tertiary",
            "hover:bg-surface-2 hover:text-text-secondary",
          )}
        >
          Sort: Newest
          <ChevronDown size={12} />
        </button>
        <span className="text-caption text-text-muted">·</span>
        <button
          className={cn(
            "flex h-6 items-center gap-1 rounded-xs px-1.5 text-caption text-text-tertiary",
            "hover:bg-surface-2 hover:text-text-secondary",
          )}
        >
          All
          <ChevronDown size={12} />
        </button>
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
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const email = list[vi.index]!;
            const isSelected = selectedEmailIds.has(email.id);
            const isSinglySelected = selectedEmailId === email.id;
            const isFocused = focusedRowId === email.id;
            return (
              <div
                key={email.id}
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
                {isMobile ? (
                  <EmailRowMobile
                    email={email}
                    selected={isSelected || isSinglySelected}
                    focused={isFocused}
                    ghosted={!isPanelFocused}
                    inSelectionSet={isSelected}
                    onSelect={(e) => handleRowClick(email.id, e)}
                    onToggleStar={() => setStarred(email.id, !email.starred)}
                  />
                ) : (
                  <EmailRow
                    email={email}
                    density={density}
                    selected={isSelected || isSinglySelected}
                    focused={isFocused}
                    ghosted={!isPanelFocused}
                    inSelectionSet={isSelected}
                    onFocus={() => setFocusedRow(email.id)}
                    onSelect={(e) => handleRowClick(email.id, e)}
                    onToggleStar={() => setStarred(email.id, !email.starred)}
                    onToggleCheck={(c) => {
                      if (c && !isSelected) toggleEmailSelection(email.id);
                      if (!c && isSelected) toggleEmailSelection(email.id);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
