import { localStore } from "@/storage/local";
import { createCustomField } from "@/state/mutations";
import type { CustomFieldDef } from "@/data/types";

const DEFAULTS: Omit<CustomFieldDef, "vaultId">[] = [
  {
    id: "cfd-project",
    name: "Project",
    type: "select",
    options: [
      { id: "cfd-proj-opt-nexus", label: "Nexus", color: 5, position: 0 },
      { id: "cfd-proj-opt-acme", label: "Acme", color: 2, position: 1 },
      { id: "cfd-proj-opt-horizon", label: "Horizon", color: 4, position: 2 },
    ],
    position: 0,
    isPinned: true,
  },
  {
    id: "cfd-deal-stage",
    name: "Deal Stage",
    type: "select",
    options: [
      { id: "ds-prospect", label: "Prospect", color: 8, position: 0 },
      { id: "ds-negotiating", label: "Negotiating", color: 3, position: 1 },
      { id: "ds-closed", label: "Closed", color: 5, position: 2 },
    ],
    position: 1,
  },
  {
    id: "cfd-notes-url",
    name: "Notes URL",
    type: "url",
    position: 2,
  },
];

/** Seed the three starter custom fields if none exist yet. */
export function seedDefaultCustomFields(): void {
  if (localStore.customFieldDefs.size > 0) return;
  const vaultId = localStore.vault?.id ?? "local";
  for (const def of DEFAULTS) {
    createCustomField(localStore, { ...def, vaultId });
  }
}
