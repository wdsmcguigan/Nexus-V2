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

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border-subtle px-3">
      <label className="w-12 shrink-0 font-sans text-caption text-text-tertiary">
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Tooltip label={label}>
      <Button variant="ghost" size="sm" iconOnly aria-label={label}>
        <Icon />
      </Button>
    </Tooltip>
  );
}

function buildQuotedBlock(msg: { fromAddr: { name: string; email: string }; receivedAt: number; snippet: string; bodyRef: string }): string {
  const date = formatAbsoluteTime(new Date(msg.receivedAt));
  const rawBody = bodyStore.get(msg.bodyRef) ?? `<p>${msg.snippet}</p>`;
  return `<br><br><div style="padding-left:12px;border-left:2px solid #4a5568;margin-left:0;color:#9ca3af">
    <div style="margin-bottom:8px;font-size:12px">On ${date}, ${msg.fromAddr.name} &lt;${msg.fromAddr.email}&gt; wrote:</div>
    ${rawBody}
  </div>`;
}

export function EmailComposerPanel() {
  const setComposerOpen = useWorkspace((s) => s.setComposerOpen);
  const composerContext = useWorkspace((s) => s.composerContext);

  const replyMsg = composerContext?.replyToMessage ?? null;
  const mode = composerContext?.mode ?? null;

  const [recipients, setRecipients] = React.useState<string[]>(() => {
    if (!replyMsg || mode === "forward") return [];
    if (mode === "reply") return [replyMsg.fromAddr.email];
    // reply-all: original sender + all to's except self
    const self = Array.from(localStore.accounts.values()).find((a) => a.provider === "gmail")?.email ?? "";
    return [replyMsg.fromAddr.email, ...replyMsg.toAddrs.map((t) => t.email).filter((e) => e !== self)];
  });

  const [ccRecipients, setCcRecipients] = React.useState<string[]>(() => {
    if (mode === "reply-all" && replyMsg) {
      return replyMsg.ccAddrs.map((t) => t.email);
    }
    return [];
  });

  const [draftInput, setDraftInput] = React.useState("");
  const [ccDraftInput, setCcDraftInput] = React.useState("");
  const [showCc, setShowCc] = React.useState(mode === "reply-all");

  const [subject, setSubject] = React.useState(() => {
    if (!replyMsg) return "Q2 review — quick note";
    if (mode === "forward") return `Fwd: ${replyMsg.subject}`;
    const subj = replyMsg.subject;
    return subj.startsWith("Re:") ? subj : `Re: ${subj}`;
  });

  const [body, setBody] = React.useState(() => {
    if (!replyMsg || mode === "forward") {
      const quoted = replyMsg ? buildQuotedBlock(replyMsg) : "";
      return quoted;
    }
    return buildQuotedBlock(replyMsg);
  });

  const [sending, setSending] = React.useState(false);
  const [countdown, setCountdown] = React.useState(0);
  const sendTimeoutRef = React.useRef<number | null>(null);

  const onCommitRecipient = React.useCallback(() => {
    const v = draftInput.trim().replace(/,$/, "");
    if (!v) return;
    setRecipients((r) => [...r, v]);
    setDraftInput("");
  }, [draftInput]);

  const onCommitCc = React.useCallback(() => {
    const v = ccDraftInput.trim().replace(/,$/, "");
    if (!v) return;
    setCcRecipients((r) => [...r, v]);
    setCcDraftInput("");
  }, [ccDraftInput]);

  const doActualSend = React.useCallback(async () => {
    setSending(false);
    setCountdown(0);
    if (isTauri()) {
      const accounts = Array.from(localStore.accounts.values());
      const gmailAccount = accounts.find((a) => a.provider === "gmail");
      if (!gmailAccount) {
        toast.error("No Gmail account connected");
        return;
      }
      try {
        const allTo = recipients;
        const bodyHtml = body.replace(/\n/g, "<br>");
        await sendMessage({
          accountId: gmailAccount.id,
          from: gmailAccount.email,
          to: allTo,
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
      toast.success("Sent");
    }
    setComposerOpen(false);
  }, [recipients, subject, body, replyMsg, setComposerOpen]);

  const startSend = React.useCallback(() => {
    setSending(true);
    setCountdown(COUNTDOWN_SECONDS);
    const tick = (remaining: number) => {
      if (remaining <= 0) {
        doActualSend();
        return;
      }
      sendTimeoutRef.current = window.setTimeout(() => {
        setCountdown(remaining - 1);
        tick(remaining - 1);
      }, 1000);
    };
    tick(COUNTDOWN_SECONDS);
    toast("Sending… click Undo to cancel", {
      action: {
        label: "Undo",
        onClick: () => undoSend(),
      },
      duration: COUNTDOWN_SECONDS * 1000,
    });
  }, [doActualSend]);

  const undoSend = React.useCallback(() => {
    if (sendTimeoutRef.current) window.clearTimeout(sendTimeoutRef.current);
    setSending(false);
    setCountdown(0);
    toast("Send cancelled");
  }, []);

  React.useEffect(() => {
    return () => {
      if (sendTimeoutRef.current) window.clearTimeout(sendTimeoutRef.current);
    };
  }, []);

  const headerMeta = mode
    ? `${mode === "forward" ? "Fwd" : "Re"}: ${replyMsg?.fromAddr.name ?? "draft"}`
    : (recipients[0] ?? "draft");

  return (
    <Panel
      panelId={PANEL_ID}
      type="stage"
      header={
        <PanelHeader
          title={mode === "forward" ? "Forward" : mode ? "Reply" : "Compose"}
          meta={headerMeta}
          actions={
            <>
              <Tooltip label="Discard">
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label="Close composer"
                  onClick={() => setComposerOpen(false)}
                >
                  <X />
                </Button>
              </Tooltip>
            </>
          }
        />
      }
    >
      <div className="flex h-full flex-col">
        <FieldRow label="From">
          <button
            type="button"
            className="flex h-9 w-full items-center gap-1 text-left text-body text-text-primary"
          >
            <span className="font-mono text-mono-sm text-text-secondary">
              {Array.from(localStore.accounts.values()).find((a) => a.provider === "gmail")?.email ?? "will@nexus.app"}
            </span>
            <ChevronDown size={12} className="text-text-tertiary" />
          </button>
        </FieldRow>

        <FieldRow label="To">
          <div className="flex h-auto min-h-9 flex-wrap items-center gap-1 py-1.5">
            {recipients.map((r) => (
              <Tag
                key={r}
                color={pickPanelLink(r)}
                size="md"
                removable
                onRemove={() =>
                  setRecipients((rs) => rs.filter((x) => x !== r))
                }
              >
                {r}
              </Tag>
            ))}
            <input
              value={draftInput}
              onChange={(e) => setDraftInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  onCommitRecipient();
                }
              }}
              onBlur={onCommitRecipient}
              placeholder={recipients.length === 0 ? "Add recipient…" : ""}
              className="min-w-[120px] flex-1 bg-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>
        </FieldRow>

        {!showCc ? (
          <button
            onClick={() => setShowCc(true)}
            className="border-b border-border-subtle px-3 py-1.5 text-left text-caption text-text-tertiary hover:text-text-secondary"
          >
            Cc Bcc
          </button>
        ) : (
          <>
            <FieldRow label="Cc">
              <div className="flex h-auto min-h-9 flex-wrap items-center gap-1 py-1.5">
                {ccRecipients.map((r) => (
                  <Tag
                    key={r}
                    color={pickPanelLink(r)}
                    size="md"
                    removable
                    onRemove={() => setCcRecipients((rs) => rs.filter((x) => x !== r))}
                  >
                    {r}
                  </Tag>
                ))}
                <input
                  value={ccDraftInput}
                  onChange={(e) => setCcDraftInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      onCommitCc();
                    }
                  }}
                  onBlur={onCommitCc}
                  placeholder={ccRecipients.length === 0 ? "Add cc…" : ""}
                  className="min-w-[120px] flex-1 bg-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none"
                />
              </div>
            </FieldRow>
            <FieldRow label="Bcc">
              <input
                placeholder="Add bcc…"
                className="h-9 w-full bg-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none"
              />
            </FieldRow>
          </>
        )}

        <FieldRow label="Subject">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            size="sm"
            className="border-none bg-transparent px-0 hover:border-none focus:border-none focus:shadow-none"
          />
        </FieldRow>

        {/* Tiptap toolbar (visual stub) */}
        <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border-subtle bg-surface-1 px-2">
          <ToolbarButton icon={Bold} label="Bold" />
          <ToolbarButton icon={Italic} label="Italic" />
          <ToolbarButton icon={Underline} label="Underline" />
          <span className="mx-1 h-4 w-px bg-border-default" />
          <ToolbarButton icon={Link2} label="Link" />
          <span className="mx-1 h-4 w-px bg-border-default" />
          <ToolbarButton icon={List} label="Bullet list" />
          <ToolbarButton icon={ListOrdered} label="Numbered list" />
          <ToolbarButton icon={Quote} label="Quote" />
          <ToolbarButton icon={Code} label="Code" />
        </div>

        {/* Editor body */}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={cn(
            "min-h-0 flex-1 resize-none bg-canvas px-4 py-3 font-sans text-body text-text-primary",
            "outline-none placeholder:text-text-muted nx-scroll",
          )}
          data-scroll
          placeholder={mode ? "" : "Write your message…"}
        />

        {/* Attachments strip */}
        <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-1 px-3">
          <Paperclip size={12} className="text-text-tertiary" />
          {mode !== "forward" && (
            <>
              <span className="font-mono text-mono-sm text-text-secondary">
                Q2-deck.pdf
              </span>
              <span className="font-mono text-mono-xs text-text-tertiary">
                4.2 MB
              </span>
            </>
          )}
          <Button variant="ghost" size="xs" className="ml-auto">
            + Attach
          </Button>
        </div>

        {/* Send footer */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-t border-border-subtle bg-surface-1 px-3">
          {!sending ? (
            <Button variant="primary" size="md" onClick={startSend}>
              {mode === "forward" ? "Forward" : "Send"}
              <Kbd size="xs" className="ml-1 bg-[rgba(255,255,255,0.15)] text-text-on-accent border-transparent">
                ⌘↵
              </Kbd>
            </Button>
          ) : (
            <button
              type="button"
              onClick={undoSend}
              className={cn(
                "relative flex h-ctrl-md items-center gap-2 rounded-sm px-3",
                "bg-accent-soft text-text-primary border border-accent",
                "transition-colors duration-fast hover:bg-accent-ghost",
              )}
            >
              <span className="font-sans text-body-strong">
                Sending… {countdown}
              </span>
              <CountdownRing total={COUNTDOWN_SECONDS} remaining={countdown} />
              <span className="ml-1 font-mono text-mono-xs text-text-tertiary">
                Click to undo
              </span>
            </button>
          )}
          <span className="ml-3 font-mono text-mono-xs text-text-tertiary">
            Saved 2s ago
          </span>
          <Button
            variant="ghost"
            size="md"
            className="ml-auto"
            onClick={() => setComposerOpen(false)}
          >
            Discard
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function CountdownRing({
  total,
  remaining,
}: {
  total: number;
  remaining: number;
}) {
  const radius = 6;
  const circ = 2 * Math.PI * radius;
  const fraction = remaining / total;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="var(--color-border-default)"
        strokeWidth="1.5"
      />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - fraction)}
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
        style={{ transition: "stroke-dashoffset 1s linear" }}
      />
    </svg>
  );
}
