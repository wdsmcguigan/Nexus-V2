import { describe, it, expect } from "vitest";
import { stubSummarizer, type ThreadMessage } from "@/modules/ai/summarizer";

const msgs: ThreadMessage[] = [
  { subject: "Q2 plan", from: "a@x.com", body: "Let's ship." },
  { subject: "Re: Q2 plan", from: "b@x.com", body: "Agreed." },
];

describe("stubSummarizer", () => {
  it("is deterministic and never throws", async () => {
    const a = await stubSummarizer.summarize(msgs);
    const b = await stubSummarizer.summarize(msgs);
    expect(a).toBe(b);
    expect(a).toContain("Q2 plan");
    expect(a.length).toBeGreaterThan(0);
  });
  it("handles an empty thread", async () => {
    await expect(stubSummarizer.summarize([])).resolves.toBeTypeOf("string");
  });
});
