import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { getUndoHistory, _resetModuleInverses, _resetUndoStacks, registerModuleInverse } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { timekitReducer } from "@/modules/timekit/reducer";
import {
  timekitInverse, TIMEKIT_NS,
  createTimerMutation, startTimerMutation, completeTimerMutation,
} from "@/modules/timekit/mutations";
import { dueTimers } from "@/modules/timekit/ticker";

function wire(): LocalStore {
  const s = new LocalStore();
  registerModuleReducer(TIMEKIT_NS, timekitReducer);
  registerModuleInverse(TIMEKIT_NS, timekitInverse);
  return s;
}

beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); _resetUndoStacks(); });

describe("dueTimers", () => {
  it("returns running timers whose end time has passed, and excludes paused/idle/done", () => {
    const s = wire();
    const t = createTimerMutation("Due", 1_000, s);
    startTimerMutation(t.id, s);
    const startedAt = s.countdownTimers.get(t.id)!.startedAt!;
    const now = startedAt + 2_000;             // past end
    const due = dueTimers(now, s.countdownTimers.values());
    expect(due.map((x) => x.id)).toEqual([t.id]);

    // Not yet due:
    expect(dueTimers(startedAt + 1, s.countdownTimers.values())).toEqual([]);
  });

  it("provenance + idempotency: completing with source:'module' flips it out of the due set", () => {
    const s = wire();
    const t = createTimerMutation("Due", 1_000, s);
    startTimerMutation(t.id, s);
    const now = s.countdownTimers.get(t.id)!.startedAt! + 2_000;

    completeTimerMutation(t.id, s, { source: "module" });
    expect(getUndoHistory()[0]?.source).toBe("module");
    // After completion the timer is "done" → no longer returned.
    expect(dueTimers(now, s.countdownTimers.values())).toEqual([]);
  });
});
