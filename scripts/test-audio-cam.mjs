// Tests the go2rtc camera audio source for beat sync: controller pulls the
// sentinel stream's Opus track over WebRTC (WHEP against 192.168.1.83:1984),
// the analyser reads it, and moonAudio messages reach a hypermoon page.
// Needs the go2rtc box reachable on the LAN.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

const moon = await context.newPage();
await moon.goto(`${BASE}/hypermoon.html?vajras=2`, { waitUntil: "domcontentloaded" });
await moon.waitForFunction(() => window.__hyperstitionStats && window.__hyperstitionStats.moonReady, { timeout: 20000 });

const ctl = await context.newPage();
ctl.on("console", (m) => { if (m.type() === "error") console.log("ctl console error:", m.text()); });
await ctl.goto(`${BASE}/controller.html`, { waitUntil: "domcontentloaded" });
await ctl.waitForTimeout(2000);
await ctl.selectOption("#adAudioSource", "http://192.168.1.83:1984/api/webrtc?src=sentinel");

// Wait for the WebRTC track to land.
await ctl.waitForFunction(() => document.getElementById("adCamStatus").textContent === "live", { timeout: 15000 });
console.log("camera connected: live");

// Camera ambience may be quiet — assert the pipeline moves data, not loudness.
await ctl.waitForTimeout(3000);
let meter = "", moonLevel = 0, gotMsg = false;
for (let i = 0; i < 50; i++) {
  meter = await ctl.evaluate(() => document.getElementById("adReactMeter").textContent);
  const a = await moon.evaluate(() => window.__hyperstitionStats.audio);
  moonLevel = Math.max(moonLevel, a.level);
  if (meter.startsWith("cam")) gotMsg = true;
  await ctl.waitForTimeout(100);
}
console.log("meter:", JSON.stringify(meter), "| max moon level:", moonLevel.toFixed(4), "| cam source active:", gotMsg);

// Switch back to deck: status clears, meter drops the cam tag.
await ctl.selectOption("#adAudioSource", "deck");
await ctl.waitForTimeout(500);
const statusAfter = await ctl.evaluate(() => document.getElementById("adCamStatus").textContent);
console.log("after switch back:", JSON.stringify(statusAfter));

const pass = gotMsg && statusAfter === "";
console.log(pass ? "PASS" : "FAIL");
await browser.close();
process.exit(pass ? 0 : 1);
