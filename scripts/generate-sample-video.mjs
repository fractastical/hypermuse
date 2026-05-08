import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawnSync, spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";
import { resolveLedExportSize } from "./led-screen-presets.mjs";

const PROJECT_ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
const VIDEO_DIR = path.join(ARTIFACTS_DIR, "videos");
const AUDIO_PATH = path.join(ARTIFACTS_DIR, "generated-tone.wav");
const VJ_SET_MANIFEST = process.env.VJ_SET_MANIFEST || "sets/bio1.json";
const CAPTURE_MS = Number.parseInt(process.env.CAPTURE_MS || "18000", 10);
const CAPTURE_FULL_SET = process.env.CAPTURE_FULL_SET === "1";
const OUTPUT_VIDEO = process.env.OUTPUT_VIDEO
  ? path.resolve(PROJECT_ROOT, process.env.OUTPUT_VIDEO)
  : path.join(ARTIFACTS_DIR, "sample-sonicsphere.webm");
const OUTPUT_VIDEO_SILENT = process.env.OUTPUT_VIDEO_SILENT
  ? path.resolve(PROJECT_ROOT, process.env.OUTPUT_VIDEO_SILENT)
  : path.join(
    path.dirname(OUTPUT_VIDEO),
    `${path.basename(OUTPUT_VIDEO, path.extname(OUTPUT_VIDEO))}-silent${path.extname(OUTPUT_VIDEO) || ".webm"}`
  );
const INPUT_AUDIO_FILE = process.env.INPUT_AUDIO_FILE || "";
const MOLECULE_NAME = process.env.MOLECULE_NAME || "";
const AUTO_BUILD_SET_MANIFEST = process.env.AUTO_BUILD_SET_MANIFEST !== "0";
const REQUIRE_SET_LOOPS = process.env.REQUIRE_SET_LOOPS === "1";
const SET_HOLD_MS = Number.parseInt(process.env.SET_HOLD_MS || "2200", 10);
const SET_TRANSITION_MS = Number.parseInt(process.env.SET_TRANSITION_MS || "450", 10);
const VJ_SOURCE_DIRS = process.env.VJ_SOURCE_DIRS || "loops/bio1";
const EFFECT_TIMELINE_PHASE_SEC = Number.parseInt(process.env.EFFECT_TIMELINE_PHASE_SEC || "16", 10);
const EFFECT_TIMELINE_PHASES_RAW = String(process.env.EFFECT_TIMELINE_PHASES || "").trim();
const EFFECT_TIMELINE_PHASES = (EFFECT_TIMELINE_PHASES_RAW || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const BASIC_VIDEO_RATIO = Number.parseFloat(process.env.BASIC_VIDEO_RATIO || "0");
const BASIC_VIDEO_CYCLE_MS = Number.parseInt(process.env.BASIC_VIDEO_CYCLE_MS || "12000", 10);
const FX_LAYOUT = String(process.env.FX_LAYOUT || "").trim();
const SERVER_PORT = Number.parseInt(process.env.SAMPLE_SERVER_PORT || process.env.SERVER_PORT || "8080", 10);
/** Classic + fullscreen video layers only — no sphere/triangle FX or effect-timeline hops (venue MP4 reels). */
const EXPORT_VIDEO_REEL = process.env.EXPORT_VIDEO_REEL === "1";
const SONIC_CAPTURE_URL = `http://127.0.0.1:${SERVER_PORT}/sonicsphere.html?demo=1&hideoverlay=1`;

async function waitForServer(url, timeoutMs = 25000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1500, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function startHttpServer(port) {
  return spawn("npx", ["http-server", "-c-1", "-p", String(port), "."], {
    cwd: PROJECT_ROOT,
    stdio: "ignore"
  });
}

/** Chunked timeouts so terminal shows progress instead of freezing on multi-minute captures. */
async function waitRecordingWindow(page, totalMs, label) {
  if (totalMs <= 0) {
    return;
  }
  const targetSec = Math.round(totalMs / 1000);
  const tickMs = Math.min(30000, Math.max(4000, Math.floor(totalMs / 12)));
  const t0 = Date.now();
  let acc = 0;
  console.log(`[export] ── Recording: ${label} · target wall ${targetSec}s (updates ~every ${Math.round(tickMs / 1000)}s)`);
  while (acc < totalMs) {
    const chunk = Math.min(tickMs, totalMs - acc);
    await page.waitForTimeout(chunk);
    acc += chunk;
    const pct = Math.min(100, Math.round((100 * acc) / totalMs));
    const wallSec = Math.round((Date.now() - t0) / 1000);
    console.log(`[export]    … ${pct}% · ${Math.round(acc / 1000)}s / ${targetSec}s simulated · wall ${wallSec}s`);
  }
}

function elapsedSince(globalT0, msg) {
  const wall = Math.round((Date.now() - globalT0) / 1000);
  console.log(`[export +${wall}s] ${msg}`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rebuildSetManifestIfNeeded() {
  if (!AUTO_BUILD_SET_MANIFEST) {
    return;
  }
  const manifestRelative = VJ_SET_MANIFEST.split(path.sep).join("/");
  if (manifestRelative !== "sets/bio1.json") {
    return;
  }
  const scriptPath = path.join(PROJECT_ROOT, "scripts", "build-vj-set-manifest.mjs");
  if (!fs.existsSync(scriptPath)) {
    return;
  }
  spawnSync("node", [scriptPath, VJ_SOURCE_DIRS, VJ_SET_MANIFEST], {
    cwd: PROJECT_ROOT,
    encoding: "utf8"
  });
}

function getManifestLoopCount() {
  const manifestPath = path.resolve(PROJECT_ROOT, VJ_SET_MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    return 0;
  }
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (Array.isArray(data.loops)) {
      return data.loops.length;
    }
    return 0;
  } catch {
    return 0;
  }
}

function estimateManifestCaptureMs() {
  const manifestPath = path.resolve(PROJECT_ROOT, VJ_SET_MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const loops = Array.isArray(data?.loops) ? data.loops : [];
    if (loops.length === 0) {
      return null;
    }
    const defaultTransition = (data && typeof data.defaultTransition === "object")
      ? data.defaultTransition
      : {};
    const fallbackHoldMs = Number.isFinite(defaultTransition.holdMs)
      ? Math.max(250, Number(defaultTransition.holdMs))
      : Math.max(250, SET_HOLD_MS);
    let total = 0;
    for (const loop of loops) {
      if (!loop || typeof loop !== "object") {
        total += fallbackHoldMs;
        continue;
      }
      const trans = (loop.transition && typeof loop.transition === "object")
        ? loop.transition
        : defaultTransition;
      const holdMs = Number.isFinite(trans.holdMs)
        ? Math.max(250, Number(trans.holdMs))
        : fallbackHoldMs;
      total += holdMs;
    }
    // Small tail so last clip has a visible dwell before recorder stops.
    return Math.max(1000, Math.round(total + 500));
  } catch {
    return null;
  }
}

function getToneDurationSec(captureMs) {
  return Math.min(
    900,
    Math.max(14, Math.ceil(captureMs / 1000))
  );
}

function isMidiFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".mid" || ext === ".midi";
}

function resolveExportSize() {
  return resolveLedExportSize(process.env);
}

function muxAudio(videoPath, audioPath, outputPath) {
  if (!ffmpegPath) {
    return { ok: false, reason: "ffmpeg binary not available" };
  }
  const inspect = spawnSync(ffmpegPath, ["-i", videoPath], { encoding: "utf8" });
  const inspectOutput = `${inspect.stdout || ""}\n${inspect.stderr || ""}`;
  const durationMatch = inspectOutput.match(/Duration:\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  let durationSec = null;
  if (durationMatch) {
    const hh = Number.parseInt(durationMatch[1], 10);
    const mm = Number.parseInt(durationMatch[2], 10);
    const ss = Number.parseFloat(durationMatch[3]);
    durationSec = (hh * 3600) + (mm * 60) + ss;
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { ok: false, reason: "could not determine captured video duration" };
  }
  const cappedDuration = Math.max(0.5, durationSec - 0.03);
  const ext = path.extname(outputPath).toLowerCase();
  const useMp4Family = ext === ".mp4" || ext === ".m4v" || ext === ".mov";
  const crf = process.env.EXPORT_CRF || "20";
  const args = useMp4Family
    ? [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-t",
      cappedDuration.toFixed(3),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      crf,
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath
    ]
    : [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-t",
      cappedDuration.toFixed(3),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libvpx",
      "-b:v",
      "3M",
      "-deadline",
      "realtime",
      "-cpu-used",
      "5",
      "-c:a",
      "libopus",
      outputPath
    ];
  const result = spawnSync(ffmpegPath, args, { encoding: "utf8" });
  if (result.status !== 0) {
    return {
      ok: false,
      reason: (result.stderr || result.stdout || "ffmpeg failed").trim()
    };
  }
  return { ok: true };
}

function createTestToneWav({
  sampleRate = 44100,
  durationSeconds = 14,
  channels = 1
} = {}) {
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = 2;
  const dataSize = sampleCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk length
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(8 * bytesPerSample, 34); // bits per sample

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  const bpm = 124;
  const beatHz = bpm / 60;

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const section = t / durationSeconds;

    // Rhythmic amplitude envelope: pump on quarter-note beats.
    const phase = (t * beatHz) % 1;
    const pulse = Math.exp(-18 * phase);

    // Evolving frequency emphasis by timeline section to force visible geometry changes.
    const bassGain = section < 0.25 ? 0.7 : (section < 0.5 ? 0.35 : (section < 0.75 ? 0.2 : 0.45));
    const midGain = section < 0.25 ? 0.25 : (section < 0.5 ? 0.75 : (section < 0.75 ? 0.4 : 0.55));
    const highGain = section < 0.25 ? 0.1 : (section < 0.5 ? 0.2 : (section < 0.75 ? 0.85 : 0.45));
    const sweep = 1 + (0.2 * Math.sin(2 * Math.PI * 0.1 * t));

    const bass = Math.sin(2 * Math.PI * 90 * sweep * t) * bassGain;
    const mid = Math.sin(2 * Math.PI * 220 * sweep * t) * midGain;
    const high = Math.sin(2 * Math.PI * 900 * sweep * t) * highGain;
    const noise = (Math.random() * 2 - 1) * 0.025;
    const gate = (section > 0.62 && section < 0.66) ? 0.2 : 1;

    const signal = (bass + mid + high + noise) * (0.28 + pulse * 0.95) * gate;
    const clamped = Math.max(-1, Math.min(1, signal));
    const pcm = Math.floor(clamped * 32767);
    buffer.writeInt16LE(pcm, 44 + i * 2);
  }

  return buffer;
}

async function runCapture() {
  const globalT0 = Date.now();
  const runtimeCaptureMs = CAPTURE_FULL_SET
    ? (estimateManifestCaptureMs() || CAPTURE_MS)
    : CAPTURE_MS;
  const toneDurationSec = getToneDurationSec(runtimeCaptureMs);
  console.log(`[export] ══ Video export start · ${new Date(globalT0).toISOString()}`);
  ensureDir(ARTIFACTS_DIR);
  ensureDir(VIDEO_DIR);
  const exportSize = resolveExportSize();
  elapsedSince(
    globalT0,
    `resolution ${exportSize.width}×${exportSize.height} (${exportSize.profile}) · videoReel=${EXPORT_VIDEO_REEL ? "1" : "0"} · CAPTURE_MS=${runtimeCaptureMs}${CAPTURE_FULL_SET ? " (full set)" : ""}`
  );
  rebuildSetManifestIfNeeded();
  const manifestLoopCount = getManifestLoopCount();
  if (REQUIRE_SET_LOOPS && manifestLoopCount === 0) {
    throw new Error(
      `Set manifest ${VJ_SET_MANIFEST} has 0 loops. Add files to loops/bio1 and rebuild the set before export.`
    );
  }
  let audioFileForCapture = AUDIO_PATH;
  if (INPUT_AUDIO_FILE) {
    const resolvedInput = path.resolve(PROJECT_ROOT, INPUT_AUDIO_FILE);
    if (!fs.existsSync(resolvedInput)) {
      throw new Error(`INPUT_AUDIO_FILE not found: ${resolvedInput}`);
    }
    audioFileForCapture = resolvedInput;
  } else {
    fs.writeFileSync(AUDIO_PATH, createTestToneWav({ durationSeconds: toneDurationSec }));
  }

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true
  });

  elapsedSince(globalT0, "Chromium launched, opening tab…");

  const context = await browser.newContext({
    viewport: { width: exportSize.width, height: exportSize.height },
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: exportSize.width, height: exportSize.height }
    }
  });

  const page = await context.newPage();
  await page.goto(SONIC_CAPTURE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  elapsedSince(globalT0, "sonicsphere loaded (demo+hideoverlay)");

  if (FX_LAYOUT && !EXPORT_VIDEO_REEL) {
    await page.waitForFunction(
      () => typeof window.setEffectLayoutMode === "function",
      { timeout: 25000 }
    );
    await page.evaluate((layout) => {
      window.setEffectLayoutMode(layout);
    }, FX_LAYOUT);
  }

  // Load prebuilt VJ set when available.
  await page.evaluate(async (manifestPath) => {
    try {
      if (window.loadVideoSetManifest) {
        await window.loadVideoSetManifest(manifestPath);
      }
    } catch (error) {
      // Continue even if no set exists yet.
      console.warn(error);
    }
  }, VJ_SET_MANIFEST);

  const loadedSetCount = await page.evaluate(() => window.__hypermuseLoadedSetCount || 0);
  if (REQUIRE_SET_LOOPS && loadedSetCount === 0) {
    throw new Error(`No set loops loaded in page from ${VJ_SET_MANIFEST}.`);
  }
  elapsedSince(globalT0, `manifest ${VJ_SET_MANIFEST} → ${loadedSetCount} clip(s)`);
  await page.evaluate(({ holdMs, transitionMs }) => {
    if (window.setSetPlaybackTiming) {
      window.setSetPlaybackTiming(holdMs, transitionMs);
    }
  }, { holdMs: SET_HOLD_MS, transitionMs: SET_TRANSITION_MS });

  if (EXPORT_VIDEO_REEL) {
    await page.waitForFunction(
      () => typeof window.setBasicVideoMode === "function",
      { timeout: 25000 }
    );
    await page.evaluate(() => {
      if (window.setBasicVideoMode) {
        window.setBasicVideoMode(true);
      }
    });
  } else if (EFFECT_TIMELINE_PHASES.length > 0) {
    await page.evaluate(({ phaseSec, phaseNames }) => {
      if (!window.setEffectTimelineConfig || !Array.isArray(phaseNames) || phaseNames.length === 0) {
        return;
      }
      const durationSec = Math.max(1, Number.parseInt(phaseSec, 10) || 3);
      const phases = phaseNames.map((name) => ({ name, durationSec }));
      window.setEffectTimelineConfig({
        enabled: true,
        phases
      }, true);
    }, { phaseSec: EFFECT_TIMELINE_PHASE_SEC, phaseNames: EFFECT_TIMELINE_PHASES });
  }

  if (!EXPORT_VIDEO_REEL && MOLECULE_NAME) {
    await page.evaluate(async (moleculeName) => {
      if (window.loadMoleculeGraphByName) {
        try {
          await window.loadMoleculeGraphByName(moleculeName);
        } catch (error) {
          console.warn(error);
        }
      }
    }, MOLECULE_NAME);
  }

  const audioInput = page.locator("#audioInput");
  await audioInput.setInputFiles(audioFileForCapture);
  elapsedSince(globalT0, "audio attached · starting viewport recording window");

  // Optional distributed basic-mode capture across the full render (ignored when EXPORT_VIDEO_REEL; already in basic video).
  const basicRatio = EXPORT_VIDEO_REEL
    ? -1
    : (Number.isFinite(BASIC_VIDEO_RATIO) ? Math.max(0, Math.min(1, BASIC_VIDEO_RATIO)) : 0);
  const cycleMs = Math.max(1000, Number.isFinite(BASIC_VIDEO_CYCLE_MS) ? BASIC_VIDEO_CYCLE_MS : 12000);
  if (basicRatio > 0 && basicRatio < 1) {
    let elapsedMs = 0;
    let lastProgLog = 0;
    let lastState = null;
    const progStep = Math.max(8000, Math.floor(runtimeCaptureMs / 12));
    while (elapsedMs < runtimeCaptureMs) {
      const inCycle = elapsedMs % cycleMs;
      const basicWindowMs = cycleMs * basicRatio;
      const shouldBasic = inCycle < basicWindowMs;
      if (shouldBasic !== lastState) {
        await page.evaluate((enabled) => {
          if (window.setBasicVideoMode) {
            window.setBasicVideoMode(!!enabled);
          }
        }, shouldBasic);
        lastState = shouldBasic;
      }
      const timeToBoundary = shouldBasic
        ? Math.max(1, basicWindowMs - inCycle)
        : Math.max(1, cycleMs - inCycle);
      const remaining = runtimeCaptureMs - elapsedMs;
      const stepMs = Math.max(220, Math.min(remaining, timeToBoundary));
      await page.waitForTimeout(stepMs);
      elapsedMs += stepMs;
      if (elapsedMs - lastProgLog >= progStep || elapsedMs >= runtimeCaptureMs) {
        const pct = Math.round((100 * elapsedMs) / runtimeCaptureMs);
        elapsedSince(globalT0, `mixed basic/ratio capture ${pct}% · ${Math.round(elapsedMs / 1000)}s / ${Math.round(runtimeCaptureMs / 1000)}s`);
        lastProgLog = elapsedMs;
      }
    }
    if (lastState) {
      await page.evaluate(() => {
        if (window.setBasicVideoMode) {
          window.setBasicVideoMode(false);
        }
      });
    }
  } else if (basicRatio >= 1) {
    await page.evaluate(() => {
      if (window.setBasicVideoMode) {
        window.setBasicVideoMode(true);
      }
    });
    await waitRecordingWindow(page, runtimeCaptureMs, "basic-video only");
  } else {
    // Give decode + capture loops enough time to build visible geometry.
    await waitRecordingWindow(
      page,
      runtimeCaptureMs,
      EXPORT_VIDEO_REEL ? "video reel (classic fullscreen)" : "effects timeline"
    );
  }

  elapsedSince(globalT0, "viewport recording stopped · closing Playwright …");
  const video = page.video();
  await context.close();
  await browser.close();

  if (!video) {
    throw new Error("Playwright video handle was not created.");
  }

  const recordedPath = await video.path();
  fs.copyFileSync(recordedPath, OUTPUT_VIDEO_SILENT);
  elapsedSince(globalT0, `raw WebM copy → ${path.relative(PROJECT_ROOT, OUTPUT_VIDEO_SILENT)}`);

  const canMuxAudio = !isMidiFile(audioFileForCapture);
  if (canMuxAudio) {
    elapsedSince(globalT0, `FFmpeg mux to ${path.extname(OUTPUT_VIDEO)} (blocked until finish …)`);
    const muxStart = Date.now();
    const muxResult = muxAudio(OUTPUT_VIDEO_SILENT, audioFileForCapture, OUTPUT_VIDEO);
    elapsedSince(globalT0, `FFmpeg done (+${Math.round((Date.now() - muxStart) / 1000)}s mux)`);
    if (!muxResult.ok) {
      fs.copyFileSync(OUTPUT_VIDEO_SILENT, OUTPUT_VIDEO);
      console.warn(`Audio mux failed, wrote silent file: ${muxResult.reason}`);
    }
  } else {
    fs.copyFileSync(OUTPUT_VIDEO_SILENT, OUTPUT_VIDEO);
    console.warn("MIDI source selected; exported video is silent (no rendered audio track).");
  }
  const wallTotal = Math.round((Date.now() - globalT0) / 1000);
  console.log(`[export] ══ Done · total wall ${wallTotal}s · Sample video written: ${OUTPUT_VIDEO}`);
  console.log(`[export]     capture timeline ${runtimeCaptureMs} ms · tone ${toneDurationSec}s`);
}

async function main() {
  const baseUrl = `http://127.0.0.1:${SERVER_PORT}/sonicsphere.html`;
  let server = null;
  const serverUp = await waitForServer(baseUrl, 2000);
  if (serverUp) {
    console.log(`[export] Using existing HTTP server on port ${SERVER_PORT}`);
  } else {
    console.log(`[export] No server on ${SERVER_PORT}; starting http-server …`);
    server = startHttpServer(SERVER_PORT);
    const ready = await waitForServer(baseUrl, 30000);
    if (!ready) {
      if (server && !server.killed) server.kill("SIGTERM");
      throw new Error(
        `Could not reach ${baseUrl}. Free port ${SERVER_PORT} or start the app with: npm start`
      );
    }
  }
  try {
    await runCapture();
  } finally {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
