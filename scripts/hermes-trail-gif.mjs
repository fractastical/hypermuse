#!/usr/bin/env node
// The trail, drawing itself, as a gif you can put anywhere.
//
//   npm run hermes:gif
//   npm run hermes:gif -- --frames=140 --fps=24 --width=900
//
// Shoots the story page once per frame with ?upto=N, which draws the first N
// points of the night and stops. Deterministic on purpose: an animation captured
// off a running clock gives a different gif every time and no way to tell a
// rendering bug from a slow frame. Here, frame N is a pure function of N.
//
// Wants the story page built (npm run hermes:story) and a server to serve it,
// because a canvas drawing an svg off file:// is blocked as cross-origin.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const storyDir = process.env.HERMES_STORY_DIR || join(repo, "artifacts", "hermes-story");

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : fallback;
};
const FRAMES = Math.max(8, arg("frames", 120));
const FPS = Math.max(4, arg("fps", 22));
// Frames held on the finished trail before it loops, so the whole night can be
// read before it starts over. A gif that restarts the instant it arrives never
// shows you the thing it spent five seconds drawing.
const HOLD = Math.max(0, arg("hold", 26));
const WIDTH = Math.max(320, arg("width", 860));
const PORT = process.env.PORT || 8124;
const page0 = `http://127.0.0.1:${PORT}/artifacts/hermes-story/index.html`;

if (!existsSync(join(storyDir, "index.html"))) {
  console.error("no story page yet — run: npm run hermes:story");
  process.exit(1);
}

const frameDir = join(storyDir, "frames");
mkdirSync(frameDir, { recursive: true });
for (const old of readdirSync(frameDir)) {
  if (old.endsWith(".png")) unlinkSync(join(frameDir, old));
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1500, height: 1000 },
  deviceScaleFactor: 2
});
page.on("console", (m) => { if (m.type() === "error") console.log("  page:", m.text()); });

// Asked for once to find out how long the night is, and to fail early and
// legibly if the page is not what this expects rather than after 120 blank shots.
await page.goto(`${page0}?upto=0`, { waitUntil: "networkidle" });
const total = await page.evaluate(() => (window.STORY && window.STORY.total) || 0);
if (!total) {
  await browser.close();
  console.error("the story page did not report a point total — is it an old build?");
  console.error("rebuild it with: npm run hermes:story");
  process.exit(1);
}
// The whole schedule from the page itself, so the gif and the live playback are
// the same animation rather than two that resemble each other — and so the pacing
// by distance travelled lives in one place.
const schedule = await page.evaluate((n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(STORY.upto((i + 1) / n));
  return out;
}, FRAMES);
if (typeof schedule[0] !== "number") {
  await browser.close();
  console.error("the story page has no frame schedule — rebuild it: npm run hermes:story");
  process.exit(1);
}
console.log(`${total} points, ${FRAMES} frames + ${HOLD} held, ${FPS}fps`);

for (let i = 0; i < FRAMES; i++) {
  const upto = schedule[i];
  await page.goto(`${page0}?upto=${upto}`, { waitUntil: "networkidle" });
  const shot = await page.$("canvas");
  writeFileSync(join(frameDir, `f${String(i).padStart(4, "0")}.png`),
    await shot.screenshot({ type: "png" }));
  if (i % 20 === 0 || i === FRAMES - 1) {
    process.stdout.write(`  frame ${i + 1}/${FRAMES} (point ${upto})\n`);
  }
}
await browser.close();

// The held tail is the last frame repeated. Cheaper than shooting it again, and
// bit-identical, which is what lets the encoder collapse it to almost nothing.
const lastFrame = join(frameDir, `f${String(FRAMES - 1).padStart(4, "0")}.png`);
for (let i = 0; i < HOLD; i++) {
  const { readFileSync } = await import("node:fs");
  writeFileSync(join(frameDir, `f${String(FRAMES + i).padStart(4, "0")}.png`),
    readFileSync(lastFrame));
}

const out = join(storyDir, "hermes-trail.gif");
// One palette for the whole animation rather than per frame: the trail grows
// against a fixed city, so a palette that changes frame to frame makes the
// streets crawl. Bayer dithering because the map is flat greys and error
// diffusion on flat greys is a field of moving speckle.
await run("ffmpeg", [
  "-y", "-framerate", String(FPS),
  "-i", join(frameDir, "f%04d.png"),
  "-filter_complex",
  `[0:v]scale=${WIDTH}:-1:flags=lanczos,split[a][b];` +
  `[a]palettegen=max_colors=192:stats_mode=full[p];` +
  `[b][p]paletteuse=dither=bayer:bayer_scale=3`,
  "-loop", "0", out
], { maxBuffer: 64 << 20 });

const { rmSync, statSync } = await import("node:fs");
const kb = Math.round(statSync(out).size / 1024);
// The frames go, unless asked for. They are tens of megabytes of retina pngs and
// they live inside the directory that gets published — a dispatch folder that is
// 99% discarded intermediates is a mistake waiting to be pushed.
if (process.argv.includes("--keep")) {
  console.log(`\nframes kept in ${frameDir.replace(repo + "/", "")}`);
} else {
  rmSync(frameDir, { recursive: true, force: true });
}
console.log(`\n${out.replace(repo + "/", "")} — ${kb}KB, ` +
  `${((FRAMES + HOLD) / FPS).toFixed(1)}s, ${WIDTH}px wide`);
