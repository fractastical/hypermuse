/**
 * Shared capture rig for the hypermoon exporters: serves the project, drives a
 * headless Chrome, records compositor frames over CDP, and encodes shots to a
 * uniform constant frame rate.
 *
 * Screenshots top out around 6fps, which is too choppy to show motion, so the
 * DevTools screencast is used instead. Its rate varies with render load, so the
 * measured span is recorded and every shot is resampled to a constant rate —
 * without that, motion plays back at the wrong speed and clips of the same
 * nominal length end up with different frame counts.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";

export const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".m4v": "video/x-m4v", ".ogv": "video/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".m4a": "audio/mp4", ".oga": "audio/ogg", ".flac": "audio/flac",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".mid": "audio/midi"
};

/**
 * Minimal static server for the export scripts. Spawning `npx http-server` is
 * flaky here — it dies mid-run and takes the capture with it — and media needs
 * byte-range support, so this serves files directly with Range handling.
 */
export function startStaticServer({ root, port }) {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { rel = req.url; }
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(path.resolve(root))) { res.writeHead(403).end(); return; }

    let stat;
    try { stat = fs.statSync(file); } catch { res.writeHead(404).end("not found"); return; }
    if (stat.isDirectory()) { res.writeHead(404).end("not found"); return; }

    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? Number.parseInt(range[1], 10) : 0;
      const end = range[2] ? Number.parseInt(range[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
        return;
      }
      res.writeHead(206, {
        "Content-Type": type, "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes", "Cache-Control": "no-store"
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      "Content-Type": type, "Content-Length": stat.size,
      "Accept-Ranges": "bytes", "Cache-Control": "no-store"
    });
    fs.createReadStream(file).pipe(res);
  });
  server.on("clientError", (e, socket) => socket.destroy());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

export async function serverUp(url, timeoutMs) {
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

/**
 * Runs `fn({ page, capture })` with a served project and a live browser, then
 * tears both down. `capture(shot, framesDir)` records one shot and returns
 * { count, ms } — the frame count and the real elapsed span.
 *
 * shot: { id, q, seconds, facing, act }
 *   q       – hypermoon query parameters
 *   facing  – wait for the anchored dark-side window to swing to front, then
 *             slow the moon so it stays there for the whole shot
 *   act     – [{ at: 0..1, set: {…} }] posted mid-shot over the controller
 *             channel; this is what gives a shot an arc instead of a static
 *             hold. Fades set in the URL instead would burn off during pre-roll.
 */
export async function withHypermoon(opts, fn) {
  const {
    root = process.cwd(), port = 8232, width = 1920, height = 1080,
    anchorMs = 9000, slowSpeed = 0.25, quality = 92
  } = opts;

  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) throw new Error("ffmpeg-static missing");

  let server = null;
  const probe = `http://127.0.0.1:${port}/hypermoon.html`;
  if (!(await serverUp(probe, 1200))) {
    server = await startStaticServer({ root, port });
    if (!(await serverUp(probe, 8000))) throw new Error(`could not reach ${probe}`);
  }

  const browser = await chromium.launch({
    channel: "chrome", headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"]
  });

  try {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.warn("[capture] page error:", e.message));

    const cdp = await context.newCDPSession(page);
    let recording = false;
    let dir = null;
    let frame = 0;
    let stamps = [];
    cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      if (!recording || !dir) return;
      fs.writeFileSync(path.join(dir, `frame-${String(frame).padStart(5, "0")}.jpg`), Buffer.from(data, "base64"));
      stamps.push(metadata.timestamp * 1000);
      frame++;
    });

    async function capture(shot, framesDir) {
      const ms = Math.round((shot.seconds || 5) * 1000);
      const q = new URLSearchParams({ speed: "1", nosound: "1", ...shot.q });
      await page.goto(`http://127.0.0.1:${port}/hypermoon.html?${q}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForFunction(() => window.__hyperstitionReady === true, undefined, { timeout: 90000 });
      await page.waitForFunction(() => (window.__hyperstitionStats || {}).moonReady === true, undefined, { timeout: 60000 })
        .catch(() => console.warn("[capture]   moon never reported ready, capturing anyway"));
      await page.waitForTimeout(shot.facing ? anchorMs : 2500);

      if (shot.facing) {
        // The anchor estimator needs a full revolution at speed 1 to find the
        // dark patch, so slowing happens only once the window is coming round.
        await page.waitForFunction(() => {
          const a = (window.__hyperstitionStats || {}).facingAngle;
          return typeof a === "number" && a > -0.5 && a < -0.12;
        }, undefined, { timeout: 30000 })
          .catch(() => console.warn("[capture]   window never faced front, capturing anyway"));
        await page.evaluate((v) => {
          new BroadcastChannel("hypermoon").postMessage({ type: "moonConfig", set: { speed: v } });
        }, shot.slowSpeed ?? slowSpeed);
      }

      ensureDir(framesDir);
      dir = framesDir;
      frame = 0;
      stamps = [];
      await cdp.send("Page.startScreencast", { format: "jpeg", quality, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
      recording = true;

      let elapsed = 0;
      for (const a of (shot.act || []).slice().sort((x, y) => x.at - y.at)) {
        const target = Math.max(0, Math.min(ms, a.at * ms));
        if (target > elapsed) { await page.waitForTimeout(target - elapsed); elapsed = target; }
        await page.evaluate((set) => {
          new BroadcastChannel("hypermoon").postMessage({ type: "moonConfig", set });
        }, a.set);
      }
      if (elapsed < ms) await page.waitForTimeout(ms - elapsed);

      recording = false;
      await cdp.send("Page.stopScreencast").catch(() => {});
      return { count: frame, ms: frame > 1 ? stamps[frame - 1] - stamps[0] : 0 };
    }

    return await fn({ page, capture });
  } finally {
    await browser.close();
    if (server) await new Promise((r) => server.close(r));
  }
}

/** Encoder settings shared by every clip, so they concat without re-encoding. */
export const H264 = ["-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p"];

/**
 * Encodes one shot's frames to a constant-rate clip of exactly targetSeconds.
 * The tail is cloned before the hard trim so a shot that captured slightly
 * short still lands on the exact frame count.
 */
export function encodeShot({ framesDir, out, count, measuredMs, targetSeconds, fps = 30, fadeIn = 0, fadeOut = 0, prores = false }) {
  const captured = Math.max(4, Math.min(60, count / Math.max(measuredMs / 1000, 0.001)));
  const filters = [`fps=${fps}`, `tpad=stop_mode=clone:stop_duration=0.8`];
  if (fadeIn > 0) filters.push(`fade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut > 0) filters.push(`fade=t=out:st=${(targetSeconds - fadeOut).toFixed(3)}:d=${fadeOut}`);
  filters.push("format=yuv420p");

  const enc = spawnSync(ffmpegPath, [
    "-y", "-framerate", captured.toFixed(3),
    "-i", path.join(framesDir, "frame-%05d.jpg"),
    "-vf", filters.join(","),
    "-t", targetSeconds.toFixed(3),
    "-r", String(fps),
    ...H264, "-movflags", "+faststart", out
  ], { encoding: "utf8" });
  if (enc.status !== 0) throw new Error(enc.stderr || "ffmpeg failed");

  if (prores) {
    const mov = out.replace(/\.mp4$/, ".mov");
    const pr = spawnSync(ffmpegPath, ["-y", "-i", out, "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", mov], { encoding: "utf8" });
    if (pr.status !== 0) throw new Error(pr.stderr || "prores failed");
  }
  return { seconds: +targetSeconds.toFixed(2), capturedFps: +captured.toFixed(1) };
}

/** A silent black clip with identical encode settings, for beats between acts. */
export function blackClip({ out, seconds, width, height, fps = 30 }) {
  const enc = spawnSync(ffmpegPath, [
    "-y", "-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:r=${fps}:d=${seconds.toFixed(3)}`,
    ...H264, "-movflags", "+faststart", out
  ], { encoding: "utf8" });
  if (enc.status !== 0) throw new Error(enc.stderr || "black clip failed");
  return out;
}

export function probeVideo(f) {
  const out = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,nb_frames:format=duration", "-of", "json", f], { encoding: "utf8" });
  const j = JSON.parse(out.stdout);
  return { w: j.streams[0].width, h: j.streams[0].height, frames: +j.streams[0].nb_frames, dur: Number.parseFloat(j.format.duration) };
}

/**
 * Concatenates clips that share encode settings. Tries a stream copy first and
 * falls back to a re-encode if the copy produces the wrong length (mismatched
 * stream parameters can make the demuxer drop or stall segments).
 */
export function concatClips({ files, out, fps = 30, workDir }) {
  const list = path.join(workDir, ".concat.txt");
  fs.writeFileSync(list, files.map((f) => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join("\n"));
  const expected = files.reduce((a, f) => a + probeVideo(f).dur, 0);

  const copy = spawnSync(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out], { encoding: "utf8" });
  const ok = copy.status === 0 && Math.abs(probeVideo(out).dur - expected) < 0.35;
  if (!ok) {
    console.warn("[capture] stream-copy concat unusable, re-encoding");
    const re = spawnSync(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", list,
      "-vf", `fps=${fps},format=yuv420p`, "-r", String(fps), ...H264, "-movflags", "+faststart", out], { encoding: "utf8" });
    if (re.status !== 0) throw new Error(re.stderr || "concat failed");
  }
  fs.rmSync(list, { force: true });
  return probeVideo(out);
}
