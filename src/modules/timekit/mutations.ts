import type { LocalStore } from "@/storage/local";
import { recordMutation, recordMutations, type ModuleInverseBuilder } from "@/state/mutations";
import { makeTimeEntry, makeTimer } from "@/modules/timekit/model";
import type { CountdownTimer, Link, MutationSource, TimeEntry } from "@/data/types";

/** Provenance opts forwarded to recordMutation (e.g. the tick worker's source:"module"). */
export type TimekitOpts = { source?: MutationSource; generatedBy?: string };

export const TIMEKIT_NS = "org.nexus.timekit";

export const KIND = {
  SET_ZONES: `${TIMEKIT_NS}/SET_TIMEKIT_ZONES`,
  START_TRACKING: `${TIMEKIT_NS}/START_TRACKING`,
  STOP_TRACKING: `${TIMEKIT_NS}/STOP_TRACKING`,
  SET_ENTRY_NOTE: `${TIMEKIT_NS}/SET_ENTRY_NOTE`,
  DELETE_ENTRY: `${TIMEKIT_NS}/DELETE_ENTRY`,
  CREATE_TIMER: `${TIMEKIT_NS}/CREATE_TIMER`,
  START_TIMER: `${TIMEKIT_NS}/START_TIMER`,
  PAUSE_TIMER: `${TIMEKIT_NS}/PAUSE_TIMER`,
  RESUME_TIMER: `${TIMEKIT_NS}/RESUME_TIMER`,
  COMPLETE_TIMER: `${TIMEKIT_NS}/COMPLETE_TIMER`,
  RESET_TIMER: `${TIMEKIT_NS}/RESET_TIMER`,
  DELETE_TIMER: `${TIMEKIT_NS}/DELETE_TIMER`,
} as const;

/** Entity-type id for a time entry (used as srcType in links). */
export const TIME_ENTRY_ENTITY = "org.nexus.timekit/time-entry";

/** Replace the saved Clock timezone list. */
export function setTimekitZonesMutation(zones: string[], store: LocalStore): void {
  recordMutation(KIND.SET_ZONES, { zones }, store);
}

/** Start a running time entry. */
export function startTrackingMutation(input: Partial<TimeEntry>, store: LocalStore): TimeEntry {
  const e = makeTimeEntry(input, store.vault?.id ?? "local", Date.now());
  recordMutation(KIND.START_TRACKING, e, store);
  return e;
}

/**
 * Start a running entry linked to a Task as ONE atomic undo unit
 * (entry --tracks--> task). Mirrors createTaskFromEntity.
 */
export function startTrackingWithTask(taskId: string, store: LocalStore): TimeEntry {
  const entry = makeTimeEntry({}, store.vault?.id ?? "local", Date.now());
  const link: Link = {
    id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultId: store.vault?.id ?? "local",
    srcType: TIME_ENTRY_ENTITY,
    srcId: entry.id,
    linkType: "tracks",
    dstType: "org.nexus.tasks/task",
    dstId: taskId,
    createdAt: Date.now(),
  };
  recordMutations(
    [
      { kind: KIND.START_TRACKING, payload: entry },
      { kind: "CREATE_LINK", payload: link },
    ],
    store,
    "Start tracking task",
  );
  return entry;
}

export function stopTrackingMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.STOP_TRACKING, { id, stoppedAt: Date.now() }, store);
}

export function setEntryNoteMutation(id: string, note: string | null, store: LocalStore): void {
  recordMutation(KIND.SET_ENTRY_NOTE, { id, note }, store);
}

export function deleteEntryMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.DELETE_ENTRY, { id }, store);
}

export function createTimerMutation(label: string, durationMs: number, store: LocalStore): CountdownTimer {
  const t = makeTimer({ label, durationMs }, store.vault?.id ?? "local", Date.now());
  recordMutation(KIND.CREATE_TIMER, t, store);
  return t;
}

export function startTimerMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.START_TIMER, { id, startedAt: Date.now() }, store);
}

/** Pause a running timer: fold the current run into elapsedBeforeMs (computed at record-time). */
export function pauseTimerMutation(id: string, store: LocalStore): void {
  const t = store.countdownTimers.get(id);
  if (!t || t.state !== "running" || t.startedAt == null) return;
  const elapsedBeforeMs = t.elapsedBeforeMs + (Date.now() - t.startedAt);
  recordMutation(KIND.PAUSE_TIMER, { id, elapsedBeforeMs }, store);
}

export function resumeTimerMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.RESUME_TIMER, { id, startedAt: Date.now() }, store);
}

/** Mark a timer done. The tick worker passes { source: "module" }; manual calls omit it. */
export function completeTimerMutation(id: string, store: LocalStore, opts?: TimekitOpts): void {
  recordMutation(KIND.COMPLETE_TIMER, { id }, store, opts);
}

export function resetTimerMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.RESET_TIMER, { id }, store);
}

export function deleteTimerMutation(id: string, store: LocalStore): void {
  recordMutation(KIND.DELETE_TIMER, { id }, store);
}

/**
 * Inverse builder for the whole timekit namespace. Captures prior state BEFORE
 * the mutation applies (substrate §4.3). Grows a case per kind across stages.
 */
export const timekitInverse: ModuleInverseBuilder = (kind, payload, store) => {
  const s = store as LocalStore;
  switch (kind) {
    case KIND.SET_ZONES: {
      return {
        reverseSteps: [{ kind: KIND.SET_ZONES, payload: { zones: [...s.timekitZones] } }],
        description: "Set clock zones",
      };
    }
    case KIND.START_TRACKING: {
      const e = payload as TimeEntry;
      return { reverseSteps: [{ kind: KIND.DELETE_ENTRY, payload: { id: e.id } }], description: "Start tracking" };
    }
    case KIND.STOP_TRACKING: {
      const p = payload as { id: string };
      const prev = s.timeEntries.get(p.id);
      if (!prev) return null;
      // Restore prior stoppedAt (null ⇒ running again).
      return { reverseSteps: [{ kind: KIND.STOP_TRACKING, payload: { id: p.id, stoppedAt: prev.stoppedAt } }], description: "Stop tracking" };
    }
    case KIND.SET_ENTRY_NOTE: {
      const p = payload as { id: string };
      const prev = s.timeEntries.get(p.id);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.SET_ENTRY_NOTE, payload: { id: p.id, note: prev.note } }], description: "Edit entry note" };
    }
    case KIND.DELETE_ENTRY: {
      const p = payload as { id: string };
      const prev = s.timeEntries.get(p.id);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.START_TRACKING, payload: prev }], description: "Delete entry" };
    }
    case KIND.CREATE_TIMER: {
      const t = payload as CountdownTimer;
      return { reverseSteps: [{ kind: KIND.DELETE_TIMER, payload: { id: t.id } }], description: "Create timer" };
    }
    case KIND.DELETE_TIMER: {
      const p = payload as { id: string };
      const prev = s.countdownTimers.get(p.id);
      if (!prev) return null;
      return { reverseSteps: [{ kind: KIND.CREATE_TIMER, payload: prev }], description: "Delete timer" };
    }
    case KIND.START_TIMER:
    case KIND.RESUME_TIMER:
    case KIND.PAUSE_TIMER:
    case KIND.COMPLETE_TIMER:
    case KIND.RESET_TIMER: {
      const p = payload as { id: string };
      const prev = s.countdownTimers.get(p.id);
      if (!prev) return null;
      const desc =
        kind === KIND.PAUSE_TIMER ? "Pause timer"
        : kind === KIND.COMPLETE_TIMER ? "Complete timer"
        : kind === KIND.RESET_TIMER ? "Reset timer"
        : "Start timer";
      return { reverseSteps: [{ kind: KIND.CREATE_TIMER, payload: { ...prev } }], description: desc };
    }
  }
  return null;
};
