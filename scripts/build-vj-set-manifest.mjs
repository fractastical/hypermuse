import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const INPUT_DIR_ARG = process.argv[2] || process.env.VJ_SOURCE_DIRS || "loops/bio1";
const OUTPUT_FILE = process.argv[3] || "sets/bio1.json";
const DEFAULT_HOLD_MS = Number.parseInt(process.env.VJ_HOLD_MS || "8000", 10);
const DEFAULT_TRANSITION_MS = Number.parseInt(process.env.VJ_TRANSITION_MS || "900", 10);
const DEFAULT_TRANSITION_TYPE = process.env.VJ_TRANSITION_TYPE || "fade";
const DEFAULT_MOLECULE_NAME = process.env.VJ_MOLECULE_NAME || "caffeine";
const DEFAULT_MOLECULE_RENDER_MODE = process.env.VJ_MOLECULE_RENDER_MODE || "coherent";
const DEFAULT_PLAYBACK_MODE = process.env.VJ_PLAYBACK_MODE || "pingpong";
const DEFAULT_MAX_LOOPS = Number.parseInt(process.env.VJ_MAX_LOOPS || "20", 10);
const DEFAULT_INCLUDE_REGEX = process.env.VJ_INCLUDE_REGEX || "";
const DEFAULT_EXCLUDE_REGEX = process.env.VJ_EXCLUDE_REGEX || "turing_patterns_loop30\\.mp4";
const DEFAULT_GRAY_SCOTT_PRESET = process.env.VJ_GRAY_SCOTT_PRESET || "nexus";
const DEFAULT_EFFECT_PHASE_SPEC = process.env.VJ_EFFECT_PHASES || "classic:16,life:16,classic:16,kuramoto:16,classic:16,gray-scott:16,classic:16,physarum:16,classic:16,molecule:16,classic:16,stacked:16";
const DEFAULT_BACKGROUND_SCRIPT = process.env.VJ_BACKGROUND_SCRIPT || "infinitestreams/src/sketches/yuruyurau/flow1";
const DEFAULT_BACKGROUND_SCRIPTS = (process.env.VJ_BACKGROUND_SCRIPTS || "infinitestreams/src/sketches/yuruyurau/dots,infinitestreams/src/sketches/yuruyurau/waves,infinitestreams/src/sketches/yuruyurau/magnets,infinitestreams/src/sketches/yuruyurau/orbits,infinitestreams/src/sketches/yuruyurau/shear,infinitestreams/src/sketches/yuruyurau/pulse,infinitestreams/src/sketches/yuruyurau/flow1,infinitestreams/src/sketches/yuruyurau/flow2,infinitestreams/src/sketches/snow/lines,infinitestreams/src/sketches/snow/grid,infinitestreams/src/sketches/snow/spiral,infinitestreams/src/sketches/snow/spiralLines,infinitestreams/src/sketches/snow/rotatingPattern,infinitestreams/src/sketches/snow/rotatingBlobs,infinitestreams/src/sketches/snow/rotatingRects,infinitestreams/src/sketches/snow/rotatingSquares,infinitestreams/src/sketches/snow/rotatingStars,infinitestreams/src/sketches/snow/noiseColumns,infinitestreams/src/sketches/snow/noiseBlobs,infinitestreams/src/sketches/snow/noiseCircles,infinitestreams/src/sketches/snow/noiseCircles4,infinitestreams/src/sketches/snow/noiseCircles5,infinitestreams/src/sketches/snow/pieArcs,infinitestreams/src/sketches/snow/pieArcs3,infinitestreams/src/sketches/snow/circles,infinitestreams/src/sketches/snow/colorLines,infinitestreams/src/sketches/snow/morphingShapes,infinitestreams/src/sketches/snow/musicalExplosions,infinitestreams/src/sketches/snow/waveEllipses")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const DEFAULT_BACKGROUND_BLEND = process.env.VJ_BACKGROUND_BLEND || "additive";
const DEFAULT_BACKGROUND_OPACITY = Number.parseFloat(process.env.VJ_BACKGROUND_OPACITY || "1.0");
const DEFAULT_BACKGROUND_SCROLL = Number.parseFloat(process.env.VJ_BACKGROUND_SCROLL || "0.012");
const DEFAULT_VIDEO_BACKGROUND_ENABLED = ["1", "true", "yes", "on"].includes(String(process.env.VJ_VIDEO_BACKGROUND_ENABLED || "").toLowerCase());
const DEFAULT_VIDEO_BACKGROUND_OPACITY = Number.parseFloat(process.env.VJ_VIDEO_BACKGROUND_OPACITY || "0.9");
const DEFAULT_MOLECULE_NAMES = (process.env.VJ_MOLECULE_NAMES || "caffeine,serotonin,dopamine,glucose")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".avi",
  ".mkv"
]);

function toPosix(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function collectVideos(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectVideos(fullPath));
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function parseInputDirs(inputArg) {
  return String(inputArg || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function interleaveVideos(videoLists, maxCount) {
  const queues = videoLists.map((list) => list.slice());
  const merged = [];
  while (merged.length < maxCount) {
    let pushedInRound = false;
    for (let i = 0; i < queues.length && merged.length < maxCount; i++) {
      if (queues[i].length > 0) {
        merged.push(queues[i].shift());
        pushedInRound = true;
      }
    }
    if (!pushedInRound) {
      break;
    }
  }
  return merged;
}

function filterVideosByPattern(videos) {
  let filtered = videos.slice();

  const excludePattern = String(DEFAULT_EXCLUDE_REGEX || "").trim();
  if (excludePattern) {
    try {
      const excludeRegex = new RegExp(excludePattern, "i");
      filtered = filtered.filter((videoPath) => !excludeRegex.test(videoPath));
    } catch {
      console.warn(`Invalid VJ_EXCLUDE_REGEX "${excludePattern}", skipping exclusion filter.`);
    }
  }

  const includePattern = String(DEFAULT_INCLUDE_REGEX || "").trim();
  if (!includePattern) {
    return filtered;
  }
  try {
    const includeRegex = new RegExp(includePattern, "i");
    return filtered.filter((videoPath) => includeRegex.test(path.basename(videoPath)));
  } catch {
    console.warn(`Invalid VJ_INCLUDE_REGEX "${includePattern}", skipping include filter.`);
    return filtered;
  }
}

function parseEffectPhases(spec) {
  const raw = String(spec || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const phases = [];
  for (const token of raw) {
    const [nameRaw, durationRaw] = token.split(":");
    const name = String(nameRaw || "").trim().toLowerCase();
    if (!name) {
      continue;
    }
    const durationSec = Math.max(1, Number.parseInt(String(durationRaw || "16").trim(), 10) || 16);
    phases.push({ name, durationSec });
  }
  if (phases.length > 0) {
    return phases;
  }
  return [
    { name: "classic", durationSec: 16 },
    { name: "life", durationSec: 16 },
    { name: "classic", durationSec: 16 },
    { name: "kuramoto", durationSec: 16 },
    { name: "classic", durationSec: 16 },
    { name: "gray-scott", durationSec: 16 },
    { name: "classic", durationSec: 16 },
    { name: "physarum", durationSec: 16 },
    { name: "classic", durationSec: 16 },
    { name: "molecule", durationSec: 16 },
    { name: "classic", durationSec: 16 },
    { name: "stacked", durationSec: 16 }
  ];
}

function main() {
  const inputDirs = parseInputDirs(INPUT_DIR_ARG);
  if (inputDirs.length === 0) {
    throw new Error("No input loop directories provided.");
  }
  const outputAbs = path.resolve(PROJECT_ROOT, OUTPUT_FILE);
  const outputDir = path.dirname(outputAbs);
  fs.mkdirSync(outputDir, { recursive: true });

  const perDirectoryVideos = inputDirs.map((inputDir) => {
    const inputAbs = path.resolve(PROJECT_ROOT, inputDir);
    return filterVideosByPattern(collectVideos(inputAbs));
  });
  const videos = interleaveVideos(perDirectoryVideos, Math.max(1, DEFAULT_MAX_LOOPS));
  const loops = videos.map((absolutePath) => {
    const relative = path.relative(PROJECT_ROOT, absolutePath);
    return {
      url: toPosix(relative),
      label: path.basename(absolutePath),
      transition: {
        type: DEFAULT_TRANSITION_TYPE,
        durationMs: DEFAULT_TRANSITION_MS,
        holdMs: DEFAULT_HOLD_MS
      }
    };
  });

  const manifest = {
    setName: inputDirs.length === 1 ? path.basename(inputDirs[0]) : "mixed-loops",
    sourceDirectory: toPosix(inputDirs[0]),
    sourceDirectories: inputDirs.map((inputDir) => toPosix(inputDir)),
    generatedAt: new Date().toISOString(),
    count: loops.length,
    playbackMode: DEFAULT_PLAYBACK_MODE,
    moleculeGraph: {
      name: DEFAULT_MOLECULE_NAME,
      names: DEFAULT_MOLECULE_NAMES,
      renderMode: DEFAULT_MOLECULE_RENDER_MODE,
      cycleOnPhaseChange: true
    },
    simulationPresets: {
      grayScott: DEFAULT_GRAY_SCOTT_PRESET
    },
    backgrounds: {
      script: DEFAULT_BACKGROUND_SCRIPT,
      scripts: DEFAULT_BACKGROUND_SCRIPTS,
      cycleOnPhaseChange: true,
      blendMode: DEFAULT_BACKGROUND_BLEND,
      opacity: Number.isFinite(DEFAULT_BACKGROUND_OPACITY) ? DEFAULT_BACKGROUND_OPACITY : 1.0,
      scrollSpeed: Number.isFinite(DEFAULT_BACKGROUND_SCROLL) ? DEFAULT_BACKGROUND_SCROLL : 0.012
    },
    videoBackground: {
      enabled: DEFAULT_VIDEO_BACKGROUND_ENABLED,
      opacity: Number.isFinite(DEFAULT_VIDEO_BACKGROUND_OPACITY) ? DEFAULT_VIDEO_BACKGROUND_OPACITY : 0.9
    },
    effectTimeline: {
      enabled: true,
      phases: parseEffectPhases(DEFAULT_EFFECT_PHASE_SPEC)
    },
    defaultTransition: {
      type: DEFAULT_TRANSITION_TYPE,
      durationMs: DEFAULT_TRANSITION_MS,
      holdMs: DEFAULT_HOLD_MS
    },
    loops
  };

  fs.writeFileSync(outputAbs, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${loops.length} loops to ${toPosix(path.relative(PROJECT_ROOT, outputAbs))}`);
}

main();
