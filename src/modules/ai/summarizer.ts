import { isTauri, aiSummarize } from "@/storage/tauri";

export interface ThreadMessage {
  subject: string;
  from: string;
  body: string;
}

export interface Summarizer {
  summarize(messages: ThreadMessage[]): Promise<string>;
}

/** Flatten a thread into prompt-ready text (capped so a huge thread can't blow the request). */
export function threadToText(messages: ThreadMessage[], maxChars = 12000): string {
  const text = messages
    .map((m) => `Subject: ${m.subject}\nFrom: ${m.from}\n\n${m.body}`)
    .join("\n\n---\n\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/** Deterministic offline summary — used in web mode / e2e. Never throws. */
export const stubSummarizer: Summarizer = {
  async summarize(messages) {
    const first = messages[0]?.subject ?? "(no subject)";
    return `Summary of ${messages.length} message(s) about "${first}". (stub summarizer)`;
  },
};

/** Real summary via the Rust IPC (key server-side). Only valid in the Tauri app. */
export const ipcSummarizer: Summarizer = {
  async summarize(messages) {
    return aiSummarize(threadToText(messages));
  },
};

/** Pick the real summarizer in the Tauri app, the deterministic stub otherwise. */
export function getSummarizer(): Summarizer {
  return isTauri() ? ipcSummarizer : stubSummarizer;
}
