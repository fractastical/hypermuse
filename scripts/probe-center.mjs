// Is the backdrop actually seated on the moon?
//
// Shoots the backdrop on its own (moon faded out) and the moon on its own,
// then reports where each landed and how big each came out. Both should be at
// the window centre and the same diameter: the moon is pinned to the centre of
// the window and the backdrop is pinned to the measured disc, so any daylight
// between these two numbers is the misalignment you can see on stage.
//
//   node scripts/probe-center.mjs
//   GIF=assets/other.gif node scripts/probe-center.mjs
//
// Also writes /tmp/probe-center-both.png: the two together with the iris open
// and the zoom off, where the artwork's edge should sit on the moon's limb.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";

const PORT = Number(process.env.PORT || 8247);
const GIF = process.env.GIF || "assets/esoteric-geometries-circles-warp.gif";
const W = Number(process.env.W || 900);
const H = Number(process.env.H || 900);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "--silent", "."], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle"]
});
const context = await browser.newContext({ viewport: { width: W, height: H } });

async function shoot(query, file) {
  const page = await context.newPage();
  await page.goto(`${BASE}/hypermoon.html?stars=0&peek=0&${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__hyperstitionStats && window.__hyperstitionStats.moonReady,
    { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(8000);
  await page.screenshot({ path: file });
  await page.close();
}

// Extent of everything that is not background, in screen pixels.
function extent(file) {
  const buf = execFileSync(ffmpeg, ["-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: 1e9, stdio: ["ignore", "pipe", "ignore"] });
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2] < 13) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const gifQ = encodeURIComponent(GIF);
await shoot(`alpha=0&backdrop=${gifQ}`, "/tmp/probe-center-gif.png");
await shoot("iris=0", "/tmp/probe-center-moon.png");
await shoot(`iris=1&irissec=0.1&iriszoom=1&backdrop=${gifQ}`, "/tmp/probe-center-both.png");

const g = extent("/tmp/probe-center-gif.png");
const m = extent("/tmp/probe-center-moon.png");
const pad = (n) => String(n.toFixed(1)).padStart(7);
console.log(`window centre      ${pad(W / 2)} ${pad(H / 2)}`);
console.log(`backdrop centre    ${pad(g.cx)} ${pad(g.cy)}   size ${pad(g.w)} ${pad(g.h)}`);
console.log(`moon centre        ${pad(m.cx)} ${pad(m.cy)}   size ${pad(m.w)} ${pad(m.h)}`);
console.log(`backdrop off centre${pad(g.cx - W / 2)} ${pad(g.cy - H / 2)}`);
console.log(`backdrop vs moon   ${pad(g.cx - m.cx)} ${pad(g.cy - m.cy)}   size ${pad(g.w - m.w)} ${pad(g.h - m.h)}`);
console.log("\nthe moon's own numbers run a couple of pixels wide and left: its glow");
console.log("reaches past the limb and the unlit edge falls under the threshold.");

await browser.close();
server.kill();
process.exit(0);
