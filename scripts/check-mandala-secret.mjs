// Reads the message back out of the Metavillan colour, off the rendered frames
// themselves: every frame of one hold is shrunk, its colour strength measured
// the way pages/metavillan-scan.html measures a camera's, and the series handed
// to the same decoder. What passes here is what the show actually draws, not
// what the code meant to draw.
//
//   npm run metavillan:secret
//   SECRET="other words" npm run metavillan:secret
//   EXTRA="&marksecretdepth=0.08" npm run metavillan:secret
//   DUMP=/tmp/frames.json npm run metavillan:secret   # keep the series
//
// Needs the server: npm start.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import "../js/secret-shimmer.js";

const S = globalThis.SecretShimmer;
const SECRET = process.env.SECRET;
const BIT = 0.2;
const q = "content=orbit&orbitseq=metavillan&giforbit=8&nosound=1&stars=0&meteors=0&mandsec=2" +
  (SECRET ? "&marksecret=" + encodeURIComponent(SECRET) : "") + (process.env.EXTRA || "");
// The marks are decoded with ImageDecoder, which the bundled headless shell
// does not have; installed Chrome does.
const browser = await chromium.launch({ channel: process.env.CHANNEL || "chrome" });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  page:", m.text()); });
const port = process.env.PORT || 8080;
await page.goto(`http://127.0.0.1:${port}/hypermoon.html?${q}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gifswarm?.sourceCount() > 0, null, { timeout: 60000 });
const state = () => page.evaluate(() => window.__gifswarm.mandala());

await page.evaluate(({ chroma }) => {
  const fn = new Function("return " + chroma)();
  const gl = [...document.querySelectorAll("canvas")]
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const c = document.createElement("canvas");
  c.width = 96; c.height = 54;
  const g = c.getContext("2d", { willReadFrequently: true });
  window.__secretSamples = [];
  const tick = () => {
    g.drawImage(gl, 0, 0, c.width, c.height);
    window.__secretSamples.push({
      t: performance.now() / 1000,
      v: fn(g.getImageData(0, 0, c.width, c.height).data),
      at: window.__gifswarm.mandala().secret?.at ?? null
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, { chroma: S.chroma.toString() });

const until = async (ok) => {
  for (let i = 0; i < 1500; i++) { if (ok(await state())) return; await page.waitForTimeout(80); }
  throw new Error("mandala never got there: " + JSON.stringify(await state()));
};
await until((s) => s.phase === "hold");
const t0 = Date.now();
await until((s) => s.phase === "scatter");
const samples = await page.evaluate(() => window.__secretSamples);
await browser.close();

if (process.env.DUMP) writeFileSync(process.env.DUMP, JSON.stringify(samples));
const held = (Date.now() - t0) / 1000;
const fps = samples.length / (samples[samples.length - 1].t - samples[0].t);
const r = S.decode(samples, BIT);
console.log(`  ${samples.length} frames at ${fps.toFixed(1)} fps over a ${held.toFixed(1)}s hold`);
if (r.text == null) {
  console.log(`  no message (best sync ${r.best.toFixed(2)})`);
  process.exit(1);
}
console.log(`  decoded "${r.text}" — ${r.bits} bits, sync ${r.score.toFixed(2)}`);
if (SECRET && r.text !== SECRET) process.exit(1);
