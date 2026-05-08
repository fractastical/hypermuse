import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const PROJECT_ROOT = process.cwd();
const BETSE_ROOT = path.join(PROJECT_ROOT, process.env.BETSE_ROOT || "external/betse");
const OUTPUT_DIR = path.join(PROJECT_ROOT, process.env.BETSE_LOOP_OUTPUT_DIR || "loops/reactions/betse");
const OUTPUT_SET = path.join(PROJECT_ROOT, process.env.BETSE_SET_OUTPUT || "sets/reactions-betse.json");
const MAX_ITEMS = Math.max(8, Number.parseInt(process.env.BETSE_MAX_ITEMS || "36", 10));
const LOOP_SECONDS = Math.max(8, Number.parseInt(process.env.BETSE_LOOP_SECONDS || "12", 10));
const FPS = Math.max(12, Number.parseInt(process.env.BETSE_LOOP_FPS || "24", 10));
const WIDTH = Math.max(960, Number.parseInt(process.env.BETSE_WIDTH || "1280", 10));
const HEIGHT = Math.max(540, Number.parseInt(process.env.BETSE_HEIGHT || "720", 10));
const MIN_SOURCE_BYTES = Math.max(2_000, Number.parseInt(process.env.BETSE_MIN_SOURCE_BYTES || "4000", 10));
const EXTENSIONS = new Set([".gif", ".png", ".jpg", ".jpeg", ".webp"]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosix(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function sanitizeBaseName(filePath) {
  const rel = path.relative(BETSE_ROOT, filePath);
  return rel
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "betse";
}

function collectSources(dirPath, acc = []) {
  if (!fs.existsSync(dirPath)) return acc;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectSources(fullPath, acc);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!EXTENSIONS.has(ext)) continue;
    const stat = fs.statSync(fullPath);
    if (!stat.isFile() || stat.size < MIN_SOURCE_BYTES) continue;
    acc.push({ filePath: fullPath, bytes: stat.size });
  }
  return acc;
}

function runFfmpeg(args) {
  const result = spawnSync(ffmpegPath, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "ffmpeg failed").trim());
  }
}

function buildStillFilter() {
  return [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`,
    `hue='H=2*PI*t/${LOOP_SECONDS}:s=1.08'`,
    "format=yuv420p"
  ].join(",");
}

function buildGifFilter() {
  return [
    `fps=${FPS}`,
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`,
    `hue='H=2*PI*t/${LOOP_SECONDS}:s=1.06'`,
    "format=yuv420p"
  ].join(",");
}

function convertSourceToLoop(inputPath, outputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === ".gif") {
    runFfmpeg([
      "-y",
      "-stream_loop",
      "-1",
      "-t",
      String(LOOP_SECONDS),
      "-i",
      inputPath,
      "-vf",
      buildGifFilter(),
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
    ]);
    return;
  }
  runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(FPS),
    "-t",
    String(LOOP_SECONDS),
    "-i",
    inputPath,
    "-vf",
    buildStillFilter(),
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
  ]);
}

function main() {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static binary not available");
  }
  if (!fs.existsSync(BETSE_ROOT)) {
    throw new Error(`BETSE root not found: ${BETSE_ROOT}`);
  }
  ensureDir(OUTPUT_DIR);
  ensureDir(path.dirname(OUTPUT_SET));

  const candidates = collectSources(BETSE_ROOT)
    .sort((a, b) => b.bytes - a.bytes || a.filePath.localeCompare(b.filePath))
    .slice(0, MAX_ITEMS);

  const loops = [];
  for (let i = 0; i < candidates.length; i++) {
    const src = candidates[i];
    const base = sanitizeBaseName(src.filePath);
    const outputFile = `${String(i + 1).padStart(2, "0")}-${base}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFile);
    try {
      convertSourceToLoop(src.filePath, outputPath);
      loops.push({
        url: toPosix(path.relative(PROJECT_ROOT, outputPath)),
        label: path.basename(outputPath),
        transition: {
          type: "fade",
          durationMs: 650,
          holdMs: 8500
        }
      });
    } catch (error) {
      // Skip media that ffmpeg cannot decode.
      console.warn(`skip ${src.filePath}: ${error.message}`);
    }
  }

  const manifest = {
    setName: "reactions-betse",
    sourceDirectory: "loops/reactions/betse",
    generatedAt: new Date().toISOString(),
    count: loops.length,
    effectTimeline: {
      enabled: true,
      phases: [
        { name: "classic", durationSec: 18 },
        { name: "gray-scott", durationSec: 18 },
        { name: "physarum", durationSec: 18 },
        { name: "word-cloud", durationSec: 16 },
        { name: "molecule", durationSec: 16 }
      ]
    },
    defaultTransition: {
      type: "fade",
      durationMs: 650,
      holdMs: 8500
    },
    loops
  };

  fs.writeFileSync(OUTPUT_SET, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    sourceCandidates: candidates.length,
    createdLoops: loops.length,
    loopsDir: toPosix(path.relative(PROJECT_ROOT, OUTPUT_DIR)),
    manifest: toPosix(path.relative(PROJECT_ROOT, OUTPUT_SET))
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || String(error));
  process.exit(1);
}
