#!/usr/bin/env node
/**
 * Build a manifest where each immediate subfolder under a root folder (e.g. loops/)
 * defines one loop-group id `${root}/${child}` for every clip found inside it (recursive).
 *
 * Usage:
 *   node scripts/build-folder-subloops-manifest.mjs [rootDir=out:sets/file.json]
 * Env:
 *   FOLDER_LOOP_ROOT=loops
 *   OUT_JSON=sets/set-loops-subfolders.json
 *   HOLD_MS / TRANS_MS / TRANSITION_TYPE (optional)
 */

import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
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

function parseArgs(argv) {
  let root = process.env.FOLDER_LOOP_ROOT || "loops";
  let outRel = path.join("sets", "set-loops-folder-groups.json");

  const arg1 = argv[2];
  const arg2 = argv[3];
  if (arg1 && !arg1.includes("=")) {
    root = arg1.trim();
    if (arg2) {
      outRel = arg2;
    }
  } else if (arg1 && arg1.includes("=")) {
    argv.slice(2).forEach((token) => {
      const idx = token.indexOf("=");
      if (idx < 1) return;
      const key = token.slice(0, idx).trim().toLowerCase();
      const val = token.slice(idx + 1).trim();
      if (key === "root") root = val;
      if (key === "out") outRel = val;
    });
  }

  if (process.env.OUT_JSON) {
    outRel = process.env.OUT_JSON;
  }

  return { rootRel: root.replace(/^\/+|\/+$/g, ""), outPath: path.resolve(PROJECT_ROOT, outRel) };
}

function collectVideosInTree(dirAbs) {
  if (!fs.existsSync(dirAbs)) {
    return [];
  }
  const out = [];
  const walk = (d) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(ent.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) continue;
      out.push(full);
    }
  };
  walk(dirAbs);
  return out.sort((a, b) => a.localeCompare(b));
}

const DEFAULT_HOLD_MS = Number.parseInt(process.env.HOLD_MS || "8500", 10);
const DEFAULT_TRANSITION_MS = Number.parseInt(process.env.TRANS_MS || "900", 10);
const DEFAULT_TRANSITION_TYPE = process.env.TRANSITION_TYPE || "fade";

const { rootRel, outPath } = parseArgs(process.argv);
const absRoot = path.join(PROJECT_ROOT, rootRel);
if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
  console.error(`Root is not a directory: ${rootRel}`);
  process.exit(1);
}

const subdirs = fs.readdirSync(absRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort((a, b) => a.localeCompare(b));

const loops = [];

for (const child of subdirs) {
  const groupId = `${toPosix(rootRel)}/${child}`;
  const childAbs = path.join(absRoot, child);
  const clips = collectVideosInTree(childAbs);
  const labelFriendly = `${child}`;
  clips.forEach((absClip) => {
    const url = toPosix(path.relative(PROJECT_ROOT, absClip));
    loops.push({
      url,
      label: path.basename(absClip),
      loopGroup: groupId,
      loopGroupLabel: labelFriendly,
      transition: {
        type: DEFAULT_TRANSITION_TYPE,
        durationMs: DEFAULT_TRANSITION_MS,
        holdMs: DEFAULT_HOLD_MS
      }
    });
  });
}

const preset = {
  setName: `folder-groups:${rootRel}`,
  sourceDirectories: subdirs.map((c) => `${toPosix(rootRel)}/${c}`),
  generatedAt: new Date().toISOString(),
  count: loops.length,
  playbackMode: "pingpong",
  defaultTransition: {
    type: DEFAULT_TRANSITION_TYPE,
    durationMs: DEFAULT_TRANSITION_MS,
    holdMs: DEFAULT_HOLD_MS
  },
  loops
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(preset, null, 2));
console.log(`Wrote ${loops.length} clips in ${subdirs.length} folder-groups → ${toPosix(path.relative(PROJECT_ROOT, outPath))}`);
