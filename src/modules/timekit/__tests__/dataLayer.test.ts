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
