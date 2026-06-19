import { test, expect } from "./fixtures";

test("app boots and renders the workspace shell after storage reset", async ({ page }) => {
  // Persistent chrome — present in every workspace, proves the shell mounted.
  await expect(page.getByRole("button", { name: "Command palette" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search emails, contacts, files…" }),
  ).toBeVisible();
});
