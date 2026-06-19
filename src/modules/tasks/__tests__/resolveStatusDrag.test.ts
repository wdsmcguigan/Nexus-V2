import { describe, it, expect } from "vitest";
import { resolveStatusDrag } from "@/modules/tasks/TaskKanbanView";

describe("resolveStatusDrag", () => {
  it("returns the target status when dropping on a different valid column", () => {
    expect(resolveStatusDrag("needs-action", "completed")).toBe("completed");
    expect(resolveStatusDrag("completed", "in-process")).toBe("in-process");
  });
  it("returns null when dropping on the same column (no-op)", () => {
    expect(resolveStatusDrag("in-process", "in-process")).toBeNull();
  });
  it("returns null for an unknown/invalid column id", () => {
    expect(resolveStatusDrag("needs-action", "bogus")).toBeNull();
    expect(resolveStatusDrag("needs-action", "")).toBeNull();
  });
});
