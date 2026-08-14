#!/usr/bin/env node
/**
 * Renders the hypermoon as it would look on a large 3D holographic LED fan.
 *
 * Two passes: first the moon is filmed square, the way it would be loaded onto
 * the fan's controller, then holofan.html plays that clip back through a
 * simulated spinning LED arm in a dark room and that is filmed in turn.
 *
 *   npm run export:holofan
 *   SKIP_SOURCE=1 npm run export:holofan          # reuse the square clip
 *   SHOT=room SKIP_SOURCE=1 npm run export:holofan  # from across the lobby
 *   SHOT=rig SKIP_SOURCE=1 npm run export:holofan   # on the 4.3 m hire tower
 *   DIAM=120 FAN_MS=20000 npm run export:holofan
 *   STILL=1 npm run export:holofan                # just a frame, to eyeball
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";

const ROOT = process.cwd();
const FRAMES = path.join(ROOT, "artifacts", "holofan-frames");
const SOURCE = path.resolve(ROOT, process.env.SOURCE_VIDEO || "artifacts/holofan-source.mp4");
const SHOT = (process.env.SHOT || "push").toLowerCase();
const RIGSHOT = SHOT === "rig";
const WIDE = SHOT === "room" || SHOT === "wide";
const OUT = path.resolve(ROOT, process.env.OUTPUT_VIDEO || (RIGSHOT
  ? "artifacts/demos/hypermuse-rig-4m3.mp4"
  : WIDE
    ? "artifacts/demos/hypermoon-holofan-180cm-room.mp4"
    : "artifacts/demos/hypermoon-holofan-180cm.mp4"));
const STILL = process.env.STILL === "1";
const SKIP_SOURCE = process.env.SKIP_SOURCE === "1";

const SRC_SIZE = Number.parseInt(process.env.SRC_SIZE || "1024", 10);
// Kept longer than the shot: if the clip wraps while the fan is being filmed,
// the sequence below snaps back to its opening in the last few seconds.
const SRC_MS = Number.parseInt(process.env.SRC_MS || "56000", 10);
// The rotation sequencer can't be trusted to land an effect inside a clip this
// short — the window is only on camera for part of a turn — so the source is
// cued by hand, and picked for what LEDs do well: a hole in the disc, then
// figures inside it, then the two whole-disc colour events.
const CUES = [
  { at: 9000, set: { iris: 1 } },
  { at: 18500, set: { iris: 0, content: "harmonics" } },
  { at: 27000, set: { content: "", bloodmoon: 0.85 } },
  // Eclipse progress is the shadow's whole transit, so totality sits halfway.
  // A slow crossing started here has the disc at its deepest as the shot ends.
  { at: 32000, set: { bloodmoon: 0, eclipse: 0, eclipserun: 30, eclipsetarget: 1 } }
];
const MOON_SPEED = process.env.MOON_SPEED || "2";
const ANCHOR_MS = Number.parseInt(process.env.ANCHOR_MS || "12000", 10);
// Whether to hold the source pass until whatever is anchored to the dark side
// has come round square to the camera. Where the terrain happens to be when
// the anchor settles is luck, and for a still that luck is the whole picture.
const FACE = process.env.FACE === "1";
// How long the fan page runs before a still is taken, which is also how far
// into the source clip the frame comes from.
const STILL_MS = Number.parseInt(process.env.STILL_MS || "1200", 10);

const WIDTH = Number.parseInt(process.env.EXPORT_WIDTH || "1920", 10);
const HEIGHT = Number.parseInt(process.env.EXPORT_HEIGHT || "1080", 10);
const FAN_MS = Number.parseInt(process.env.FAN_MS || "46000", 10);
const FAN_NTH = Number.parseInt(process.env.FAN_NTH || "2", 10);
const DIAM = process.env.DIAM || "180";
const PORT = Number.parseInt(process.env.SERVER_PORT || "8233", 10);

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

async function serverUp(url, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 500); });
      req.on("error", () => resolve(false));
      req.setTimeout(1200, () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
}

// Records compositor frames off the DevTools screencast, which keeps up with
// motion in a way repeated screenshots never do, and reports the rate actually
// achieved so the encode plays at true speed.
async function record(context, page, ms, size, nth = 1) {
  if (fs.existsSync(FRAMES)) fs.rmSync(FRAMES, { recursive: true, force: true });
  ensureDir(FRAMES);
  const cdp = await context.newCDPSession(page);
  let frame = 0;
  const stamps = [];
  let on = false;
  cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (!on) return;
    fs.writeFileSync(path.join(FRAMES, `f-${String(frame).padStart(5, "0")}.jpg`), Buffer.from(data, "base64"));
    stamps.push(metadata.timestamp * 1000);
    frame++;
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg", quality: 88, maxWidth: size.width, maxHeight: size.height, everyNthFrame: nth
  });
  on = true;
  await page.waitForTimeout(ms);
  on = false;
  await cdp.send("Page.stopScreencast").catch(() => {});
  if (frame < 2) throw new Error("no frames captured");
  const spanMs = stamps[frame - 1] - stamps[0];
  return { frame, fps: Math.max(4, Math.min(60, frame / Math.max(spanMs / 1000, 0.001))), spanMs };
}

function encode(out, count, fps) {
  ensureDir(path.dirname(out));
  const args = [
    "-y", "-framerate", fps.toFixed(3),
    "-i", path.join(FRAMES, "f-%05d.jpg"),
    "-frames:v", String(count),
    // The screencast can come back an odd number of pixels tall, which h264
    // will not take.
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264", "-crf", "19", "-preset", "medium", "-pix_fmt", "yuv420p", out
  ];
  const r = spawnSync(ffmpegPath, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || "ffmpeg failed");
}

async function main() {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) throw new Error("ffmpeg-static binary missing");
  ensureDir(path.join(ROOT, "artifacts"));
  // Said before the hour of rendering rather than after it. OUTPUT_VIDEO is an
  // environment variable, so it can be left set in a shell from something else
  // entirely and quietly point this run at that file - which it will overwrite.
  if (!STILL) {
    console.log(`[holofan] ${SHOT} -> ${path.relative(ROOT, OUT)}` +
      (process.env.OUTPUT_VIDEO ? "  (from OUTPUT_VIDEO in the environment)" : ""));
    if (process.env.OUTPUT_VIDEO && !/holofan|rig/i.test(path.basename(OUT))) {
      console.warn(`[holofan] WARNING: ${path.basename(OUT)} does not look like a fan render. ` +
        `If that is a leftover OUTPUT_VIDEO, unset it.`);
    }
  }

  let server = null;
  const probe = `http://127.0.0.1:${PORT}/holofan.html`;
  if (!(await serverUp(probe, 1500))) {
    console.log(`[holofan] starting http-server on :${PORT}`);
    server = spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "."], {
      cwd: ROOT, stdio: "ignore", detached: true
    });
    if (!(await serverUp(probe, 30000))) throw new Error(`could not reach ${probe}`);
  }

  const browser = await chromium.launch({
    channel: "chrome", headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--enable-gpu-rasterization"]
  });

  try {
    // ---- pass one: the moon, square, the way the fan's card wants it -------
    if (!SKIP_SOURCE || !fs.existsSync(SOURCE)) {
      const ctx = await browser.newContext({ viewport: { width: SRC_SIZE, height: SRC_SIZE } });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.warn("[holofan] moon page error:", e.message));
      const q = new URLSearchParams({
        speed: "1", nosound: "1", moonscale: "1.9",
        stars: "900", meteors: "26", stardrift: "2.5", vajras: "3",
        backdrop: "assets/esoteric-geometries-circles-warp.gif", iriszoom: "2.5", backscale: "0.98",
        // Opened past the measured shadow patch, or the window content is a
        // speck by the time it has been through the LED grid.
        angw: "1.5", angh: "0.95", threshold: "0.42", winbright: "0.85", harmsec: "3.5",
        ...(process.env.MOON_QUERY ? Object.fromEntries(new URLSearchParams(process.env.MOON_QUERY)) : {})
      });
      await page.goto(`http://127.0.0.1:${PORT}/hypermoon.html?${q}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForFunction(() => window.__hyperstitionReady === true, undefined, { timeout: 90000 });
      // The anchor estimator needs a turn at full speed before the window can
      // open on the dark patch; only then is it safe to wind the moon up.
      await page.waitForTimeout(ANCHOR_MS);
      if (FACE) {
        await page.waitForFunction(() => {
          const a = (window.__hyperstitionStats || {}).facingAngle;
          return typeof a === "number" && a > -0.5 && a < -0.12;
        }, undefined, { timeout: 40000 })
          .catch(() => console.warn("[holofan]   never came round front, filming anyway"));
      }
      // A broadcast channel never echoes to the page that posted it, so the
      // cues have to come from a second page on the same origin.
      const cuePage = await ctx.newPage();
      await cuePage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
      await cuePage.evaluate((v) => {
        new BroadcastChannel("hypermoon").postMessage({ type: "moonConfig", set: { speed: Number(v) } });
      }, MOON_SPEED);
      // Opening that second tab shrinks the first one's viewport, and the
      // square framing matters here.
      await page.bringToFront();
      await page.setViewportSize({ width: SRC_SIZE, height: SRC_SIZE });
      console.log(`[holofan] filming the moon square, ${(SRC_MS / 1000).toFixed(0)}s at ${SRC_SIZE}px`);
      // The cues are armed inside the page rather than fired from here: this
      // process spends the capture writing sixty frames a second to disk, and
      // a timer stuck behind that lands seconds late or not at all.
      const due = CUES.filter((c) => c.at < SRC_MS);
      await cuePage.evaluate((cues) => {
        const ch = new BroadcastChannel("hypermoon");
        window.__fired = [];
        for (const c of cues) {
          setTimeout(() => {
            ch.postMessage({ type: "moonConfig", set: c.set });
            window.__fired.push(c.at);
          }, c.at);
        }
      }, due);
      const r = await record(ctx, page, SRC_MS, { width: SRC_SIZE, height: SRC_SIZE });
      const fired = await cuePage.evaluate(() => window.__fired || []);
      for (const c of due) {
        const ok = fired.includes(c.at);
        console.log(`[holofan]   ${ok ? "+" : "MISSED "}${(c.at / 1000).toFixed(0)}s ${JSON.stringify(c.set)}`);
      }
      encode(SOURCE, r.frame, r.fps);
      console.log(`[holofan]   ${r.frame} frames @ ${r.fps.toFixed(1)}fps -> ${path.relative(ROOT, SOURCE)}`);
      await ctx.close();
    } else {
      console.log(`[holofan] reusing ${path.relative(ROOT, SOURCE)}`);
    }

    // ---- pass two: that clip, played on the fan ----------------------------
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.warn("[holofan] fan page error:", e.message));
    // push opens wide enough to read 180 cm against the room, then goes in
    // until the LED rings and the update seam are visible. room stays back
    // across the lobby for the whole shot and barely moves, so the disc is
    // read at the distance an audience actually stands at.
    const fq = new URLSearchParams({
      src: path.relative(ROOT, SOURCE), diam: DIAM,
      // Under house lights the disc has to out-punch the room and the source is
      // already bright, so it is held well below the page's lobby default. The
      // rig is filmed at night, where the disc lights everything and the page's
      // own dark default is the right one.
      ...(RIGSHOT ? {} : { gain: "1.05" }),
      ...(RIGSHOT
        // The hire rig: the tower's own defaults frame it, so nothing is
        // overridden here but the length of the move.
        ? { shot: "rig", dollysec: String(Math.round(FAN_MS * 0.9 / 1000)) }
        : WIDE
          ? { shot: "room", dollysec: String(Math.round(FAN_MS * 0.9 / 1000)) }
          : { dist: "5.3", dist2: "2.6", dollysec: String(Math.round(FAN_MS * 0.72 / 1000)) }),
      ...(process.env.FAN_QUERY ? Object.fromEntries(new URLSearchParams(process.env.FAN_QUERY)) : {})
    });
    await page.goto(`http://127.0.0.1:${PORT}/holofan.html?${fq}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => window.__holofanReady === true, undefined, { timeout: 60000 });
    await page.waitForTimeout(STILL ? STILL_MS : 1200);

    if (STILL) {
      const still = path.resolve(ROOT, process.env.OUTPUT_STILL || "artifacts/holofan-still.png");
      ensureDir(path.dirname(still));
      await page.screenshot({ path: still });
      console.log(`[holofan] still -> ${path.relative(ROOT, still)}`);
    } else {
      console.log(`[holofan] filming the fan, ${(FAN_MS / 1000).toFixed(0)}s at ${WIDTH}x${HEIGHT}, ${60 / FAN_NTH}fps`);
      // Every other compositor frame, so the fan is filmed at 30 like the
      // phone footage it is imitating. At 500 rpm on four blades that is just
      // over one arm pass per frame, and the near-miss is what sets the
      // shutter wedge crawling instead of strobing.
      const r = await record(ctx, page, FAN_MS, { width: WIDTH, height: HEIGHT }, FAN_NTH);
      encode(OUT, r.frame, r.fps);
      console.log(JSON.stringify({
        output: path.relative(ROOT, OUT), frames: r.frame,
        seconds: +(r.spanMs / 1000).toFixed(1), fps: +r.fps.toFixed(2), size: `${WIDTH}x${HEIGHT}`
      }, null, 2));
    }
    await ctx.close();
  } finally {
    await browser.close();
    if (server && !server.killed) {
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    }
    if (fs.existsSync(FRAMES) && process.env.KEEP_FRAMES !== "1") {
      fs.rmSync(FRAMES, { recursive: true, force: true });
    }
  }
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
