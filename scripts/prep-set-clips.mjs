import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const PROJECT_ROOT = process.cwd();
const INPUT_MANIFEST = process.env.PREP_INPUT_MANIFEST || process.argv[2] || "sets/mix-bio1-clarafi-other-303040-clean.json";
const OUTPUT_MANIFEST = process.env.PREP_OUTPUT_MANIFEST || process.argv[3] || INPUT_MANIFEST.replace(/\.json$/i, "-prepped.json");
const OUTPUT_DIR = process.env.PREP_OUTPUT_DIR || "loops/prepped";
const VIDEO_CODEC = process.env.PREP_VIDEO_CODEC || "libx264";
const CRF = Number.parseInt(process.env.PREP_CRF || "20", 10);
const PRESET = process.env.PREP_PRESET || "veryfast";

function toPosix(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function parseDurationSec(videoPath) {
  const probe = spawnSync(ffmpegPath, ["-i", videoPath], { encoding: "utf8" });
  const output = `${probe.stdout || ""}\n${probe.stderr || ""}`;
  const m = output.match(/Duration:\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return null;
  return (Number.parseInt(m[1], 10) * 3600) + (Number.parseInt(m[2], 10) * 60) + Number.parseFloat(m[3]);
}

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function sanitizeName(value) {
  return String(value || "clip")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "clip";
}

function shouldPrepareLoop(loop) {
  const t = loop?.transition || {};
  return Number.isFinite(t.clipStartSec)
    || Number.isFinite(t.clipEndSec)
    || (t.crop && Number.isFinite(t.crop.x) && Number.isFinite(t.crop.y) && Number.isFinite(t.crop.width) && Number.isFinite(t.crop.height));
}

function buildFilterChain(crop, holdPadSec) {
  const filters = [];
  if (crop && Number.isFinite(crop.x) && Number.isFinite(crop.y) && Number.isFinite(crop.width) && Number.isFinite(crop.height)) {
    const x = Math.max(0, Math.min(1, crop.x));
    const y = Math.max(0, Math.min(1, crop.y));
    const w = Math.max(0.2, Math.min(1, crop.width));
    const h = Math.max(0.2, Math.min(1, crop.height));
    filters.push(`crop=iw*${w}:ih*${h}:iw*${x}:ih*${y}`);
  }
  if (holdPadSec > 0.01) {
    filters.push(`tpad=stop_mode=clone:stop_duration=${holdPadSec.toFixed(3)}`);
  }
  return filters;
}

function transcodeLoop(loop, outputBaseDir, index) {
  const srcRel = loop.url;
  const srcAbs = path.resolve(PROJECT_ROOT, srcRel);
  if (!fs.existsSync(srcAbs)) {
    throw new Error(`Missing source clip: ${srcRel}`);
  }

  const transition = loop.transition || {};
  const parsedDuration = parseDurationSec(srcAbs);
  const srcDurationSec = Number.isFinite(parsedDuration) ? parsedDuration : null;
  const startSec = Number.isFinite(transition.clipStartSec) ? Math.max(0, transition.clipStartSec) : 0;
  let endSec = Number.isFinite(transition.clipEndSec) ? Math.max(startSec + 0.04, transition.clipEndSec) : srcDurationSec;
  if (Number.isFinite(srcDurationSec) && Number.isFinite(endSec)) {
    endSec = Math.min(endSec, srcDurationSec);
  }
  const clipDurationSec = Number.isFinite(endSec) ? Math.max(0.04, endSec - startSec) : null;
  const holdMs = Number.isFinite(transition.holdMs) ? Math.max(0, transition.holdMs) : 0;
  const holdPadSec = clipDurationSec !== null ? Math.max(0, (holdMs / 1000) - clipDurationSec) : 0;
  const filters = buildFilterChain(transition.crop, holdPadSec);

  const ext = ".mp4";
  const rawLabel = loop.label || path.basename(srcRel, path.extname(srcRel));
  const baseLabel = path.basename(rawLabel, path.extname(rawLabel));
  const stem = `${String(index + 1).padStart(3, "0")}-${sanitizeName(baseLabel)}`;
  const outAbs = path.join(outputBaseDir, `${stem}${ext}`);
  const outRel = toPosix(path.relative(PROJECT_ROOT, outAbs));
  ensureDir(path.dirname(outAbs));

  const args = ["-y"];
  if (startSec > 0.001) {
    args.push("-ss", startSec.toFixed(3));
  }
  args.push("-i", srcAbs);
  if (clipDurationSec !== null) {
    args.push("-t", clipDurationSec.toFixed(3));
  }
  if (filters.length > 0) {
    args.push("-vf", filters.join(","));
  }
  args.push(
    "-an",
    "-c:v", VIDEO_CODEC,
    "-preset", PRESET,
    "-crf", String(CRF),
    "-pix_fmt", "yuv420p",
    outAbs
  );

  const run = spawnSync(ffmpegPath, args, { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error((run.stderr || run.stdout || "ffmpeg failed").trim());
  }
  return outRel;
}

function main() {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static is unavailable.");
  }
  const manifestAbs = path.resolve(PROJECT_ROOT, INPUT_MANIFEST);
  if (!fs.existsSync(manifestAbs)) {
    throw new Error(`Input manifest not found: ${INPUT_MANIFEST}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestAbs, "utf8"));
  if (!Array.isArray(manifest.loops)) {
    throw new Error(`Invalid manifest loops in: ${INPUT_MANIFEST}`);
  }

  const setName = sanitizeName(manifest.setName || "set");
  const outputBaseDir = path.resolve(PROJECT_ROOT, OUTPUT_DIR, setName);
  ensureDir(outputBaseDir);

  let preparedCount = 0;
  const loops = manifest.loops.map((loop, index) => {
    if (!shouldPrepareLoop(loop)) {
      return loop;
    }
    const outRel = transcodeLoop(loop, outputBaseDir, index);
    preparedCount += 1;
    return {
      ...loop,
      url: outRel,
      transition: {
        ...(loop.transition || {}),
        clipStartSec: undefined,
        clipEndSec: undefined,
        crop: undefined,
        holdLastFrameOnClipEnd: false
      }
    };
  });

  const outputManifestAbs = path.resolve(PROJECT_ROOT, OUTPUT_MANIFEST);
  ensureDir(path.dirname(outputManifestAbs));
  const outputPayload = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    sourceManifest: toPosix(path.relative(PROJECT_ROOT, manifestAbs)),
    preprocessedClips: preparedCount,
    loops
  };
  fs.writeFileSync(outputManifestAbs, JSON.stringify(outputPayload, null, 2) + "\n");

  console.log(`Prepared clips: ${preparedCount}/${manifest.loops.length}`);
  console.log(`Wrote ${toPosix(path.relative(PROJECT_ROOT, outputManifestAbs))}`);
}

main();
