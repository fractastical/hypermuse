import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const INPUT_DIR = process.argv[2] || "loops/bio1";
const OUTPUT_FILE = process.argv[3] || "sets/bio1.json";
const DEFAULT_HOLD_MS = Number.parseInt(process.env.VJ_HOLD_MS || "8000", 10);
const DEFAULT_TRANSITION_MS = Number.parseInt(process.env.VJ_TRANSITION_MS || "900", 10);
const DEFAULT_TRANSITION_TYPE = process.env.VJ_TRANSITION_TYPE || "fade";
const DEFAULT_MOLECULE_NAME = process.env.VJ_MOLECULE_NAME || "caffeine";
const DEFAULT_PLAYBACK_MODE = process.env.VJ_PLAYBACK_MODE || "pingpong";
const DEFAULT_MAX_LOOPS = Number.parseInt(process.env.VJ_MAX_LOOPS || "20", 10);
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

function main() {
  const inputAbs = path.resolve(PROJECT_ROOT, INPUT_DIR);
  const outputAbs = path.resolve(PROJECT_ROOT, OUTPUT_FILE);
  const outputDir = path.dirname(outputAbs);
  fs.mkdirSync(outputDir, { recursive: true });

  const videos = collectVideos(inputAbs).slice(0, Math.max(1, DEFAULT_MAX_LOOPS));
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
    setName: path.basename(INPUT_DIR),
    sourceDirectory: toPosix(INPUT_DIR),
    generatedAt: new Date().toISOString(),
    count: loops.length,
    playbackMode: DEFAULT_PLAYBACK_MODE,
    moleculeGraph: {
      name: DEFAULT_MOLECULE_NAME,
      names: DEFAULT_MOLECULE_NAMES,
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
