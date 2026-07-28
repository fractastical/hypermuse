// Shoot a guest logo on the moon before anyone else sees it there.
//
//   npm run preview:logo -- assets/synbiobeta-logo.png
//
// Waits for the shadow survey to settle, waits again for the panel to swing
// round square to the camera, and writes a still per mode so you can tell
// whether the mark actually reads at that size. Marks in dark ink come out as
// a moonlight silhouette; wordmarks shred in cubes mode and are fine in plain.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const LOGO = process.argv[2] || process.env.LOGO;
if (!LOGO) {
  console.error("usage: npm run preview:logo -- <path-to-logo> [more,logos]");
  process.exit(1);
}
const PORT = +(process.env.PORT || 8246);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT || "artifacts";
const MODES = (process.env.MODES || "plain,cubes").split(",");
const SETTLE = +(process.env.SETTLE || 12000);
const EXTRA = process.env.EXTRA || "";

mkdirSync(OUT, { recursive: true });
const server = spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "--silent", "."], {
  stdio: "ignore"
});
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle"]
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

try {
  for (const mode of MODES) {
    const page = await context.newPage();
    page.on("console", (m) => {
      if (/could not load logo/.test(m.text())) console.warn("  !", m.text());
    });
    const q = `speed=1&peek=0&logo=${encodeURIComponent(LOGO)}&logomode=${mode}${EXTRA}`;
    await page.goto(`${BASE}/hypermoon.html?${q}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.__hyperstitionStats && window.__hyperstitionStats.moonReady,
      { timeout: 20000 }
    ).catch(() => {});
    // The anchor estimator needs a full turn before the panel settles.
    await page.waitForTimeout(SETTLE);
    await page.waitForFunction(() => {
      const s = window.__hyperstitionStats;
      return s && s.facing && Math.abs(s.facingAngle) < 0.12;
    }, { timeout: 20000, polling: 60 }).catch(() => {});
    const path = `${OUT}/logo-preview-${mode}.png`;
    await page.screenshot({ path });
    console.log("saved", path);
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
process.exit(0);
