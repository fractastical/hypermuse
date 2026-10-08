// The whole trip, as a phone would make it: records a video of the Metavillan
// act — compressed, 25 fps, everything on screen — and hands the file to
// pages/metavillan-scan.html, which has to find the message in it the same way
// it would from a camera. check-mandala-secret.mjs reads the rendered frames
// directly; this one adds the lossy recording in between.
//
//   npm run metavillan:secret:video
//   EXTRA="&marksecret=other%20words" npm run metavillan:secret:video
//
// Needs the server: npm start. Takes about a minute and a quarter.
import { chromium } from "playwright";
import fs from "node:fs";

const port = process.env.PORT || 8080;
const OUT = process.env.OUT || "artifacts/metavillan";
fs.mkdirSync(OUT, { recursive: true });
// ImageDecoder, which the marks are decoded with, is in installed Chrome and
// not in the bundled headless shell.
const browser = await chromium.launch({ channel: process.env.CHANNEL || "chrome" });
const ctx = await browser.newContext({
  viewport: { width: 960, height: 540 },
  recordVideo: { dir: OUT, size: { width: 960, height: 540 } }
});
const page = await ctx.newPage();
const q = "content=orbit&orbitseq=metavillan&giforbit=8&nosound=1&stars=0&meteors=0&mandsec=2" + (process.env.EXTRA || "");
await page.goto(`http://127.0.0.1:${port}/hypermoon.html?${q}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gifswarm?.sourceCount() > 0, null, { timeout: 60000 });
const state = () => page.evaluate(() => window.__gifswarm.mandala());
for (let i = 0; i < 1500 && (await state()).phase !== "scatter"; i++) await page.waitForTimeout(100);
await page.waitForTimeout(2000);
const recorded = await page.video().path();
await ctx.close();
const vid = `${OUT}/secret-recording.webm`;
fs.renameSync(recorded, vid);
console.log(`  recorded ${vid}, ${(fs.statSync(vid).size / 1e6).toFixed(1)} MB`);

const scan = await browser.newPage({ viewport: { width: 960, height: 600 } });
scan.on("pageerror", (e) => console.log("  page:", e.message));
await scan.goto(`http://127.0.0.1:${port}/pages/metavillan-scan.html`);
await scan.setInputFiles("#file", vid);
let st = "";
for (let i = 0; i < 150; i++) {
  await scan.waitForTimeout(1000);
  st = await scan.evaluate(() => document.querySelector("#status").textContent);
  if (st === "decoded" || st.startsWith("no message")) break;
}
await scan.screenshot({ path: `${OUT}/secret-scan.png` });
const text = await scan.evaluate(() => document.querySelector("#phrase").textContent);
const detail = await scan.evaluate(() => document.querySelector("#detail").textContent);
await browser.close();
if (st !== "decoded") {
  console.log(`  ${st}`);
  process.exit(1);
}
console.log(`  decoded "${text}"\n` + detail.split("\n").map((l) => "    " + l).join("\n"));
console.log(`  shot -> ${OUT}/secret-scan.png`);
