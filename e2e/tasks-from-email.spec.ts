import { test, expect } from "./fixtures";

test("create a task from an email via the row context menu", async ({ page }) => {
  const row = page.getByTestId("email-row").first();
  await expect(row).toBeVisible();

  // Capture the real subject (fixtures may be non-deterministic) so we assert
  // the created task's title against it rather than a hardcoded string.
  const subject = (await row.getByTestId("email-subject").innerText()).trim();
  expect(subject.length).toBeGreaterThan(0);

  await row.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Create task from this email" })
    .click();

  // createTaskFromEntity also opens the Tasks panel.
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: `Toggle ${subject}` }),
  ).toBeVisible();
});
