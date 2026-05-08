import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const OUTPUT_DIR = path.join(PROJECT_ROOT, process.env.CREATIVE_SETLIST_DIR || "sets");
const DATASET_PATH = path.join(PROJECT_ROOT, process.env.COLOR_DATASET_INPUT || "artifacts/color-dataset.json");
const TARGET_HOURS = Math.max(0.5, Number.parseFloat(process.env.TONIGHT_SET_HOURS || "1"));
const TARGET_SECONDS = TARGET_HOURS * 3600;

/** Same rotation pool as build-vj-set-manifest — doubled so backdrop cycles feel like an Infinitestreams “tour”. */
const INFINITESTREAMS_SCRIPT_POOL = (
  process.env.INFINITESTREAMS_SCRIPT_LIST
    || [
      "infinitestreams/src/sketches/yuruyurau/dots",
      "infinitestreams/src/sketches/yuruyurau/waves",
      "infinitestreams/src/sketches/yuruyurau/magnets",
      "infinitestreams/src/sketches/yuruyurau/orbits",
      "infinitestreams/src/sketches/yuruyurau/shear",
      "infinitestreams/src/sketches/yuruyurau/pulse",
      "infinitestreams/src/sketches/yuruyurau/flow1",
      "infinitestreams/src/sketches/yuruyurau/flow2",
      "infinitestreams/src/sketches/snow/lines",
      "infinitestreams/src/sketches/snow/grid",
      "infinitestreams/src/sketches/snow/spiral",
      "infinitestreams/src/sketches/snow/spiralLines",
      "infinitestreams/src/sketches/snow/rotatingPattern",
      "infinitestreams/src/sketches/snow/rotatingBlobs",
      "infinitestreams/src/sketches/snow/rotatingRects",
      "infinitestreams/src/sketches/snow/rotatingSquares",
      "infinitestreams/src/sketches/snow/rotatingStars",
      "infinitestreams/src/sketches/snow/noiseColumns",
      "infinitestreams/src/sketches/snow/noiseBlobs",
      "infinitestreams/src/sketches/snow/noiseCircles",
      "infinitestreams/src/sketches/snow/noiseCircles4",
      "infinitestreams/src/sketches/snow/noiseCircles5",
      "infinitestreams/src/sketches/snow/pieArcs",
      "infinitestreams/src/sketches/snow/pieArcs3",
      "infinitestreams/src/sketches/snow/circles",
      "infinitestreams/src/sketches/snow/colorLines",
      "infinitestreams/src/sketches/snow/morphingShapes",
      "infinitestreams/src/sketches/snow/musicalExplosions",
      "infinitestreams/src/sketches/snow/waveEllipses"
    ].join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"]);
const EXCLUDED_VIDEO_PATTERNS = (
  process.env.CREATIVE_SETLIST_EXCLUDE_PATTERNS
  || "loops/morpholib/turing_patterns_loop30.mp4,loops/clarafi/"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s.toLowerCase());

function toPosix(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function isExcludedVideoPath(inputPath) {
  const rel = toPosix(path.isAbsolute(inputPath)
    ? path.relative(PROJECT_ROOT, inputPath)
    : String(inputPath || ""));
  const lowerRel = rel.toLowerCase();
  return EXCLUDED_VIDEO_PATTERNS.some((pattern) => lowerRel.includes(pattern));
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
      if (!isExcludedVideoPath(fullPath)) {
        acc.push(fullPath);
      }
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

function parseVideoRef(ref) {
  if (!ref || typeof ref !== "string") return null;
  if (ref.startsWith("video:")) return ref.slice(6);
  return null;
}

function buildStandardManifest({ name, dirs, effectPhases }, clipBudget) {
  const holdMs = 8200;
  const transitionMs = 650;
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

function buildInfinitestreamsJourneyManifest(clipBudget) {
  const dirs = [
    "loops/morpholib",
    "loops/clarafi",
    "loops/highdef",
    "loops/reactions",
    "loops/reactions/betse"
  ];
  const base = buildStandardManifest({
    name: "set-infinitestreams-journey",
    dirs,
    effectPhases: "classic:14,kuramoto:16,gray-scott:22,physarum:18,gray-scott:22,word-cloud:14,classic:14"
  }, clipBudget);

  const scripts = [...INFINITESTREAMS_SCRIPT_POOL, ...INFINITESTREAMS_SCRIPT_POOL];
  base.backgrounds = {
    script: scripts[0],
    scripts,
    cycleOnPhaseChange: true,
    blendMode: "additive",
    opacity: 1,
    scrollSpeed: 0.014
  };
  base.setNotes = "Backdrop cycles Infinitestreams sketches; foreground clips from morpho/clarafi/highdef/reactions.";
  return base;
}

function collectColorArcLoops(tagIndex, clipBudget) {
  const outbound = [
    "red",
    "red-orange",
    "orange",
    "yellow",
    "green",
    "cyan",
    "blue",
    "purple",
    "gray"
  ];
  const inbound = [
    "gray",
    "purple",
    "blue",
    "cyan",
    "green",
    "yellow",
    "orange",
    "red-orange",
    "red"
  ];
  const seen = new Set();
  const paths = [];
  const maxPerSegment = Math.max(2, Math.ceil(clipBudget / (outbound.length + inbound.length)));

  function pull(tags) {
    for (const tag of tags) {
      const list = tagIndex[tag];
      if (!Array.isArray(list)) continue;
      let n = 0;
      for (const ref of list) {
        const p = parseVideoRef(ref);
        if (!p || seen.has(p) || isExcludedVideoPath(p)) continue;
        const abs = path.join(PROJECT_ROOT, p);
        if (!fs.existsSync(abs)) continue;
        seen.add(p);
        paths.push(abs);
        n += 1;
        if (n >= maxPerSegment) break;
        if (paths.length >= clipBudget) return;
      }
    }
  }

  pull(outbound);
  pull(inbound);
  return paths.slice(0, clipBudget);
}

function collectTaggedLoops(tagIndex, tags, clipBudget, seenGlobal = new Set()) {
  const paths = [];
  const perTag = Math.max(2, Math.ceil(clipBudget / Math.max(1, tags.length)));
  for (const tag of tags) {
    const list = tagIndex[tag];
    if (!Array.isArray(list)) continue;
    let n = 0;
    for (const ref of list) {
      const p = parseVideoRef(ref);
      if (!p || seenGlobal.has(p) || isExcludedVideoPath(p)) continue;
      const abs = path.join(PROJECT_ROOT, p);
      if (!fs.existsSync(abs)) continue;
      seenGlobal.add(p);
      paths.push(abs);
      n += 1;
      if (n >= perTag) break;
      if (paths.length >= clipBudget) break;
    }
    if (paths.length >= clipBudget) break;
  }
  return paths.slice(0, clipBudget);
}

function loopsFromAbsolutePaths(selected, holdMs, transitionMs) {
  return selected.map((absolutePath) => ({
    url: toPosix(path.relative(PROJECT_ROOT, absolutePath)),
    label: path.basename(absolutePath),
    transition: {
      type: "fade",
      durationMs: transitionMs,
      holdMs,
      holdLastFrameOnClipEnd: true
    }
  }));
}

function buildTaggedColorManifest({
  setName,
  setNotes,
  effectPhases,
  tagIndex,
  tagOrder,
  clipBudget,
  holdMs,
  transitionMs
}) {
  const tagsPresent = tagOrder.filter((t) => tagIndex[t]);
  if (tagsPresent.length === 0) {
    return null;
  }
  const pathsRaw = collectTaggedLoops(tagIndex, tagsPresent, clipBudget);
  if (pathsRaw.length === 0) {
    return null;
  }
  const paths = repeatToLength(pathsRaw, clipBudget);
  const loops = loopsFromAbsolutePaths(paths, holdMs, transitionMs);
  return {
    setName,
    sourceDirectory: "loops",
    generatedAt: new Date().toISOString(),
    count: loops.length,
    playbackMode: "loop",
    setNotes,
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
  const holdMs = 8200;
  const transitionMs = 650;
  const clipBudget = Math.ceil(TARGET_SECONDS / ((holdMs + transitionMs) / 1000));

  const outputs = [];

  function writeManifest(manifest, fileName) {
    const outPath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    outputs.push({
      set: manifest.setName,
      loops: manifest.loops.length,
      path: toPosix(path.relative(PROJECT_ROOT, outPath))
    });
  }

  const inf = buildInfinitestreamsJourneyManifest(clipBudget);
  writeManifest(inf, "set-infinitestreams-journey.json");

  if (!fs.existsSync(DATASET_PATH)) {
    console.warn(`[creative-setlists] Skip color arcs: missing ${DATASET_PATH} (run npm run build:color:dataset)`);
  } else {
    const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, "utf8"));
    const tagIndex = dataset.tagIndex && typeof dataset.tagIndex === "object" ? dataset.tagIndex : {};

    const arcPathsRaw = collectColorArcLoops(tagIndex, clipBudget);
    const arcPaths = repeatToLength(arcPathsRaw, clipBudget);
    const arcLoops = loopsFromAbsolutePaths(arcPaths, holdMs, transitionMs);
    const arcManifest = {
      setName: "set-color-red-diffusion-roundtrip",
      sourceDirectory: "loops",
      generatedAt: new Date().toISOString(),
      count: arcLoops.length,
      playbackMode: "loop",
      setNotes: "Hue arc: warm reds → spectrum → gray (diffusion/neutral) → back toward red. Tags from color-dataset.json.",
      effectTimeline: {
        enabled: true,
        phases: parseEffectPhases(
          "classic:14,gray-scott:26,physarum:18,gray-scott:26,kuramoto:14,classic:14,gray-scott:20,life:14"
        )
      },
      defaultTransition: {
        type: "fade",
        durationMs: transitionMs,
        holdMs
      },
      loops: arcLoops
    };
    writeManifest(arcManifest, "set-color-red-diffusion-roundtrip.json");

    const purpleTealTags = [
      "purple",
      "purple-magenta",
      "magenta",
      "cyan",
      "blue-cyan",
      "cyan-blue",
      "blue"
    ].filter((t) => tagIndex[t]);
    const ptPathsRaw = collectTaggedLoops(tagIndex, purpleTealTags, clipBudget);
    const ptPaths = repeatToLength(ptPathsRaw, clipBudget);
    const ptLoops = loopsFromAbsolutePaths(ptPaths, holdMs, transitionMs);
    const ptManifest = {
      setName: "set-color-purple-teal-arc",
      sourceDirectory: "loops",
      generatedAt: new Date().toISOString(),
      count: ptLoops.length,
      playbackMode: "loop",
      setNotes: "Cool chromatic arc: purple / magenta / teal-cyan family clips from color tags.",
      effectTimeline: {
        enabled: true,
        phases: parseEffectPhases(
          "classic:16,kuramoto:18,physarum:18,molecule:16,word-cloud:14,stacked:18"
        )
      },
      defaultTransition: {
        type: "fade",
        durationMs: transitionMs,
        holdMs
      },
      loops: ptLoops
    };
    writeManifest(ptManifest, "set-color-purple-teal-arc.json");

    const warmManifest = buildTaggedColorManifest({
      setName: "set-color-warm-spectrum",
      setNotes: "Warm arc: red / orange / yellow tagged clips from color-dataset.json.",
      effectPhases:
        "classic:14,physarum:18,kuramoto:14,gray-scott:20,molecule:16,classic:14,kuramoto:16",
      tagIndex,
      tagOrder: [
        "red",
        "red-orange",
        "orange",
        "orange-yellow",
        "yellow",
        "orange-red",
        "yellow-orange",
        "magenta",
        "red-magenta"
      ],
      clipBudget,
      holdMs,
      transitionMs
    });
    if (warmManifest) writeManifest(warmManifest, "set-color-warm-spectrum.json");

    const forestManifest = buildTaggedColorManifest({
      setName: "set-color-forest-cyan",
      setNotes: "Verdant / aqua arc: green and cyan family clips from color tags.",
      effectPhases:
        "classic:14,life:16,gray-scott:22,physarum:18,classic:14,kuramoto:16,hierarchical-life:14",
      tagIndex,
      tagOrder: [
        "green",
        "yellow-green",
        "green-yellow",
        "cyan",
        "cyan-green",
        "green-cyan",
        "cyan-blue",
        "blue-cyan",
        "yellow"
      ],
      clipBudget,
      holdMs,
      transitionMs
    });
    if (forestManifest) writeManifest(forestManifest, "set-color-forest-cyan.json");

    const monoManifest = buildTaggedColorManifest({
      setName: "set-color-monochrome-film",
      setNotes: "Monochrome keyed clips: gray, black, white (and composites) from color tags.",
      effectPhases:
        "stacked:16,gray-scott:20,rewrite:14,classic:14,word-cloud:12,molecule:14",
      tagIndex,
      tagOrder: [
        "gray",
        "white",
        "black",
        "gray-black",
        "gray-white",
        "white-gray",
        "black-gray",
        "black-white",
        "white-black"
      ],
      clipBudget,
      holdMs,
      transitionMs
    });
    if (monoManifest) writeManifest(monoManifest, "set-color-monochrome-film.json");
  }

  const morphClarafi = buildStandardManifest({
    name: "set-sample-morpholib-clarafi",
    dirs: ["loops/morpholib", "loops/clarafi"],
    effectPhases:
      "classic:16,molecule:18,kuramoto:16,physarum:20,rewrite:14,classic:14,gray-scott:22,life:14"
  }, clipBudget);
  morphClarafi.setNotes =
    "Tight reel: morphology + explanatory science clips only (loops/morpholib · loops/clarafi).";

  const reactionsLab = buildStandardManifest({
    name: "set-sample-reactions-lab",
    dirs: [
      "loops/reactions/betse",
      "loops/reactions/cell-image-library",
      "loops/reactions/nikon-smallworld",
      "loops/reactions"
    ],
    effectPhases:
      "gray-scott:20,physarum:18,classic:14,word-cloud:14,molecule:16,kuramoto:14,classic:14"
  }, clipBudget);
  reactionsLab.setNotes =
    "Microscopy / reaction-diffusion weighted pool (betse, cell-image-library, Nikon Small World, loops/reactions).";

  if (morphClarafi.loops.length > 0) {
    writeManifest(morphClarafi, "set-sample-morpholib-clarafi.json");
  } else {
    console.warn(
      "[creative-setlists] Skip set-sample-morpholib-clarafi (no clips under loops/morpholib · clarafi)"
    );
  }

  if (reactionsLab.loops.length > 0) {
    writeManifest(reactionsLab, "set-sample-reactions-lab.json");
  } else {
    console.warn(
      "[creative-setlists] Skip set-sample-reactions-lab (no clips under loops/reactions*)"
    );
  }

  console.log(JSON.stringify({
    targetHoursPerSet: TARGET_HOURS,
    clipBudget,
    outputs
  }, null, 2));
}

main();
