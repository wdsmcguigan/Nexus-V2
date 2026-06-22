import type { LocalStore } from "@/storage/local";
import { recordMutation, type ModuleInverseBuilder } from "@/state/mutations";

export const TIMEKIT_NS = "org.nexus.timekit";

export const KIND = {
  SET_ZONES: `${TIMEKIT_NS}/SET_TIMEKIT_ZONES`,
} as const;

/** Replace the saved Clock timezone list. */
export function setTimekitZonesMutation(zones: string[], store: LocalStore): void {
  recordMutation(KIND.SET_ZONES, { zones }, store);
}

/**
 * Inverse builder for the whole timekit namespace. Captures prior state BEFORE
 * the mutation applies (substrate §4.3). Grows a case per kind across stages.
 */
export const timekitInverse: ModuleInverseBuilder = (kind, _payload, store) => {
  const s = store as LocalStore;
  switch (kind) {
    case KIND.SET_ZONES: {
      return {
        reverseSteps: [{ kind: KIND.SET_ZONES, payload: { zones: [...s.timekitZones] } }],
        description: "Set clock zones",
      };
    }
  }
  return null;
};
