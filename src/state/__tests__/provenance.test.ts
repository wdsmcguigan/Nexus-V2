import { describe, it, expect } from "vitest";
import { wrapEnvelope, unwrapEnvelope } from "@/state/provenance";

describe("provenance envelope", () => {
  it("returns the bare payload unchanged when meta is absent or default", () => {
    const p = { a: 1 };
    expect(wrapEnvelope(p)).toBe(p);
    expect(wrapEnvelope(p, { source: "user" })).toBe(p);
    expect(wrapEnvelope(p, {})).toBe(p);
  });

  it("wraps when source is non-default or generatedBy is set", () => {
    const p = { a: 1 };
    const w = wrapEnvelope(p, { source: "ai", generatedBy: "claude-x" }) as Record<string, unknown>;
    expect(w).not.toBe(p);
    expect((w.value as typeof p)).toEqual(p);
  });

  it("unwraps an enveloped payload to { payload, meta }", () => {
    const p = { a: 1 };
    const w = wrapEnvelope(p, { source: "ai" });
    const { payload, meta } = unwrapEnvelope(w);
    expect(payload).toEqual(p);
    expect(meta?.source).toBe("ai");
  });

  it("is a no-op for a bare payload (meta null)", () => {
    const p = { a: 1 };
    const { payload, meta } = unwrapEnvelope(p);
    expect(payload).toBe(p);
    expect(meta).toBeNull();
  });

  it("is idempotent — unwrapping a bare payload twice is stable", () => {
    const p = { a: 1 };
    const once = unwrapEnvelope(p).payload;
    expect(unwrapEnvelope(once).payload).toBe(p);
  });
});
