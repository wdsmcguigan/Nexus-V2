import { test, expect } from "./fixtures";

test("summarize a thread from an email creates an AI note linked to it", async ({ page }) => {
  const row = page.getByTestId("email-row").first();
  await expect(row).toBeVisible();
  const subject = (await row.getByTestId("email-subject").innerText()).trim();
  expect(subject.length).toBeGreaterThan(0);

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Summarize this thread with AI" }).click();

  // Notes opens with an "AI summary: <subject>" note (stub summarizer, deterministic).
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp("AI summary: " + escapeRegExp(subject)) }),
  ).toBeVisible();
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
