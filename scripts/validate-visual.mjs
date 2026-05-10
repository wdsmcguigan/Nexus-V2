// Visual validation script — captures screenshots in 4 key states.
// Requires: dev server running at http://127.0.0.1:5173
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.NEXUS_URL || "http://127.0.0.1:5173";
const OUT = "validation-screenshots";

await mkdir(OUT, { recursive: true });

const executablePath =
  process.env.CHROMIUM_PATH ||
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});

const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    // surface React + runtime errors
    console.error(`[browser ${msg.type()}]`, msg.text());
  }
});
page.on("pageerror", (err) => {
  console.error("[pageerror]", err.message);
});

console.log("→ Loading", URL);
await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector('[data-panel-id="list"]', { timeout: 10000 });
// Wait for fonts to load and apply
await page.waitForTimeout(800);

async function shot(name) {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log("✓", path);
}

// 1) Default: dark mode, comfortable density, list focused, no selection
await shot("01-dark-comfortable-default");

// 2) Select an email, focus list — selection in active panel
await page.locator('[data-panel-id="list"] [role="row"]').nth(2).click();
await page.waitForTimeout(120);
await shot("02-dark-selected-active");

// 3) Click the inspector header to focus it — list selection should ghost
await page.locator('[data-panel-id="inspector"] header').click();
await page.waitForTimeout(220);
await shot("03-dark-selection-ghosted-on-list");

// 4) Pin the inspector
const pinButton = page
  .locator('[data-panel-id="inspector"]')
  .locator('button[aria-label="Pin"], button[aria-label="Unpin"]')
  .first();
await pinButton.waitFor({ state: "visible", timeout: 5000 });
await pinButton.click();
await page.waitForTimeout(220);
await shot("04-dark-inspector-pinned");

// 5) Cycle to compact density
await page.locator('[data-panel-id="list"] [aria-label="Cycle density"]').click();
await page.waitForTimeout(160);
await shot("05-dark-compact-density");

// 6) Cycle to cozy
await page.locator('[data-panel-id="list"] [aria-label="Cycle density"]').click();
await page.locator('[data-panel-id="list"] [aria-label="Cycle density"]').click();
await page.waitForTimeout(160);
await shot("06-dark-cozy-density");

// 7) Open command palette
await page.keyboard.press("Meta+k");
await page.waitForTimeout(220);
await shot("07-dark-command-palette");

// Type in the palette
await page.keyboard.type("compose");
await page.waitForTimeout(160);
await shot("08-dark-command-palette-filtered");

// 8) Press Escape, then trigger compose flow
await page.keyboard.press("Escape");
await page.waitForTimeout(160);
await page.keyboard.press("Meta+k");
await page.waitForTimeout(160);
await page.keyboard.press("Enter");
await page.waitForTimeout(220);
await shot("09-dark-composer-open");

// 9) Close composer and switch to light mode via theme toggle
await page.locator('[aria-label="Close composer"]').click();
await page.waitForTimeout(120);
await page.locator('[aria-label="Toggle theme"]').click();
await page.waitForTimeout(220);
await shot("10-light-comfortable-default");

// 10) Expand the HUD strip
await page.locator('[aria-label="Activity HUD"] button').first().click();
await page.waitForTimeout(220);
await shot("11-light-hud-expanded");

// 11) Multi-select with shift-click
await page.locator('[aria-label="Toggle theme"]').click(); // back to dark
await page.waitForTimeout(120);
const rows = page.locator('[data-panel-id="list"] [role="row"]');
await rows.nth(1).click();
await rows.nth(5).click({ modifiers: ["Shift"] });
await page.waitForTimeout(160);
await shot("12-dark-multi-select-range");

await browser.close();
console.log("\nAll screenshots written to", OUT);
