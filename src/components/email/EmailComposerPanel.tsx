import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Bold,
  Italic,
  Underline,
  Link2,
  List,
  ListOrdered,
  Quote,
  Code,
  Paperclip,
  X,
  ChevronDown,
  FileText,
} from "lucide-react";
import * as AlertDialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExt from "@tiptap/extension-underline";
import LinkExt from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tag } from "@/components/ui/Tag";
import { Avatar } from "@/components/ui/Avatar";
import { Tooltip } from "@/components/ui/Tooltip";
import { Kbd } from "@/components/ui/Kbd";
import { useWorkspace } from "@/state/workspace";
import { cn, formatBytes } from "@/lib/utils";
import { pickPanelLink } from "@/design-system/tokens";
import DOMPurify from "dompurify";
import { isTauri, sendMessage, type AttachmentPayload } from "@/storage/tauri";
import { localStore } from "@/storage/local";
import { bodyStore } from "@/storage/bodyStore";
import { formatAbsoluteTime } from "@/lib/utils";
import { loadSignature } from "@/lib/signature";

const PANEL_ID = "composer";
const COUNTDOWN_SECONDS = 5;
const DRAFT_KEY_PREFIX = "nexus-draft-";

interface DraftData {
  subject: string;
  recipients: string[];
  ccRecipients: string[];
  bccRecipients: string[];
  bodyHtml: string;
  savedAt: number;
}

function draftKey(replyMsgId: string | null): string {
  return replyMsgId ? `${DRAFT_KEY_PREFIX}reply-${replyMsgId}` : `${DRAFT_KEY_PREFIX}new`;
}

function loadDraft(key: string): DraftData | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as DraftData) : null;
  } catch {
    return null;
  }
}

function saveDraft(key: string, data: DraftData): void {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* ignore quota */ }
}

function clearDraft(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// ─── Field row ────────────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border-subtle px-3">
      <label className="w-12 shrink-0 font-sans text-caption text-text-tertiary">{label}</label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ─── Toolbar button ───────────────────────────────────────────────────────────

function ToolbarBtn({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault(); // prevent editor losing focus
          onClick();
        }}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "flex size-6 items-center justify-center rounded-xs transition-colors duration-fast",
          active
            ? "bg-accent-soft text-accent"
            : "text-text-tertiary hover:bg-surface-3 hover:text-text-primary",
        )}
      >
        <Icon size={13} />
      </button>
    </Tooltip>
  );
}

// ─── Recipient input with autocomplete ───────────────────────────────────────

interface RecipientInputProps {
  value: string;
  onChange: (v: string) => void;
  onCommit: (email: string) => void;
  placeholder: string;
}

function RecipientInput({ value, onChange, onCommit, placeholder }: RecipientInputProps) {
  const [isFocused, setIsFocused] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(-1);

  const suggestions = React.useMemo(() => {
    if (value.trim().length < 1) return [];
    const q = value.toLowerCase();
    const results: import("@/data/types").Contact[] = [];
    for (const c of localStore.contacts.values()) {
      if (
        c.name.toLowerCase().includes(q) ||
        c.emails.some((e) => e.toLowerCase().includes(q))
      ) {
        results.push(c);
        if (results.length >= 6) break;
      }
    }
    return results;
  }, [value]);

  // Reset activeIdx when suggestions change
  React.useEffect(() => {
    setActiveIdx(-1);
  }, [suggestions]);

  const showDropdown = isFocused && suggestions.length > 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setActiveIdx(-1);
      setIsFocused(false);
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        const email = suggestions[activeIdx].emails[0] ?? "";
        onCommit(email);
        onChange("");
      } else {
        onCommit(value);
        onChange("");
      }
    }
  }

  return (
    <div style={{ position: "relative" }} className="flex-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          setActiveIdx(-1);
        }}
        placeholder={placeholder}
        className="min-w-[120px] w-full bg-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      {showDropdown && (
        <div className="absolute top-full left-0 z-50 mt-0.5 w-72 overflow-hidden rounded-md border border-border-subtle bg-surface-2 shadow-lg">
          {suggestions.map((c, idx) => (
            <div
              key={c.id}
              onMouseDown={(e) => {
                e.preventDefault();
                const email = c.emails[0] ?? "";
                onCommit(email);
                onChange("");
              }}
              className={cn(
                "flex h-9 cursor-pointer items-center gap-2 px-2 text-body text-text-secondary hover:bg-surface-3",
                idx === activeIdx && "bg-surface-3 text-text-primary",
              )}
            >
              <Avatar
                name={c.name}
                size={20}
                colorSeed={pickPanelLink(c.emails[0] ?? "")}
              />
              <span className="truncate">{c.name}</span>
              <span className="ml-auto truncate font-mono text-mono-xs text-text-muted">
                {c.emails[0] ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Attachment helpers ───────────────────────────────────────────────────────

function readFileAsBase64(file: File): Promise<AttachmentPayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result = "data:<mime>;base64,<data>"
      const data = result.split(",")[1] ?? "";
      resolve({ name: file.name, mimeType: file.type || "application/octet-stream", data });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Quoted block ─────────────────────────────────────────────────────────────

function buildQuotedHtml(msg: {
  fromAddr: { name: string; email: string };
  receivedAt: number;
  snippet: string;
  bodyRef: string;
}): string {
  const date = formatAbsoluteTime(new Date(msg.receivedAt));
  const rawBody = bodyStore.get(msg.bodyRef) ?? `<p>${msg.snippet}</p>`;
  return `<p></p><blockquote><p><em>On ${date}, ${msg.fromAddr.name} &lt;${msg.fromAddr.email}&gt; wrote:</em></p>${rawBody}</blockquote>`;
}

// ─── Link dialog (simple prompt) ─────────────────────────────────────────────

function setLink(editor: ReturnType<typeof useEditor>) {
  if (!editor) return;
  const prev = editor.getAttributes("link").href as string | undefined;
  const url = window.prompt("Enter URL:", prev ?? "https://");
  if (url === null) return; // cancelled
  if (url === "") {
    editor.chain().focus().unsetLink().run();
  } else {
    editor.chain().focus().setLink({ href: url }).run();
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EmailComposerPanel() {
  const setComposerOpen = useWorkspace((s) => s.setComposerOpen);
  const composerContext = useWorkspace((s) => s.composerContext);
  const archive = useWorkspace((s) => s.archive);

  const replyMsg = composerContext?.replyToMessage ?? null;
  const mode = composerContext?.mode ?? null;
  const _draftKey = draftKey(replyMsg?.id ?? null);
  const _draft = React.useMemo(() => loadDraft(_draftKey), []); // load once on mount
  const sendAndArchiveRef = React.useRef(false);
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ── Recipients ────────────────────────────────────────────────────────────

  const [recipients, setRecipients] = React.useState<string[]>(() => {
    if (_draft) return _draft.recipients;
    if (!replyMsg || mode === "forward") return [];
    if (mode === "reply") return [replyMsg.fromAddr.email];
    const self = Array.from(localStore.accounts.values()).find((a) => a.provider === "gmail")?.email ?? "";
    return [replyMsg.fromAddr.email, ...replyMsg.toAddrs.map((t) => t.email).filter((e) => e !== self)];
  });
  const [ccRecipients, setCcRecipients] = React.useState<string[]>(() => {
    if (_draft) return _draft.ccRecipients;
    if (mode === "reply-all" && replyMsg) return replyMsg.ccAddrs.map((t) => t.email);
    return [];
  });
  const [bccRecipients, setBccRecipients] = React.useState<string[]>(() => _draft?.bccRecipients ?? []);
  const [fromAccountId, setFromAccountId] = React.useState<string>(() => {
    const accounts = Array.from(localStore.accounts.values());
    return accounts.find((a) => a.provider === "gmail")?.id ?? accounts[0]?.id ?? "";
  });
  const [draftInput, setDraftInput] = React.useState("");
  const [ccDraftInput, setCcDraftInput] = React.useState("");
  const [bccDraftInput, setBccDraftInput] = React.useState("");
  const [showCc, setShowCc] = React.useState(mode === "reply-all" || ((_draft?.ccRecipients.length ?? 0) > 0));

  // ── Subject ───────────────────────────────────────────────────────────────

  const [subject, setSubject] = React.useState(() => {
    if (_draft) return _draft.subject;
    if (!replyMsg) return "";
    if (mode === "forward") return `Fwd: ${replyMsg.subject}`;
    const s = replyMsg.subject;
    return s.startsWith("Re:") ? s : `Re: ${s}`;
  });

  // ── Tiptap editor ─────────────────────────────────────────────────────────

  const _sigHtml = React.useMemo(() => {
    const acct = Array.from(localStore.accounts.values()).find((a) => a.provider === "gmail");
    const sig = acct ? loadSignature(acct.id) : "";
    const sigHtml = sig.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>");
    return sigHtml ? `<div class="nexus-signature"><br/>-- <br/>${sigHtml}</div>` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const initialContent = _draft?.bodyHtml ?? (
    replyMsg
      ? buildQuotedHtml(replyMsg) + _sigHtml
      : (_sigHtml ? `<p></p>${_sigHtml}` : "")
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { HTMLAttributes: { class: "nx-code-block" } } }),
      UnderlineExt,
      LinkExt.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: mode ? "" : "Write your message…" }),
    ],
    content: initialContent,
    autofocus: "start",
    editorProps: {
      attributes: {
        class: cn(
          "min-h-0 flex-1 outline-none px-4 py-3 font-sans text-body text-text-primary",
          "prose prose-sm prose-invert max-w-none",
          "[&_.tiptap]:outline-none",
        ),
      },
    },
  });

  // ── Send machinery ────────────────────────────────────────────────────────

  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [showTemplates, setShowTemplates] = React.useState(false);
  const templates = Array.from(localStore.templates?.values() ?? []);
  const [countdown, setCountdown] = React.useState(0);
  const sendTimeoutRef = React.useRef<number | null>(null);
  const [scheduledAt, setScheduledAt] = React.useState<number | null>(null);
  const [schedulePickerOpen, setSchedulePickerOpen] = React.useState(false);
  const scheduledSendRef = React.useRef<number | null>(null);

  const doActualSend = React.useCallback(async () => {
    setSending(false);
    setCountdown(0);
    const bodyHtml = editor?.getHTML() ?? "";
    if (isTauri()) {
      const accounts = Array.from(localStore.accounts.values());
      const selectedAccount = accounts.find((a) => a.id === fromAccountId) ?? accounts.find((a) => a.provider === "gmail");
      if (!selectedAccount) { toast.error("No account connected"); return; }
      try {
        const attachmentPayloads = attachments.length > 0
          ? await Promise.all(attachments.map(readFileAsBase64))
          : undefined;
        await sendMessage({
          accountId: selectedAccount.id,
          from: selectedAccount.email,
          to: recipients,
          cc: ccRecipients.length > 0 ? ccRecipients : undefined,
          bcc: bccRecipients.length > 0 ? bccRecipients : undefined,
          subject,
          bodyHtml,
          replyToMessageId: replyMsg?.providerIds?.messageId,
          attachments: attachmentPayloads,
        });
        clearDraft(_draftKey);
        toast.success("Sent");
        if (sendAndArchiveRef.current && replyMsg) archive(replyMsg.id);
      } catch (e) {
        toast.error(`Send failed: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    } else {
      toast.success("Sent (web mode — not actually delivered)");
      if (sendAndArchiveRef.current && replyMsg) archive(replyMsg.id);
    }
    setComposerOpen(false);
  }, [editor, recipients, ccRecipients, bccRecipients, subject, replyMsg, attachments, setComposerOpen, archive]);

  const startSend = React.useCallback(() => {
    setSending(true);
    setCountdown(COUNTDOWN_SECONDS);
    const tick = (remaining: number) => {
      if (remaining <= 0) { doActualSend(); return; }
      sendTimeoutRef.current = window.setTimeout(() => {
        setCountdown(remaining - 1);
        tick(remaining - 1);
      }, 1000);
    };
    tick(COUNTDOWN_SECONDS);
    toast("Sending…", {
      action: { label: "Undo", onClick: () => undoSend() },
      duration: COUNTDOWN_SECONDS * 1000,
    });
  }, [doActualSend]);

  const undoSend = React.useCallback(() => {
    if (sendTimeoutRef.current) window.clearTimeout(sendTimeoutRef.current);
    setSending(false);
    setCountdown(0);
    toast("Send cancelled");
  }, []);

  React.useEffect(() => () => { if (sendTimeoutRef.current) window.clearTimeout(sendTimeoutRef.current); }, []);

  // Fire scheduled send when time arrives
  React.useEffect(() => {
    if (!scheduledAt) return;
    const delay = scheduledAt - Date.now();
    if (delay <= 0) { doActualSend(); return; }
    scheduledSendRef.current = window.setTimeout(doActualSend, delay);
    return () => { if (scheduledSendRef.current) window.clearTimeout(scheduledSendRef.current); };
  }, [scheduledAt, doActualSend]);

  // Auto-save draft on change (debounced 1s)
  const saveTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (sending) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const bodyHtml = editor?.getHTML() ?? "";
      saveDraft(_draftKey, { subject, recipients, ccRecipients, bccRecipients, bodyHtml, savedAt: Date.now() });
    }, 1000);
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, recipients, ccRecipients, bccRecipients, editor, sending]);

  // ⌘↵ to send, ⌘⇧↵ to send + archive
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!sending) {
          sendAndArchiveRef.current = e.shiftKey && (mode === "reply" || mode === "reply-all");
          startSend();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sending, startSend, mode]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function handleDiscard() {
    // Consider it dirty if: has recipients, non-empty subject, or editor
    // has more than the initial quoted block (check text content length)
    const text = editor?.getText() ?? "";
    const isDirty = recipients.length > 0 || subject.trim() !== "" || text.trim().length > 0 || attachments.length > 0;
    if (isDirty) {
      setDiscardOpen(true);
    } else {
      setComposerOpen(false);
    }
  }

  const allAccounts = Array.from(localStore.accounts.values());
  const fromAccount = allAccounts.find((a) => a.id === fromAccountId) ?? allAccounts[0];

  const headerMeta = mode
    ? `${mode === "forward" ? "Fwd" : "Re"}: ${replyMsg?.fromAddr.name ?? "draft"}`
    : (recipients[0] ?? "new message");

  return (
    <>
    <Panel
      panelId={PANEL_ID}
      type="stage"
      header={
        <PanelHeader
          title={mode === "forward" ? "Forward" : mode ? "Reply" : "Compose"}
          meta={headerMeta}
          actions={
            <Tooltip label="Discard">
              <Button variant="ghost" size="sm" iconOnly aria-label="Close composer" onClick={handleDiscard}>
                <X />
              </Button>
            </Tooltip>
          }
        />
      }
    >
      <div className="flex h-full flex-col">
        {/* From */}
        <FieldRow label="From">
          {allAccounts.length <= 1 ? (
            <span className="font-mono text-mono-sm text-text-secondary py-2">
              {fromAccount?.email ?? "me@nexus.app"}
            </span>
          ) : (
            <select
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value)}
              className="h-9 w-full bg-transparent font-mono text-mono-sm text-text-secondary focus:outline-none"
            >
              {allAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.email}</option>
              ))}
            </select>
          )}
        </FieldRow>

        {/* To */}
        <FieldRow label="To">
          <div className="flex h-auto min-h-9 flex-wrap items-center gap-1 py-1.5">
            {recipients.map((r) => (
              <Tag key={r} color={pickPanelLink(r)} size="md" removable onRemove={() => setRecipients((rs) => rs.filter((x) => x !== r))}>
                {r}
              </Tag>
            ))}
            <RecipientInput
              value={draftInput}
              onChange={setDraftInput}
              onCommit={(email) => { setRecipients((r) => [...r, email]); setDraftInput(""); }}
              placeholder={recipients.length === 0 ? "Add recipient…" : ""}
            />
            {!showCc && (
              <button type="button" onClick={() => setShowCc(true)} className="ml-auto text-caption text-text-tertiary hover:text-text-secondary">
                Cc Bcc
              </button>
            )}
          </div>
        </FieldRow>

        {/* Cc / Bcc */}
        {showCc && (
          <>
            <FieldRow label="Cc">
              <div className="flex h-auto min-h-9 flex-wrap items-center gap-1 py-1.5">
                {ccRecipients.map((r) => (
                  <Tag key={r} color={pickPanelLink(r)} size="md" removable onRemove={() => setCcRecipients((rs) => rs.filter((x) => x !== r))}>
                    {r}
                  </Tag>
                ))}
                <RecipientInput
                  value={ccDraftInput}
                  onChange={setCcDraftInput}
                  onCommit={(email) => { setCcRecipients((r) => [...r, email]); setCcDraftInput(""); }}
                  placeholder={ccRecipients.length === 0 ? "Add cc…" : ""}
                />
              </div>
            </FieldRow>
            <FieldRow label="Bcc">
              <div className="flex h-auto min-h-9 flex-wrap items-center gap-1 py-1.5">
                {bccRecipients.map((r) => (
                  <Tag key={r} color={pickPanelLink(r)} size="md" removable onRemove={() => setBccRecipients((rs) => rs.filter((x) => x !== r))}>
                    {r}
                  </Tag>
                ))}
                <RecipientInput
                  value={bccDraftInput}
                  onChange={setBccDraftInput}
                  onCommit={(email) => { setBccRecipients((r) => [...r, email]); setBccDraftInput(""); }}
                  placeholder={bccRecipients.length === 0 ? "Add bcc…" : ""}
                />
              </div>
            </FieldRow>
          </>
        )}

        {/* Subject */}
        <FieldRow label="Subject">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            size="sm"
            className="border-none bg-transparent px-0 hover:border-none focus:border-none focus:shadow-none"
          />
        </FieldRow>

        {/* Formatting toolbar */}
        <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border-subtle bg-surface-1 px-2">
          <ToolbarBtn icon={Bold} label="Bold (⌘B)" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} />
          <ToolbarBtn icon={Italic} label="Italic (⌘I)" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} />
          <ToolbarBtn icon={Underline} label="Underline (⌘U)" active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()} />
          <span className="mx-1 h-4 w-px bg-border-default" />
          <ToolbarBtn icon={Link2} label="Link (⌘K)" active={editor?.isActive("link")} onClick={() => setLink(editor)} />
          <span className="mx-1 h-4 w-px bg-border-default" />
          <ToolbarBtn icon={List} label="Bullet list" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
          <ToolbarBtn icon={ListOrdered} label="Numbered list" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
          <ToolbarBtn icon={Quote} label="Blockquote" active={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
          <ToolbarBtn icon={Code} label="Inline code" active={editor?.isActive("code")} onClick={() => editor?.chain().focus().toggleCode().run()} />
          {templates.length > 0 && (
            <>
              <span className="mx-1 h-4 w-px bg-border-default" />
              <div className="relative">
                <Tooltip label="Insert template">
                  <button
                    type="button"
                    onClick={() => setShowTemplates((v) => !v)}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-xs text-text-tertiary transition-colors hover:bg-surface-3 hover:text-text-secondary",
                      showTemplates && "bg-surface-3 text-text-secondary",
                    )}
                  >
                    <FileText size={13} />
                  </button>
                </Tooltip>
                {showTemplates && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-border-subtle bg-surface-2 py-1 shadow-lg">
                    {templates.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        type="button"
                        onClick={() => {
                          if (tmpl.subject) setSubject(tmpl.subject);
                          editor?.commands.setContent(DOMPurify.sanitize(tmpl.bodyHtml));
                          setShowTemplates(false);
                        }}
                        className="flex w-full flex-col px-3 py-2 text-left hover:bg-surface-3"
                      >
                        <span className="text-body text-text-primary">{tmpl.name}</span>
                        {tmpl.subject && (
                          <span className="text-small text-text-tertiary truncate">{tmpl.subject}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Tiptap editor */}
        <div
          data-scroll
          className="nx-scroll min-h-0 flex-1 overflow-auto bg-canvas"
          onClick={() => editor?.commands.focus()}
        >
          <EditorContent
            editor={editor}
            className="h-full [&_.tiptap]:min-h-full [&_.tiptap]:px-4 [&_.tiptap]:py-3 [&_.tiptap]:outline-none [&_.tiptap]:text-body [&_.tiptap]:text-text-primary [&_.tiptap_p]:my-0 [&_.tiptap_p+p]:mt-2 [&_.tiptap_blockquote]:border-l-2 [&_.tiptap_blockquote]:border-border-default [&_.tiptap_blockquote]:pl-3 [&_.tiptap_blockquote]:text-text-tertiary [&_.tiptap_ul]:pl-5 [&_.tiptap_ol]:pl-5 [&_.tiptap_li]:my-0.5 [&_.tiptap_code]:rounded-xs [&_.tiptap_code]:bg-surface-3 [&_.tiptap_code]:px-1 [&_.tiptap_code]:font-mono [&_.tiptap_code]:text-mono-sm [&_.tiptap_a]:text-accent [&_.tiptap_a]:underline [&_.tiptap_.is-editor-empty:first-child:before]:content-[attr(data-placeholder)] [&_.tiptap_.is-editor-empty:first-child:before]:text-text-muted [&_.tiptap_.is-editor-empty:first-child:before]:pointer-events-none [&_.tiptap_.is-editor-empty:first-child:before]:float-left [&_.tiptap_.is-editor-empty:first-child:before]:h-0"
          />
        </div>

        {/* Attachments strip */}
        <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-t border-border-subtle bg-surface-1 px-3 py-1.5">
          <Paperclip size={12} className="shrink-0 text-text-tertiary" />
          {attachments.length === 0 && (
            <span className="flex-1 font-mono text-mono-sm text-text-muted">No attachments</span>
          )}
          {attachments.map((file, i) => (
            <span
              key={`${file.name}-${i}`}
              className="flex items-center gap-1 rounded-xs border border-border-default bg-surface-2 px-2 py-0.5 font-mono text-mono-xs text-text-secondary"
            >
              {file.name}
              <span className="text-text-muted">({formatBytes(file.size)})</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                className="ml-1 rounded-xs text-text-muted hover:text-text-primary"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto shrink-0"
            onClick={() => fileInputRef.current?.click()}
          >
            + Attach
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) setAttachments((prev) => [...prev, ...files]);
              e.target.value = ""; // reset so same file can be re-attached
            }}
          />
        </div>

        {/* Send footer */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-t border-border-subtle bg-surface-1 px-3">
          {scheduledAt ? (
            /* Scheduled-send banner */
            <div className="flex flex-1 items-center gap-3">
              <span className="text-body text-text-secondary">
                Scheduled for {formatAbsoluteTime(new Date(scheduledAt))}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (scheduledSendRef.current) window.clearTimeout(scheduledSendRef.current);
                  setScheduledAt(null);
                  toast("Scheduled send cancelled");
                }}
                className="font-mono text-mono-xs text-text-tertiary hover:text-text-primary underline"
              >
                Cancel
              </button>
            </div>
          ) : !sending ? (
            /* Normal send: split button (Send | ▾ dropdown) */
            <div className="flex items-stretch">
              <Button
                variant="primary"
                size="md"
                className="rounded-r-none border-r border-r-white/20"
                onClick={() => { sendAndArchiveRef.current = false; startSend(); }}
              >
                {mode === "forward" ? "Forward" : "Send"}
                <Kbd size="xs" className="ml-1 bg-[rgba(255,255,255,0.15)] text-text-on-accent border-transparent">⌘↵</Kbd>
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="primary"
                    size="md"
                    iconOnly
                    className="rounded-l-none px-1.5"
                    aria-label="More send options"
                  >
                    <ChevronDown size={13} />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    sideOffset={4}
                    align="start"
                    className="z-50 min-w-[200px] overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
                  >
                    {(mode === "reply" || mode === "reply-all") && (
                      <DropdownMenu.Item
                        className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                        onSelect={() => { sendAndArchiveRef.current = true; startSend(); }}
                      >
                        Send + Archive
                        <span className="ml-auto font-mono text-mono-xs text-text-muted">⌘⇧↵</span>
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Item
                      className="flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body text-text-secondary outline-none focus:bg-surface-3 focus:text-text-primary"
                      onSelect={() => setSchedulePickerOpen(true)}
                    >
                      Send later…
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          ) : (
            /* Undo countdown */
            <button
              type="button"
              onClick={undoSend}
              className="relative flex h-ctrl-md items-center gap-2 rounded-sm border border-accent bg-accent-soft px-3 text-text-primary transition-colors duration-fast hover:bg-accent-ghost"
            >
              <span className="font-sans text-body-strong">Sending… {countdown}</span>
              <CountdownRing total={COUNTDOWN_SECONDS} remaining={countdown} />
              <span className="ml-1 font-mono text-mono-xs text-text-tertiary">Click to undo</span>
            </button>
          )}
          <Button variant="ghost" size="md" className="ml-auto" onClick={handleDiscard}>
            Discard
          </Button>
        </div>

        {/* Send later datetime picker */}
        {schedulePickerOpen && (
          <ScheduleDatePicker
            onConfirm={(ts) => { setScheduledAt(ts); setSchedulePickerOpen(false); }}
            onCancel={() => setSchedulePickerOpen(false)}
          />
        )}
      </div>
    </Panel>

    {/* Discard confirmation dialog */}
    <AlertDialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <AlertDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[60] w-full max-w-sm -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-border-subtle bg-surface-2 p-6 shadow-xl",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          <AlertDialog.Title className="mb-2 text-body-strong text-text-primary">
            Discard this draft?
          </AlertDialog.Title>
          <AlertDialog.Description className="mb-5 text-body text-text-secondary">
            Your message will be permanently deleted and cannot be recovered.
          </AlertDialog.Description>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="md" onClick={() => setDiscardOpen(false)}>
              Keep editing
            </Button>
            <Button
              variant="ghost"
              size="md"
              className="text-error hover:bg-error/10 hover:text-error"
              onClick={() => { clearDraft(_draftKey); setDiscardOpen(false); setComposerOpen(false); }}
            >
              Discard
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
    </>
  );
}

// ─── Schedule date picker ─────────────────────────────────────────────────────

function ScheduleDatePicker({
  onConfirm,
  onCancel,
}: {
  onConfirm: (ts: number) => void;
  onCancel: () => void;
}) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaultDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const defaultTime = `${pad(now.getHours() + 1)}:00`;

  const [dateVal, setDateVal] = React.useState(defaultDate);
  const [timeVal, setTimeVal] = React.useState(defaultTime);

  function handleConfirm() {
    const ts = new Date(`${dateVal}T${timeVal}`).getTime();
    if (isNaN(ts) || ts <= Date.now()) {
      alert("Please choose a time in the future.");
      return;
    }
    onConfirm(ts);
  }

  return (
    <div className="absolute inset-x-0 bottom-12 z-10 flex items-center gap-2 border-t border-border-subtle bg-surface-2 px-3 py-2 shadow-lg">
      <span className="shrink-0 text-body text-text-secondary">Send at</span>
      <input
        type="date"
        value={dateVal}
        onChange={(e) => setDateVal(e.target.value)}
        className="rounded-xs border border-border-default bg-surface-1 px-2 py-1 font-mono text-mono-sm text-text-primary outline-none focus:border-accent"
      />
      <input
        type="time"
        value={timeVal}
        onChange={(e) => setTimeVal(e.target.value)}
        className="rounded-xs border border-border-default bg-surface-1 px-2 py-1 font-mono text-mono-sm text-text-primary outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={handleConfirm}
        className="rounded-xs bg-accent px-3 py-1 text-body-strong text-text-on-accent hover:bg-accent/90"
      >
        Schedule
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="font-mono text-mono-xs text-text-tertiary hover:text-text-primary"
      >
        Cancel
      </button>
    </div>
  );
}

// ─── Countdown ring ────────────────────────────────────────────────────────────

function CountdownRing({ total, remaining }: { total: number; remaining: number }) {
  const radius = 6;
  const circ = 2 * Math.PI * radius;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r={radius} fill="none" stroke="var(--color-border-default)" strokeWidth="1.5" />
      <circle
        cx="8" cy="8" r={radius} fill="none"
        stroke="var(--color-accent)" strokeWidth="1.5"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - remaining / total)}
        strokeLinecap="round" transform="rotate(-90 8 8)"
        style={{ transition: "stroke-dashoffset 1s linear" }}
      />
    </svg>
  );
}
