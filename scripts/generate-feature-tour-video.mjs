import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";

const PROJECT_ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
const VIDEO_DIR = path.join(ARTIFACTS_DIR, "videos");
const AUDIO_PATH = path.join(ARTIFACTS_DIR, "generated-tone.wav");
const OUTPUT_VIDEO = path.join(ARTIFACTS_DIR, "sample-feature-tour.webm");
const OUTPUT_VIDEO_SILENT = path.join(ARTIFACTS_DIR, "sample-feature-tour-silent.webm");
const CAPTURE_MS = Math.max(30000, Number.parseInt(process.env.CAPTURE_MS || "70000", 10));
const SET_MANIFEST = process.env.VJ_SET_MANIFEST || "sets/tonight-set-1-betse-cells.json";
const WIDTH = Number.parseInt(process.env.EXPORT_WIDTH || "1920", 10);
const HEIGHT = Number.parseInt(process.env.EXPORT_HEIGHT || "1080", 10);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createTestToneWav({ sampleRate = 44100, durationSeconds = 75 } = {}) {
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  const bpm = 126;
  const beatHz = bpm / 60;
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const pulse = Math.exp(-14 * ((t * beatHz) % 1));
    const bass = Math.sin(2 * Math.PI * 84 * t) * (0.45 + pulse * 0.55);
    const mid = Math.sin(2 * Math.PI * 220 * t) * (0.28 + pulse * 0.5);
    const high = Math.sin(2 * Math.PI * 820 * t) * (0.12 + pulse * 0.45);
    const value = Math.max(-1, Math.min(1, (bass + mid + high) * 0.36));
    buffer.writeInt16LE(Math.floor(value * 32767), 44 + (i * 2));
  }
  return buffer;
}

function muxAudio(videoPath, audioPath, outputPath) {
  const result = spawnSync(ffmpegPath, [
    "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "libvpx",
    "-b:v", "4M",
    "-deadline", "realtime",
    "-cpu-used", "5",
    "-c:a", "libopus",
    outputPath
  ], { encoding: "utf8" });
  return result.status === 0;
}

function startHttpServer(port = 8080) {
  return spawn("npx", ["http-server", "-c-1", "-p", String(port), "."], {
    cwd: PROJECT_ROOT,
    stdio: "ignore"
  });
}

async function runCapture() {
  ensureDir(ARTIFACTS_DIR);
  ensureDir(VIDEO_DIR);
  fs.writeFileSync(AUDIO_PATH, createTestToneWav());
  const server = startHttpServer(8080);
  let browser = null;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      recordVideo: { dir: VIDEO_DIR, size: { width: WIDTH, height: HEIGHT } }
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:8080/sonicsphere.html?demo=1&hideoverlay=1", {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });
    await page.evaluate(async (manifestPath) => {
      if (window.loadVideoSetManifest) {
        await window.loadVideoSetManifest(manifestPath);
      }
    }, SET_MANIFEST);
    await page.locator("#audioInput").setInputFiles(AUDIO_PATH);
    await page.evaluate(() => {
      if (window.vjControl) {
        window.vjControl({ hideUI: true, play: true, audio: true });
      }
      if (window.setEffectTimelineConfig) {
        window.setEffectTimelineConfig({
          enabled: true,
          phaseList: "classic,gray-scott,word-cloud,rewrite,molecule,stacked",
          phaseDurationSec: 10
        }, true);
      }
      if (window.setWordCloudList) {
        window.setWordCloudList("bioelectric-core-v1");
      }
    });

    const segmentMs = Math.floor(CAPTURE_MS / 7);
    await page.waitForTimeout(segmentMs);
    await page.evaluate(() => window.vjControl && window.vjControl({ layout: "thirds-2d", mode: "gray-scott" }));
    await page.waitForTimeout(segmentMs);
    await page.evaluate(() => window.vjControl && window.vjControl({ mode: "word-cloud", wordList: "synthetic-bio-mit-v1" }));
    await page.waitForTimeout(segmentMs);
    await page.evaluate(() => window.vjControl && window.vjControl({ mode: "word-cloud", wordList: "ai-bio-futures-v1" }));
    await page.waitForTimeout(segmentMs);
    await page.evaluate(() => window.vjControl && window.vjControl({ mosaic: true, mosaicOpacity: 0.72 }));
    await page.waitForTimeout(segmentMs);
    await page.evaluate(() => window.vjControl && window.vjControl({ mosaicFx: true, mode: "stacked" }));
    await page.waitForTimeout(segmentMs);
    await page.evaluate(() => window.vjControl && window.vjControl({
      infinitestreams: true,
      infinitestreamsOpacity: 0.65,
      infinitestreamsUrl: "https://infinitestreams.io/",
      mode: "rewrite"
    }));
    await page.waitForTimeout(segmentMs);

    const video = page.video();
    await context.close();
    if (!video) throw new Error("No recorded video handle.");
    fs.copyFileSync(await video.path(), OUTPUT_VIDEO_SILENT);
    if (!muxAudio(OUTPUT_VIDEO_SILENT, AUDIO_PATH, OUTPUT_VIDEO)) {
      fs.copyFileSync(OUTPUT_VIDEO_SILENT, OUTPUT_VIDEO);
    }
    console.log(JSON.stringify({
      output: path.relative(PROJECT_ROOT, OUTPUT_VIDEO),
      silent: path.relative(PROJECT_ROOT, OUTPUT_VIDEO_SILENT),
      captureMs: CAPTURE_MS
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server && !server.killed) server.kill("SIGTERM");
  }
}

runCapture().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
