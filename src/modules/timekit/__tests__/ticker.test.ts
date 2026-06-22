import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import { getUndoHistory, _resetModuleInverses, _resetUndoStacks, registerModuleInverse } from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { timekitReducer } from "@/modules/timekit/reducer";
import {
  timekitInverse, TIMEKIT_NS,
  createTimerMutation, startTimerMutation, completeTimerMutation,
  createAlarmMutation, fireAlarmMutation, setAlarmEnabledMutation,
} from "@/modules/timekit/mutations";
import { dueTimers, dueAlarms } from "@/modules/timekit/ticker";

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

describe("dueAlarms", () => {
  it("returns enabled, unfired, past-due alarms; excludes disabled/future/fired", () => {
    const s = wire();
    const due = createAlarmMutation("Due", 1_000, s);
    const future = createAlarmMutation("Future", 10_000, s);
    const disabled = createAlarmMutation("Off", 1_000, s);
    setAlarmEnabledMutation(disabled.id, false, s);

    expect(dueAlarms(5_000, s.alarms.values()).map((a) => a.id)).toEqual([due.id]);
    expect(future).toBeDefined();
  });

  it("provenance + idempotency: firing with source:'module' sets firedAt and drops it from due", () => {
    const s = wire();
    const a = createAlarmMutation("Due", 1_000, s);
    fireAlarmMutation(a.id, s, { source: "module" });
    expect(getUndoHistory()[0]?.source).toBe("module");
    expect(dueAlarms(5_000, s.alarms.values())).toEqual([]);
  });
});
