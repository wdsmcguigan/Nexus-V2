import { test, expect, openTimekitPanel } from "./fixtures";

test("track time: start then stop produces an entry with a duration", async ({ page }) => {
  await openTimekitPanel(page);

  // Switch to the Tracker section.
  await page.getByRole("button", { name: "Tracker", exact: true }).click();

  await page.getByRole("button", { name: "Start tracking" }).click();
  // A Stop control appears while running.
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();

  // Let at least one second of elapsed accrue, then stop.
  await page.waitForTimeout(1100);
  await stop.click();

  // A finished entry now shows a Delete control (only present on stopped rows).
  await expect(page.getByRole("button", { name: "Delete entry" }).first()).toBeVisible();
});

test("countdown: a short timer auto-completes via the tick worker", async ({ page }) => {
  await openTimekitPanel(page);

  await page.getByRole("button", { name: "Timers", exact: true }).click();

  await page.getByLabel("Timer label").fill("Quick");
  await page.getByLabel("Timer seconds").fill("1");
  await page.getByRole("button", { name: "Add timer" }).click();

  // Start it; the 1s worker should flip it to "Done" within a few ticks.
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible({ timeout: 8000 });
});
