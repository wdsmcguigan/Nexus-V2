import { describe, it, expect } from "vitest";
import { isNamespacedKind, kindNamespace, NAMESPACE_SEP } from "@/state/mutationKind";

describe("mutationKind helpers", () => {
  it("treats a bare core kind as non-namespaced", () => {
    expect(isNamespacedKind("MOVE_TO_FOLDER")).toBe(false);
    expect(kindNamespace("MOVE_TO_FOLDER")).toBeNull();
  });

  it("treats a slash-delimited kind as namespaced", () => {
    expect(isNamespacedKind("com.acme.timer/START")).toBe(true);
    expect(kindNamespace("com.acme.timer/START")).toBe("com.acme.timer");
  });

  it("ignores a leading separator (no namespace before it)", () => {
    expect(isNamespacedKind("/START")).toBe(false);
    expect(kindNamespace("/START")).toBeNull();
  });

  it("splits on the first separator only", () => {
    expect(kindNamespace("a.b/c/d")).toBe("a.b");
  });

  it("exposes the separator constant", () => {
    expect(NAMESPACE_SEP).toBe("/");
  });
});
