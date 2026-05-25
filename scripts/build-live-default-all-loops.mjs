#!/usr/bin/env node
/**
 * Regenerate sets/set-live-default-all-loops.json from every immediate subfolder
 * under loops/, interleaving clips so the live controller can toggle each folder.
 *
 * Usage: node scripts/build-live-default-all-loops.mjs
 */

import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const LOOPS_ROOT = "loops";
const OUT_PATH = path.join(PROJECT_ROOT, "sets/set-live-default-all-loops.json");
const TEMPLATE_PATH = OUT_PATH;

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"
]);

const DEFAULT_HOLD_MS = 8500;
const DEFAULT_TRANSITION_MS = 900;
const DEFAULT_TRANSITION_TYPE = "fade";

function toPosix(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function collectVideosInTree(dirAbs) {
  if (!fs.existsSync(dirAbs)) return [];
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
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

function interleaveQueues(queues) {
  const lists = queues.map((q) => q.slice());
  const merged = [];
  while (true) {
    let pushed = false;
    for (let i = 0; i < lists.length; i++) {
      if (lists[i].length === 0) continue;
      merged.push(lists[i].shift());
      pushed = true;
    }
    if (!pushed) break;
  }
  return merged;
}

function loadTemplate() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

const absRoot = path.join(PROJECT_ROOT, LOOPS_ROOT);
if (!fs.existsSync(absRoot)) {
  console.error(`Missing ${LOOPS_ROOT}/ directory`);
  process.exit(1);
}

const subdirs = fs.readdirSync(absRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort((a, b) => a.localeCompare(b));

const perFolder = [];
const loopGroupLabels = {};
const sourceDirectories = [];

for (const child of subdirs) {
  const groupId = `${LOOPS_ROOT}/${child}`;
  const childAbs = path.join(absRoot, child);
  const clips = collectVideosInTree(childAbs);
  if (clips.length === 0) continue;

  sourceDirectories.push(groupId);
  loopGroupLabels[groupId] = child;

  const folderLoops = clips.map((absClip) => ({
    abs: absClip,
    url: toPosix(path.relative(PROJECT_ROOT, absClip)),
    label: path.basename(absClip),
    loopGroup: groupId,
    loopGroupLabel: child,
    transition: {
      type: DEFAULT_TRANSITION_TYPE,
      durationMs: DEFAULT_TRANSITION_MS,
      holdMs: DEFAULT_HOLD_MS
    }
  }));
  perFolder.push(folderLoops);
}

const interleaved = interleaveQueues(perFolder);
const loops = interleaved.map(({ url, label, loopGroup, loopGroupLabel, transition }) => ({
  url,
  label,
  loopGroup,
  loopGroupLabel,
  transition
}));

const template = loadTemplate();
const manifest = {
  ...template,
  setName: template.setName || "mixed-loops",
  sourceDirectory: sourceDirectories[0] || `${LOOPS_ROOT}/cells1`,
  sourceDirectories,
  generatedAt: new Date().toISOString(),
  count: loops.length,
  playbackMode: template.playbackMode || "pingpong",
  folderLoopRoot: LOOPS_ROOT,
  loopGroupLabels,
  defaultTransition: template.defaultTransition || {
    type: DEFAULT_TRANSITION_TYPE,
    durationMs: DEFAULT_TRANSITION_MS,
    holdMs: DEFAULT_HOLD_MS
  },
  loops
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Wrote ${loops.length} clips across ${sourceDirectories.length} loop folders → ${toPosix(path.relative(PROJECT_ROOT, OUT_PATH))}`
);
