import type { ModuleReducer } from "@/state/moduleReducers";
import type { LocalStore } from "@/storage/local";

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
    }
  },
};
