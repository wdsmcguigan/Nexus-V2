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

test("commands open the panel on their section via params, and re-focus after navigating away", async ({ page }) => {
  const palette = () => page.getByRole("button", { name: "Command palette" });
  const search = () => page.getByPlaceholder("Search mail, contacts, or type a command…");

  // "New timer" opens the panel already on the Timers section (the seconds input
  // only exists in the Timers section) — no manual tab click.
  await palette().click();
  await search().fill("New timer");
  await search().press("Enter");
  await expect(page.getByLabel("Timer seconds")).toBeVisible();

  // Navigate away to Clock, then re-fire "New timer" → snaps back to Timers.
  // A value-only effect would miss this; the launch nonce makes it work.
  await page.getByRole("button", { name: "Clock", exact: true }).click();
  await expect(page.getByLabel("Timer seconds")).toBeHidden();
  await palette().click();
  await search().fill("New timer");
  await search().press("Enter");
  await expect(page.getByLabel("Timer seconds")).toBeVisible();

  // "New alarm" lands on the Alarms section (the time input is Alarms-only).
  await palette().click();
  await search().fill("New alarm");
  await search().press("Enter");
  await expect(page.getByLabel("Alarm time")).toBeVisible();
});
