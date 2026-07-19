// Captures the stills that the modes-guide PDF needs but that don't exist
// yet: sonicsphere effect modes, the controller hypermoon/audio panels, the
// window-scale comparison, and an "any video in the window" example.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

async function shotHypermoon(query, path, settleMs = 9000) {
  const page = await context.newPage();
  await page.goto(`${BASE}/hypermoon.html?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__hyperstitionStats && window.__hyperstitionStats.moonReady, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path });
  await page.close();
  console.log("saved", path);
}

async function shotSonic(mode, path, extra = "") {
  const page = await context.newPage();
  await page.goto(`${BASE}/sonicsphere.html?demo=1&hideui=1&hideoverlay=1&mode=${mode}${extra}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12000);
  await page.screenshot({ path });
  await page.close();
  console.log("saved", path);
}

// Sonicsphere effect families
await shotSonic("classic", "artifacts/guide-sonic-classic.png");
await shotSonic("hex", "artifacts/guide-sonic-hexca.png", "&hexpalette=aurora&hexspeed=2&hexsync=0");
await shotSonic("words", "artifacts/guide-sonic-words.png");

// Controller panels (hypermoon panel incl. video picker / winscale / program editor)
{
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 2200 });
  await page.goto(`${BASE}/controller.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const hm = page.locator("#hypermoonPanel");
  await hm.screenshot({ path: "artifacts/guide-controller-hypermoon.png" });
  console.log("saved artifacts/guide-controller-hypermoon.png");
  const ad = page.locator("#audioDeckPanel");
  await ad.screenshot({ path: "artifacts/guide-controller-audiodeck.png" });
  console.log("saved artifacts/guide-controller-audiodeck.png");
  await page.close();
}

// Window scale comparison (same content, winscale 1 vs 1.8)
await shotHypermoon("content=crt&speed=1&peek=0&bright=1.5", "artifacts/guide-winscale-1x.png", 11000);
await shotHypermoon("content=crt&speed=1&peek=0&bright=1.5&winscale=1.8", "artifacts/guide-winscale-18x.png", 11000);

// Any video playing inside the window (wordless)
await shotHypermoon("content=artifacts/sample-sonicsphere-silent.webm&mosaic=0&bleed=2&speed=1&bright=1.5", "artifacts/guide-anyvideo.png", 11000);

await browser.close();
console.log("done");
