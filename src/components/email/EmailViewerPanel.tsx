import * as React from "react";
import {
  Reply,
  ReplyAll,
  Forward,
  MoreHorizontal,
  ShieldCheck,
  ImageIcon,
  Mail,
  Star,
  Archive,
  Trash2,
  AlarmClock,
  Pin,
  PinOff,
  PanelRight,
  PanelRightClose,
  ChevronDown,
} from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelEmpty } from "@/components/panel/PanelEmpty";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useWorkspace, getDockviewApi, newPanelId } from "@/state/workspace";
import { useMessage, useThreadMessages } from "@/storage/useStore";
import { cn } from "@/lib/utils";
import { bodyStore } from "@/storage/bodyStore";
import { localStore } from "@/storage/local";
import { readMessage } from "@/state/mutations";
import { pickPanelLink } from "@/design-system/tokens";
import { formatAbsoluteTime } from "@/lib/utils";
import type { Message } from "@/data/types";

// ─── Collapsed thread message row ─────────────────────────────────────────────

function ThreadMessageRow({ msg }: { msg: Message }) {
  const [expanded, setExpanded] = React.useState(false);
  const colorSeed = pickPanelLink(msg.fromAddr.email);
  const body = bodyStore.get(msg.bodyRef) ?? `<p>${msg.snippet}</p>`;

  return (
    <div className="border-b border-border-subtle">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2 transition-colors duration-fast"
      >
        <Avatar name={msg.fromAddr.name} size={24} colorSeed={colorSeed} />
        <div className="min-w-0 flex-1">
          <span className="font-sans text-body-strong text-text-secondary">{msg.fromAddr.name}</span>
          {!expanded && (
            <span className="ml-2 text-small text-text-tertiary truncate">{msg.snippet}</span>
          )}
        </div>
        <span className="shrink-0 font-mono text-mono-xs text-text-tertiary">
          {formatAbsoluteTime(new Date(msg.receivedAt))}
        </span>
        <ChevronDown
          size={12}
          className={cn("shrink-0 text-text-tertiary transition-transform duration-fast", expanded && "rotate-180")}
        />
      </button>
      {expanded && (
        <iframe
          title={`Email from ${msg.fromAddr.name}`}
          sandbox=""
          srcDoc={`<!doctype html><html><head><style>html,body{margin:0;padding:16px 24px;background:transparent;color:#e6e8ec;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6}p{margin:0 0 12px}strong{color:#fff}a{color:#76A1F5}</style></head><body>${body}</body></html>`}
          className="block h-48 w-full bg-canvas"
        />
      )}
    </div>
  );
}

export function EmailViewerPanel({ panelId }: { panelId: string }) {
  const globalSelectedEmailId = useWorkspace((s) => s.selectedEmailId);
  const pinnedEmailId = useWorkspace((s) => s.viewerPinState[panelId] ?? null);
  const isPinned = pinnedEmailId !== null;
  const pinViewerToEmail = useWorkspace((s) => s.pinViewerToEmail);
  const unpinViewer = useWorkspace((s) => s.unpinViewer);
  const openComposer = useWorkspace((s) => s.openComposer);

  const effectiveEmailId = isPinned ? pinnedEmailId : globalSelectedEmailId;
  const msg = useMessage(effectiveEmailId);
  const threadMsgs = useThreadMessages(msg?.threadId ?? "", effectiveEmailId ?? "");
  const [imagesShown, setImagesShown] = React.useState(false);

  // Auto-mark as read after 500ms — gives time to skip past without marking
  React.useEffect(() => {
    if (!effectiveEmailId) return;
    const current = localStore.messages.get(effectiveEmailId);
    if (!current || current.flags.read) return;
    const timer = setTimeout(() => readMessage(localStore, effectiveEmailId), 500);
    return () => clearTimeout(timer);
  }, [effectiveEmailId]);

  // Inspector toggle — opens/closes an inspector panel associated with this viewer.
  const ownedInspectorId = useWorkspace((s) => s.viewerInspectorMap[panelId] ?? null);
  const setViewerInspector = useWorkspace((s) => s.setViewerInspector);
  const clearViewerInspector = useWorkspace((s) => s.clearViewerInspector);

  function toggleInspector() {
    const api = getDockviewApi();
    if (!api) return;

    // Case 1: this viewer already owns an inspector.
    if (ownedInspectorId) {
      const owned = api.getPanel(ownedInspectorId);
      if (owned) {
        // Panel still exists — close it.
        api.removePanel(owned);
        clearViewerInspector(panelId);
        return;
      }
      // Panel was closed externally (via X button). Clear the stale entry and
      // fall through to open a fresh one.
      clearViewerInspector(panelId);
    }

    // Case 2: find any inspector panel not yet owned by any viewer.
    // Never adopt an already-owned inspector — only pick up truly free panels.
    const ownedIds = new Set(Object.values(useWorkspace.getState().viewerInspectorMap));
    const free = api.panels.find(
      (p) => (p.id === "inspector" || p.id.startsWith("inspector-")) && !ownedIds.has(p.id),
    );

    if (free) {
      setViewerInspector(panelId, free.id);
    } else {
      // All existing inspectors are owned — spawn a new one to the right.
      const newId = newPanelId("inspector");
      api.addPanel({
        id: newId,
        component: "inspector",
        title: "Inspector",
        initialWidth: 260,
        minimumWidth: 200,
        position: { direction: "right", referencePanel: panelId },
      });
      setViewerInspector(panelId, newId);
    }
  }

  const inspectorOpen = ownedInspectorId !== null && !!getDockviewApi()?.getPanel(ownedInspectorId);

  if (!msg) {
    return (
      <Panel
        panelId={panelId}
        type="stage"
        header={<PanelHeader title="Reader" />}
      >
        <PanelEmpty
          icon={Mail}
          title="No message selected"
          body="Choose an email from the list, or press ⌘K to jump to one."
        />
      </Panel>
    );
  }

  const colorSeed = pickPanelLink(msg.fromAddr.email);
  const hasRemoteImages = msg.id.endsWith("0") || msg.id.endsWith("5");

  // EP-3: retrieve full body from bodyStore. Falls back to snippet if not cached
  // (e.g. messages arrived via sync before EP-4 body retrieval pipeline exists).
  const storedBody = bodyStore.get(msg.bodyRef);
  const bodyHtml = storedBody ?? `<p>${msg.snippet}</p>`;

  return (
    <Panel
      panelId={panelId}
      type="stage"
      header={
        <PanelHeader
          title={msg.subject}
          actions={
            <>
              <Tooltip label={isPinned ? "Unpin — follow navigation" : "Pin this message"}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={isPinned ? "Unpin viewer" : "Pin viewer to this message"}
                  className={isPinned ? "text-accent" : ""}
                  onClick={() => isPinned ? unpinViewer(panelId) : pinViewerToEmail(panelId, msg.id)}
                >
                  {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
                </Button>
              </Tooltip>
              <Tooltip label={inspectorOpen ? "Close inspector" : "Open inspector"}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={inspectorOpen ? "Close inspector panel" : "Open inspector panel"}
                  className={inspectorOpen ? "text-accent" : ""}
                  onClick={toggleInspector}
                >
                  {inspectorOpen ? <PanelRightClose size={12} /> : <PanelRight size={12} />}
                </Button>
              </Tooltip>
              <Tooltip label="Star">
                <Button variant="ghost" size="sm" iconOnly aria-label="Star">
                  <Star />
                </Button>
              </Tooltip>
              <Tooltip label="Snooze" shortcut="H">
                <Button variant="ghost" size="sm" iconOnly aria-label="Snooze">
                  <AlarmClock />
                </Button>
              </Tooltip>
              <Tooltip label="Archive" shortcut="E">
                <Button variant="ghost" size="sm" iconOnly aria-label="Archive">
                  <Archive />
                </Button>
              </Tooltip>
              <Tooltip label="Delete" shortcut="#">
                <Button variant="ghost" size="sm" iconOnly aria-label="Delete">
                  <Trash2 />
                </Button>
              </Tooltip>
              <span className="mx-1 h-4 w-px bg-border-subtle" />
              <Tooltip label="More">
                <Button variant="ghost" size="sm" iconOnly aria-label="More">
                  <MoreHorizontal />
                </Button>
              </Tooltip>
            </>
          }
        />
      }
    >
      <div className="flex h-full flex-col">
        {/* Earlier messages in this thread */}
        {threadMsgs.length > 0 && (
          <div className="shrink-0 bg-surface-1">
            {threadMsgs.map((m) => (
              <ThreadMessageRow key={m.id} msg={m} />
            ))}
          </div>
        )}

        {/* Sender chrome */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-1 px-4 py-3">
          <Avatar name={msg.fromAddr.name} size={40} colorSeed={colorSeed} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate font-sans text-body-strong text-text-primary">
                {msg.fromAddr.name}
              </span>
              <span className="truncate font-mono text-mono-sm text-text-tertiary">
                &lt;{msg.fromAddr.email}&gt;
              </span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-2 text-small text-text-tertiary">
              <span>to {msg.toAddrs.map((t) => t.name).join(", ")}</span>
              {msg.ccAddrs.length > 0 && (
                <>
                  <span>·</span>
                  <span>cc {msg.ccAddrs.map((t) => t.name).join(", ")}</span>
                </>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-mono-sm text-text-secondary">
              {formatAbsoluteTime(new Date(msg.receivedAt))}
            </div>
            <div className="mt-0.5 flex items-center justify-end gap-1 text-overline uppercase text-text-tertiary">
              <ShieldCheck size={10} />
              <span>isolated content</span>
            </div>
          </div>
        </div>

        {/* Remote-image banner */}
        {hasRemoteImages && !imagesShown && (
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-warning bg-warning-soft px-4">
            <ImageIcon size={14} className="text-warning" />
            <span className="text-small text-text-primary">Remote images blocked</span>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setImagesShown(true)}>
                Show images
              </Button>
              <Button variant="ghost" size="sm">Always allow</Button>
            </div>
          </div>
        )}

        {/* Iframe sandbox boundary */}
        <div data-scroll className="nx-scroll min-h-0 flex-1 overflow-auto bg-canvas p-4">
          <div className="mx-auto max-w-[680px] rounded-md border border-border-default bg-surface-1 shadow-l1">
            <iframe
              title={`Email body from ${msg.fromAddr.name}`}
              sandbox=""
              srcDoc={`<!doctype html><html><head><style>
                html,body{margin:0;padding:24px;background:transparent;color:#e6e8ec;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6}
                p{margin:0 0 12px}h1,h2,h3{margin:0 0 12px;color:#fff}ul,ol{margin:0 0 12px 24px}
                strong{color:#fff}a{color:#76A1F5}
              </style></head><body>${bodyHtml}</body></html>`}
              className="block h-[420px] w-full rounded-md bg-canvas"
            />
          </div>
        </div>

        {/* Footer chrome (reply bar) */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-1 px-4">
          <Button variant="primary" size="md" onClick={() => openComposer({ mode: "reply", replyToMessage: msg })}>
            <Reply />
            Reply
          </Button>
          <Button variant="secondary" size="md" onClick={() => openComposer({ mode: "reply-all", replyToMessage: msg })}>
            <ReplyAll />
            Reply all
          </Button>
          <Button variant="secondary" size="md" onClick={() => openComposer({ mode: "forward", replyToMessage: msg })}>
            <Forward />
            Forward
          </Button>
        </div>
      </div>
    </Panel>
  );
}
