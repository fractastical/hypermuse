import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";

const PROJECT_ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
const VIDEO_DIR = path.join(ARTIFACTS_DIR, "videos");
const AUDIO_PATH = path.join(ARTIFACTS_DIR, "generated-tone.wav");
const OUTPUT_VIDEO = path.join(ARTIFACTS_DIR, "sample-sonicsphere.webm");
const OUTPUT_VIDEO_SILENT = path.join(ARTIFACTS_DIR, "sample-sonicsphere-silent.webm");
const VJ_SET_MANIFEST = process.env.VJ_SET_MANIFEST || "sets/bio1.json";
const CAPTURE_MS = Number.parseInt(process.env.CAPTURE_MS || "18000", 10);
const INPUT_AUDIO_FILE = process.env.INPUT_AUDIO_FILE || "";
const MOLECULE_NAME = process.env.MOLECULE_NAME || "";
const AUTO_BUILD_SET_MANIFEST = process.env.AUTO_BUILD_SET_MANIFEST !== "0";
const REQUIRE_SET_LOOPS = process.env.REQUIRE_SET_LOOPS === "1";
const SET_HOLD_MS = Number.parseInt(process.env.SET_HOLD_MS || "2200", 10);
const SET_TRANSITION_MS = Number.parseInt(process.env.SET_TRANSITION_MS || "450", 10);
const VJ_SOURCE_DIRS = process.env.VJ_SOURCE_DIRS || "loops/bio1";
const EFFECT_TIMELINE_PHASE_SEC = Number.parseInt(process.env.EFFECT_TIMELINE_PHASE_SEC || "3", 10);
const EFFECT_TIMELINE_PHASES = (process.env.EFFECT_TIMELINE_PHASES || "classic,molecule,life,kuramoto,stacked")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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

function isMidiFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".mid" || ext === ".midi";
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
  const args = [
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
  ensureDir(ARTIFACTS_DIR);
  ensureDir(VIDEO_DIR);
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
    fs.writeFileSync(AUDIO_PATH, createTestToneWav());
  }

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1920, height: 1080 }
    }
  });

  const page = await context.newPage();
  await page.goto("http://127.0.0.1:8080/sonicsphere.html?demo=1", {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });

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
  await page.evaluate(({ holdMs, transitionMs }) => {
    if (window.setSetPlaybackTiming) {
      window.setSetPlaybackTiming(holdMs, transitionMs);
    }
  }, { holdMs: SET_HOLD_MS, transitionMs: SET_TRANSITION_MS });

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

  if (MOLECULE_NAME) {
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

  // Give decode + capture loops enough time to build visible geometry.
  await page.waitForTimeout(CAPTURE_MS);

  const video = page.video();
  await context.close();
  await browser.close();

  if (!video) {
    throw new Error("Playwright video handle was not created.");
  }

  const recordedPath = await video.path();
  fs.copyFileSync(recordedPath, OUTPUT_VIDEO_SILENT);

  const canMuxAudio = !isMidiFile(audioFileForCapture);
  if (canMuxAudio) {
    const muxResult = muxAudio(OUTPUT_VIDEO_SILENT, audioFileForCapture, OUTPUT_VIDEO);
    if (!muxResult.ok) {
      fs.copyFileSync(OUTPUT_VIDEO_SILENT, OUTPUT_VIDEO);
      console.warn(`Audio mux failed, wrote silent file: ${muxResult.reason}`);
    }
  } else {
    fs.copyFileSync(OUTPUT_VIDEO_SILENT, OUTPUT_VIDEO);
    console.warn("MIDI source selected; exported video is silent (no rendered audio track).");
  }
  console.log(`Sample video written: ${OUTPUT_VIDEO}`);
}

runCapture().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
