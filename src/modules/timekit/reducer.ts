import type { ModuleReducer } from "@/state/moduleReducers";
import type { LocalStore } from "@/storage/local";
import type { TimeEntry } from "@/data/types";

function patchEntry(s: LocalStore, id: string, change: Partial<TimeEntry>): void {
  const prev = s.timeEntries.get(id);
  if (!prev) return;
  s.putTimeEntry({ ...prev, ...change });
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
    }
  },
};
