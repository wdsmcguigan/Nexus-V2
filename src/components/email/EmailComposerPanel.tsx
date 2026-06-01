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
  CalendarDays,
  AlertCircle,
  RotateCw,
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
import { filterContacts, contactLabel } from "@/lib/contactSearch";
import { isValidEmail } from "@/lib/email";
import { pickPanelLink } from "@/design-system/tokens";
import DOMPurify from "dompurify";
import { isTauri, sendMessage, syncAccountNow, getSignatureHtml, type AttachmentPayload } from "@/storage/tauri";
import type { Message } from "@/data/types";
import * as Mut from "@/state/mutations";
import { localStore } from "@/storage/local";
import { bodyStore } from "@/storage/bodyStore";
import { formatAbsoluteTime } from "@/lib/utils";
import { loadSignature } from "@/lib/signature";
import { getAppPreferences } from "@/lib/appPreferences";

const PANEL_ID = "composer";
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

  const suggestions = React.useMemo(
    () => filterContacts(localStore.contacts.values(), value, 6),
    [value],
  );

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
    } else if (e.key === "Tab" && value.trim()) {
      // Tab commits pending text (matches Enter/comma) but we deliberately
      // don't preventDefault — Tab also moves focus to the next field,
      // which is the standard expectation for keyboard-driven composing.
      // Tab on an empty input falls through to default focus traversal.
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        onCommit(suggestions[activeIdx].emails[0] ?? "");
      } else {
        onCommit(value);
      }
      onChange("");
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
                name={contactLabel(c)}
                size={20}
                colorSeed={pickPanelLink(c.emails?.[0] ?? "")}
              />
              <span className="truncate">{contactLabel(c)}</span>
              <span className="ml-auto truncate font-mono text-mono-xs text-text-muted">
                {c.emails?.[0] ?? ""}
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

/** Rough plain-text snippet from a HTML body. Used to populate the
 * optimistic Sent row's preview text until the next Gmail sync replaces it
 * with Gmail's authoritative snippet. */
function htmlToSnippet(html: string, max: number = 200): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function classifyAttachment(file: File): "pdf" | "image" | "doc" | "archive" | "calendar" | "other" {
  const t = file.type.toLowerCase();
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (t.startsWith("image/")) return "image";
  if (t === "application/pdf" || ext === "pdf") return "pdf";
  if (t === "text/calendar" || ext === "ics") return "calendar";
  if (
    t.startsWith("application/vnd.openxmlformats-officedocument") ||
    t === "application/msword" ||
    t === "application/vnd.ms-excel" ||
    t === "application/vnd.ms-powerpoint" ||
    ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "txt", "md", "rtf"].includes(ext)
  ) return "doc";
  if (
    t === "application/zip" ||
    t === "application/x-zip-compressed" ||
    t === "application/x-tar" ||
    t === "application/x-rar-compressed" ||
    ["zip", "tar", "gz", "rar", "7z"].includes(ext)
  ) return "archive";
  return "other";
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

// ─── Recipient chip with invalid-email styling ───────────────────────────────

function RecipientChip({ address, onRemove }: { address: string; onRemove: () => void }) {
  const valid = isValidEmail(address);
  if (valid) {
    return (
      <Tag color={pickPanelLink(address)} size="md" removable onRemove={onRemove}>
        {address}
      </Tag>
    );
  }
  // Invalid: render the chip with a destructive border + warning icon. We use
  // a hand-rolled span (not <Tag>) because Tag's color prop maps to themed
  // panel-link hues; an explicit red border is clearer for "this is wrong."
  return (
    <span
      title="Invalid email — fix or remove to send"
      className="inline-flex items-center gap-1 rounded-xs border border-danger bg-danger/10 px-1.5 py-0.5 text-caption text-danger"
    >
      <AlertCircle size={11} className="shrink-0" />
      <span className="truncate font-mono">{address}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${address}`}
        className="ml-0.5 rounded-xs text-danger/70 hover:text-danger"
      >
        <X size={10} />
      </button>
    </span>
  );
}

// ─── Persistent send-failure banner ──────────────────────────────────────────

function SendErrorBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2 text-small text-danger"
    >
      <AlertCircle size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Send failed</div>
        <div className="break-words text-danger/80">{message}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="xs" onClick={onRetry}>
          <RotateCw size={11} />
          Retry
        </Button>
        <Button variant="ghost" size="xs" iconOnly aria-label="Dismiss" onClick={onDismiss}>
          <X size={11} />
        </Button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EmailComposerPanel() {
  const setComposerOpen = useWorkspace((s) => s.setComposerOpen);
  const composerContext = useWorkspace((s) => s.composerContext);
  const archive = useWorkspace((s) => s.archive);
  const openEventCreateModal = useWorkspace((s) => s.openEventCreateModal);

  const replyMsg = composerContext?.replyToMessage ?? null;
  const mode = composerContext?.mode ?? null;
  const prefilledTo = composerContext?.prefilledTo ?? null;
  const _draftKey = draftKey(replyMsg?.id ?? null);
  const _draft = React.useMemo(() => loadDraft(_draftKey), []); // load once on mount
  const sendAndArchiveRef = React.useRef(false);
  const [attachments, setAttachments] = React.useState<File[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // Drag-and-drop state. Counter (vs boolean) to avoid flicker when the user
  // moves the cursor between nested children — dragenter/dragleave events
  // fire in pairs as the pointer crosses element boundaries.
  const [dragDepth, setDragDepth] = React.useState(0);
  const isDraggingFiles = dragDepth > 0;

  // ── Recipients ────────────────────────────────────────────────────────────

  const [recipients, setRecipients] = React.useState<string[]>(() => {
    if (_draft) return _draft.recipients;
    if (prefilledTo) return prefilledTo;
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

  const _fromAccount = React.useMemo(
    () => Array.from(localStore.accounts.values()).find((a) => a.provider === "gmail"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const _sigHtml = React.useMemo(() => {
    if (!_fromAccount) return "";
    const sig = loadSignature(_fromAccount.id);
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

  // Load DB signature on mount (Tauri only) — replaces the localStorage fallback in the initial content
  React.useEffect(() => {
    if (!editor || !_fromAccount || !isTauri() || _draft) return;
    getSignatureHtml(_fromAccount.id).then((dbHtml) => {
      if (!dbHtml) return;
      const sig = `<div class="nexus-signature"><br/>-- <br/>${dbHtml}</div>`;
      const body = replyMsg ? buildQuotedHtml(replyMsg) + sig : `<p></p>${sig}`;
      editor.commands.setContent(body);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ── Send machinery ────────────────────────────────────────────────────────

  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [showTemplates, setShowTemplates] = React.useState(false);
  const templates = Array.from(localStore.templates?.values() ?? []);
  const [countdown, setCountdown] = React.useState(0);
  const sendDurationRef = React.useRef<number>(5);
  const sendTimeoutRef = React.useRef<number | null>(null);
  const [scheduledAt, setScheduledAt] = React.useState<number | null>(null);
  const [schedulePickerOpen, setSchedulePickerOpen] = React.useState(false);
  const scheduledSendRef = React.useRef<number | null>(null);
  // Persistent send-failure banner state. Stays visible until the user clicks
  // Retry or Dismiss — toast notifications are too transient for failures the
  // user explicitly needs to act on (commit b69397e regression fix).
  const [sendError, setSendError] = React.useState<string | null>(null);
  // Id of the "Sending…" countdown toast so we can dismiss it before showing
  // the result toast (sonner's id-based update pattern keeps the same toast
  // visible — it transitions instead of stacking).
  const sendingToastIdRef = React.useRef<string | number | null>(null);

  // Gating for the Send button. Two failure modes:
  //   1. No recipients at all (committed chips + pending draft text both empty).
  //      Gmail rejects this with "Recipient address required" — the user's
  //      visible-but-uncommitted To text would otherwise be silently dropped.
  //   2. Any committed chip OR any non-empty pending draft fails the WHATWG
  //      email check. Pending drafts count because `doActualSend` implicitly
  //      commits them at send time (just like Gmail / Outlook do).
  const sendGate = React.useMemo(() => {
    const allCommitted = [...recipients, ...ccRecipients, ...bccRecipients];
    const allDrafts = [draftInput.trim(), ccDraftInput.trim(), bccDraftInput.trim()].filter(Boolean);
    const allEffective = [...allCommitted, ...allDrafts];
    if (allEffective.length === 0) {
      return { ok: false as const, reason: "Add at least one recipient" };
    }
    if (allEffective.some((addr) => !isValidEmail(addr))) {
      return { ok: false as const, reason: "Fix invalid recipient(s) first" };
    }
    return { ok: true as const, reason: "" };
  }, [recipients, ccRecipients, bccRecipients, draftInput, ccDraftInput, bccDraftInput]);
  const hasInvalidRecipients = !sendGate.ok;

  const doActualSend = React.useCallback(async () => {
    setSending(false);
    setCountdown(0);
    // Dismiss the countdown toast — we're about to transition to a fresh
    // loading toast that'll update in-place to success/error via its id.
    if (sendingToastIdRef.current != null) {
      toast.dismiss(sendingToastIdRef.current);
      sendingToastIdRef.current = null;
    }
    // Implicit commit: if the user clicks Send with text still in any
    // recipient input (no Enter pressed), include it. Otherwise Gmail rejects
    // with "Recipient address required" because params.to.join(", ") is "" —
    // the most common cause of silent send failures. Matches Gmail/Outlook
    // behavior. Also dedupes against existing chips so a stray Enter +
    // re-type doesn't double-add.
    const toDraft = draftInput.trim();
    const ccDraft = ccDraftInput.trim();
    const bccDraft = bccDraftInput.trim();
    const finalRecipients = toDraft && !recipients.includes(toDraft)
      ? [...recipients, toDraft]
      : recipients;
    const finalCc = ccDraft && !ccRecipients.includes(ccDraft)
      ? [...ccRecipients, ccDraft]
      : ccRecipients;
    const finalBcc = bccDraft && !bccRecipients.includes(bccDraft)
      ? [...bccRecipients, bccDraft]
      : bccRecipients;
    // Sync the UI so the chips appear (and the optimistic Sent row carries
    // the correct addresses below).
    if (toDraft) { setRecipients(finalRecipients); setDraftInput(""); }
    if (ccDraft) { setCcRecipients(finalCc); setCcDraftInput(""); }
    if (bccDraft) { setBccRecipients(finalBcc); setBccDraftInput(""); }
    const bodyHtml = editor?.getHTML() ?? "";
    if (isTauri()) {
      const accounts = Array.from(localStore.accounts.values());
      const selectedAccount = accounts.find((a) => a.id === fromAccountId) ?? accounts.find((a) => a.provider === "gmail");
      if (!selectedAccount) {
        toast.error("No account connected", { duration: 10_000 });
        setSendError("No account connected");
        return;
      }
      // Sonner canonical pattern: one toast id transitions through
      // loading → success / error. Stays visible and smoothly updates,
      // instead of stacking toasts on top of each other.
      const sendToastId = toast.loading("Sending email…");
      try {
        const attachmentPayloads = attachments.length > 0
          ? await Promise.all(attachments.map(readFileAsBase64))
          : undefined;
        const gmailId = await sendMessage({
          accountId: selectedAccount.id,
          from: selectedAccount.email,
          to: finalRecipients,
          cc: finalCc.length > 0 ? finalCc : undefined,
          bcc: finalBcc.length > 0 ? finalBcc : undefined,
          subject,
          bodyHtml,
          replyToMessageId: replyMsg?.providerIds?.messageId,
          attachments: attachmentPayloads,
          icalReply: composerContext?.icalReply,
        });

        // Gmail accepted the send. Everything below is best-effort local
        // bookkeeping — wrap separately so a bug here can never make a
        // successful send look like a failure to the user.
        try {
          // Optimistic Sent row: write a Message keyed by Gmail's returned id
          // so the next periodic sync upserts the same row idempotently (no
          // duplicates). The row is intentionally minimal — body lives only
          // on Gmail until sync_account_now backfills it shortly.
          const vaultId = localStore.vault?.id ?? selectedAccount.vaultId ?? "";
          const sentFolderId = vaultId ? `${vaultId}-sent` : "sent";
          const nowMs = Date.now();
          const optimisticMsg: Message = {
            id: gmailId,
            vaultId,
            folderId: sentFolderId,
            threadId: replyMsg?.threadId ?? gmailId,
            providerIds: { gmail: gmailId },
            labelIds: [sentFolderId],
            tags: [],
            statusId: null,
            priority: null,
            star: null,
            flag: null,
            pinned: false,
            muted: false,
            notes: null,
            customFields: {},
            flags: { read: true, answered: !!replyMsg, draft: false, flagged: false },
            receivedAt: nowMs,
            sentAt: nowMs,
            fromAddr: { name: selectedAccount.email, email: selectedAccount.email },
            toAddrs: finalRecipients.map((email) => ({ name: "", email })),
            ccAddrs: finalCc.map((email) => ({ name: "", email })),
            bccAddrs: finalBcc.map((email) => ({ name: "", email })),
            subject,
            snippet: htmlToSnippet(bodyHtml),
            bodyRef: "",
            attachmentRefs: attachments.map((f) => ({
              name: f.name,
              size: f.size,
              type: classifyAttachment(f),
            })),
          };
          Mut.recordMutation("SEND_MESSAGE", optimisticMsg);

          // Kick off a background sync so Gmail's authoritative body, snippet,
          // and final attachment refs replace the optimistic row within a few
          // seconds. Fire-and-forget — we don't block the close on this.
          void syncAccountNow(selectedAccount.id).catch(() => {
            // No-op: the next scheduled sync will reconcile.
          });

          toast.success("Sent", { id: sendToastId });
        } catch (innerErr) {
          // Gmail HAS the message. Surface a soft notice but treat as success.
          console.warn("Optimistic Sent row failed to write:", innerErr);
          toast.warning("Sent — your Sent folder will update on next sync", {
            id: sendToastId,
            duration: 6_000,
          });
        }

        clearDraft(_draftKey);
        if (sendAndArchiveRef.current && replyMsg) archive(replyMsg.id);
      } catch (e) {
        const errMessage = e instanceof Error ? e.message : String(e);
        console.error("Send failed:", e);
        toast.error("Send failed", {
          id: sendToastId,
          description: errMessage,
          duration: 10_000,
        });
        setSendError(errMessage);
        return;
      }
    } else {
      toast.success("Sent (web mode — not actually delivered)");
      if (sendAndArchiveRef.current && replyMsg) archive(replyMsg.id);
    }
    setComposerOpen(false);
  }, [editor, recipients, ccRecipients, bccRecipients, draftInput, ccDraftInput, bccDraftInput, subject, replyMsg, attachments, setComposerOpen, archive, _draftKey, composerContext?.icalReply, fromAccountId]);

  const startSend = React.useCallback(() => {
    // Clear any previous failure banner — the user is trying again.
    setSendError(null);
    const seconds = getAppPreferences().undoSendSeconds;
    sendDurationRef.current = seconds;
    setSending(true);
    if (seconds === 0) {
      doActualSend();
      return;
    }
    setCountdown(seconds);
    const tick = (remaining: number) => {
      if (remaining <= 0) { doActualSend(); return; }
      sendTimeoutRef.current = window.setTimeout(() => {
        setCountdown(remaining - 1);
        tick(remaining - 1);
      }, 1000);
    };
    tick(seconds);
    // Capture the id so doActualSend / undoSend can dismiss it explicitly
    // before transitioning to the result toast.
    sendingToastIdRef.current = toast("Sending…", {
      action: { label: "Undo", onClick: () => undoSend() },
      duration: seconds * 1000,
    });
  }, [doActualSend]);

  const undoSend = React.useCallback(() => {
    if (sendTimeoutRef.current) window.clearTimeout(sendTimeoutRef.current);
    if (sendingToastIdRef.current != null) {
      toast.dismiss(sendingToastIdRef.current);
      sendingToastIdRef.current = null;
    }
    setSending(false);
    setCountdown(0);
    toast("Send cancelled");
  }, []);

  const handleRetry = React.useCallback(() => {
    setSendError(null);
    startSend();
  }, [startSend]);

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

  function handleSaveAsDraft() {
    // Flush the debounced autosave first so any unsaved keystrokes are
    // persisted before we close. Then close — the next compose-on-this-key
    // will rehydrate from the same `_draftKey`.
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const bodyHtml = editor?.getHTML() ?? "";
    saveDraft(_draftKey, {
      subject,
      recipients,
      ccRecipients,
      bccRecipients,
      bodyHtml,
      savedAt: Date.now(),
    });
    toast.success("Draft saved");
    setComposerOpen(false);
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
      <div
        className={cn(
          "relative flex h-full flex-col",
          isDraggingFiles && "outline outline-2 outline-offset-[-2px] outline-accent",
        )}
        onDragEnter={(e) => {
          // Only count drags carrying files — ignore text/element drags inside
          // the editor (e.g. Tiptap's own drag-to-move-text).
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragDepth((d) => d + 1);
          }
        }}
        onDragLeave={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            setDragDepth((d) => Math.max(0, d - 1));
          }
        }}
        onDragOver={(e) => {
          // Required to enable a drop target; also signals "copy" cursor.
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragDepth(0);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) setAttachments((prev) => [...prev, ...files]);
        }}
      >
        {isDraggingFiles && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-accent/10 backdrop-blur-[1px]"
          >
            <div className="rounded-md border border-accent bg-surface-2 px-4 py-2 text-body-strong text-accent shadow-l4">
              Drop files to attach
            </div>
          </div>
        )}
        {sendError && (
          <SendErrorBanner
            message={sendError}
            onRetry={handleRetry}
            onDismiss={() => setSendError(null)}
          />
        )}
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
              <RecipientChip
                key={r}
                address={r}
                onRemove={() => setRecipients((rs) => rs.filter((x) => x !== r))}
              />
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
                  <RecipientChip
                    key={r}
                    address={r}
                    onRemove={() => setCcRecipients((rs) => rs.filter((x) => x !== r))}
                  />
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
                  <RecipientChip
                    key={r}
                    address={r}
                    onRemove={() => setBccRecipients((rs) => rs.filter((x) => x !== r))}
                  />
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
            onKeyDown={(e) => {
              // Tab from Subject jumps directly into the body editor, skipping
              // the formatting toolbar buttons in between (which are click-only
              // anyway, matching Gmail/Outlook convention). Shift+Tab keeps the
              // default backwards traversal to Cc/Bcc/To.
              if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                editor?.commands.focus("start");
              }
            }}
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
          <span className="mx-1 h-4 w-px bg-border-default" />
          <ToolbarBtn
            icon={CalendarDays}
            label="Create calendar event from this email"
            active={false}
            onClick={() => openEventCreateModal({ attendees: [...recipients, ...ccRecipients] })}
          />
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
              <Tooltip label={sendGate.ok ? "" : sendGate.reason}>
                <Button
                  variant="primary"
                  size="md"
                  disabled={hasInvalidRecipients}
                  className="rounded-r-none border-r border-r-white/20"
                  onClick={() => { sendAndArchiveRef.current = false; startSend(); }}
                >
                  {mode === "forward" ? "Forward" : "Send"}
                  <Kbd size="xs" className="ml-1 bg-[rgba(255,255,255,0.15)] text-text-on-accent border-transparent">⌘↵</Kbd>
                </Button>
              </Tooltip>
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
              <CountdownRing total={sendDurationRef.current} remaining={countdown} />
              <span className="ml-1 font-mono text-mono-xs text-text-tertiary">Click to undo</span>
            </button>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="md" onClick={handleSaveAsDraft}>
              Save as draft
            </Button>
            <Button variant="ghost" size="md" onClick={handleDiscard}>
              Discard
            </Button>
          </div>
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
