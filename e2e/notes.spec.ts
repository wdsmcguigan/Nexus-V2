import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function openNotesPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Command palette" }).click();
  const input = page.getByPlaceholder("Search mail, contacts, or type a command…");
  await input.fill("Open Notes");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
}

test("create a note and see it in the list", async ({ page }) => {
  await openNotesPanel(page);
  await page.getByRole("button", { name: "New note" }).click();

  const titleInput = page.getByPlaceholder("Title");
  await expect(titleInput).toBeVisible();
  await titleInput.fill("My first note");
  await titleInput.press("Enter"); // blur → commit title

  // Type into the TipTap body.
  const body = page.locator(".ProseMirror");
  await expect(body).toBeVisible();
  await body.click();
  await body.pressSequentially("Some body text");

  // The note appears in the list with its title.
  await expect(page.getByRole("button", { name: /My first note/ })).toBeVisible();
});

test("create a note from an email via the row context menu", async ({ page }) => {
  const row = page.getByTestId("email-row").first();
  await expect(row).toBeVisible();
  const subject = (await row.getByTestId("email-subject").innerText()).trim();
  expect(subject.length).toBeGreaterThan(0);

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Create note from this email" }).click();

  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(escapeRegExp(subject)) })).toBeVisible();
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
