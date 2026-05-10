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

// 13) Archive selection — toast appears
await page.locator('[data-panel-id="inspector"] button:has-text("Archive")').click();
await page.waitForTimeout(220);
await shot("13-archive-toast");

// 14) Click Undo on the toast
await page.locator('[data-sonner-toast] button:has-text("Undo")').click();
await page.waitForTimeout(220);
await shot("14-archive-undone");

// 15) Star toggle from inspector (star button shows starred state)
await page.locator('[data-panel-id="list"] [role="row"]').nth(2).click();
await page.waitForTimeout(120);
await page.locator('[data-panel-id="inspector"] button:has-text("Star"), [data-panel-id="inspector"] button:has-text("Starred")').first().click();
await page.waitForTimeout(160);
await shot("15-star-toggled");

await context.close();

// === Mobile pass ===
const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
  isMobile: true,
  hasTouch: true,
});
const mPage = await mobileContext.newPage();
mPage.on("pageerror", (err) => console.error("[mobile pageerror]", err.message));
mPage.on("console", (msg) => {
  if (msg.type() === "error") console.error("[mobile console error]", msg.text());
});

console.log("→ Loading mobile", URL);
await mPage.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
await mPage.waitForSelector('[data-panel-id="nav"]', { timeout: 10000 });
await mPage.waitForTimeout(800);

async function mshot(name) {
  const path = `${OUT}/${name}.png`;
  await mPage.screenshot({ path, fullPage: false });
  console.log("✓", path);
}

// m01: nav root
await mshot("m01-mobile-nav");

// m02: tap Inbox → list
await mPage.locator('[data-folder-id="inbox"]').click();
await mPage.waitForTimeout(220);
await mshot("m02-mobile-list");

// m03: tap a row → viewer
await mPage.locator('[data-panel-id="list"] [role="row"]').nth(0).click();
await mPage.waitForTimeout(220);
await mshot("m03-mobile-viewer");

// m04: tap inspector trailing in top bar
await mPage.locator('header [aria-label="Inspector"]').click();
await mPage.waitForTimeout(220);
await mshot("m04-mobile-inspector");

// m05: pop back to nav via tab bar Mail
await mPage.locator('nav button:has-text("Mail")').click();
await mPage.waitForTimeout(220);
await mshot("m05-mobile-nav-via-tabbar");

// m06: tap Compose tab → composer dialog
await mPage.locator('nav button:has-text("Compose")').click();
await mPage.waitForTimeout(260);
await mshot("m06-mobile-composer");

// m07: dismiss composer, tap Search → bottom-sheet palette
await mPage.locator('[aria-label="Close composer"]').click();
await mPage.waitForTimeout(160);
await mPage.locator('nav button:has-text("Search")').click();
await mPage.waitForTimeout(220);
await mshot("m07-mobile-palette-bottom-sheet");

// m08: dismiss palette, return to list, capture clean (non-overlapping) rows
await mPage.keyboard.press("Escape");
await mPage.waitForTimeout(160);
await mPage.locator('nav button:has-text("Mail")').click();
await mPage.waitForTimeout(160);
await mPage.locator('[data-folder-id="inbox"]').click();
await mPage.waitForTimeout(220);
await mshot("m08-mobile-list-no-overlap");

// m09: confirm search bar visible at top of list
await mshot("m09-mobile-search-bar");

// m10: confirm tab bar is visible at the bottom of the dvh viewport
await mshot("m10-mobile-tabbar-visible");

await browser.close();
console.log("\nAll screenshots written to", OUT);
