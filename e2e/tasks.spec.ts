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
