#!/usr/bin/env node
// Shoots the climb at fixed points along it, so the ascent can be judged as a
// sequence instead of by staring at the moon waiting for the minute to come
// round. Drives the phase directly rather than waiting on the show clock, which
// is the only way to get the same six pictures every time.
//
//   npm run hermes:aerial
//   EXTRA="&aerialframe=0&aerialnear=900" npm run hermes:aerial
//
// Needs the server up (npm start) and a fix in the log for the car to be over.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = process.env.OUT || "artifacts/aerial";
mkdirSync(OUT, { recursive: true });
const port = process.env.PORT || 8124;
const q = "content=orbit&orbitseq=metavillan&nosound=1&stars=0&meteors=0" +
  "&flash=hermes/logo.png&aerial=1" + (process.env.EXTRA || "");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  page:", m.text()); });
await page.goto(`http://127.0.0.1:${port}/hypermoon.html?${q}`, { waitUntil: "domcontentloaded" });

// The climb needs the city image and a fix before it will draw anything, both
// fetched after load. Waiting on the show's own report of readiness rather than
// on a timeout, or the first shots come out as bare moon and look like a bug.
const ready = await page.waitForFunction(() => {
  const a = window.__hyperstitionStats && window.__hyperstitionStats.aerialState;
  return a && a.map && a.fix ? a : null;
}, null, { timeout: 25000 }).then((h) => h.jsonValue()).catch(() => null);
if (!ready) {
  await browser.close();
  console.error("the climb never became ready — is the server up, and is there a fix?");
  console.error("  check: curl -s localhost:8124/api/hermes/state");
  process.exit(1);
}
console.log(`  over ${ready.fix.lat.toFixed(5)}, ${ready.fix.lon.toFixed(5)}` +
  `  trail ${ready.trail} point(s)`);

const cdp = await page.context().newCDPSession(page);
const shots = [
  ["0-ground", 0],
  ["1-lifting", 0.18],
  ["2-blocks", 0.4],
  ["3-district", 0.62],
  ["4-city", 0.85],
  ["5-altitude", 1]
];
for (const [name, climb] of shots) {
  const where = await page.evaluate((c) => window.__hyperstitionStats.aerialAt(c), climb);
  // Two frames for the parked altitude to be drawn and presented, since the
  // hold is honoured by the animation loop rather than rendered on the spot.
  await page.evaluate(() => new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r))));
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
  console.log(`  ${name.padEnd(12)} climb=${String(climb).padEnd(5)}` +
    ` span=${String(Math.round(where.spanM)).padStart(5)}m` +
    ` mark=${where.markScale.toFixed(3)}` +
    ` pins=${String(where.pins).padStart(2)}` +
    ` at ${where.x.toFixed(2)},${where.y.toFixed(2)} of the radius`);
}
await browser.close();
console.log(`shots -> ${OUT}`);
