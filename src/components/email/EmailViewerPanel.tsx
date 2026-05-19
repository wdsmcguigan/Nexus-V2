import * as React from "react";
import DOMPurify from "dompurify";
import {
  Reply,
  ReplyAll,
  Forward,
  MoreHorizontal,
  ShieldCheck,
  ImageIcon,
  Mail,
  MailX,
  Star,
  Archive,
  Trash2,
  Pin,
  PinOff,
  PanelRight,
  PanelRightClose,
  ChevronDown,
  Paperclip,
  Download,
  Tag as TagIcon,
  Bell,
  BellOff,
  Printer,
  FileDown,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { SnoozePopover } from "@/components/email/SnoozePopover";
import { LabelPickerPopover } from "@/components/email/LabelPickerPopover";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelEmpty } from "@/components/panel/PanelEmpty";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useWorkspace, getDockviewApi, newPanelId } from "@/state/workspace";
import { useMessage, useThreadMessages, useContactByEmail } from "@/storage/useStore";
import { cn, formatBytes } from "@/lib/utils";
import { bodyStore } from "@/storage/bodyStore";
import { localStore } from "@/storage/local";
import { toast } from "sonner";
import { readMessage } from "@/state/mutations";
import * as Mut from "@/state/mutations";
import { isTauri, getMessageBody, downloadAttachment, sendUnsubscribe } from "@/storage/tauri";
import { printMessages } from "@/lib/print";
import { exportMessageEml, exportMessagesAsMbox } from "@/lib/export";
import { loadBodies } from "@/lib/loadBodies";
import { pickPanelLink } from "@/design-system/tokens";
import { formatAbsoluteTime } from "@/lib/utils";
import type { Message } from "@/data/types";

// ─── Collapsed thread message row ─────────────────────────────────────────────

function ThreadMessageRow({ msg }: { msg: Message }) {
  const [expanded, setExpanded] = React.useState(false);
  const colorSeed = pickPanelLink(msg.fromAddr.email);
  const [body, setBody] = React.useState<string>(
    () => bodyStore.get(msg.bodyRef) ?? `<p>${msg.snippet}</p>`
  );
  React.useEffect(() => {
    const cached = bodyStore.get(msg.bodyRef);
    if (cached) { setBody(cached); return; }
    if (!isTauri()) return;
    let cancelled = false;
    getMessageBody(msg.bodyRef).then((html) => {
      if (cancelled) return;
      if (html) { bodyStore.set(msg.bodyRef, html); setBody(html); }
    });
    return () => { cancelled = true; };
  }, [msg.bodyRef]);

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
          sandbox="allow-same-origin"
          srcDoc={`<!doctype html><html><head><meta name="color-scheme" content="light"><style>html,body{margin:0;padding:16px 24px;background:#ffffff;color:#1a1a1a;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6}p{margin:0 0 12px}a{color:#2563eb}img{max-width:100%;height:auto}</style></head><body>${DOMPurify.sanitize(body, { FORBID_TAGS: ["script", "form", "meta"], FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "action"], ALLOW_DATA_ATTR: false })}</body></html>`}
          className="block h-48 w-full"
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
  const unarchive = useWorkspace((s) => s.unarchive);

  const effectiveEmailId = isPinned ? pinnedEmailId : globalSelectedEmailId;
  const msg = useMessage(effectiveEmailId);
  const threadMsgs = useThreadMessages(msg?.threadId ?? "", effectiveEmailId ?? "");
  const senderContact = useContactByEmail(msg?.fromAddr.email ?? "");
  const [imagesShown, setImagesShown] = React.useState(false);
  const [labelPickerOpen, setLabelPickerOpen] = React.useState(false);
  const [bodyHeight, setBodyHeight] = React.useState(400);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  // Auto-mark as read after 500ms — gives time to skip past without marking
  React.useEffect(() => {
    if (!effectiveEmailId) return;
    const current = localStore.messages.get(effectiveEmailId);
    if (!current || current.flags.read) return;
    const timer = setTimeout(() => readMessage(localStore, effectiveEmailId), 500);
    return () => clearTimeout(timer);
  }, [effectiveEmailId]);

  // Async body loading: serve from cache or fetch via IPC on miss
  const [bodyHtml, setBodyHtml] = React.useState<string>(() =>
    msg ? (bodyStore.get(msg.bodyRef) ?? `<p>${msg.snippet}</p>`) : ""
  );
  React.useEffect(() => {
    if (!msg) return;
    const cached = bodyStore.get(msg.bodyRef);
    if (cached) { setBodyHtml(cached); return; }
    setBodyHtml(`<p>${msg.snippet}</p>`);
    if (!isTauri()) return;
    let cancelled = false;
    getMessageBody(msg.bodyRef).then((html) => {
      if (cancelled) return;
      if (html) { bodyStore.set(msg.bodyRef, html); setBodyHtml(html); }
    });
    return () => { cancelled = true; };
  }, [msg?.bodyRef]);

  // Auto-show images if sender is trusted
  React.useEffect(() => {
    setImagesShown(senderContact?.alwaysShowImages === true);
  }, [effectiveEmailId, senderContact?.alwaysShowImages]);

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
  const hasRemoteImages = /src=["']https?:\/\//i.test(bodyHtml);

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
              <Tooltip label={msg.star ? "Unstar" : "Star"} shortcut="S">
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label="Star"
                  className={msg.star ? "text-accent" : ""}
                  onClick={() => { if (msg.star) Mut.clearStar(localStore, msg.id); else Mut.setStar(localStore, msg.id, "yellow"); }}
                >
                  <Star />
                </Button>
              </Tooltip>
              <SnoozePopover messageId={msg.id} />
              <Tooltip label="Archive" shortcut="E">
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label="Archive"
                  onClick={() => {
                    const id = msg.id;
                    Mut.archiveMessage(localStore, id);
                    toast("Archived", { action: { label: "Undo", onClick: () => unarchive(id) } });
                  }}
                >
                  <Archive />
                </Button>
              </Tooltip>
              <Tooltip label="Delete" shortcut="#">
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label="Delete"
                  onClick={() => {
                    Mut.deleteMessage(localStore, msg.id);
                    toast("Moved to Trash");
                  }}
                >
                  <Trash2 />
                </Button>
              </Tooltip>
              <Tooltip label={msg.muted ? "Unmute thread" : "Mute thread"}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={msg.muted ? "Unmute" : "Mute"}
                  className={msg.muted ? "text-accent" : ""}
                  onClick={() => Mut.setMuted(localStore, msg.id, !msg.muted)}
                >
                  {msg.muted ? <Bell size={12} /> : <BellOff size={12} />}
                </Button>
              </Tooltip>
              <span className="mx-1 h-4 w-px bg-border-subtle" />
              {/* More dropdown */}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <span>
                    <Tooltip label="More">
                      <Button variant="ghost" size="sm" iconOnly aria-label="More actions">
                        <MoreHorizontal />
                      </Button>
                    </Tooltip>
                  </span>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    sideOffset={6}
                    align="end"
                    className="z-50 min-w-[180px] overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
                  >
                    <DropdownMenu.Item
                      onSelect={() => setLabelPickerOpen(true)}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                    >
                      <TagIcon size={12} />
                      Label…
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
                    <DropdownMenu.Item
                      onSelect={async () => {
                        const bodies = await loadBodies([msg]);
                        printMessages([msg], bodies);
                      }}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                    >
                      <Printer size={12} />
                      Print message
                    </DropdownMenu.Item>
                    {threadMsgs.length > 0 && (
                      <DropdownMenu.Item
                        onSelect={async () => {
                          const all = [...threadMsgs, msg].sort((a, b) => a.receivedAt - b.receivedAt);
                          const bodies = await loadBodies(all);
                          printMessages(all, bodies);
                        }}
                        className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                      >
                        <Printer size={12} />
                        Print thread
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
                    <DropdownMenu.Item
                      onSelect={async () => {
                        const bodies = await loadBodies([msg]);
                        await exportMessageEml(msg, bodies.get(msg.bodyRef) ?? `<p>${msg.snippet}</p>`);
                      }}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                    >
                      <FileDown size={12} />
                      Export as EML
                    </DropdownMenu.Item>
                    {threadMsgs.length > 0 && (
                      <DropdownMenu.Item
                        onSelect={async () => {
                          const all = [...threadMsgs, msg].sort((a, b) => a.receivedAt - b.receivedAt);
                          const bodies = await loadBodies(all);
                          await exportMessagesAsMbox(all, bodies, msg.subject);
                        }}
                        className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                      >
                        <FileDown size={12} />
                        Export thread as MBOX
                      </DropdownMenu.Item>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              {/* Label picker popover (controlled, opened from More menu) */}
              <LabelPickerPopover
                messageId={msg.id}
                open={labelPickerOpen}
                onOpenChange={setLabelPickerOpen}
              />
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
            {msg.listUnsubscribeJson && (
              <Tooltip label="Unsubscribe from this sender">
                <button
                  type="button"
                  className="mt-1 flex items-center gap-1 text-overline uppercase text-text-tertiary hover:text-accent transition-colors"
                  onClick={async () => {
                    const openSafeUrl = (raw: string) => {
                      try {
                        const u = new URL(raw);
                        if (u.protocol === "https:" || u.protocol === "http:") {
                          window.open(raw, "_blank", "noopener,noreferrer");
                        } else {
                          toast.error("Unsubscribe link has an invalid protocol");
                        }
                      } catch {
                        toast.error("Invalid unsubscribe URL");
                      }
                    };
                    try {
                      if (isTauri()) {
                        const result = await sendUnsubscribe(msg.id);
                        if (result === "posted") {
                          toast.success("Unsubscribed successfully");
                        } else {
                          openSafeUrl(result);
                        }
                      } else {
                        const parsed = JSON.parse(msg.listUnsubscribeJson!);
                        const url: unknown = parsed.link ?? parsed.post;
                        if (typeof url === "string") openSafeUrl(url);
                      }
                    } catch (e) {
                      toast.error(`Unsubscribe failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                  }}
                >
                  <MailX size={10} />
                  <span>unsubscribe</span>
                </button>
              </Tooltip>
            )}
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const email = msg.fromAddr.email;
                  if (!email) return;
                  setImagesShown(true);
                  const existing = localStore.lookupByEmail(email);
                  if (existing) {
                    Mut.updateContact(existing.id, { alwaysShowImages: true });
                  } else {
                    const id = `cnt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    Mut.upsertContact({
                      id,
                      vaultId: localStore.vault?.id ?? "local",
                      name: msg.fromAddr.name ?? email,
                      emails: [email],
                      phones: [],
                      tags: [],
                      alwaysShowImages: true,
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    });
                  }
                }}
              >
                Always allow
              </Button>
            </div>
          </div>
        )}

        {/* Iframe sandbox boundary */}
        <div data-scroll className="nx-scroll min-h-0 flex-1 overflow-auto bg-canvas p-4">
          <div className="mx-auto max-w-[680px] overflow-hidden rounded-md border border-border-default bg-white shadow-l1">
            <iframe
              ref={iframeRef}
              title={`Email body from ${msg.fromAddr.name}`}
              sandbox="allow-same-origin"
              srcDoc={`<!doctype html><html><head><meta name="color-scheme" content="light"><style>
                html,body{margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6}
                p{margin:0 0 12px}h1,h2,h3{margin:0 0 12px}ul,ol{margin:0 0 12px 24px}
                a{color:#2563eb}img{max-width:100%;height:auto}
              </style></head><body>${DOMPurify.sanitize(bodyHtml, { FORBID_TAGS: ["script", "form", "meta"], FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "action"], ALLOW_DATA_ATTR: false })}</body></html>`}
              className="block w-full"
              style={{ height: bodyHeight }}
              onLoad={() => {
                const h = iframeRef.current?.contentDocument?.body?.scrollHeight;
                if (h) setBodyHeight(h + 48);
              }}
            />
          </div>
        </div>

        {/* Attachment chips */}
        {msg.attachmentRefs.length > 0 && (
          <div className="shrink-0 border-t border-border-subtle bg-surface-1 px-4 py-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-overline uppercase text-text-tertiary">
              <Paperclip size={10} />
              <span>{msg.attachmentRefs.length} attachment{msg.attachmentRefs.length > 1 ? "s" : ""}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {msg.attachmentRefs.map((a) => (
                <div
                  key={a.name}
                  className="flex items-center gap-2 rounded-sm border border-border-subtle bg-surface-2 px-2.5 py-1.5 hover:border-border-default hover:bg-surface-3 transition-colors duration-fast"
                >
                  <Paperclip size={11} className="shrink-0 text-text-tertiary" />
                  <div className="min-w-0">
                    <div className="max-w-[160px] truncate text-small text-text-primary">{a.name}</div>
                    <div className="font-mono text-mono-xs text-text-tertiary">{formatBytes(a.size)}</div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Download ${a.name}`}
                    className="ml-1 rounded-xs p-0.5 text-text-tertiary hover:text-text-primary"
                    onClick={() => {
                      if (!isTauri() || !a.attachmentId || !msg) return;
                      downloadAttachment({
                        messageId: msg.id,
                        attachmentId: a.attachmentId,
                        filename: a.name,
                      }).catch((e) => console.warn("Download failed:", e));
                    }}
                  >
                    <Download size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
