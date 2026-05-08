import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const PROJECT_ROOT = process.cwd();
const INPUT_DIR = path.join(PROJECT_ROOT, process.env.CELL_IMAGE_INPUT_DIR || "assets/cell-image-library/raw");
const OUTPUT_DIR = path.join(PROJECT_ROOT, process.env.CELL_IMAGE_LOOP_OUTPUT_DIR || "loops/reactions/cell-image-library");
const MANIFEST_PATH = path.join(PROJECT_ROOT, process.env.CELL_IMAGE_LOOP_MANIFEST || "sets/reactions-cell-image-library.json");
const MAX_IMAGES = Math.max(1, Number.parseInt(process.env.CELL_IMAGE_MAX_LOOPS || "30", 10));
const LOOP_SECONDS = Math.max(4, Number.parseInt(process.env.CELL_IMAGE_LOOP_SECONDS || "12", 10));
const FPS = Math.max(12, Number.parseInt(process.env.CELL_IMAGE_LOOP_FPS || "24", 10));
const WIDTH = Math.max(640, Number.parseInt(process.env.CELL_IMAGE_WIDTH || "1280", 10));
const HEIGHT = Math.max(360, Number.parseInt(process.env.CELL_IMAGE_HEIGHT || "720", 10));

const VALID_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listInputImages() {
  if (!fs.existsSync(INPUT_DIR)) {
    return [];
  }
  return fs.readdirSync(INPUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(INPUT_DIR, entry.name))
    .filter((filePath) => VALID_IMAGE_EXTS.has(path.extname(filePath).toLowerCase()))
    .sort()
    .slice(0, MAX_IMAGES);
}

function runFfmpeg(args) {
  const result = spawnSync(ffmpegPath, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "ffmpeg failed").trim());
  }
}

function safeBaseName(filePath) {
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "image";
}

function buildHueFilter(loopSeconds) {
  // Continuous hue rotation across full cycle plus subtle saturation/value pulsing.
  return [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`,
    `hue='H=2*PI*t/${loopSeconds}:s=1+0.08*sin(2*PI*t/${Math.max(3, Math.floor(loopSeconds / 2))})'`,
    `eq=brightness=0.02:contrast=1.1:saturation=1.15`,
    "format=yuv420p"
  ].join(",");
}

function makeLoopFromImage(inputPath, outputPath, loopSeconds) {
  const vf = buildHueFilter(loopSeconds);
  const args = [
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(FPS),
    "-t",
    String(loopSeconds),
    "-i",
    inputPath,
    "-vf",
    vf,
    "-r",
    String(FPS),
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath
  ];
  runFfmpeg(args);
}

function main() {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static binary not available");
  }
  ensureDir(OUTPUT_DIR);
  ensureDir(path.dirname(MANIFEST_PATH));

  const images = listInputImages();
  if (images.length === 0) {
    throw new Error(`No images found in ${INPUT_DIR}. Run scrape:cell:images first.`);
  }

  const loops = [];
  for (const imagePath of images) {
    const base = safeBaseName(imagePath);
    const outputFile = `${base}-hue-loop.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFile);
    makeLoopFromImage(imagePath, outputPath, LOOP_SECONDS);
    loops.push({
      url: path.relative(PROJECT_ROOT, outputPath).split(path.sep).join("/"),
      title: `${base} hue loop`,
      sourceImage: path.relative(PROJECT_ROOT, imagePath).split(path.sep).join("/"),
      transition: {
        holdMs: 2200,
        fadeInMs: 350,
        fadeOutMs: 300,
        playbackRate: 1,
        holdLastFrameOnClipEnd: true
      }
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceDirectory: path.relative(PROJECT_ROOT, INPUT_DIR).split(path.sep).join("/"),
    loops,
    transitionDefaults: {
      holdMs: 2200,
      fadeInMs: 350,
      fadeOutMs: 300
    }
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    loopCount: loops.length,
    loopsDir: path.relative(PROJECT_ROOT, OUTPUT_DIR),
    manifest: path.relative(PROJECT_ROOT, MANIFEST_PATH)
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error?.stack || String(error));
  process.exit(1);
}
