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
} from "lucide-react";
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
import { Tooltip } from "@/components/ui/Tooltip";
import { Kbd } from "@/components/ui/Kbd";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";
import { pickPanelLink } from "@/design-system/tokens";
import { isTauri, sendMessage } from "@/storage/tauri";
import { localStore } from "@/storage/local";
import { bodyStore } from "@/storage/bodyStore";
import { formatAbsoluteTime } from "@/lib/utils";

const PANEL_ID = "composer";
const COUNTDOWN_SECONDS = 5;

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

  const replyMsg = composerContext?.replyToMessage ?? null;
  const mode = composerContext?.mode ?? null;

  // ── Recipients ────────────────────────────────────────────────────────────

  const [recipients, setRecipients] = React.useState<string[]>(() => {
    if (!replyMsg || mode === "forward") return [];
    if (mode === "reply") return [replyMsg.fromAddr.email];
    const self = Array.from(localStore.accounts.values()).find((a) => a.provider === "gmail")?.email ?? "";
    return [replyMsg.fromAddr.email, ...replyMsg.toAddrs.map((t) => t.email).filter((e) => e !== self)];
  });
  const [ccRecipients, setCcRecipients] = React.useState<string[]>(() => {
    if (mode === "reply-all" && replyMsg) return replyMsg.ccAddrs.map((t) => t.email);
    return [];
  });
  const [draftInput, setDraftInput] = React.useState("");
  const [ccDraftInput, setCcDraftInput] = React.useState("");
  const [showCc, setShowCc] = React.useState(mode === "reply-all");

  // ── Subject ───────────────────────────────────────────────────────────────

  const [subject, setSubject] = React.useState(() => {
    if (!replyMsg) return "";
    if (mode === "forward") return `Fwd: ${replyMsg.subject}`;
    const s = replyMsg.subject;
    return s.startsWith("Re:") ? s : `Re: ${s}`;
  });

  // ── Tiptap editor ─────────────────────────────────────────────────────────

  const initialContent = replyMsg ? buildQuotedHtml(replyMsg) : "";

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

  const [sending, setSending] = React.useState(false);
  const [countdown, setCountdown] = React.useState(0);
  const sendTimeoutRef = React.useRef<number | null>(null);

  const doActualSend = React.useCallback(async () => {
    setSending(false);
    setCountdown(0);
    const bodyHtml = editor?.getHTML() ?? "";
    if (isTauri()) {
      const accounts = Array.from(localStore.accounts.values());
      const gmailAccount = accounts.find((a) => a.provider === "gmail");
      if (!gmailAccount) { toast.error("No Gmail account connected"); return; }
      try {
        await sendMessage({
          accountId: gmailAccount.id,
          from: gmailAccount.email,
          to: recipients,
          subject,
          bodyHtml,
          replyToMessageId: replyMsg?.providerIds?.messageId,
        });
        toast.success("Sent");
      } catch (e) {
        toast.error(`Send failed: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    } else {
      toast.success("Sent (web mode — not actually delivered)");
    }
    setComposerOpen(false);
  }, [editor, recipients, subject, replyMsg, setComposerOpen]);

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

  // ⌘↵ to send
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!sending) startSend();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sending, startSend]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function commitRecipient() {
    const v = draftInput.trim().replace(/,$/, "");
    if (!v) return;
    setRecipients((r) => [...r, v]);
    setDraftInput("");
  }
  function commitCc() {
    const v = ccDraftInput.trim().replace(/,$/, "");
    if (!v) return;
    setCcRecipients((r) => [...r, v]);
    setCcDraftInput("");
  }

  const fromEmail =
    Array.from(localStore.accounts.values()).find((a) => a.provider === "gmail")?.email ??
    "me@nexus.app";

  const headerMeta = mode
    ? `${mode === "forward" ? "Fwd" : "Re"}: ${replyMsg?.fromAddr.name ?? "draft"}`
    : (recipients[0] ?? "new message");

  return (
    <Panel
      panelId={PANEL_ID}
      type="stage"
      header={
        <PanelHeader
          title={mode === "forward" ? "Forward" : mode ? "Reply" : "Compose"}
          meta={headerMeta}
          actions={
            <Tooltip label="Discard">
              <Button variant="ghost" size="sm" iconOnly aria-label="Close composer" onClick={() => setComposerOpen(false)}>
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
          <button type="button" className="flex h-9 w-full items-center gap-1 text-left">
            <span className="font-mono text-mono-sm text-text-secondary">{fromEmail}</span>
            <ChevronDown size={12} className="text-text-tertiary" />
          </button>
        </FieldRow>

        {/* To */}
        <FieldRow label="To">
          <div className="flex h-auto min-h-9 flex-wrap items-center gap-1 py-1.5">
            {recipients.map((r) => (
              <Tag key={r} color={pickPanelLink(r)} size="md" removable onRemove={() => setRecipients((rs) => rs.filter((x) => x !== r))}>
                {r}
              </Tag>
            ))}
            <input
              value={draftInput}
              onChange={(e) => setDraftInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitRecipient(); } }}
              onBlur={commitRecipient}
              placeholder={recipients.length === 0 ? "Add recipient…" : ""}
              className="min-w-[120px] flex-1 bg-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none"
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
                <input
                  value={ccDraftInput}
                  onChange={(e) => setCcDraftInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitCc(); } }}
                  onBlur={commitCc}
                  placeholder={ccRecipients.length === 0 ? "Add cc…" : ""}
                  className="min-w-[120px] flex-1 bg-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none"
                />
              </div>
            </FieldRow>
            <FieldRow label="Bcc">
              <input placeholder="Add bcc…" className="h-9 w-full bg-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none" />
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
        <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-1 px-3">
          <Paperclip size={12} className="text-text-tertiary" />
          <span className="flex-1 font-mono text-mono-sm text-text-muted">No attachments</span>
          <Button variant="ghost" size="xs">+ Attach</Button>
        </div>

        {/* Send footer */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-t border-border-subtle bg-surface-1 px-3">
          {!sending ? (
            <Button variant="primary" size="md" onClick={startSend}>
              {mode === "forward" ? "Forward" : "Send"}
              <Kbd size="xs" className="ml-1 bg-[rgba(255,255,255,0.15)] text-text-on-accent border-transparent">⌘↵</Kbd>
            </Button>
          ) : (
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
          <Button variant="ghost" size="md" className="ml-auto" onClick={() => setComposerOpen(false)}>
            Discard
          </Button>
        </div>
      </div>
    </Panel>
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
