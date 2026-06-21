import type { Link, Message, Note } from "@/data/types";
import type { LocalStore } from "@/storage/local";
import { recordMutations } from "@/state/mutations";
import { makeNote } from "@/modules/notes/model";
import { KIND as NOTES_KIND, NOTE_ENTITY } from "@/modules/notes/mutations";
import { getSummarizer, type ThreadMessage } from "@/modules/ai/summarizer";

const GENERATED_BY = "claude (ai-tracer)";

/** Gather a message's thread into ThreadMessage[] (the AI's context). */
export function gatherThread(
  messageId: string,
  store: LocalStore,
): { anchor: Message | undefined; messages: ThreadMessage[] } {
  const anchor = store.messages.get(messageId);
  if (!anchor) return { anchor: undefined, messages: [] };
  const threadMsgs = Array.from(store.messages.values()).filter((m) => m.threadId === anchor.threadId);
  const ordered = threadMsgs.length ? threadMsgs : [anchor];
  const messages: ThreadMessage[] = ordered.map((m) => ({
    subject: m.subject || "(no subject)",
    from: m.fromAddr?.email ?? "",
    body: m.snippet ?? "",
  }));
  return { anchor, messages };
}

/** Build the AI summary note + a 'summarizes' link, emitted as one atomic source:"ai" action. */
export function createSummaryNote(
  subject: string,
  summary: string,
  threadAnchorId: string,
  store: LocalStore,
): Note {
  const note = makeNote(
    { title: `AI summary: ${subject}`, body: `<p>${escapeHtml(summary)}</p>` },
    store.vault?.id ?? "local",
    Date.now(),
  );
  const link: Link = {
    id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    srcType: NOTE_ENTITY,
    srcId: note.id,
    linkType: "summarizes",
    dstType: "nexus/email.message",
    dstId: threadAnchorId,
    createdAt: Date.now(),
  };
  recordMutations(
    [
      { kind: NOTES_KIND.CREATE, payload: note },
      { kind: "CREATE_LINK", payload: link },
    ],
    store,
    "Summarize thread",
    { source: "ai", generatedBy: GENERATED_BY },
  );
  return note;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The command entry: gather → summarize → emit the AI note. Throws are surfaced by the caller. */
export async function summarizeThread(messageId: string, store: LocalStore): Promise<void> {
  const { anchor, messages } = gatherThread(messageId, store);
  if (!anchor) return;
  const summary = await getSummarizer().summarize(messages);
  createSummaryNote(anchor.subject || "(no subject)", summary, anchor.id, store);
}
