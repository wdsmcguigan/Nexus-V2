import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODULE_COLORS,
  toCssColor,
  resolvePanelColor,
  resolveBodyTintLevel,
  moduleSurfaceFallbackColor,
  resolveModulePanelColor,
} from "@/lib/panelColors";
import type { PanelColorPrefs } from "@/data/types";

const userOnly: PanelColorPrefs = { colors: {}, bodyTintLevel: "L2" };

describe("DEFAULT_MODULE_COLORS", () => {
  it("has an entry for every ModuleKey", () => {
    expect(DEFAULT_MODULE_COLORS).toEqual({
      nav: "link-16",
      list: "link-4",
      viewer: "link-21",
      inspector: "link-18",
      contacts: "link-2",
      calendar: "link-7",
      settings: "link-8",
    });
  });
});

describe("toCssColor", () => {
  it("converts a link-N token reference to var(--color-link-N)", () => {
    expect(toCssColor("link-4")).toBe("var(--color-link-4)");
    expect(toCssColor("link-21")).toBe("var(--color-link-21)");
  });

  it("passes a hex string through unchanged", () => {
    expect(toCssColor("#aabbcc")).toBe("#aabbcc");
    expect(toCssColor("#1a2b3c")).toBe("#1a2b3c");
  });
});

describe("resolvePanelColor", () => {
  it("returns the system default when neither user nor workspace overrides", () => {
    expect(resolvePanelColor("list", userOnly)).toBe("var(--color-link-4)");
    expect(resolvePanelColor("inspector", userOnly)).toBe("var(--color-link-18)");
  });

  it("returns the user override when set", () => {
    const user: PanelColorPrefs = { colors: { list: "link-7" }, bodyTintLevel: "L2" };
    expect(resolvePanelColor("list", user)).toBe("var(--color-link-7)");
  });

  it("workspace override beats user override", () => {
    const user: PanelColorPrefs = { colors: { list: "link-7" }, bodyTintLevel: "L2" };
    const ws: PanelColorPrefs = { colors: { list: "#ff0000" }, bodyTintLevel: "L2" };
    expect(resolvePanelColor("list", user, ws)).toBe("#ff0000");
  });

  it("workspace falls through to user pref when the module isn't overridden", () => {
    const user: PanelColorPrefs = { colors: { inspector: "link-9" }, bodyTintLevel: "L2" };
    const ws: PanelColorPrefs = { colors: { list: "#ff0000" }, bodyTintLevel: "L2" };
    expect(resolvePanelColor("inspector", user, ws)).toBe("var(--color-link-9)");
  });

  it("falls all the way through to system default when neither layer covers it", () => {
    // user overrides "list" with link-2 (amber), not "calendar" — so calendar
    // must come from the system default (link-7 / rose), not from user.colors.list.
    const user: PanelColorPrefs = { colors: { list: "link-2" }, bodyTintLevel: "L2" };
    const ws: PanelColorPrefs = { colors: {}, bodyTintLevel: "L2" };
    expect(resolvePanelColor("calendar", user, ws)).toBe("var(--color-link-7)");
  });
});

describe("resolveBodyTintLevel", () => {
  it("returns the user level when no workspace override", () => {
    expect(resolveBodyTintLevel({ colors: {}, bodyTintLevel: "L2" })).toBe("L2");
    expect(resolveBodyTintLevel({ colors: {}, bodyTintLevel: "L3" })).toBe("L3");
  });

  it("workspace overrides user", () => {
    const result = resolveBodyTintLevel(
      { colors: {}, bodyTintLevel: "L2" },
      { colors: {}, bodyTintLevel: "L3" },
    );
    expect(result).toBe("L3");
  });
});

describe("moduleSurfaceFallbackColor", () => {
  it("is deterministic for the same id", () => {
    const a = moduleSurfaceFallbackColor("org.nexus.tasks:tasks.main");
    const b = moduleSurfaceFallbackColor("org.nexus.tasks:tasks.main");
    expect(a).toBe(b);
  });
  it("always returns a link-N in 1..21", () => {
    for (const id of ["a", "org.nexus.notes:notes.main", "x:y", "zzzzzzzz", "org.nexus.timekit:timekit.main"]) {
      const m = /^link-(\d+)$/.exec(moduleSurfaceFallbackColor(id));
      expect(m).not.toBeNull();
      const n = Number(m![1]);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(21);
    }
  });
  it("distinguishes at least some distinct ids", () => {
    const set = new Set([
      moduleSurfaceFallbackColor("org.nexus.tasks:tasks.main"),
      moduleSurfaceFallbackColor("org.nexus.notes:notes.main"),
      moduleSurfaceFallbackColor("org.nexus.timekit:timekit.main"),
    ]);
    expect(set.size).toBeGreaterThan(1);
  });
});

describe("resolveModulePanelColor", () => {
  const KEY = "org.nexus.tasks:tasks.main";
  const userOnly: PanelColorPrefs = { colors: {}, bodyTintLevel: "L2" };

  it("uses the declared color when nothing is overridden", () => {
    expect(resolveModulePanelColor(KEY, "link-11", userOnly)).toBe("var(--color-link-11)");
  });
  it("falls back to the per-id hash when no declared color and no override", () => {
    const out = resolveModulePanelColor(KEY, undefined, userOnly);
    expect(out).toBe(toCssColor(moduleSurfaceFallbackColor(KEY)));
  });
  it("user override beats the declared color", () => {
    const user: PanelColorPrefs = { colors: {}, moduleColors: { [KEY]: "link-7" }, bodyTintLevel: "L2" };
    expect(resolveModulePanelColor(KEY, "link-11", user)).toBe("var(--color-link-7)");
  });
  it("workspace override beats user override", () => {
    const user: PanelColorPrefs = { colors: {}, moduleColors: { [KEY]: "link-7" }, bodyTintLevel: "L2" };
    const ws: PanelColorPrefs = { colors: {}, moduleColors: { [KEY]: "#ff0000" }, bodyTintLevel: "L2" };
    expect(resolveModulePanelColor(KEY, "link-11", user, ws)).toBe("#ff0000");
  });
  it("workspace without this key falls through to user/declared", () => {
    const user: PanelColorPrefs = { colors: {}, moduleColors: { [KEY]: "link-7" }, bodyTintLevel: "L2" };
    const ws: PanelColorPrefs = { colors: {}, moduleColors: {}, bodyTintLevel: "L2" };
    expect(resolveModulePanelColor(KEY, "link-11", user, ws)).toBe("var(--color-link-7)");
  });
});
