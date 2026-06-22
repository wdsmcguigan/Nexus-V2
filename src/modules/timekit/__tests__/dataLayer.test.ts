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
import { timekitInverse, TIMEKIT_NS, setTimekitZonesMutation } from "@/modules/timekit/mutations";

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
