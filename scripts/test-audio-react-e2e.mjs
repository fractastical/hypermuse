// End-to-end music sync test: real controller page plays the sample bass
// track through its deck analyser, real hypermoon page (same browser context,
// same BroadcastChannel) must show live band levels and beat envelopes.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

const moon = await context.newPage();
await moon.goto(`${BASE}/hypermoon.html?vajras=3`, { waitUntil: "domcontentloaded" });
await moon.waitForFunction(() => window.__hyperstitionStats && window.__hyperstitionStats.moonReady, { timeout: 20000 });

const ctl = await context.newPage();
await ctl.goto(`${BASE}/controller.html`, { waitUntil: "domcontentloaded" });
await ctl.waitForTimeout(2000);
await ctl.fill("#adBedInput", "artifacts/edm-dnb-strong-bass.mp3");
await ctl.click("#adBedButton");
await ctl.waitForFunction(() => document.getElementById("adBedStatus").textContent === "looping", { timeout: 8000 });

// Let the track build past its intro, then sample the moon's audio state
// repeatedly to catch beats (the sample track's drop lands around 8-10 s).
await ctl.waitForTimeout(4000);
let maxBass = 0, maxBeat = 0, meter = "";
for (let i = 0; i < 120; i++) {
  const a = await moon.evaluate(() => window.__hyperstitionStats.audio);
  maxBass = Math.max(maxBass, a.bass);
  maxBeat = Math.max(maxBeat, a.beatEnv);
  await moon.waitForTimeout(100);
}
meter = await ctl.evaluate(() => document.getElementById("adReactMeter").textContent);
console.log("max bass on moon:", maxBass.toFixed(3), "| max beatEnv:", maxBeat.toFixed(3), "| controller meter:", JSON.stringify(meter));

const pass = maxBass > 0.15 && maxBeat > 0.2 && meter.length > 0;
console.log(pass ? "PASS" : "FAIL");
await browser.close();
process.exit(pass ? 0 : 1);
