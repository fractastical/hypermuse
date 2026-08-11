// Where the moon actually sits on the screen, in pixels, rather than by eye.
//
// The disc is drawn wherever it happens to be in the source video. The page
// measures it off the video's alpha and slides the whole render so it lands in
// the middle of the frame, so this is a check on that measurement: a shift of a
// few percent of the radius is nothing on a monitor and 6 cm across on a 180 cm
// fan.
//
// Two centres are reported, because they answer different questions:
//
//   outline  the alpha silhouette, which is what the page centres on.
//   visible  every pixel that can be told from the background at all, counted
//            once each. This is the shape the eye sees, and it is the one to
//            trust: a mare is dark and entirely visible, so a brightness
//            -weighted centroid is the wrong model - it reads the maria as
//            half-absent and lands 18% of a radius away on the stock loop,
//            which is a measurement of where the maria are and not of where
//            the moon is.
//
//   node scripts/probe-moon-framing.mjs
//   VIDEO="loops/3d moon/web/moon-rotating-6s-alpha.webm" node scripts/probe-moon-framing.mjs
//   QUERY="moonx=0.05" W=1920 H=1080 node scripts/probe-moon-framing.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = 8262;
const BASE = `http://127.0.0.1:${PORT}`;
const W = Number(process.env.W || 1280);
const H = Number(process.env.H || 720);
const SAMPLES = Number(process.env.SAMPLES || 24);

const dir = "loops/3d moon/web";
const videos = process.env.VIDEO ? [process.env.VIDEO]
  : fs.readdirSync(dir).filter((f) => /\.(webm|mp4)$/i.test(f)).map((f) => path.join(dir, f));

const server = spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "--silent", "."], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-gl=angle"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });

// The canvas keeps its drawing buffer, so it can be read straight back. Alpha
// is the disc: the page clears transparent so the backdrop can show through.
const measure = () => {
  const gl = document.querySelector("canvas");
  const c = document.createElement("canvas");
  c.width = gl.width;
  c.height = gl.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(gl, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  // Coverage, not a hard mask, the same way the page measures it: an edge
  // pixel's alpha is the fraction of it inside the disc, so the centroid is
  // good to well under a pixel. The window opens above the video's glow halo.
  let cov = 0, sx = 0, sy = 0;
  let vis = 0, vx = 0, vy = 0, vx0 = 1e9, vx1 = -1, vy0 = 1e9, vy1 = -1;
  for (let py = 0; py < c.height; py++) {
    for (let px = 0; px < c.width; px++) {
      const o = (py * c.width + px) * 4;
      const a = d[o + 3] / 255;
      if (a > 0.3) {
        const w = a >= 0.7 ? 1 : (a - 0.3) / 0.4;
        cov += w; sx += (px + 0.5) * w; sy += (py + 0.5) * w;
      }
      const l = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
      if (l > 0.03) {
        vis++; vx += px + 0.5; vy += py + 0.5;
        if (px < vx0) vx0 = px; if (px > vx1) vx1 = px;
        if (py < vy0) vy0 = py; if (py > vy1) vy1 = py;
      }
    }
  }
  if (cov < 100 || vis < 100) return null;
  return {
    cx: sx / cov, cy: sy / cov,
    vx: vx / vis, vy: vy / vis,
    bx: (vx0 + vx1) / 2, by: (vy0 + vy1) / 2,
    r: Math.sqrt(cov / Math.PI),
    W: c.width, H: c.height, dpr: c.width / window.innerWidth
  };
};

console.log(`${W}x${H}, ${SAMPLES} samples\n`);
console.log("video".padEnd(24),
  "outline dx".padStart(11), "dy".padStart(7), "of r".padStart(6), "  |",
  "visible dx".padStart(11), "dy".padStart(7), "of r".padStart(6), "  |",
  "bbox dx".padStart(8), "dy".padStart(7), "  |", "drift");

const rec = [];
for (const v of videos) {
  const p = await ctx.newPage();
  // text= with nothing in it turns the letter mosaic off. The letters are
  // bright and live on the dark side by design, so leaving them on measures
  // where the word is as much as where the moon is.
  // Wound up to 3x, because everything here wants whole revolutions and the
  // moon turns at a third of real time by default - the 30s loop would take a
  // minute and a half to survey and four and a half to sample. Rotation speed
  // has no bearing on where the moon is or on how much of it can be seen.
  const q = (process.env.QUERY || "") + "&text=%20&speed=3";
  await p.goto(`${BASE}/hypermoon.html?video=${encodeURIComponent(v)}&${q}`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__hyperstitionStats?.moonReady === true, { timeout: 25000 }).catch(() => {});
  // The disc is averaged over a revolution of playback and then pinned, so
  // measuring before that finishes measures the average still converging. At
  // the default third speed that is half a minute for the six second loop.
  const surveyed = await p.waitForFunction(
    () => window.__hyperstitionStats?.centre?.surveyed === true,
    { timeout: 200000 }
  ).then(() => true).catch(() => false);
  await p.waitForTimeout(1500);

  const runs = [];
  for (let i = 0; i < SAMPLES; i++) {
    const m = await p.evaluate(measure);
    if (m) runs.push(m);
    await p.waitForTimeout(250);
  }
  await p.close();
  if (!runs.length) { console.log(path.basename(v).padEnd(24), "  no disc"); continue; }

  const avg = (f) => runs.reduce((a, m) => a + f(m), 0) / runs.length;
  const dpr = runs[0].dpr;
  const off = (f, mid) => (avg(f) - mid) / dpr; // CSS pixels, which is what the eye judges
  const r = avg((m) => m.r) / dpr;
  const cxo = off((m) => m.cx, runs[0].W / 2), cyo = off((m) => m.cy, runs[0].H / 2);
  const vxo = off((m) => m.vx, runs[0].W / 2), vyo = off((m) => m.vy, runs[0].H / 2);
  const bxo = off((m) => m.bx, runs[0].W / 2), byo = off((m) => m.by, runs[0].H / 2);
  // How much the centre moves over the samples as against where it sits: a
  // static offset can be nudged out, a drift cannot.
  const drift = Math.max(
    Math.max(...runs.map((m) => m.cx)) - Math.min(...runs.map((m) => m.cx)),
    Math.max(...runs.map((m) => m.cy)) - Math.min(...runs.map((m) => m.cy))
  ) / dpr;
  console.log(
    path.basename(v).replace(/-alpha\.webm$/, "").padEnd(24),
    cxo.toFixed(2).padStart(11), cyo.toFixed(2).padStart(7),
    (100 * Math.hypot(cxo, cyo) / r).toFixed(1).padStart(5) + "%", "  |",
    vxo.toFixed(2).padStart(11), vyo.toFixed(2).padStart(7),
    (100 * Math.hypot(vxo, vyo) / r).toFixed(1).padStart(5) + "%", "  |",
    bxo.toFixed(2).padStart(8), byo.toFixed(2).padStart(7), "  |",
    drift.toFixed(2) + "px",
    surveyed ? "" : "  (survey unfinished)"
  );
  // What to put in ?moonx=/?moony= to bring the visible shape to the middle.
  // Positive is right and up; the nudge is in disc radii, which is the unit
  // these offsets are already being reported in.
  rec.push([path.basename(v).replace(/-alpha\.webm$/, ""), -vxo / r, vyo / r]);
}

console.log("\nto centre the shape you can see rather than the true disc:");
for (const [name, nx, ny] of rec) {
  const near = Math.hypot(nx, ny) < 0.02;
  console.log("  " + name.padEnd(24),
    near ? "already centred" : `?moonx=${nx.toFixed(2)}&moony=${ny.toFixed(2)}`);
}

await browser.close();
server.kill();
process.exit(0);
