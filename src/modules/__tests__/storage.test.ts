import { describe, it, expect, beforeEach } from "vitest";
import { moduleStorage, _resetModuleStorage } from "@/modules/storage";

beforeEach(() => {
  _resetModuleStorage();
});

describe("host-mediated namespaced storage", () => {
  it("stores and retrieves a value scoped to a namespace", () => {
    const s = moduleStorage("com.acme.timer");
    s.set("running", true);
    expect(s.get("running")).toBe(true);
  });

  it("isolates namespaces from each other", () => {
    moduleStorage("com.a").set("k", 1);
    moduleStorage("com.b").set("k", 2);
    expect(moduleStorage("com.a").get("k")).toBe(1);
    expect(moduleStorage("com.b").get("k")).toBe(2);
  });

  it("returns undefined for an unset key", () => {
    expect(moduleStorage("com.a").get("missing")).toBeUndefined();
  });
});
