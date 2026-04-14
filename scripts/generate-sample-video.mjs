import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const PROJECT_ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
const VIDEO_DIR = path.join(ARTIFACTS_DIR, "videos");
const AUDIO_PATH = path.join(ARTIFACTS_DIR, "generated-tone.wav");
const OUTPUT_VIDEO = path.join(ARTIFACTS_DIR, "sample-sonicsphere.webm");
const VJ_SET_MANIFEST = process.env.VJ_SET_MANIFEST || "sets/bio1.json";
const CAPTURE_MS = Number.parseInt(process.env.CAPTURE_MS || "18000", 10);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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
  fs.writeFileSync(AUDIO_PATH, createTestToneWav());

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

  const audioInput = page.locator("#audioInput");
  await audioInput.setInputFiles(AUDIO_PATH);

  // Give decode + capture loops enough time to build visible geometry.
  await page.waitForTimeout(CAPTURE_MS);

  const video = page.video();
  await context.close();
  await browser.close();

  if (!video) {
    throw new Error("Playwright video handle was not created.");
  }

  const recordedPath = await video.path();
  fs.copyFileSync(recordedPath, OUTPUT_VIDEO);
  console.log(`Sample video written: ${OUTPUT_VIDEO}`);
}

runCapture().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
