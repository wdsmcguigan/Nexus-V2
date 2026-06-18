import { describe, it, expect } from "vitest";
import { SURFACE_TYPES, canContributeSurface } from "@/modules/surfaces";

describe("surface taxonomy + trust gating", () => {
  it("declares the nine surface types", () => {
    expect(SURFACE_TYPES).toEqual([
      "dock",
      "rail",
      "inspector-section",
      "embedded-widget",
      "overlay",
      "headless",
      "full-window",
      "ambient-indicator",
      "canvas",
    ]);
  });

  it("lets core and first-party contribute every surface", () => {
    for (const t of SURFACE_TYPES) {
      expect(canContributeSurface("core", t)).toBe(true);
      expect(canContributeSurface("first-party", t)).toBe(true);
    }
  });

  it("restricts third-party to safe surfaces", () => {
    expect(canContributeSurface("third-party", "dock")).toBe(true);
    expect(canContributeSurface("third-party", "inspector-section")).toBe(true);
    expect(canContributeSurface("third-party", "overlay")).toBe(true);
    expect(canContributeSurface("third-party", "ambient-indicator")).toBe(true);
    expect(canContributeSurface("third-party", "canvas")).toBe(true);
    expect(canContributeSurface("third-party", "headless")).toBe(true);
  });

  it("denies third-party the high-risk surfaces", () => {
    expect(canContributeSurface("third-party", "rail")).toBe(false);
    expect(canContributeSurface("third-party", "embedded-widget")).toBe(false);
    expect(canContributeSurface("third-party", "full-window")).toBe(false);
  });
});
