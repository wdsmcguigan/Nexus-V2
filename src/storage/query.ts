/**
 * WF-SEARCH-QUERY — queryMessages(filter)
 *
 * Composes indexed predicates across any combination of metadata axes.
 * EP-3: textQuery routes through the FTS index (MiniSearch BM25) which
 * indexes subject + body + notes. EP-4 (Tauri) will swap the FTS backend
 * for SQLite-FTS5 once real .eml bodies are available at scale.
 *
 * Performance guarantee: every axis resolved via an index (Set intersection),
 * not a full table scan. The canonical multi-axis query must run <10ms on
 * 100k messages (Gate 0g benchmark).
 */

import type { Message, MetadataFilter, QueryResult } from "@/data/types";
import { localStore } from "@/storage/local";
import { ftsIndex, FTSIndex } from "@/storage/fts";

const DEFAULT_LIMIT = 100;

/**
 * Intersect two sets, returning the smaller result.
 * Mutates neither set. Returns null if either input is null (no-op axis).
 */
function intersect(a: Set<string> | null, b: Set<string> | null): Set<string> | null {
  if (a === null) return b;
  if (b === null) return a;
  // Iterate the smaller set
  if (a.size > b.size) return intersect(b, a);
  const result = new Set<string>();
  for (const id of a) {
    if (b.has(id)) result.add(id);
  }
  return result;
}

export function queryMessages(
  filter: MetadataFilter = {},
  store = localStore,
  fts: FTSIndex = ftsIndex,
): QueryResult {
  const t0 = performance.now();

  // ── Phase 1: index-based candidate set ──────────────────────────
  // Each indexed axis produces a Set<messageId>. We intersect them all.
  // null = "all messages" (axis not filtered).

  let candidates: Set<string> | null = null;

  // Folder
  if (filter.folderId !== undefined) {
    candidates = intersect(candidates, store.messagesByFolder.get(filter.folderId) ?? new Set());
  }

  // Labels (AND semantics — must have ALL requested labels)
  if (filter.labelIds && filter.labelIds.length > 0) {
    for (const lid of filter.labelIds) {
      candidates = intersect(candidates, store.messagesByLabel.get(lid) ?? new Set());
    }
  }

  // Tags (AND semantics)
  if (filter.tags && filter.tags.length > 0) {
    for (const tag of filter.tags) {
      candidates = intersect(candidates, store.messagesByTag.get(tag) ?? new Set());
    }
  }

  // Status (exact match)
  if (filter.statusId !== undefined) {
    if (filter.statusId === null) {
      // "no status" — need all messages without a statusId
      const withStatus = new Set<string>();
      for (const ids of store.messagesByStatus.values()) {
        for (const id of ids) withStatus.add(id);
      }
      const noStatus = new Set<string>();
      for (const id of store.messages.keys()) {
        if (!withStatus.has(id)) noStatus.add(id);
      }
      candidates = intersect(candidates, noStatus);
    } else {
      candidates = intersect(candidates, store.messagesByStatus.get(filter.statusId) ?? new Set());
    }
  }

  // Thread
  if (filter.threadId !== undefined) {
    candidates = intersect(candidates, store.messagesByThread.get(filter.threadId) ?? new Set());
  }

  // Contact participant (from/to/cc — uses messagesByContact index)
  if (filter.contactId !== undefined) {
    candidates = intersect(candidates, store.messagesByContact.get(filter.contactId) ?? new Set());
  }

  // FTS (EP-3) — intersect before resolving Message objects
  if (filter.textQuery && filter.textQuery.trim().length > 0) {
    candidates = intersect(candidates, fts.searchIds(filter.textQuery));
  }

  // Custom field equality
  if (filter.customFieldValues) {
    for (const [fieldId, value] of Object.entries(filter.customFieldValues)) {
      if (value === undefined) continue;
      const fieldMap = store.messagesByCustomField.get(fieldId);
      const key = JSON.stringify(value);
      candidates = intersect(candidates, fieldMap?.get(key) ?? new Set());
    }
  }

  // ── Phase 2: resolve candidate IDs to Message objects ───────────

  let result: Message[];
  if (candidates === null) {
    // No indexed filter applied — scan all messages
    result = Array.from(store.messages.values());
  } else {
    result = [];
    for (const id of candidates) {
      const msg = store.messages.get(id);
      if (msg) result.push(msg);
    }
  }

  // ── Phase 3: post-filter on non-indexed predicates ───────────────
  // Priority range, star, pinned, muted, read, flagged, textQuery.
  // These are O(candidates) not O(total), so still fast after index narrowing.

  if (filter.maxPriority !== undefined) {
    result = result.filter(
      (m) => m.priority !== null && m.priority <= filter.maxPriority!,
    );
  }
  if (filter.minPriority !== undefined) {
    result = result.filter(
      (m) => m.priority !== null && m.priority >= filter.minPriority!,
    );
  }
  if (filter.star !== undefined) {
    result = result.filter((m) => m.star === filter.star);
  }
  if (filter.pinned !== undefined) {
    result = result.filter((m) => m.pinned === filter.pinned);
  }
  if (filter.muted !== undefined) {
    result = result.filter((m) => m.muted === filter.muted);
  }
  if (filter.read !== undefined) {
    result = result.filter((m) => m.flags.read === filter.read);
  }
  if (filter.flagged !== undefined) {
    result = result.filter((m) => (m.flag !== null) === filter.flagged);
  }

  const total = result.length;

  // ── Phase 4: sort ────────────────────────────────────────────────

  const dir = filter.sortDir === "asc" ? 1 : -1;
  const sortBy = filter.sortBy ?? "receivedAt";

  result.sort((a, b) => {
    // Pinned messages always float to top regardless of sort
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

    switch (sortBy) {
      case "priority": {
        const ap = a.priority ?? 5; // null priority sorts last
        const bp = b.priority ?? 5;
        if (ap !== bp) return (ap - bp) * dir;
        // Tie-break by receivedAt desc
        return (b.receivedAt - a.receivedAt);
      }
      case "status": {
        const as = a.statusId ?? "￿";
        const bs = b.statusId ?? "￿";
        if (as !== bs) return as < bs ? -dir : dir;
        return (b.receivedAt - a.receivedAt);
      }
      case "sender": {
        const af = a.fromAddr.name || a.fromAddr.email;
        const bf = b.fromAddr.name || b.fromAddr.email;
        if (af !== bf) return af < bf ? -dir : dir;
        return (b.receivedAt - a.receivedAt);
      }
      case "receivedAt":
      default:
        return (a.receivedAt - b.receivedAt) * dir;
    }
  });

  // ── Phase 5: pagination ───────────────────────────────────────────

  const limit = filter.limit ?? DEFAULT_LIMIT;
  let offset = 0;
  if (filter.cursor) {
    const decoded = parseInt(filter.cursor, 10);
    if (!isNaN(decoded)) offset = decoded;
  }
  const page = result.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const nextCursor = nextOffset < total ? String(nextOffset) : null;

  const took = performance.now() - t0;

  return { items: page, total, took, nextCursor };
}
