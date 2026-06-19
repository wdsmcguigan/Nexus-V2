import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared e2e fixture. Playwright already isolates storage per test via a fresh
 * browser context; we additionally wipe OPFS + localStorage before the app
 * boots so initWeb() fixture seeding starts clean even if context isolation
 * ever regresses. OPFS may be unavailable on some engines — the wipe is
 * defensive and the in-memory store path still works there.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.goto("/");
    await page.evaluate(async () => {
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
      try {
        const root = await navigator.storage.getDirectory();
        const names: string[] = [];
        // Collect entry names first via keys() to avoid mutating the directory mid-iteration.
        for await (const name of (root as unknown as { keys(): AsyncIterableIterator<string> }).keys()) {
          names.push(name);
        }
        await Promise.all(
          names.map((n) => root.removeEntry(n, { recursive: true }).catch(() => {})),
        );
      } catch {
        /* OPFS unavailable — in-memory store is fine */
      }
    });
    await page.reload();
    await use(page);
  },
});

export { expect };

/** Open the Tasks dock panel via the command palette. */
export async function openTasksPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Command palette" }).click();
  const input = page.getByPlaceholder("Search mail, contacts, or type a command…");
  await input.fill("Open Tasks");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
}
