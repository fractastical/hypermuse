// Shoots the README gallery: the handful of looks worth leading with, at a
// consistent size, into docs/ where git will actually keep them.
//
//   node scripts/make-gallery.mjs            all of it
//   ONLY=word,eye node scripts/make-gallery.mjs   just those
//
// artifacts/ is gitignored, so anything the README points at has to live under
// docs/. Everything is written as JPEG: these are dark photographic frames and
// PNG costs five times the bytes for no visible gain in a thumbnail.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import ffmpeg from "ffmpeg-static";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs", "gallery");
const PORT = 8256;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT_W = 1600, SHOT_H = 900;
const HERO_W = 1600, THUMB_W = 720;

// The dark-side window only exists where the terrain is actually in shadow, and
// the anchor estimator needs a full revolution at speed to find that patch - so
// window scenes load at speed 1, wait for the anchor, wait again for the patch
// to swing to the front, and only then slow down to be photographed.
const ANCHOR_MS = 9000;
const WIN = { angw: "1.35", angh: "0.85", threshold: "0.4" };
const EYE = "assets/esoteric-geometries-circles-warp.gif";

const SHOTS = [
  { id: "word", title: "The word on the dark side", facing: true,
    q: { ...WIN, word: "hyperstition", angw: "1.95", angh: "0.62", threshold: "0.3" },
    note: "letter cubes cut from moon footage, pinned to the shadowed terrain" },
  { id: "eye", title: "Eye seal iris reveal", wait: 7000,
    q: { backdrop: EYE, iris: "1", iriszoom: "2.5", backscale: "0.98" },
    note: "the disc opens to a clear hole onto the seal turning behind it" },
  // These three are the disc itself doing something, so the word is suppressed.
  // Left on, the tracker letters the shadowed patch and the frame reads as a
  // different effect than the caption claims. ?mosaic=0 only bites when there
  // is file content to put in the window instead; on a bare moon the only way
  // out is a blank ?text, which takes the mosaic path out of the build.
  { id: "blood", title: "Blood moon", wait: 6000,
    q: { bloodmoon: "0.9", stars: "500", text: " " },
    note: "a luminance-preserving eclipse grade, fadeable over a two-hour set" },
  // The transit runs 0 to 1 with a clear moon at BOTH ends - the shadow crosses
  // and leaves - so totality is the middle. Stopping the run at 0.5 parks the
  // umbra on the disc instead of photographing the moment after it has passed.
  { id: "eclipse", title: "Earth's shadow", wait: 11000,
    q: { eclipse: "0", eclipsetarget: "0.5", eclipserun: "8", stars: "400", meteors: "0", text: " " },
    note: "the umbra crosses the disc, totality lit by refracted sunlight" },
  { id: "vajras", title: "Orbiting vajras", wait: 6000,
    q: { vajras: "6", vajraradius: "1.3", stars: "500", text: " " },
    note: "dorje sprites on tilted lanes that pass behind the disc" },
  { id: "fisher", title: "The star fisher", facing: true, wait: 4000,
    q: { ...WIN, angw: "1.55", angh: "0.98", content: "fisher", fishersec: "6", fisherheart: "1", winbright: "0.38" },
    note: "hooks a star, cups it, lets it go - and the freed stars make a heart" },
  { id: "harmonics", title: "Sonic sphere", facing: true, wait: 4000,
    q: { ...WIN, content: "harmonics", winbright: "0.85", harmsec: "3.5", angw: "1.5", angh: "0.95" },
    note: "the real normal modes of a vibrating sphere, driven by the room" },
  { id: "fold", title: "Synergetics fold", facing: true, wait: 3000,
    q: { ...WIN, content: "fold", winbright: "0.9" },
    note: "Fuller 100.41 - a triangle folding itself into a tetrahedron" }
];

// Not the moon: the poem screen, from the terminal.
const POEM = {
  id: "poem", title: "The poem, three words a side",
  page: "crt-terminal.html",
  q: {
    poem: "trinitypoem.txt", group: "3", align: "center", vcenter: "1",
    safe: "0.06", fit: "0.97", cps: "400", hold: "900", color: "white", fx: "0",
    // No turn for a still: it cannot be seen in one frame and it holds the
    // screen back from filling, which is what there is to look at.
    layout: "triangle", triease: "0"
  },
  note: "nine words to a screen, one line to each side of the triangle"
};

const only = String(process.env.ONLY || "").trim();
const wanted = only ? new Set(only.split(",").map((s) => s.trim())) : null;
const pick = (id) => !wanted || wanted.has(id);

fs.mkdirSync(OUT, { recursive: true });

const alive = (url) => new Promise((resolve) => {
  const req = http.get(url, (r) => { r.resume(); resolve(r.statusCode < 500); });
  req.on("error", () => resolve(false));
  req.setTimeout(1000, () => { req.destroy(); resolve(false); });
});

let server = null;
if (!(await alive(`${BASE}/hypermoon.html`))) {
  server = spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "--silent", "."], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await alive(`${BASE}/hypermoon.html`)); i++) await new Promise((r) => setTimeout(r, 400));
}

const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle"]
});
const context = await browser.newContext({ viewport: { width: SHOT_W, height: SHOT_H } });

// Resize and re-encode. Thumbnails are what the README grid shows; the hero is
// the only one anyone sees full size.
function encode(src, dest, width, quality) {
  execFileSync(ffmpeg, ["-y", "-i", src, "-vf", `scale=${width}:-2:flags=lanczos`,
    "-q:v", String(quality), dest], { stdio: "ignore" });
  fs.rmSync(src, { force: true });
  return (fs.statSync(dest).size / 1024).toFixed(0) + "K";
}

async function shootMoon(s) {
  const page = await context.newPage();
  const q = new URLSearchParams({ speed: "1", ...s.q });
  await page.goto(`${BASE}/hypermoon.html?${q}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => window.__hyperstitionReady === true, { timeout: 90000 });
  await page.waitForFunction(() => (window.__hyperstitionStats || {}).moonReady === true, { timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(s.facing ? ANCHOR_MS : 2500);
  if (s.facing) {
    await page.waitForFunction(() => {
      const a = (window.__hyperstitionStats || {}).facingAngle;
      return typeof a === "number" && a > -0.42 && a < -0.1;
    }, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => {
      new BroadcastChannel("hypermoon").postMessage({ type: "moonConfig", set: { speed: 0.05 } });
    });
  }
  if (s.wait) await page.waitForTimeout(s.wait);
  const raw = path.join(OUT, `${s.id}.raw.png`);
  await page.screenshot({ path: raw });
  await page.close();
  return raw;
}

async function shootPage(s) {
  const page = await context.newPage();
  await page.goto(`${BASE}/${s.page}?${new URLSearchParams(s.q)}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__hyperstitionReady === true, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const raw = path.join(OUT, `${s.id}.raw.png`);
  await page.screenshot({ path: raw });
  await page.close();
  return raw;
}

const made = [];
for (const s of SHOTS) {
  if (!pick(s.id)) continue;
  const raw = await shootMoon(s);
  const size = encode(raw, path.join(OUT, `${s.id}.jpg`), THUMB_W, 4);
  console.log("  " + s.id.padEnd(11), size);
  made.push(s);
}
if (pick(POEM.id)) {
  const raw = await shootPage(POEM);
  console.log("  " + POEM.id.padEnd(11), encode(raw, path.join(OUT, `${POEM.id}.jpg`), THUMB_W, 4));
  made.push(POEM);
}

// The fan renders come from holofan.html via `npm run export:holofan:still` and
// are far too slow to redo here; reuse them if they have been made.
for (const [src, name, width] of [
  // The rig at night is the hero: it is how the thing is actually seen, and
  // under house lights most of what the show does is not there to see.
  ["artifacts/holofan-rig-night.png", "rig", HERO_W],
  ["artifacts/holofan-rig-lit.png", "rig-lit", THUMB_W],
  ["artifacts/demos/hypermoon-holofan-180cm-wide.png", "holofan-room", HERO_W],
  ["artifacts/demos/hypermoon-holofan-180cm-close.png", "holofan-close", THUMB_W]
]) {
  if (!pick(name)) continue;
  const from = path.join(ROOT, src);
  if (!fs.existsSync(from)) {
    console.log("  " + name.padEnd(11), `skipped - no ${src}, run npm run export:holofan:still`);
    continue;
  }
  const tmp = path.join(OUT, `${name}.raw.png`);
  fs.copyFileSync(from, tmp);
  console.log("  " + name.padEnd(11), encode(tmp, path.join(OUT, `${name}.jpg`), width, width === HERO_W ? 3 : 4));
}

await browser.close();
if (server) try { process.kill(-server.pid); } catch (e) { /* already gone */ }
const total = fs.readdirSync(OUT).filter((f) => f.endsWith(".jpg"))
  .reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`\n${(total / 1024 / 1024).toFixed(2)} MB in docs/gallery`);
process.exit(0);
