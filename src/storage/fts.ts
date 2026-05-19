/**
 * Full-text search index (EP-3 web phase).
 *
 * Uses MiniSearch (pure JS, BM25 ranking) for the browser. EP-4 (Tauri) will
 * replace this with SQLite-FTS5 running in-process on the native side where
 * the corpus is real .eml files and scale can reach 100k+ messages.
 *
 * Fields indexed: subject (boost 3), body (boost 1), notes (boost 2).
 * The singleton ftsIndex is populated by initStore() in fixtures.ts alongside
 * the LocalStore hydration, and updated incrementally via addMessage /
 * removeMessage when mutations occur (future: EP-4+).
 */

import MiniSearch from "minisearch";
import type { Message } from "@/data/types";
import type { BodyStore } from "@/storage/bodyStore";

export interface FTSResult {
  id: string;
  score: number;
}

interface FTSDocument {
  id: string;
  subject: string;
  body: string;
  notes: string;
}

export class FTSIndex {
  private _ms = new MiniSearch<FTSDocument>({
    fields: ["subject", "body", "notes"],
    storeFields: ["id"],
    searchOptions: {
      boost: { subject: 3, notes: 2, body: 1 },
      prefix: false,
      fuzzy: 0.1,
      combineWith: "AND",
    },
  });

  private _indexed = new Set<string>();

  reindex(messages: Message[], bodies: Pick<BodyStore, "get">): void {
    this._indexed.clear();
    this.indexMessages(messages, bodies);
  }

  indexMessages(messages: Message[], bodies: Pick<BodyStore, "get">): void {
    const docs: FTSDocument[] = [];
    for (const msg of messages) {
      if (this._indexed.has(msg.id)) continue;
      docs.push({
        id: msg.id,
        subject: msg.subject,
        body: this._stripHtml(bodies.get(msg.bodyRef) ?? msg.snippet),
        notes: msg.notes ?? "",
      });
      this._indexed.add(msg.id);
    }
    if (docs.length > 0) this._ms.addAll(docs);
  }

  addMessage(msg: Message, bodyHtml: string): void {
    if (this._indexed.has(msg.id)) this._ms.remove({ id: msg.id } as FTSDocument);
    const doc: FTSDocument = {
      id: msg.id,
      subject: msg.subject,
      body: this._stripHtml(bodyHtml),
      notes: msg.notes ?? "",
    };
    this._ms.add(doc);
    this._indexed.add(msg.id);
  }

  removeMessage(id: string): void {
    if (!this._indexed.has(id)) return;
    this._ms.remove({ id } as FTSDocument);
    this._indexed.delete(id);
  }

  search(query: string, limit = 200): FTSResult[] {
    if (!query.trim()) return [];
    return this._ms
      .search(query)
      .slice(0, limit)
      .map((r) => ({ id: r.id as string, score: r.score }));
  }

  /** Returns a Set of message IDs matching the query (for use in queryMessages). */
  searchIds(query: string): Set<string> {
    return new Set(this.search(query).map((r) => r.id));
  }

  private _stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

export const ftsIndex = new FTSIndex();
