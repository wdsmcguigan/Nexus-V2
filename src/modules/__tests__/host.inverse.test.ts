import { describe, it, expect, beforeEach } from "vitest";
import { createModuleHost } from "@/modules/host";
import { _resetModuleInverses } from "@/state/mutations";

beforeEach(() => _resetModuleInverses());

describe("host.registerInverse", () => {
  it("registers an inverse builder under the module namespace and disposes it", () => {
    const { host, dispose } = createModuleHost("com.acme.x", "com.acme.x", new Map());
    host.registerInverse((kind, payload) => ({ reverseSteps: [{ kind, payload }], description: "x" }));
    expect(() =>
      createModuleHost("com.acme.x", "com.acme.x", new Map()).host.registerInverse(() => null),
    ).toThrow(/already registered/);
    dispose();
    expect(() =>
      createModuleHost("com.acme.x", "com.acme.x", new Map()).host.registerInverse(() => null),
    ).not.toThrow();
  });
});
