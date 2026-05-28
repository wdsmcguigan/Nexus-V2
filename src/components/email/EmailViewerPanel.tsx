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
  MailOpen,
  MailX,
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
  AlarmClock,
  ShieldAlert,
  Fish,
  Filter,
  Languages,
  Code,
  X,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LabelPickerPopover } from "@/components/email/LabelPickerPopover";
import { RuleEditorDialog } from "@/components/settings/RuleEditorDialog";
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
import { isTauri, getMessageBody, downloadAttachment, sendUnsubscribe, getMessageSource } from "@/storage/tauri";
import { printMessages } from "@/lib/print";
import { exportMessageEml, exportMessagesAsMbox } from "@/lib/export";
import { loadBodies } from "@/lib/loadBodies";
import { pickPanelLink } from "@/design-system/tokens";
import { getAppPreferences } from "@/lib/appPreferences";
import { getAccountPreferences, type AccountPreferences } from "@/storage/tauri";
import { formatAbsoluteTime } from "@/lib/utils";
import type { Message } from "@/data/types";
import { ContactHoverCard } from "@/components/contacts/ContactHoverCard";

// ─── Shared email body renderer ──────────────────────────────────────────────
// Uses contentDocument.write() + useLayoutEffect so height is measured
// synchronously before the first browser paint — eliminates the "pop-in" where
// content appeared clipped then jumped to full height.

const IFRAME_CSS =
  `html{margin:0;padding:0;overflow-x:hidden}` +
  `body{margin:0;padding:0;background:#fff;color:#1a1a1a;font-size:14px;line-height:1.6;overflow-x:hidden;word-break:break-word}` +
  `img{max-width:100%!important;height:auto!important}` +
  `table{max-width:100%!important;border-collapse:collapse}` +
  `td,th{word-break:break-word;overflow-wrap:anywhere}` +
  `a{color:#2563eb}`;

// Applied AFTER DOMPurify so attribute structure is already clean.
// Blanks out remote image URLs rather than removing the element, which
// preserves layout while preventing tracking pixels and resource loads.
function stripRemoteImages(html: string): string {
  return html
    .replace(/(<[^>]+\s)src=(["'])https?:\/\/[^"']*\2/gi, '$1src=""')
    .replace(/(<[^>]+\s)srcset=(["'])[^"']*\2/gi, '$1srcset=""')
    .replace(
      /background-image\s*:\s*url\s*\(\s*["']?https?:\/\/[^)"']*["']?\s*\)/gi,
      "background-image:none"
    );
}

function EmailBody({ html, title, imagesShown }: { html: string; title: string; imagesShown: boolean }) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const roRef = React.useRef<ResizeObserver | null>(null);
  const rafRef = React.useRef<number>(0);

  React.useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    roRef.current?.disconnect();
    cancelAnimationFrame(rafRef.current);
    const doc = iframe.contentDocument;
    if (!doc) return;

    const sanitized = DOMPurify.sanitize(html, {
      FORBID_TAGS: ["script", "form", "meta"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "action"],
      ALLOW_DATA_ATTR: false,
    });
    const content = imagesShown ? sanitized : stripRemoteImages(sanitized);
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta name="color-scheme" content="light">` +
      `<style>${IFRAME_CSS}</style></head><body>${content}</body></html>`
    );
    doc.close();

    const applyHeight = () => {
      if (!iframe.isConnected) return;
      const h = doc.body?.scrollHeight ?? 0;
      if (h > 0) iframe.style.height = `${h}px`;
    };
    applyHeight();

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(applyHeight);
    });
    if (doc.body) ro.observe(doc.body);
    roRef.current = ro;

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [html, imagesShown]);

  return (
    <iframe
      ref={iframeRef}
      title={title}
      sandbox="allow-same-origin"
      className="block w-full"
      style={{ height: 0 }}
    />
  );
}

// ─── Collapsed thread message row ─────────────────────────────────────────────

function ThreadMessageRow({ msg }: { msg: Message }) {
  const [expanded, setExpanded] = React.useState(false);
  const colorSeed = pickPanelLink(msg.fromAddr.email);
  const senderContact = useContactByEmail(msg.fromAddr.email);
  const [body, setBody] = React.useState<string | null>(
    () => bodyStore.get(msg.bodyRef) ?? null
  );
  React.useEffect(() => {
    const cached = bodyStore.get(msg.bodyRef);
    if (cached) { setBody(cached); return; }
    if (!isTauri()) { setBody(""); return; }
    let cancelled = false;
    getMessageBody(msg.bodyRef).then((html) => {
      if (cancelled) return;
      if (html) bodyStore.set(msg.bodyRef, html);
      setBody(html ?? "");
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
        <Avatar name={msg.fromAddr.name} size={24} colorSeed={colorSeed} src={senderContact?.photoUrl} />
        <div className="min-w-0 flex-1">
          {expanded ? (
            <span className="font-sans text-body-strong text-text-secondary">{msg.fromAddr.name}</span>
          ) : (
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 font-sans text-body-strong text-text-secondary">{msg.fromAddr.name}</span>
              <span className="min-w-0 flex-1 truncate text-small text-text-tertiary">{msg.snippet}</span>
            </div>
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
        body === null ? (
          <div className="flex h-12 items-center justify-center">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300" />
          </div>
        ) : body === "" ? (
          <div className="flex h-12 items-center justify-center">
            <span className="text-small text-text-tertiary">No content</span>
          </div>
        ) : (
          <EmailBody html={body} title={`Email from ${msg.fromAddr.name}`} imagesShown={false} />
        )
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
  const [accountPrefs, setAccountPrefs] = React.useState<AccountPreferences | null>(null);
  const [showRuleDialog, setShowRuleDialog] = React.useState(false);
  const [translatedBody, setTranslatedBody] = React.useState<string | null>(null);
  const [translating, setTranslating] = React.useState(false);
  const [showSourceModal, setShowSourceModal] = React.useState(false);
  const [sourceContent, setSourceContent] = React.useState<string | null | "loading">("loading");

  // Auto-mark as read based on user preference (markReadAfterMs; -1 = never)
  React.useEffect(() => {
    if (!effectiveEmailId) return;
    const current = localStore.messages.get(effectiveEmailId);
    if (!current || current.flags.read) return;
    const { markReadAfterMs } = getAppPreferences();
    if (markReadAfterMs === -1) return;
    const timer = setTimeout(() => readMessage(localStore, effectiveEmailId), markReadAfterMs);
    return () => clearTimeout(timer);
  }, [effectiveEmailId]);

  // Async body loading: null = loading, "" = no body, string = ready
  // Bodies are stored locally in SQLite after sync — no network call.
  // We load on-demand (not at startup) to avoid loading hundreds of MB into RAM.
  const [bodyHtml, setBodyHtml] = React.useState<string | null>(() =>
    msg ? (bodyStore.get(msg.bodyRef) ?? null) : null
  );
  React.useEffect(() => {
    if (!msg) return;
    setTranslatedBody(null);
    const cached = bodyStore.get(msg.bodyRef);
    if (cached) { setBodyHtml(cached); return; }
    if (!isTauri()) { setBodyHtml(""); return; }
    setBodyHtml(null);
    let cancelled = false;
    getMessageBody(msg.bodyRef).then((html) => {
      if (cancelled) return;
      if (html) bodyStore.set(msg.bodyRef, html);
      setBodyHtml(html ?? "");
    });
    return () => { cancelled = true; };
  }, [msg?.bodyRef]);

  // Resolve which account this message belongs to (match toAddrs against known accounts)
  const receivingAccountId = React.useMemo(() => {
    if (!msg) return null;
    const accts = Array.from(localStore.accounts.values());
    if (accts.length === 1) return accts[0]?.id ?? null;
    return (
      accts.find((a) =>
        msg.toAddrs.some((t) => t.email.toLowerCase() === a.email.toLowerCase()),
      )?.id ?? accts[0]?.id ?? null
    );
  }, [msg]);

  // Load per-account preferences when the resolved account changes
  React.useEffect(() => {
    if (!receivingAccountId || !isTauri()) return;
    getAccountPreferences(receivingAccountId).then(setAccountPrefs).catch(() => {});
  }, [receivingAccountId]);

  // Auto-show images based on: account pref "always" OR trusted sender contact
  React.useEffect(() => {
    const alwaysByPref = accountPrefs?.externalImages === "always";
    setImagesShown(alwaysByPref || senderContact?.alwaysShowImages === true);
  }, [effectiveEmailId, senderContact?.alwaysShowImages, accountPrefs?.externalImages]);

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
  const hasRemoteImages = /src=["']https?:\/\//i.test(bodyHtml ?? "");
  const renderedBody = translatedBody ?? bodyHtml;

  async function handleTranslate() {
    if (!msg) return;
    const key = getAppPreferences().translateApiKey.trim();
    if (!key) {
      toast.error("Add a Google Translate API key in Settings → Preferences");
      return;
    }
    const source = bodyHtml || msg.snippet;
    if (!source) {
      toast.error("Nothing to translate");
      return;
    }
    setTranslating(true);
    try {
      const res = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: source, target: "en", format: "html" }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const translated = data?.data?.translations?.[0]?.translatedText;
      if (typeof translated !== "string") throw new Error("Unexpected API response");
      setTranslatedBody(translated);
    } catch (e) {
      toast.error(`Translation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTranslating(false);
    }
  }

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
              <Tooltip label="Mark as unread">
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label="Mark as unread"
                  onClick={() => Mut.unreadMessage(localStore, msg.id)}
                >
                  <MailOpen size={12} />
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
                    {/* Snooze */}
                    <DropdownMenu.Item
                      onSelect={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        d.setHours(8, 0, 0, 0);
                        Mut.snoozeMessage(localStore, msg.id, d.getTime());
                        toast("Snoozed until tomorrow");
                      }}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                    >
                      <AlarmClock size={12} />
                      Snooze to tomorrow
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
                    {/* Archive */}
                    <DropdownMenu.Item
                      onSelect={() => {
                        const id = msg.id;
                        Mut.archiveMessage(localStore, id);
                        toast("Archived", { action: { label: "Undo", onClick: () => unarchive(id) } });
                      }}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                    >
                      <Archive size={12} />
                      Archive
                    </DropdownMenu.Item>
                    {/* Mute */}
                    <DropdownMenu.Item
                      onSelect={() => Mut.setMuted(localStore, msg.id, !msg.muted)}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                    >
                      {msg.muted ? <Bell size={12} /> : <BellOff size={12} />}
                      {msg.muted ? "Unmute thread" : "Mute thread"}
                    </DropdownMenu.Item>
                    {/* Delete */}
                    <DropdownMenu.Item
                      onSelect={() => {
                        Mut.deleteMessage(localStore, msg.id);
                        toast("Moved to Trash");
                      }}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-error outline-none focus:bg-error/10 focus:text-error"
                    >
                      <Trash2 size={12} />
                      Delete
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
                    {/* Report spam */}
                    <DropdownMenu.Item
                      onSelect={() => {
                        const id = msg.id;
                        Mut.markAsSpam(localStore, id);
                        toast("Reported as spam");
                      }}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                    >
                      <ShieldAlert size={12} />
                      Report spam
                    </DropdownMenu.Item>
                    {/* Report phishing */}
                    <DropdownMenu.Item
                      onSelect={() => {
                        const id = msg.id;
                        Mut.markAsSpam(localStore, id);
                        toast("Reported as phishing");
                      }}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                    >
                      <Fish size={12} />
                      Report phishing
                    </DropdownMenu.Item>
                    {/* Filter messages like this */}
                    <DropdownMenu.Item
                      onSelect={() => setShowRuleDialog(true)}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                    >
                      <Filter size={12} />
                      Filter messages like this
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
                    <DropdownMenu.Item
                      onSelect={() => setLabelPickerOpen(true)}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                    >
                      <TagIcon size={12} />
                      Label…
                    </DropdownMenu.Item>
                    {/* Translate */}
                    <DropdownMenu.Item
                      onSelect={() => { void handleTranslate(); }}
                      disabled={translating}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary data-[disabled]:opacity-50"
                    >
                      <Languages size={12} />
                      {translating ? "Translating…" : "Translate"}
                    </DropdownMenu.Item>
                    {/* Show original */}
                    <DropdownMenu.Item
                      onSelect={async () => {
                        setShowSourceModal(true);
                        setSourceContent("loading");
                        const raw = await getMessageSource(msg.id).catch(() => null);
                        setSourceContent(raw);
                      }}
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                    >
                      <Code size={12} />
                      Show original
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
          <ContactHoverCard email={msg.fromAddr.email} name={msg.fromAddr.name ?? ""}>
            <button
              type="button"
              className="flex shrink-0 cursor-default items-center gap-3 rounded-sm px-1 -mx-1 hover:bg-surface-2 transition-colors"
            >
              <Avatar name={msg.fromAddr.name} size={40} colorSeed={colorSeed} src={senderContact?.photoUrl} />
              <span className="max-w-[160px] truncate font-sans text-body-strong text-text-primary">
                {msg.fromAddr.name}
              </span>
            </button>
          </ContactHoverCard>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
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
                      socialProfiles: [],
                      addresses: [],
                      source: "manual",
                      importance: "normal",
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

        {/* Translation banner */}
        {translatedBody !== null && (
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-accent bg-accent-soft px-4">
            <Languages size={14} className="text-accent" />
            <span className="text-small text-text-primary">Translated to English</span>
            <div className="ml-auto">
              <Button variant="ghost" size="sm" onClick={() => setTranslatedBody(null)}>
                Show original
              </Button>
            </div>
          </div>
        )}

        {/* Iframe sandbox boundary */}
        <div data-scroll className="nx-scroll min-h-0 flex-1 overflow-auto bg-canvas">
          {renderedBody === null ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300" />
            </div>
          ) : renderedBody === "" ? (
            <div className="mx-4 my-4 overflow-hidden rounded-md border border-border-default bg-white shadow-l1 px-6 py-5">
              <p className="text-sm text-text-secondary leading-relaxed">{msg.snippet}</p>
            </div>
          ) : (
            <div className="mx-4 my-4 overflow-hidden rounded-md border border-border-default bg-white shadow-l1">
              <EmailBody html={renderedBody} title={`Email body from ${msg.fromAddr.name}`} imagesShown={imagesShown || translatedBody !== null} />
            </div>
          )}
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
          <Button variant="primary" size="md" onClick={() => openComposer({ mode: accountPrefs?.defaultReplyAll ? "reply-all" : "reply", replyToMessage: msg })}>
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

      {/* Filter messages like this — opens the rule editor pre-filled from sender */}
      {showRuleDialog && (
        <RuleEditorDialog
          open={showRuleDialog}
          initial={{
            id: "",
            vaultId: localStore.vault?.id ?? "local",
            name: `Messages from ${msg.fromAddr.email}`,
            conditionLogic: "AND",
            conditions: [{ field: "from", op: "contains", value: msg.fromAddr.email }],
            actions: [],
            enabled: true,
            position: 0,
          }}
          vaultId={localStore.vault?.id ?? "local"}
          onSave={(rule) => {
            Mut.saveRuleMutation(rule, localStore);
            setShowRuleDialog(false);
            toast("Rule created");
          }}
          onClose={() => setShowRuleDialog(false)}
        />
      )}

      {/* Show original — raw RFC 822 source */}
      {showSourceModal && (
        <MessageSourceModal
          msg={msg}
          content={sourceContent}
          onClose={() => setShowSourceModal(false)}
        />
      )}
    </Panel>
  );
}

// ─── Show-original modal ──────────────────────────────────────────────────────

function reconstructHeaders(msg: Message): string {
  const fmtAddr = (a: { name: string | null; email: string }) =>
    a.name ? `${a.name} <${a.email}>` : a.email;
  const lines = [
    `Message-ID: ${msg.id}`,
    `Date: ${new Date(msg.receivedAt).toUTCString()}`,
    `From: ${fmtAddr(msg.fromAddr)}`,
    `To: ${msg.toAddrs.map(fmtAddr).join(", ")}`,
  ];
  if (msg.ccAddrs.length > 0) lines.push(`Cc: ${msg.ccAddrs.map(fmtAddr).join(", ")}`);
  lines.push(`Subject: ${msg.subject}`);
  return lines.join("\n");
}

function MessageSourceModal({
  msg,
  content,
  onClose,
}: {
  msg: Message;
  content: string | null | "loading";
  onClose: () => void;
}) {
  const reconstructed = React.useMemo(() => reconstructHeaders(msg), [msg]);
  const text = content === "loading" ? "" : (content ?? reconstructed);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border-default bg-surface-2 shadow-l4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3">
          <span className="text-body-strong text-text-primary">Original message</span>
          <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
        <div className="nx-scroll min-h-0 flex-1 overflow-auto bg-canvas p-4">
          {content === "loading" ? (
            <div className="flex h-32 items-center justify-center">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300" />
            </div>
          ) : (
            <>
              {content === null && (
                <p className="mb-3 text-small text-text-tertiary">
                  Raw source is not stored for this message. Showing reconstructed headers.
                </p>
              )}
              <pre className="whitespace-pre-wrap break-words font-mono text-mono-xs text-text-primary">
                {text}
              </pre>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={content === "loading"}
            onClick={() => {
              navigator.clipboard.writeText(text).then(
                () => toast("Copied to clipboard"),
                () => toast.error("Copy failed"),
              );
            }}
          >
            Copy to clipboard
          </Button>
        </div>
      </div>
    </div>
  );
}
