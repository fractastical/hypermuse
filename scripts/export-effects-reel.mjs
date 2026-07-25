#!/usr/bin/env node
/**
 * Montage of every effect the hypermoon currently has, one scene each, with
 * a caption naming the effect and the query that produces it.
 *
 *   npm run export:reel                              # the montage
 *   npm run export:clips                             # one video per effect
 *   SCENE_MS=4000 EXPORT_WIDTH=1920 EXPORT_HEIGHT=1080 npm run export:reel
 *   SCENES=mumins,vajras,blood npm run export:reel   # subset, in this order
 *
 * Window content only shows while the anchored dark-side window faces the
 * camera, so those scenes wait for the moon to bring it around before the
 * capture starts. Frame timestamps are recorded and the encode uses the rate
 * actually achieved, so the montage plays back at true speed instead of the
 * screenshot loop's speed.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";

const PROJECT_ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
const FRAMES_DIR = path.join(ARTIFACTS_DIR, "effects-reel-frames");
const OUTPUT = path.resolve(PROJECT_ROOT, process.env.OUTPUT_VIDEO || "artifacts/hypermoon-effects-reel.mp4");
const CLIPS_DIR = path.resolve(PROJECT_ROOT, process.env.CLIPS_DIR || "artifacts/demos/effects");
// CLIPS=1 writes one little video per effect; REEL=0 skips the long montage.
const CLIPS = process.env.CLIPS === "1";
const REEL = process.env.REEL !== "0";
const WIDTH = Number.parseInt(process.env.EXPORT_WIDTH || "1280", 10);
const HEIGHT = Number.parseInt(process.env.EXPORT_HEIGHT || "720", 10);
const SCENE_MS = Number.parseInt(process.env.SCENE_MS || "3200", 10);
const PORT = Number.parseInt(process.env.SERVER_PORT || "8231", 10);
const EYE_GIF = "assets/esoteric-geometries-circles-warp.gif";

// facing: hold the scene until the dark-side window rotates into view. Those
// scenes also turn the moon down to a quarter speed, both so the window is
// legible and so it stays on camera for the whole scene, and open the window
// past its measured shadow patch (angw/angh) so the content is not a speck.
// The window seals to a glimmer wherever the surface is sunlit, so a scene
// framed on the anchor can still come out blank at the wrong phase. A raised
// threshold counts more of the mid-grey terrain as shadow and keeps the
// window open, and angw/angh open it past the measured patch so the content
// is not a speck.
const WIN = { angw: "1.35", angh: "0.85", threshold: "0.4" };
// The moon has to turn at least once at full speed for the anchor estimator
// to find its dark patch, so every scene loads at speed 1 and window scenes
// are slowed to SLOW_SPEED only once the window is swinging into view.
const ANCHOR_MS = Number.parseInt(process.env.ANCHOR_MS || "9000", 10);
const SLOW_SPEED = Number.parseFloat(process.env.SLOW_SPEED || "0.25");
const SCENES = [
  { id: "word", title: "word mosaic", facing: true,
    q: { ...WIN, word: "hyperstition", angw: "1.95", angh: "0.62", threshold: "0.3" },
    note: "the default: letter cubes anchored to the dark terrain" },
  { id: "mumins", title: "dancing mumins", facing: true,
    q: { ...WIN, content: "mumins", mumins: "4", winbright: "0.45", winsolid: "1" },
    note: "a troupe of little trolls, painted solid on the surface" },
  // A whole catch has to fit inside the scene, so this one runs a short cycle
  // and hearts on every catch rather than every third.
  { id: "fisher", title: "the star fisher", facing: true, ms: 7000,
    q: { ...WIN, angw: "1.55", angh: "0.98", content: "fisher", fishersec: "6", fisherheart: "1", winbright: "0.38" },
    note: "hooks a star, cups it, lets it go — and the freed stars make a heart" },
  // mosaic=0 drops the letter panel that normally sits over these windows, so
  // the reel shows the content itself rather than the word on top of it.
  { id: "crt", title: "CRT terminal", facing: true, q: { ...WIN, content: "crt", mosaic: "0" },
    note: "a live terminal typing through the window" },
  // apparition=0 stops the random open/shut gating, which otherwise leaves
  // the scene shut for the few seconds it is on camera.
  { id: "incant", title: "incantation", facing: true, q: { ...WIN, content: "incant", apparition: "0" },
    note: "mantra phrases surfacing one at a time" },
  { id: "vajracave", title: "vajra cave", facing: true, q: { ...WIN, content: "vajra", mosaic: "0" },
    note: "spinning dorjes recessed into the moon" },
  { id: "fold", title: "synergetics fold", facing: true, q: { ...WIN, content: "fold", winbright: "0.9" },
    note: "Fuller 100.41: a triangle folding into a tetrahedron" },
  { id: "foldhelix", title: "fold helix", facing: true, q: { ...WIN, content: "foldhelix", winbright: "0.9" },
    note: "the same repertoire, wound into a helix" },
  { id: "harmonics", title: "sonic sphere", facing: true, ms: 7000,
    q: { ...WIN, content: "harmonics", winbright: "0.85", harmsec: "3.5", angw: "1.5", angh: "0.95" },
    note: "the real normal modes of a vibrating sphere, ringing in place" },
  { id: "cymatics", title: "cymatics plate", facing: true, ms: 7000,
    q: { ...WIN, content: "cymatics", winbright: "0.75", cymsec: "3.5", angw: "1.4", angh: "0.95" },
    note: "sand settling onto the nodal lines of a driven plate" },
  { id: "vajras", title: "orbiting vajras", q: { vajras: "6", vajraradius: "1.3" },
    note: "dorje sprites on tilted lanes, hidden behind the disc" },
  { id: "fisherlive", title: "the fisher, alongside", ms: 8000,
    q: { fisherlive: "1", vajras: "3", stars: "600", meteors: "12", fishersec: "7", fisherheart: "1" },
    note: "the fisher on his own layer, so he keeps fishing through everything else" },
  { id: "eye", title: "eye seal iris reveal", q: { backdrop: EYE_GIF, iris: "1", iriszoom: "2.5", backscale: "0.98" },
    note: "the disc opens to a clear hole onto the seal behind it" },
  { id: "blood", title: "blood moon", q: { bloodmoon: "0.9" },
    note: "luminance-preserving eclipse grade over the whole disc" },
  // Run the transit fast enough that the shadow visibly moves: the three
  // seconds of pre-roll before recording carry it to first contact.
  { id: "eclipse", title: "earth's shadow", ms: 6000,
    q: { eclipse: "0", eclipsetarget: "1", eclipserun: "13", stars: "400", meteors: "0" },
    note: "the umbra crosses the disc, totality lit by refracted sunlight" },
  { id: "stars", title: "starfield sky", q: { stars: "700", meteors: "60", stardrift: "3", vajras: "3" },
    note: "parallax stars behind everything, with the occasional meteor" },
  { id: "scale", title: "moon size", q: { moonscale: "0.55", vajras: "3" },
    note: "the whole render shrinks, backdrop and orbits following" }
];

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

function sceneUrl(scene) {
  const q = new URLSearchParams({ speed: "1", nosound: "1", ...scene.q });
  return `http://127.0.0.1:${PORT}/hypermoon.html?${q.toString()}`;
}

async function main() {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error("ffmpeg-static binary missing — run: node node_modules/ffmpeg-static/install.js");
  }
  const wanted = String(process.env.SCENES || "").trim();
  const scenes = wanted
    ? wanted.split(",").map((s) => s.trim()).filter(Boolean)
      .map((id) => SCENES.find((s) => s.id === id) || (() => { throw new Error("unknown scene: " + id); })())
    : SCENES;

  ensureDir(ARTIFACTS_DIR);
  if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  ensureDir(FRAMES_DIR);

  let server = null;
  const probe = `http://127.0.0.1:${PORT}/hypermoon.html`;
  if (!(await serverUp(probe, 1500))) {
    console.log(`[reel] starting http-server on :${PORT}`);
    // Detached so the whole npx/http-server group can be torn down at the
    // end; killing only the npx wrapper leaves the server holding the port.
    server = spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "."], {
      cwd: PROJECT_ROOT, stdio: "ignore", detached: true
    });
    if (!(await serverUp(probe, 30000))) throw new Error(`could not reach ${probe}`);
  }

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"]
  });
  let frame = 0;
  let recordedMs = 0;
  const stamps = [];
  const cuts = []; // one entry per scene, so each can be cut out on its own
  try {
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.warn("[reel] page error:", e.message));

    // Screenshots top out around 6fps at 720p, which is too choppy to show
    // motion. The DevTools screencast hands us compositor frames instead.
    const cdp = await context.newCDPSession(page);
    let recording = false;
    cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      if (!recording) return;
      fs.writeFileSync(path.join(FRAMES_DIR, `frame-${String(frame).padStart(5, "0")}.jpg`), Buffer.from(data, "base64"));
      stamps.push(metadata.timestamp * 1000);
      frame++;
    });

    for (const scene of scenes) {
      console.log(`[reel] ${scene.id}: ${scene.title}`);
      await page.goto(sceneUrl(scene), { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForFunction(() => window.__hyperstitionReady === true, undefined, { timeout: 90000 });
      await page.waitForFunction(() => (window.__hyperstitionStats || {}).moonReady === true, undefined, { timeout: 60000 })
        .catch(() => console.warn("[reel]   moon never reported ready, capturing anyway"));
      await page.waitForTimeout(scene.facing ? ANCHOR_MS : 3000);

      if (scene.facing) {
        // Catch the window just before it swings through front, then slow the
        // moon so it stays there for the whole scene.
        await page.waitForFunction(() => {
          const a = (window.__hyperstitionStats || {}).facingAngle;
          return typeof a === "number" && a > -0.5 && a < -0.12;
        }, undefined, { timeout: 30000 })
          .catch(() => console.warn("[reel]   window never faced front, capturing anyway"));
        await page.evaluate((v) => {
          new BroadcastChannel("hypermoon").postMessage({ type: "moonConfig", set: { speed: v } });
        }, SLOW_SPEED);
      }

      await page.evaluate(({ title, note }) => {
        let d = document.getElementById("__reelcap");
        if (!d) {
          d = document.createElement("div");
          d.id = "__reelcap";
          d.style.cssText = "position:fixed;left:36px;bottom:32px;z-index:99999;pointer-events:none;" +
            "font:600 21px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
            "color:#e6f1ff;text-shadow:0 2px 12px rgba(0,0,0,0.9);letter-spacing:0.01em;";
          document.body.appendChild(d);
        }
        d.innerHTML = "<div>" + title + "</div><div style=\"font:400 12px/1.45 ui-monospace,Menlo,monospace;" +
          "color:rgba(150,190,230,0.85);margin-top:4px;\">" + note + "</div>";
      }, { title: scene.title, note: scene.note });

      if (process.env.REEL_DEBUG === "1") {
        const s = await page.evaluate(() => {
          const st = window.__hyperstitionStats || {};
          return {
            window: st.window, gate: st.gate, facing: +(st.facingAngle || 0).toFixed(2),
            thresh: +(st.bleedThresh || 0).toFixed(3), speed: st.speed,
            winsolid: st.winsolid, winbright: st.winbright,
            angw: +(st.angw || 0).toFixed(2), angh: +(st.angh || 0).toFixed(2),
            content: st.contentSrc
          };
        });
        console.log("[reel]   state", JSON.stringify(s));
      }
      await cdp.send("Page.startScreencast", {
        format: "jpeg", quality: 88, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1
      });
      const startIndex = frame;
      recording = true;
      await page.waitForTimeout(scene.ms || SCENE_MS);
      recording = false;
      await cdp.send("Page.stopScreencast").catch(() => {});
      // Per-scene span only: the gaps spent loading and waiting between
      // scenes must not drag the playback rate down.
      const shot = frame - startIndex;
      if (shot > 1) {
        const ms = stamps[frame - 1] - stamps[startIndex];
        recordedMs += ms;
        cuts.push({ id: scene.id, title: scene.title, start: startIndex, count: shot, ms });
      }
    }
    await context.close();
  } finally {
    await browser.close();
    if (server && !server.killed) {
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    }
  }

  if (frame < 2) throw new Error("no frames captured");

  // Encode at the rate actually achieved so motion plays at true speed.
  function encode(out, start, count, ms) {
    const fps = Math.max(4, Math.min(60, count / Math.max(ms / 1000, 0.001)));
    const args = [
      "-y", "-framerate", fps.toFixed(3),
      "-start_number", String(start),
      "-i", path.join(FRAMES_DIR, "frame-%05d.jpg"),
      "-frames:v", String(count)
    ];
    if (path.extname(out).toLowerCase() === ".webm") args.push("-c:v", "libvpx-vp9", "-b:v", "4M");
    else args.push("-c:v", "libx264", "-crf", "20", "-preset", "medium", "-vf", "format=yuv420p");
    args.push(out);
    const enc = spawnSync(ffmpegPath, args, { encoding: "utf8" });
    if (enc.status !== 0) throw new Error(enc.stderr || "ffmpeg failed");
    return { seconds: +(ms / 1000).toFixed(1), fps: +fps.toFixed(2) };
  }

  const made = [];
  if (CLIPS) {
    ensureDir(CLIPS_DIR);
    for (const c of cuts) {
      const out = path.join(CLIPS_DIR, `hypermoon-${c.id}.mp4`);
      const info = encode(out, c.start, c.count, c.ms);
      console.log(`[reel] clip ${c.id}: ${info.seconds}s @ ${info.fps}fps`);
      made.push({ id: c.id, title: c.title, file: path.relative(PROJECT_ROOT, out), ...info });
    }
  }
  if (REEL) {
    const info = encode(OUTPUT, 0, frame, recordedMs);
    console.log(`[reel] reel: ${frame} frames, ${info.seconds}s @ ${info.fps}fps`);
    made.push({ id: "reel", title: "all effects", file: path.relative(PROJECT_ROOT, OUTPUT), ...info });
  }

  console.log(JSON.stringify({ size: `${WIDTH}x${HEIGHT}`, frames: frame, outputs: made }, null, 2));
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
