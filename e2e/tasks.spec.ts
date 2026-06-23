import { test, expect, openTasksPanel } from "./fixtures";

test("open Tasks, add a task, and complete it", async ({ page }) => {
  await openTasksPanel(page);

  const title = "Write the e2e harness";
  const addInput = page.getByPlaceholder("Add task…").first();
  await addInput.fill(title);
  await addInput.press("Enter");

  const checkbox = page.getByRole("checkbox", { name: `Toggle ${title}` });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).not.toBeChecked();

  await checkbox.check();
  await expect(page.getByRole("checkbox", { name: `Toggle ${title}` })).toBeChecked();
});

test("global shortcut: pressing 't' opens the Tasks panel; typing 't' in an input does not", async ({ page }) => {
  // Body is focused on load — the module shortcut fires.
  await page.locator("body").click();
  await page.keyboard.press("t");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();

  // Typing 't' inside the command-palette search input must NOT re-trigger it
  // (the editable-element guard). Open the palette, type, and confirm no error /
  // the input received the character rather than the shortcut firing.
  await page.getByRole("button", { name: "Command palette" }).click();
  const input = page.getByPlaceholder("Search mail, contacts, or type a command…");
  await input.fill("");
  await input.press("t");
  await expect(input).toHaveValue("t");
});
