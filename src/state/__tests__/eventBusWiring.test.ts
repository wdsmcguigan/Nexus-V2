import { describe, it, expect, beforeEach } from "vitest";
import type { LocalStore } from "@/storage/local";
import { makeSeedStore } from "@/storage/__tests__/seed";
import {
  recordMutation,
  replayMutations,
  applyRemoteMutation,
} from "@/state/mutations";
import { subscribe, _resetEventBus } from "@/state/eventBus";
import type { Mutation } from "@/data/types";

let store: LocalStore;

beforeEach(() => {
  store = makeSeedStore();
  _resetEventBus();
});

describe("event bus wiring", () => {
  it("fires the bus for a live recorded mutation", () => {
    const got: string[] = [];
    subscribe("*", (m) => got.push(m.kind));
    recordMutation("com.test/PING", { x: 1 }, store);
    expect(got).toEqual(["com.test/PING"]);
  });

  it("fires the bus for a remote (sibling-window) mutation", () => {
    const got: string[] = [];
    subscribe("com.test/*", (m) => got.push(m.kind));
    applyRemoteMutation("com.test/REMOTE", { x: 1 }, 99, store);
    expect(got).toEqual(["com.test/REMOTE"]);
  });

  it("does NOT fire the bus during replay (state reconstruction)", () => {
    let count = 0;
    subscribe("*", () => {
      count += 1;
    });
    const m: Mutation = {
      id: "m1",
      vaultId: "v",
      deviceId: "d",
      ts: 0,
      lamport: 1,
      kind: "com.test/PING",
      payload: {},
    };
    replayMutations([m], store);
    expect(count).toBe(0);
  });
});
