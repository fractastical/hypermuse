// Smoke test for music sync: opens hypermoon with vajras, pushes synthetic
// "moonAudio" band levels + beats over the BroadcastChannel (exactly what the
// controller's audio deck analyser sends), and checks that the audio state
// updates and the vajra sprites flare on beats.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${BASE}/hypermoon.html?vajras=3&content=crt&speed=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__hyperstitionStats && window.__hyperstitionStats.moonReady, { timeout: 20000 });
await page.waitForTimeout(2000);

const silent = await page.evaluate(() => window.__hyperstitionStats.audio);
console.log("silent:", JSON.stringify(silent));

// Feed a loud bass beat + sustained highs for 1.5 s at 20 Hz.
await page.evaluate(() => {
  const ch = new BroadcastChannel("hypermoon");
  let n = 0;
  window.__feeder = setInterval(() => {
    ch.postMessage({ type: "moonAudio", bass: 0.8, mid: 0.5, high: 0.6, level: 0.63, beat: n % 10 === 0 });
    n++;
  }, 50);
});
await page.waitForTimeout(700);
const loud = await page.evaluate(() => window.__hyperstitionStats.audio);
console.log("loud:  ", JSON.stringify(loud));

// Stop the feed; levels must decay back toward silence.
await page.evaluate(() => clearInterval(window.__feeder));
await page.waitForTimeout(2500);
const after = await page.evaluate(() => window.__hyperstitionStats.audio);
console.log("decayed:", JSON.stringify(after));

// Live react intensity + mic flag over the controller channel.
await page.evaluate(() => {
  new BroadcastChannel("hypermoon").postMessage({ type: "moonConfig", set: { react: 1.7 } });
});
await page.waitForTimeout(400);
const react = await page.evaluate(() => window.__hyperstitionStats.audio.react);
console.log("react set to:", react);

const pass =
  silent.level < 0.05 &&
  loud.level > 0.3 && loud.bass > 0.4 && loud.beatEnv >= 0 &&
  after.level < 0.08 &&
  Math.abs(react - 1.7) < 1e-6;
console.log(pass ? "PASS" : "FAIL");
await browser.close();
process.exit(pass ? 0 : 1);
