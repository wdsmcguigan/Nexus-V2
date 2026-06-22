import type { TimeEntry } from "@/data/types";

// Monotonic within this module instance; combined with Date.now() for unique ids.
let _seq = 0;
function tkId(prefix: string): string {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

/** Build a full TimeEntry from partial input, filling defaults. */
export function makeTimeEntry(input: Partial<TimeEntry>, vaultId: string, now: number): TimeEntry {
  return {
    id: input.id ?? tkId("te"),
    vaultId,
    startedAt: input.startedAt ?? now,
    stoppedAt: input.stoppedAt ?? null,
    note: input.note ?? null,
    createdAt: input.createdAt ?? now,
  };
}
