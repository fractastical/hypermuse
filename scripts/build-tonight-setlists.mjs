import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const OUTPUT_DIR = path.join(PROJECT_ROOT, process.env.TONIGHT_SETLIST_DIR || "sets");
const TARGET_HOURS = Math.max(1, Number.parseFloat(process.env.TONIGHT_SET_HOURS || "1"));
const TARGET_SECONDS = TARGET_HOURS * 3600;

const PLAYLISTS = [
  {
    name: "tonight-set-1-betse-cells",
    dirs: ["loops/reactions/betse", "loops/cells1", "loops/cells2", "loops/reactions"],
    effectPhases: "classic:18,gray-scott:22,physarum:20,word-cloud:16,molecule:16,rewrite:16"
  },
  {
    name: "tonight-set-2-morphogenesis",
    dirs: ["loops/morpholib", "loops/clarafi", "loops/cells2", "loops/reactions/betse"],
    effectPhases: "classic:18,life:16,hierarchical-life:16,gray-scott:20,word-cloud:16,molecule:18"
  },
  {
    name: "tonight-set-3-high-energy-mix",
    dirs: [
      "loops/highdef",
      "loops/reactions",
      "loops/reactions/betse",
      "loops/Artbeats-OceanWaterEffects",
      "loops/Artbeats-TimelapsePlants",
      "loops/morpholib"
    ],
    effectPhases: "classic:16,kuramoto:18,gray-scott:18,physarum:18,rewrite:16,word-cloud:16,stacked:18"
  },
  {
    name: "sample-set-4-reaction-microscopy",
    dirs: [
      "loops/reactions/nikon-smallworld",
      "loops/reactions/cell-image-library",
      "loops/Nikon Vj Loops Cellular",
      "loops/reactions/betse",
      "loops/reactions"
    ],
    effectPhases: "classic:16,gray-scott:20,molecule:18,word-cloud:14,rewrite:14,physarum:18"
  },
  {
    name: "sample-set-5-cells-morpho",
    dirs: ["loops/cells1", "loops/cells2", "loops/morpholib", "loops/clarafi"],
    effectPhases: "classic:18,life:14,hierarchical-life:14,gray-scott:18,word-cloud:16,molecule:18"
  },
  {
    name: "sample-set-6-nature-water-artbeats",
    dirs: [
      "loops/Artbeats-OceanWaterEffects",
      "loops/Artbeats-TimelapsePlants",
      "loops/Artbeats-TimelapseFlowers3",
      "loops/Artbeats-WaterEffects2",
      "loops/highdef"
    ],
    effectPhases: "classic:14,kuramoto:16,gray-scott:18,physarum:18,stacked:16,word-cloud:14"
  }
];

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"]);

function toPosix(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function collectVideosRecursive(dirPath, acc = []) {
  if (!fs.existsSync(dirPath)) return acc;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectVideosRecursive(fullPath, acc);
      continue;
    }
    if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function interleaveBuckets(buckets, maxCount) {
  const out = [];
  for (let i = 0; out.length < maxCount; i++) {
    let pushed = false;
    for (const bucket of buckets) {
      if (i < bucket.length) {
        out.push(bucket[i]);
        pushed = true;
        if (out.length >= maxCount) break;
      }
    }
    if (!pushed) break;
  }
  return out.slice(0, maxCount);
}

function repeatToLength(items, targetCount) {
  if (!Array.isArray(items) || items.length === 0 || targetCount <= 0) {
    return [];
  }
  if (items.length >= targetCount) {
    return items.slice(0, targetCount);
  }
  const out = [];
  let i = 0;
  while (out.length < targetCount) {
    out.push(items[i % items.length]);
    i += 1;
  }
  return out;
}

function parseEffectPhases(spec) {
  return String(spec || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const [name, secRaw] = token.split(":");
      return {
        name: String(name || "classic").trim().toLowerCase(),
        durationSec: Math.max(8, Number.parseInt(secRaw || "16", 10) || 16)
      };
    });
}

function buildManifest({ name, dirs, effectPhases }) {
  const holdMs = 8200;
  const transitionMs = 650;
  const clipBudget = Math.ceil(TARGET_SECONDS / ((holdMs + transitionMs) / 1000));
  const buckets = dirs
    .map((dir) => collectVideosRecursive(path.join(PROJECT_ROOT, dir)).sort())
    .filter((list) => list.length > 0);
  const selectedUnique = interleaveBuckets(buckets, clipBudget);
  const selected = repeatToLength(selectedUnique, clipBudget);

  const loops = selected.map((absolutePath) => ({
    url: toPosix(path.relative(PROJECT_ROOT, absolutePath)),
    label: path.basename(absolutePath),
    transition: {
      type: "fade",
      durationMs: transitionMs,
      holdMs,
      holdLastFrameOnClipEnd: true
    }
  }));

  return {
    setName: name,
    sourceDirectory: "loops",
    sourceDirectories: dirs.map((d) => toPosix(d)),
    generatedAt: new Date().toISOString(),
    count: loops.length,
    playbackMode: "loop",
    effectTimeline: {
      enabled: true,
      phases: parseEffectPhases(effectPhases)
    },
    defaultTransition: {
      type: "fade",
      durationMs: transitionMs,
      holdMs
    },
    loops
  };
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputs = [];
  for (const plan of PLAYLISTS) {
    const manifest = buildManifest(plan);
    const outPath = path.join(OUTPUT_DIR, `${plan.name}.json`);
    fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    outputs.push({
      set: plan.name,
      loops: manifest.loops.length,
      path: toPosix(path.relative(PROJECT_ROOT, outPath))
    });
  }
  console.log(JSON.stringify({
    targetHoursPerSet: TARGET_HOURS,
    outputs
  }, null, 2));
}

main();
