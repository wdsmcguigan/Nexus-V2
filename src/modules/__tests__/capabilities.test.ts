import { describe, it, expect } from "vitest";
import { parseCapability } from "@/modules/capabilities";

describe("parseCapability", () => {
  it("parses data.read with an entity type and no group", () => {
    expect(parseCapability("data.read:nexus/contact")).toEqual({
      action: "data.read",
      target: "nexus/contact",
      entType: "nexus/contact",
      group: undefined,
    });
  });

  it("parses data.read with a projection group", () => {
    expect(parseCapability("data.read:nexus/email.message#body")).toEqual({
      action: "data.read",
      target: "nexus/email.message#body",
      entType: "nexus/email.message",
      group: "body",
    });
  });

  it("parses a targetless capability", () => {
    expect(parseCapability("data.write.own")).toEqual({
      action: "data.write.own",
      target: undefined,
      entType: undefined,
      group: undefined,
    });
  });

  it("parses an emit glob", () => {
    expect(parseCapability("mutations.emit:com.acme.timer/*")).toEqual({
      action: "mutations.emit",
      target: "com.acme.timer/*",
      entType: undefined,
      group: undefined,
    });
  });

  it("flags a sensitive read group", () => {
    expect(parseCapability("data.read:nexus/email.message#body").group).toBe("body");
    expect(parseCapability("data.read:nexus/email.message#envelope").group).toBe("envelope");
  });
});
