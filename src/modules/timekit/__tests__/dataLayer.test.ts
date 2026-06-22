import { describe, it, expect, beforeEach } from "vitest";
import { LocalStore } from "@/storage/local";
import {
  undoLastMutation,
  _resetModuleInverses,
  _resetUndoStacks,
  registerModuleInverse,
} from "@/state/mutations";
import { registerModuleReducer, _resetModuleReducers } from "@/state/moduleReducers";
import { timekitReducer } from "@/modules/timekit/reducer";
import {
  timekitInverse,
  TIMEKIT_NS,
  setTimekitZonesMutation,
  startTrackingMutation,
  stopTrackingMutation,
  setEntryNoteMutation,
  deleteEntryMutation,
  createTimerMutation,
  startTimerMutation,
  pauseTimerMutation,
  resumeTimerMutation,
  completeTimerMutation,
  resetTimerMutation,
  deleteTimerMutation,
  createAlarmMutation, setAlarmEnabledMutation, fireAlarmMutation, deleteAlarmMutation,
} from "@/modules/timekit/mutations";

function wire(): LocalStore {
  const s = new LocalStore();
  registerModuleReducer(TIMEKIT_NS, timekitReducer);
  registerModuleInverse(TIMEKIT_NS, timekitInverse);
  return s;
}

beforeEach(() => { _resetModuleReducers(); _resetModuleInverses(); _resetUndoStacks(); });

describe("timekit clock zones", () => {
  it("SET_TIMEKIT_ZONES replaces the list", () => {
    const s = wire();
    setTimekitZonesMutation(["UTC", "America/New_York"], s);
    expect(s.timekitZones).toEqual(["UTC", "America/New_York"]);
    setTimekitZonesMutation(["Europe/London"], s);
    expect(s.timekitZones).toEqual(["Europe/London"]);
  });

  it("undo restores the prior zone list", () => {
    const s = wire();
    setTimekitZonesMutation(["UTC"], s);
    setTimekitZonesMutation(["UTC", "Asia/Tokyo"], s);
    undoLastMutation(s);
    expect(s.timekitZones).toEqual(["UTC"]);
  });
});

describe("timekit time entries", () => {
  it("START_TRACKING creates a running entry", () => {
    const s = wire();
    const e = startTrackingMutation({}, s);
    expect(s.timeEntries.get(e.id)?.stoppedAt).toBeNull();
  });

  it("STOP_TRACKING sets stoppedAt", () => {
    const s = wire();
    const e = startTrackingMutation({}, s);
    stopTrackingMutation(e.id, s);
    expect(s.timeEntries.get(e.id)?.stoppedAt).not.toBeNull();
  });

  it("SET_ENTRY_NOTE updates the note", () => {
    const s = wire();
    const e = startTrackingMutation({}, s);
    setEntryNoteMutation(e.id, "design review", s);
    expect(s.timeEntries.get(e.id)?.note).toBe("design review");
  });

  it("undo round-trips stop, note, and delete", () => {
    const s = wire();
    const e = startTrackingMutation({}, s);

    stopTrackingMutation(e.id, s);
    undoLastMutation(s);
    expect(s.timeEntries.get(e.id)?.stoppedAt).toBeNull();

    setEntryNoteMutation(e.id, "x", s);
    undoLastMutation(s);
    expect(s.timeEntries.get(e.id)?.note).toBeNull();

    deleteEntryMutation(e.id, s);
    undoLastMutation(s);
    expect(s.timeEntries.has(e.id)).toBe(true);
  });
});

describe("timekit countdown timers", () => {
  it("create → start → complete moves through states", () => {
    const s = wire();
    const t = createTimerMutation("Tea", 5_000, s);
    expect(s.countdownTimers.get(t.id)?.state).toBe("idle");
    startTimerMutation(t.id, s);
    expect(s.countdownTimers.get(t.id)?.state).toBe("running");
    completeTimerMutation(t.id, s);
    expect(s.countdownTimers.get(t.id)?.state).toBe("done");
  });

  it("pause accumulates elapsedBeforeMs and resume re-arms startedAt", () => {
    const s = wire();
    const t = createTimerMutation("Work", 60_000, s);
    startTimerMutation(t.id, s);
    pauseTimerMutation(t.id, s);
    const paused = s.countdownTimers.get(t.id)!;
    expect(paused.state).toBe("paused");
    expect(paused.startedAt).toBeNull();
    expect(paused.elapsedBeforeMs).toBeGreaterThanOrEqual(0);
    resumeTimerMutation(t.id, s);
    expect(s.countdownTimers.get(t.id)?.state).toBe("running");
    expect(s.countdownTimers.get(t.id)?.startedAt).not.toBeNull();
  });

  it("reset returns to idle with zero elapsed; delete removes it", () => {
    const s = wire();
    const t = createTimerMutation("X", 1_000, s);
    startTimerMutation(t.id, s);
    resetTimerMutation(t.id, s);
    const r = s.countdownTimers.get(t.id)!;
    expect(r.state).toBe("idle");
    expect(r.elapsedBeforeMs).toBe(0);
    deleteTimerMutation(t.id, s);
    expect(s.countdownTimers.has(t.id)).toBe(false);
  });

  it("undo of complete restores the running state", () => {
    const s = wire();
    const t = createTimerMutation("Y", 1_000, s);
    startTimerMutation(t.id, s);
    completeTimerMutation(t.id, s);
    undoLastMutation(s);
    expect(s.countdownTimers.get(t.id)?.state).toBe("running");
  });
});

describe("timekit alarms", () => {
  it("create → toggle enabled → fire → delete", () => {
    const s = wire();
    const a = createAlarmMutation("Standup", 5_000, s);
    expect(s.alarms.get(a.id)?.enabled).toBe(true);
    setAlarmEnabledMutation(a.id, false, s);
    expect(s.alarms.get(a.id)?.enabled).toBe(false);
    fireAlarmMutation(a.id, s);
    expect(s.alarms.get(a.id)?.firedAt).not.toBeNull();
    deleteAlarmMutation(a.id, s);
    expect(s.alarms.has(a.id)).toBe(false);
  });

  it("undo of fire restores firedAt = null", () => {
    const s = wire();
    const a = createAlarmMutation("X", 1_000, s);
    fireAlarmMutation(a.id, s);
    undoLastMutation(s);
    expect(s.alarms.get(a.id)?.firedAt).toBeNull();
  });
});
