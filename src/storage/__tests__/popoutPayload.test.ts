import { describe, it, expect } from "vitest";
import { encodeModulePopoutPayload, decodeModulePopoutPayload } from "@/storage/tauri";

describe("module popout payload", () => {
  it("round-trips a componentKey", () => {
    const enc = encodeModulePopoutPayload({ componentKey: "org.nexus.tasks:tasks.main" });
    expect(decodeModulePopoutPayload(enc)).toEqual({ componentKey: "org.nexus.tasks:tasks.main" });
  });
  it("returns null for absent payloads", () => {
    expect(decodeModulePopoutPayload(null)).toBeNull();
    expect(decodeModulePopoutPayload(undefined)).toBeNull();
    expect(decodeModulePopoutPayload("")).toBeNull();
  });
  it("returns null for non-JSON", () => {
    expect(decodeModulePopoutPayload("not json")).toBeNull();
  });
  it("returns null for JSON without a string componentKey", () => {
    expect(decodeModulePopoutPayload(JSON.stringify({ foo: 1 }))).toBeNull();
    expect(decodeModulePopoutPayload(JSON.stringify({ componentKey: "" }))).toBeNull();
    expect(decodeModulePopoutPayload(JSON.stringify({ componentKey: 5 }))).toBeNull();
  });
});
