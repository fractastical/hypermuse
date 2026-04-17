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
  const pattern = String(DEFAULT_INCLUDE_REGEX || "").trim();
  if (!pattern) {
    return videos;
  }
  let includeRegex = null;
  try {
    includeRegex = new RegExp(pattern, "i");
  } catch (error) {
    console.warn(`Invalid VJ_INCLUDE_REGEX "${pattern}", skipping filter.`);
    return videos;
  }
  return videos.filter((videoPath) => includeRegex.test(path.basename(videoPath)));
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
    effectTimeline: {
      enabled: true,
      phases: [
        { name: "classic", durationSec: 8 },
        { name: "life", durationSec: 8 },
        { name: "kuramoto", durationSec: 8 },
        { name: "molecule", durationSec: 8 },
        { name: "stacked", durationSec: 8 }
      ]
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
