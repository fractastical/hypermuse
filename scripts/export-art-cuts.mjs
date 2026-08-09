#!/usr/bin/env node
/**
 * Clean 5-second cuts of the strongest hypermoon sequences, for cutting into
 * a video art piece. Unlike the effects reel these carry no captions, run at
 * a uniform constant frame rate, and are choreographed: each cut opens, does
 * something, and lands, so it can stand on its own or loop.
 *
 *   npm run export:art                       # all cuts + montage, 1080p
 *   CUTS=eye,blood,cymatics npm run export:art
 *   CUT_MS=8000 npm run export:art           # longer cuts
 *   SIZE=1080x1080 npm run export:art        # square (holofan / installation)
 *   PRORES=1 npm run export:art              # add ProRes 422 editing masters
 *   MONTAGE=0 npm run export:art             # skip the stitched montage
 *
 * Output: artifacts/art-cuts/<id>.mp4 (+ .mov with PRORES=1) and
 * artifacts/art-cuts/hypermoon-art-montage.mp4.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";

const ROOT = process.cwd();
const FRAMES_DIR = path.join(ROOT, "artifacts", "art-cut-frames");
const OUT_DIR = path.resolve(ROOT, process.env.OUT_DIR || "artifacts/art-cuts");
const CUT_MS = Number.parseInt(process.env.CUT_MS || "5000", 10);
const [WIDTH, HEIGHT] = (process.env.SIZE || "1920x1080").split("x").map((n) => Number.parseInt(n, 10));
// Constant output rate: capture rate varies with render load, so every cut is
// resampled to this so an NLE sees uniform, frame-accurate media.
const FPS = Number.parseInt(process.env.FPS || "30", 10);
const PRORES = process.env.PRORES === "1";
const MONTAGE = process.env.MONTAGE !== "0";
const XFADE = Number.parseFloat(process.env.XFADE || "0"); // seconds; 0 = hard cuts
const PORT = Number.parseInt(process.env.SERVER_PORT || "8232", 10);
const ANCHOR_MS = Number.parseInt(process.env.ANCHOR_MS || "9000", 10);
const SLOW_SPEED = Number.parseFloat(process.env.SLOW_SPEED || "0.25");
const EYE_GIF = "assets/esoteric-geometries-circles-warp.gif";

// Window scenes: hold until the anchored dark-side window faces the camera,
// slow the moon so it stays there, and open the window past its measured
// shadow patch so the content is not a speck.
const WIN = { angw: "1.35", angh: "0.85", threshold: "0.4" };

/**
 * act: [{ at: 0..1 of the cut, set: {…} }] — posted over the hypermoon
 * BroadcastChannel mid-capture, which is what gives each cut its arc.
 */
const CUTS = [
  {
    id: "eye", title: "eye opens",
    q: { backdrop: EYE_GIF, backscale: "0.98", iris: "0", iriszoom: "2.5", irissec: "3.4", stars: "500", meteors: "6" },
    act: [{ at: 0.12, set: { iris: 1 } }],
    note: "the disc irises open onto the seal behind it"
  },
  {
    id: "blood", title: "blood bloom",
    // The fade is started by the act, not the URL: a fade set at load would
    // burn through during the pre-roll and the cut would open already red.
    q: { bloodmoon: "0", stars: "420", meteors: "4" },
    act: [{ at: 0.06, set: { bloodtarget: 1, bloodfade: 4.4 } }],
    note: "the disc grades into a copper eclipse, craters keeping their relief"
  },
  {
    id: "eclipse", title: "earth's shadow",
    // Parked just past first contact, then the transit is released into the
    // cut. Kept in the partial phase: the hard shadow edge crossing a still-lit
    // disc is the strong image, whereas totality is just a dark ball.
    q: { eclipse: "0.26", eclipsedeep: "0.6", stars: "500", meteors: "0" },
    act: [{ at: 0.04, set: { eclipsetarget: 0.42, eclipserun: 24 } }],
    note: "the umbra's edge crosses the lit disc"
  },
  {
    id: "cymatics", title: "cymatics plate", facing: true,
    q: { ...WIN, content: "cymatics", winbright: "0.8", cymsec: "2.4", angw: "1.4", angh: "0.95" },
    note: "sand settling onto the nodal lines of a driven plate"
  },
  {
    id: "harmonics", title: "sonic sphere", facing: true,
    q: { ...WIN, content: "harmonics", winbright: "0.85", harmsec: "2.4", angw: "1.5", angh: "0.95" },
    note: "normal modes of a vibrating sphere, ringing in place"
  },
  {
    id: "word", title: "hyperstition", facing: true,
    q: { ...WIN, word: "hyperstition", angw: "1.95", angh: "0.62", threshold: "0.3" },
    note: "letter cubes anchored to the dark terrain"
  },
  {
    id: "fisher", title: "the star fisher",
    // fisherlive keeps him on his own layer so the whole cast fits the cut.
    q: { fisherlive: "1", fishersec: "5", fisherheart: "1", stars: "700", meteors: "10", vajras: "2" },
    note: "hooks a star, cups it, lets it go"
  },
  {
    id: "vajras", title: "orbiting vajras",
    q: { vajras: "6", vajraradius: "1.28", vajraTilt: "0.5", stars: "600", meteors: "8" },
    note: "dorje sprites on tilted lanes, ducking behind the disc"
  },
  {
    id: "stars", title: "starfield drift",
    q: { stars: "900", meteors: "50", stardrift: "3", vajras: "3" },
    note: "parallax sky behind everything, meteors crossing"
  },
  {
    id: "mumins", title: "dancing mumins", facing: true,
    // Three rather than a crowd, zoomed so the whole troupe fits the window:
    // the default ring is sized for the full canvas and crops to one giant leg.
    q: { ...WIN, content: "mumins", mumins: "3", muminzoom: "0.9", muminbpm: "104", winbright: "0.55",
         angw: "1.7", angh: "1.1", winscale: "1.4", threshold: "0.4" },
    note: "a troupe of little trolls, painted solid on the surface"
  },
  {
    id: "crt", title: "CRT terminal", facing: true,
    q: { ...WIN, content: "crt", mosaic: "0" },
    note: "a live terminal typing through the window"
  },
  {
    id: "incant", title: "incantation", facing: true,
    q: { ...WIN, content: "incant", apparition: "0" },
    note: "mantra phrases surfacing one at a time"
  },
  {
    id: "vajracave", title: "vajra cave", facing: true,
    q: { ...WIN, content: "vajra", mosaic: "0" },
    note: "spinning dorjes recessed into the moon"
  }
];

const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

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

function cutUrl(cut) {
  const q = new URLSearchParams({ speed: "1", nosound: "1", ...cut.q });
  return `http://127.0.0.1:${PORT}/hypermoon.html?${q.toString()}`;
}

function encode(framesDir, out, count, measuredMs, targetMs) {
  const captured = Math.max(4, Math.min(60, count / Math.max(measuredMs / 1000, 0.001)));
  // Each cut has its own frame directory: -frames:v counts frames *after* the
  // fps filter, so a shared directory with a running counter would let one cut
  // read on into the next one's frames.
  const args = [
    "-y", "-framerate", captured.toFixed(3),
    "-i", path.join(framesDir, "frame-%05d.jpg"),
    // Resample to constant FPS, then clone the tail and hard-trim so every cut
    // is exactly the same length and frame count in a timeline.
    "-vf", `fps=${FPS},tpad=stop_mode=clone:stop_duration=0.6,format=yuv420p`,
    "-t", (targetMs / 1000).toFixed(3),
    "-r", String(FPS)
  ];
  args.push("-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out);
  const enc = spawnSync(ffmpegPath, args, { encoding: "utf8" });
  if (enc.status !== 0) throw new Error(enc.stderr || "ffmpeg failed");

  if (PRORES) {
    const mov = out.replace(/\.mp4$/, ".mov");
    const pr = spawnSync(ffmpegPath, [
      "-y", "-i", out, "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", mov
    ], { encoding: "utf8" });
    if (pr.status !== 0) throw new Error(pr.stderr || "prores failed");
  }
  return { seconds: +(targetMs / 1000).toFixed(2), capturedFps: +captured.toFixed(1) };
}

async function main() {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) throw new Error("ffmpeg-static missing");

  const wanted = String(process.env.CUTS || "").trim();
  const cuts = wanted
    ? wanted.split(",").map((s) => s.trim()).filter(Boolean).map((id) => {
        const c = CUTS.find((x) => x.id === id);
        if (!c) throw new Error("unknown cut: " + id);
        return c;
      })
    : CUTS;

  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  ensureDir(FRAMES_DIR);
  ensureDir(OUT_DIR);

  let server = null;
  const probe = `http://127.0.0.1:${PORT}/hypermoon.html`;
  if (!(await serverUp(probe, 1500))) {
    console.log(`[art] starting http-server on :${PORT}`);
    server = spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "."], {
      cwd: ROOT, stdio: "ignore", detached: true
    });
    if (!(await serverUp(probe, 30000))) throw new Error(`could not reach ${probe}`);
  }

  const browser = await chromium.launch({
    channel: "chrome", headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"]
  });

  const made = [];
  let frame = 0;
  const stamps = [];
  const spans = [];
  try {
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.warn("[art] page error:", e.message));

    const cdp = await context.newCDPSession(page);
    let recording = false;
    let cutDir = null;
    cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      if (!recording || !cutDir) return;
      fs.writeFileSync(path.join(cutDir, `frame-${String(frame).padStart(5, "0")}.jpg`), Buffer.from(data, "base64"));
      stamps.push(metadata.timestamp * 1000);
      frame++;
    });

    for (const cut of cuts) {
      const ms = cut.ms || CUT_MS;
      console.log(`[art] ${cut.id}: ${cut.title}`);
      await page.goto(cutUrl(cut), { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForFunction(() => window.__hyperstitionReady === true, undefined, { timeout: 90000 });
      await page.waitForFunction(() => (window.__hyperstitionStats || {}).moonReady === true, undefined, { timeout: 60000 })
        .catch(() => console.warn("[art]   moon never reported ready, capturing anyway"));
      await page.waitForTimeout(cut.facing ? ANCHOR_MS : 2500);

      if (cut.facing) {
        await page.waitForFunction(() => {
          const a = (window.__hyperstitionStats || {}).facingAngle;
          return typeof a === "number" && a > -0.5 && a < -0.12;
        }, undefined, { timeout: 30000 })
          .catch(() => console.warn("[art]   window never faced front, capturing anyway"));
        await page.evaluate((v) => {
          new BroadcastChannel("hypermoon").postMessage({ type: "moonConfig", set: { speed: v } });
        }, SLOW_SPEED);
      }

      cutDir = path.join(FRAMES_DIR, cut.id);
      ensureDir(cutDir);
      frame = 0;
      stamps.length = 0;
      await cdp.send("Page.startScreencast", {
        format: "jpeg", quality: 92, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1
      });
      recording = true;

      // Choreography: fire each act at its point in the cut.
      const acts = (cut.act || []).slice().sort((a, b) => a.at - b.at);
      let elapsed = 0;
      for (const a of acts) {
        const target = Math.max(0, Math.min(ms, a.at * ms));
        if (target > elapsed) { await page.waitForTimeout(target - elapsed); elapsed = target; }
        await page.evaluate((set) => {
          new BroadcastChannel("hypermoon").postMessage({ type: "moonConfig", set });
        }, a.set);
      }
      if (elapsed < ms) await page.waitForTimeout(ms - elapsed);

      recording = false;
      await cdp.send("Page.stopScreencast").catch(() => {});

      if (frame > 1) {
        spans.push({ ...cut, dir: cutDir, count: frame, ms: stamps[frame - 1] - stamps[0], targetMs: ms });
      } else {
        console.warn(`[art]   ${cut.id}: no frames captured, skipped`);
      }
    }
    await context.close();
  } finally {
    await browser.close();
    if (server && !server.killed) {
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    }
  }

  if (!spans.length) throw new Error("no cuts captured");

  const files = [];
  for (const s of spans) {
    const out = path.join(OUT_DIR, `${s.id}.mp4`);
    const info = encode(s.dir, out, s.count, s.ms, s.targetMs);
    console.log(`[art] cut ${s.id}: ${info.seconds}s (captured ${info.capturedFps}fps -> ${FPS}fps CFR)`);
    files.push(out);
    made.push({ id: s.id, title: s.title, note: s.note, file: path.relative(ROOT, out), ...info });
  }

  if (MONTAGE && files.length > 1) {
    const montage = path.join(OUT_DIR, "hypermoon-art-montage.mp4");
    if (XFADE > 0) {
      // Chained xfade: each transition eats XFADE seconds of overlap.
      const args = [];
      files.forEach((f) => args.push("-i", f));
      let filter = "";
      let prev = "0:v";
      const cutSec = CUT_MS / 1000;
      for (let i = 1; i < files.length; i++) {
        const label = i === files.length - 1 ? "v" : `x${i}`;
        const offset = (cutSec - XFADE) * i;
        filter += `[${prev}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}[${label}];`;
        prev = label;
      }
      args.push("-filter_complex", filter.replace(/;$/, ""), "-map", "[v]",
        "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p", "-r", String(FPS),
        "-movflags", "+faststart", montage);
      const enc = spawnSync(ffmpegPath, args, { encoding: "utf8" });
      if (enc.status !== 0) throw new Error(enc.stderr || "montage failed");
    } else {
      const listFile = path.join(FRAMES_DIR, "concat.txt");
      fs.writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
      const enc = spawnSync(ffmpegPath, [
        "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", montage
      ], { encoding: "utf8" });
      if (enc.status !== 0) throw new Error(enc.stderr || "montage failed");
    }
    console.log(`[art] montage: ${path.relative(ROOT, montage)}`);
    made.push({ id: "montage", title: "all cuts", file: path.relative(ROOT, montage) });
  }

  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  console.log(JSON.stringify({ size: `${WIDTH}x${HEIGHT}`, fps: FPS, cutSeconds: CUT_MS / 1000, outputs: made }, null, 2));
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
