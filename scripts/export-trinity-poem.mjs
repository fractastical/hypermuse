// The whole trinity poem, one pass, as a 1920x1080 triangle video.
//
//   npm run export:poem
//
// Stops when the poem wraps, so the length is the poem's rather than a guess.
// The 60-second projector demo is left alone; this writes
// artifacts/demos/poem-triangle-full-1920x1080.mp4
//
//   ONLY=poem-full npm run press   afterwards, for a viewing copy in docs/press
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";
import { startStaticServer, serverUp, ensureDir, H264 } from "./lib/hypermoon-capture.mjs";

const ROOT = process.cwd();
const PORT = Number(process.env.SERVER_PORT || 8275);
const WIDTH = Number(process.env.EXPORT_WIDTH || 1920);
const HEIGHT = Number(process.env.EXPORT_HEIGHT || 1080);
const FPS = Number(process.env.EXPORT_FPS || 30);
const OUT = path.resolve(ROOT, process.env.OUTPUT_VIDEO ||
  "artifacts/demos/poem-triangle-full-1920x1080.mp4");
const FRAMES = path.join(ROOT, "artifacts", "poem-full-frames");
const QUERY = "poem=trinitypoem.txt&group=3&layout=triangle&trifollow=1" +
  "&triease=1.2&trighost=6&color=white&fx=0&cps=13&hold=1.6" +
  "&safe=0.06&fit=0.97&align=center&vcenter=1";
// A safety cap so a stuck page cannot run overnight. The poem is about 12
// minutes; this is twice that.
const MAX_MS = Number(process.env.MAX_MS || 24 * 60 * 1000);

if (!ffmpegPath) throw new Error("ffmpeg-static missing");

const server = await startStaticServer({ root: ROOT, port: PORT });
if (!(await serverUp(`http://127.0.0.1:${PORT}/crt-terminal.html`, 8000))) {
  throw new Error("could not reach crt-terminal.html");
}

const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--use-gl=angle"]
});

try {
  if (fs.existsSync(FRAMES)) fs.rmSync(FRAMES, { recursive: true, force: true });
  ensureDir(FRAMES);
  ensureDir(path.dirname(OUT));

  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.warn("[poem] page error:", e.message));
  await page.goto(`http://127.0.0.1:${PORT}/crt-terminal.html?${QUERY}`, {
    waitUntil: "domcontentloaded", timeout: 45000
  });
  await page.waitForFunction(() => window.__hyperstitionReady === true, undefined, { timeout: 30000 });
  const info = await page.evaluate(() => {
    const s = window.__hyperstitionStats;
    return { frames: s.frames, cps: s.cps, hold: s.hold, shape: s.shape };
  });
  console.log(`[poem] ${info.frames} screens, ${info.shape}, ${info.cps} cps, hold ${info.hold}s`);

  const cdp = await context.newCDPSession(page);
  let n = 0;
  const stamps = [];
  cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    fs.writeFileSync(path.join(FRAMES, `frame-${String(n).padStart(5, "0")}.jpg`), Buffer.from(data, "base64"));
    stamps.push(metadata.timestamp * 1000);
    n++;
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg", quality: 90, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1
  });

  const t0 = Date.now();
  let last = 0;
  while (Date.now() - t0 < MAX_MS) {
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => {
      const st = window.__hyperstitionStats;
      return { pass: st.pass, frame: st.frame, frames: st.frames, written: st.written };
    });
    const sec = ((Date.now() - t0) / 1000).toFixed(0);
    if (s.frame !== last) {
      console.log(`[poem] ${sec}s  screen ${s.frame + 1}/${s.frames}  frames ${n}  “${s.written.slice(0, 40)}”`);
      last = s.frame;
    }
    if (s.pass >= 1) {
      console.log(`[poem] wrapped after ${sec}s`);
      break;
    }
  }

  await cdp.send("Page.stopScreencast").catch(() => {});
  await context.close();

  if (n < 8) throw new Error(`only captured ${n} frames`);
  const measured = stamps[n - 1] - stamps[0];
  const captured = Math.max(4, Math.min(60, n / Math.max(measured / 1000, 0.001)));
  console.log(`[poem] encoding ${n} frames (${captured.toFixed(1)} fps captured, ${ (measured / 1000).toFixed(1)}s)`);

  const enc = spawnSync(ffmpegPath, [
    "-y", "-framerate", captured.toFixed(3),
    "-i", path.join(FRAMES, "frame-%05d.jpg"),
    "-vf", `fps=${FPS},format=yuv420p`,
    "-r", String(FPS),
    ...H264, "-movflags", "+faststart", OUT
  ], { encoding: "utf8" });
  if (enc.status !== 0) throw new Error(enc.stderr || "ffmpeg failed");

  const mb = (fs.statSync(OUT).size / (1024 * 1024)).toFixed(1);
  console.log(`\nwrote ${path.relative(ROOT, OUT)}  ${mb}M  ${(measured / 1000).toFixed(1)}s`);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  if (fs.existsSync(FRAMES)) fs.rmSync(FRAMES, { recursive: true, force: true });
}
