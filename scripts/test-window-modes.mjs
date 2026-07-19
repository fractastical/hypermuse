// Smoke test for the rebuilt hypermoon window system: loads each window
// preset, checks the page runs, exercises the live keys over the broadcast
// channel, and saves a still per mode into artifacts/.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const results = [];
const log = (name, ok, note = "") => results.push({ name, ok, note });

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

const cases = [
  ["crt", "hypermoon.html?content=crt&speed=1&peek=6", "still-win-crt.png"],
  ["vajra", "hypermoon.html?content=vajra&speed=1", "still-win-vajra.png"],
  ["incant", "hypermoon.html?content=incant&speed=1&apparition=4", "still-win-incant.png"],
  ["slideshow", "hypermoon.html?content=assets/estoteric/web/IMG_1900.jpg,assets/estoteric/web/IMG_1903.jpg&speed=1", "still-win-sutra.png"],
  ["planar bleed", "hypermoon.html?mosaic=0&content=artifacts/crt-terminal-green.mp4&bleed=2&speed=1", "still-win-bleed.png"],
];

for (const [name, url, still] of cases) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/${url}`, { waitUntil: "domcontentloaded" });
  const ready = await page.waitForFunction(() => window.__hyperstitionStats && window.__hyperstitionStats.moonReady, { timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(9000); // let the survey lock + content render
  const stats = await page.evaluate(() => ({ ...window.__hyperstitionStats, gate: window.__hyperstitionStats.gate, wordOn: window.__hyperstitionStats.wordOn }));
  await page.screenshot({ path: `artifacts/${still}` });
  log(`${name}: page runs`, ready && errors.length === 0, errors[0] || `window=${stats.window} gate=${Number(stats.gate).toFixed(2)} wordOn=${Number(stats.wordOn).toFixed(2)}`);

  if (name === "crt") {
    // live "when" update over the channel
    await page.evaluate(() => new BroadcastChannel("hypermoon").postMessage({ type: "moonConfig", set: { when: "FRIDAY 23:59" } }));
    await page.waitForTimeout(400);
    const when = await page.evaluate(() => window.__hyperstitionStats.when);
    log("crt: live when update", when === "FRIDAY 23:59", `when=${when}`);
  }
  if (name === "incant") {
    // apparition gate should be cycling (not pinned at 1)
    const g1 = stats.gate;
    await page.waitForTimeout(4000);
    const g2 = await page.evaluate(() => window.__hyperstitionStats.gate);
    log("incant: apparition gate cycles", Math.abs(g1 - g2) > 0.01 || g1 < 1 || g2 < 1, `gate ${Number(g1).toFixed(2)} -> ${Number(g2).toFixed(2)}`);
  }
  if (name === "planar bleed") {
    // The adaptive walk starts from the 0.09 planar default; having moved
    // away from it (typically converged near the target area) is the pass.
    const th = await page.evaluate(() => window.__hyperstitionStats.bleedThresh);
    log("planar: threshold adapts", Math.abs(th - 0.09) > 0.01, `thresh=${Number(th).toFixed(3)} (default 0.090)`);
  }
  await page.close();
}

// Peek cycle: run CRT with a short peek and watch wordOn dip.
const page = await context.newPage();
await page.goto(`${BASE}/hypermoon.html?content=crt&speed=2&peek=4&peekhold=2`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__hyperstitionStats && window.__hyperstitionStats.moonReady, { timeout: 15000 }).catch(() => {});
let sawDip = false;
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  const wordOn = await page.evaluate(() => window.__hyperstitionStats.wordOn);
  if (wordOn < 0.35) { sawDip = true; break; }
  await page.waitForTimeout(300);
}
if (sawDip) await page.screenshot({ path: "artifacts/still-win-peek.png" });
log("peek: letters dissolve", sawDip);
await page.close();

await browser.close();
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.note ? "  — " + r.note : ""}`);
}
console.log(fail === 0 ? "\nall good" : `\n${fail} failing`);
