import { describe, it, expect, beforeEach } from "vitest";
import {
  subscribe,
  emit,
  matchesGlob,
  _resetEventBus,
  MAX_REACTION_DEPTH,
} from "@/state/eventBus";
import type { Mutation, MutationKind } from "@/data/types";

function mut(kind: MutationKind): Mutation {
  return { id: "m", vaultId: "v", deviceId: "d", ts: 0, lamport: 1, kind, payload: {} };
}

beforeEach(() => {
  _resetEventBus();
});

describe("eventBus matchesGlob", () => {
  it("matches all with '*'", () => {
    expect(matchesGlob("*", "READ")).toBe(true);
    expect(matchesGlob("*", "com.acme.timer/START")).toBe(true);
  });

  it("matches a namespace prefix with 'ns/*'", () => {
    expect(matchesGlob("com.acme.timer/*", "com.acme.timer/START")).toBe(true);
    expect(matchesGlob("com.acme.timer/*", "com.other/START")).toBe(false);
  });

  it("matches an exact kind", () => {
    expect(matchesGlob("READ", "READ")).toBe(true);
    expect(matchesGlob("READ", "UNREAD")).toBe(false);
  });
});

describe("eventBus subscribe/emit", () => {
  it("delivers a matching mutation to a subscriber", () => {
    const got: string[] = [];
    subscribe("com.acme.timer/*", (m) => got.push(m.kind));
    emit(mut("com.acme.timer/START"));
    emit(mut("com.other/NOPE"));
    expect(got).toEqual(["com.acme.timer/START"]);
  });

  it("stops delivering after unsubscribe", () => {
    const got: string[] = [];
    const dispose = subscribe("*", (m) => got.push(m.kind));
    emit(mut("READ"));
    dispose();
    emit(mut("UNREAD"));
    expect(got).toEqual(["READ"]);
  });

  it("bounds reaction cascades at MAX_REACTION_DEPTH", () => {
    let calls = 0;
    subscribe("*", () => {
      calls += 1;
      emit(mut("com.loop/AGAIN"));
    });
    emit(mut("com.loop/START"));
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThanOrEqual(MAX_REACTION_DEPTH);
  });
});
