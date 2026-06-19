import type { LocalStore } from "@/storage/local";
import { linksFrom } from "@/state/linksGraph";
import { TASK_ENTITY } from "@/modules/tasks/mutations";

export interface LinkedItem {
  linkId: string;
  entityType: string;
  entityId: string;
  label: string;
}

/** Resolve a task's outgoing "tracks" links into displayable items. */
export function taskLinkedItems(store: LocalStore, taskId: string): LinkedItem[] {
  return linksFrom(store, TASK_ENTITY, taskId).map((l) => ({
    linkId: l.id,
    entityType: l.dstType,
    entityId: l.dstId,
    label: labelFor(store, l.dstType, l.dstId),
  }));
}

function labelFor(store: LocalStore, type: string, id: string): string {
  if (type === "nexus/email.message") return store.messages.get(id)?.subject || "(email)";
  if (type === "nexus/contact") return store.contacts.get(id)?.name || "(contact)";
  if (type === "nexus/calendar.event") return store.calendarEvents.get(id)?.title || "(event)";
  return id;
}
