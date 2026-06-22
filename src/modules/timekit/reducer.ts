import type { ModuleReducer } from "@/state/moduleReducers";
import type { LocalStore } from "@/storage/local";
import type { CountdownTimer, TimeEntry } from "@/data/types";

function patchEntry(s: LocalStore, id: string, change: Partial<TimeEntry>): void {
  const prev = s.timeEntries.get(id);
  if (!prev) return;
  s.putTimeEntry({ ...prev, ...change });
}

function patchTimer(s: LocalStore, id: string, change: Partial<CountdownTimer>): void {
  const prev = s.countdownTimers.get(id);
  if (!prev) return;
  s.putCountdownTimer({ ...prev, ...change });
}

/** Applies all org.nexus.timekit mutations to the in-memory projections. */
export const timekitReducer: ModuleReducer = {
  apply(kind, payload, store) {
    const s = store as LocalStore;
    switch (kind) {
      case "org.nexus.timekit/SET_TIMEKIT_ZONES": {
        const p = payload as { zones: string[] };
        s.setTimekitZones(p.zones);
        break;
      }
      case "org.nexus.timekit/START_TRACKING":
        s.putTimeEntry(payload as TimeEntry);
        break;
      case "org.nexus.timekit/STOP_TRACKING": {
        const p = payload as { id: string; stoppedAt: number | null };
        patchEntry(s, p.id, { stoppedAt: p.stoppedAt });
        break;
      }
      case "org.nexus.timekit/SET_ENTRY_NOTE": {
        const p = payload as { id: string; note: string | null };
        patchEntry(s, p.id, { note: p.note });
        break;
      }
      case "org.nexus.timekit/DELETE_ENTRY": {
        const p = payload as { id: string };
        s.deleteTimeEntry(p.id);
        break;
      }
      case "org.nexus.timekit/CREATE_TIMER":
        s.putCountdownTimer(payload as CountdownTimer);
        break;
      case "org.nexus.timekit/START_TIMER":
      case "org.nexus.timekit/RESUME_TIMER": {
        const p = payload as { id: string; startedAt: number };
        patchTimer(s, p.id, { state: "running", startedAt: p.startedAt });
        break;
      }
      case "org.nexus.timekit/PAUSE_TIMER": {
        const p = payload as { id: string; elapsedBeforeMs: number };
        patchTimer(s, p.id, { state: "paused", startedAt: null, elapsedBeforeMs: p.elapsedBeforeMs });
        break;
      }
      case "org.nexus.timekit/COMPLETE_TIMER": {
        const p = payload as { id: string };
        patchTimer(s, p.id, { state: "done", startedAt: null });
        break;
      }
      case "org.nexus.timekit/RESET_TIMER": {
        const p = payload as { id: string };
        patchTimer(s, p.id, { state: "idle", startedAt: null, elapsedBeforeMs: 0 });
        break;
      }
      case "org.nexus.timekit/DELETE_TIMER": {
        const p = payload as { id: string };
        s.deleteCountdownTimer(p.id);
        break;
      }
    }
  },
};
