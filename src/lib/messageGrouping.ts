/**
 * Flatten a message list into virtual-list items with group headers. Extracted
 * from EmailListPanel so the grouping/ordering rules can be unit-tested without
 * the virtualized component or the store.
 */

import type { Message } from "@/data/types";

/** A flattened virtual-list entry: either a message row or a group header. */
export type VItem =
  | { kind: "row"; msg: Message }
  | { kind: "header"; label: string };

export type GroupBy = "none" | "priority" | "status";

const PRI_GROUP_LABELS: Record<number, string> = { 1: "Urgent", 2: "High", 3: "Normal", 4: "Low" };

/**
 * Build the virtual-list items for the given grouping:
 * - `none`:     rows in input order, no headers.
 * - `priority`: Urgent → High → Normal → Low, then "No Priority" last. Empty
 *               priority buckets are omitted.
 * - `status`:   "No Status" first, then each status in first-seen order. Names
 *               are resolved via `resolveStatusName`, falling back to the id.
 */
export function buildGroupedItems(
  messages: Message[],
  groupBy: GroupBy,
  resolveStatusName: (statusId: string) => string | undefined = () => undefined,
): VItem[] {
  if (groupBy === "none") {
    return messages.map((msg) => ({ kind: "row", msg }));
  }

  if (groupBy === "priority") {
    const groups = new Map<number | null, Message[]>();
    for (const msg of messages) {
      const key = msg.priority ?? null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(msg);
    }
    const items: VItem[] = [];
    for (const level of [1, 2, 3, 4] as const) {
      const msgs = groups.get(level);
      if (msgs?.length) {
        items.push({ kind: "header", label: PRI_GROUP_LABELS[level]! });
        for (const msg of msgs) items.push({ kind: "row", msg });
      }
    }
    const noPri = groups.get(null);
    if (noPri?.length) {
      items.push({ kind: "header", label: "No Priority" });
      for (const msg of noPri) items.push({ kind: "row", msg });
    }
    return items;
  }

  // groupBy === "status"
  const groups = new Map<string | null, Message[]>();
  for (const msg of messages) {
    const key = msg.statusId ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(msg);
  }
  const items: VItem[] = [];
  const noStatus = groups.get(null);
  if (noStatus?.length) {
    items.push({ kind: "header", label: "No Status" });
    for (const msg of noStatus) items.push({ kind: "row", msg });
  }
  for (const [statusId, msgs] of groups) {
    if (statusId === null) continue;
    items.push({ kind: "header", label: resolveStatusName(statusId) ?? statusId });
    for (const msg of msgs) items.push({ kind: "row", msg });
  }
  return items;
}
