// Reads the message back out of the red in an essay's drawing, twice over:
// the floorboards in essays/tower/, or the stain in
// essays/the-image-that-looks-back/.
//
// First off the frames the page draws: the drawing's canvas is shrunk and its
// colour strength measured the way pages/metavillan-scan.html measures a
// camera's, and the series handed to the same decoder. Then the whole trip as
// a phone would make it: the same frames, with the text around the drawing in
// shot, are compressed to a 25 fps video, and the file is given to the reader
// page, which has to find the message in it by itself.
//
//   npm run essay:tower:secret
//   npm run essay:lookback:secret
//   SECRET="other words" npm run essay:tower:secret
//   SECRET=0 npm run essay:tower:secret        # switched off: must find nothing
//   EXTRA="&secretdepth=0.12" npm run essay:tower:secret
//
// Needs the server: npm start. Takes a minute or two. Run one at a time: two
// at once have hung at the reader page.
//
// The message is in the timing of the colour, so nothing is recorded in real
// time. As in record-flower.mjs, the page's clock is frozen and stepped one
// video frame at a time, and each frame is drawn and photographed before the
// clock moves on. A busy machine makes it slower, never wrong.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import ffmpegPath from "ffmpeg-static";
import "../js/secret-shimmer.js";

const S = globalThis.SecretShimmer;
// Which essay: the page, the canvas that carries the message, and what it
// says when nothing else is asked for.
const ESSAYS = {
  tower: { page: "essays/tower/", canvas: "#heart", says: "tower tower", file: "heart" },
  lookback: { page: "essays/the-image-that-looks-back/", canvas: "#stain", says: "looks back", file: "stain" }
};
const NAME = process.argv[2] || "tower";
const ESSAY = ESSAYS[NAME];
if (!ESSAY) { console.error(`no essay "${NAME}": ${Object.keys(ESSAYS).join(", ")}`); process.exit(2); }
const SECRET = process.env.SECRET ?? ESSAY.says;
const OFF = SECRET === "0";
const BIT = Number(process.env.BIT) || 0.2;
const FPS = 25;
const port = process.env.PORT || 8080;
const OUT = process.env.OUT || `artifacts/${NAME}`;
fs.mkdirSync(OUT, { recursive: true });
const vid = `${OUT}/${ESSAY.file}.mp4`;

const query = new URLSearchParams();
if (process.env.SECRET != null) query.set("secret", SECRET);
if (process.env.BIT) query.set("secretbit", String(BIT));
// One frame and a quarter, so a whole one is in the recording wherever it
// starts. Switched off there is no frame, so the default's length is watched.
const span = (S.frameBits(OFF ? ESSAY.says : SECRET).length + S.GAP) * BIT;
const frames = Math.ceil((span * 1.25 + 3) * FPS);

const browser = await chromium.launch({ channel: process.env.CHANNEL || "chrome" });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on("pageerror", (e) => console.log("  page:", e.message));
await page.addInitScript(() => {
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  let frozen = false, vt = 0, queue = [];
  performance.now = () => (frozen ? vt : realNow());
  window.requestAnimationFrame = (cb) => realRaf(() => (frozen ? queue.push(cb) : cb(realNow())));
  window.__clock = {
    freeze() { vt = realNow(); frozen = true; },
    step(ms) {
      vt += ms;
      const run = queue;
      queue = [];
      for (const cb of run) cb(vt);
      return vt;
    }
  };
});
await page.goto(`http://127.0.0.1:${port}/${ESSAY.page}?${query}${process.env.EXTRA || ""}`, { waitUntil: "load" });
await page.evaluate(({ chroma, canvas }) => {
  const fn = new Function("return " + chroma)();
  const heart = document.querySelector(canvas);
  heart.scrollIntoView({ block: "center" });
  const c = document.createElement("canvas");
  c.width = 96; c.height = 54;
  const g = c.getContext("2d", { willReadFrequently: true });
  window.__heartStep = (ms) => {
    const t = window.__clock.step(ms) / 1000;
    g.drawImage(heart, 0, 0, c.width, c.height);
    return { t, v: fn(g.getImageData(0, 0, c.width, c.height).data) };
  };
}, { chroma: S.chroma.toString(), canvas: ESSAY.canvas });
// The drawing starts its clock when it scrolls into view. Give it that, then
// stop time, and let the frame that was in flight land in the queue.
await page.waitForTimeout(400);
await page.evaluate(() => window.__clock.freeze());
await page.waitForTimeout(200);

const ff = spawn(ffmpegPath, [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
  "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  vid
], { stdio: ["pipe", "inherit", "inherit"] });
const ffDone = new Promise((ok, fail) => ff.on("close", (c) => (c ? fail(new Error(`ffmpeg exited ${c}`)) : ok())));
const samples = [];
for (let i = 0; i < frames; i++) {
  samples.push(await page.evaluate((ms) => window.__heartStep(ms), 1000 / FPS));
  const png = await page.screenshot({ type: "png" });
  if (!ff.stdin.write(png)) await new Promise((ok) => ff.stdin.once("drain", ok));
}
ff.stdin.end();
await ffDone;
await page.close();

let failed = false;
const r = S.decode(samples, BIT);
if (r.text == null) {
  console.log(`  frames: no message in ${samples.length} frames (best sync ${r.best.toFixed(2)})${OFF ? ", as asked" : ""}`);
  failed ||= !OFF;
} else {
  console.log(`  frames: decoded "${r.text}" from ${samples.length} frames: ${r.bits} bits, sync ${r.score.toFixed(2)}, ${r.fixed} corrected`);
  failed ||= OFF || r.text !== SECRET;
}

const scan = await browser.newPage({ viewport: { width: 960, height: 600 } });
scan.on("pageerror", (e) => console.log("  page:", e.message));
await scan.goto(`http://127.0.0.1:${port}/pages/metavillan-scan.html${process.env.BIT ? `?bit=${BIT}` : ""}`);
await scan.setInputFiles("#file", vid);
let st = "";
for (let i = 0; i < 150; i++) {
  await scan.waitForTimeout(1000);
  st = await scan.evaluate(() => document.querySelector("#status").textContent);
  if (st === "decoded" || st.startsWith("no message")) break;
}
await scan.screenshot({ path: `${OUT}/${ESSAY.file}-scan.png` });
const text = await scan.evaluate(() => document.querySelector("#phrase").textContent);
const detail = await scan.evaluate(() => document.querySelector("#detail").textContent);
await browser.close();
if (st !== "decoded") {
  console.log(`  video:  ${st}${OFF ? ", as asked" : ""}`);
  failed ||= !OFF;
} else {
  console.log(`  video:  decoded "${text}" from ${vid}\n` + detail.split("\n").map((l) => "            " + l).join("\n"));
  failed ||= OFF || text !== SECRET;
}
console.log(`  shot -> ${OUT}/${ESSAY.file}-scan.png`);
process.exit(failed ? 1 : 0);
