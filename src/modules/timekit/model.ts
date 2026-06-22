import type { Alarm, CountdownTimer, TimeEntry } from "@/data/types";

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

/** Build a CountdownTimer from partial input (label + durationMs required). */
export function makeTimer(
  input: Partial<CountdownTimer> & { label: string; durationMs: number },
  vaultId: string,
  now: number,
): CountdownTimer {
  return {
    id: input.id ?? tkId("ct"),
    vaultId,
    label: input.label,
    durationMs: input.durationMs,
    startedAt: input.startedAt ?? null,
    elapsedBeforeMs: input.elapsedBeforeMs ?? 0,
    state: input.state ?? "idle",
    createdAt: input.createdAt ?? now,
  };
}

/** Build an Alarm from partial input (label + fireAt required). */
export function makeAlarm(
  input: Partial<Alarm> & { label: string; fireAt: number },
  vaultId: string,
  now: number,
): Alarm {
  return {
    id: input.id ?? tkId("al"),
    vaultId,
    label: input.label,
    fireAt: input.fireAt,
    enabled: input.enabled ?? true,
    firedAt: input.firedAt ?? null,
    createdAt: input.createdAt ?? now,
  };
}
