import { describe, it, expect } from "vitest";
import type { MutationKind } from "@/data/types";

describe("MutationKind type", () => {
  it("admits both core and module-namespaced kinds", () => {
    const core: MutationKind = "MOVE_TO_FOLDER";
    const mod: MutationKind = "com.acme.timer/START";
    expect(core).toBe("MOVE_TO_FOLDER");
    expect(mod).toBe("com.acme.timer/START");
  });
});
