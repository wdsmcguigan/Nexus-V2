import { describe, it, expect } from "vitest";
import { shouldNavigate } from "@/lib/wheelNav";

describe("shouldNavigate", () => {
  it("returns null when shift is not held (no false-positive on regular scroll)", () => {
    expect(
      shouldNavigate({ shiftKey: false, deltaX: 50, deltaY: 0 }, 0, 1000),
    ).toBeNull();
  });

  it("returns 'next' for shift + positive deltaX (Mac trackpad horizontal)", () => {
    expect(
      shouldNavigate({ shiftKey: true, deltaX: 40, deltaY: 0 }, 0, 1000),
    ).toBe("next");
  });

  it("returns 'prev' for shift + negative deltaX", () => {
    expect(
      shouldNavigate({ shiftKey: true, deltaX: -40, deltaY: 0 }, 0, 1000),
    ).toBe("prev");
  });

  it("uses deltaY when it dominates (Windows shift+wheel)", () => {
    expect(
      shouldNavigate({ shiftKey: true, deltaX: 1, deltaY: 80 }, 0, 1000),
    ).toBe("next");
    expect(
      shouldNavigate({ shiftKey: true, deltaX: 1, deltaY: -80 }, 0, 1000),
    ).toBe("prev");
  });

  it("returns null inside the throttle window", () => {
    expect(
      shouldNavigate({ shiftKey: true, deltaX: 40, deltaY: 0 }, 1000, 1100),
    ).toBeNull(); // 100ms after lastNav, within 250ms window
  });

  it("returns non-null once the throttle window has passed", () => {
    expect(
      shouldNavigate({ shiftKey: true, deltaX: 40, deltaY: 0 }, 1000, 1300),
    ).toBe("next"); // 300ms after lastNav, outside 250ms window
  });

  it("ignores noisy near-zero deltas (avoids accidental nav on rest)", () => {
    expect(
      shouldNavigate({ shiftKey: true, deltaX: 1, deltaY: 0 }, 0, 1000),
    ).toBeNull();
  });
});
