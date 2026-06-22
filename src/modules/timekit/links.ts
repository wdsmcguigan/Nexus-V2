import type { LocalStore } from "@/storage/local";
import { linksFrom } from "@/state/linksGraph";
import { TIME_ENTRY_ENTITY } from "@/modules/timekit/mutations";

export interface TrackedTask {
  linkId: string;
  taskId: string;
  title: string;
}

/** Resolve a time entry's outgoing "tracks" link to its Task, or null. */
export function entryTrackedTask(store: LocalStore, entryId: string): TrackedTask | null {
  const link = linksFrom(store, TIME_ENTRY_ENTITY, entryId, "tracks")[0];
  if (!link) return null;
  return {
    linkId: link.id,
    taskId: link.dstId,
    title: store.tasks.get(link.dstId)?.title ?? "(task)",
  };
}
