#!/usr/bin/env node
// One map per day: where Hermes went, drawn over the city.
//
//   npm run hermes:annals:maps
//   npm run hermes:annals:maps -- --day 2026-09-03
//
// The projection is not recomputed here. scripts/build-hermes-map.mjs wrote the base
// map and left its origin, rotation, bounds, scale and offset in the metadata beside
// it, so reading those back is the only way an overlay is guaranteed to sit on the
// streets rather than near them.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const mapDir = join(repo, "data", "hermes", "2026", "map");
const metaPath = join(mapDir, "playa-streets-metadata.json");
const basePath = join(mapDir, "playa-streets.svg");
const trackPath = process.env.HERMES_TRACK || join(repo, "data", "hermes", "track.jsonl");
const outDir = join(repo, "artifacts", "hermes-annals", "maps");

const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const onlyDay = arg("day", "");
const TZ = process.env.HERMES_TZ || "America/Los_Angeles";

for (const needed of [metaPath, basePath, trackPath]) {
  if (!existsSync(needed)) {
    console.error("missing " + needed.replace(repo + "/", ""));
    if (needed === basePath || needed === metaPath) console.error("run: node scripts/build-hermes-map.mjs");
    process.exit(1);
  }
}

const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const LAT_SCALE = 111320;
const LON_SCALE = Math.cos(meta.origin.lat * Math.PI / 180) * 111320;
const COS_R = Math.cos(meta.rotation);
const SIN_R = Math.sin(meta.rotation);

/** The same screen() the base map was drawn with, rebuilt from what it recorded. */
function screen(lon, lat) {
  const rx = (lon - meta.origin.lon) * LON_SCALE;
  const ry = (lat - meta.origin.lat) * LAT_SCALE;
  const x = rx * COS_R - ry * SIN_R;
  const y = rx * SIN_R + ry * COS_R;
  return {
    x: meta.offset.x + (x - meta.bounds.minX) * meta.scale,
    y: meta.offset.y + (meta.bounds.maxY - y) * meta.scale
  };
}

const dayOf = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });
const clock = (t) => new Date(t).toLocaleTimeString("en-US",
  { timeZone: TZ, hour: "numeric", minute: "2-digit" });

const byDay = new Map();
for (const line of readFileSync(trackPath, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  if (!row || !Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lon))) continue;
  const day = dayOf(row.t);
  if (onlyDay && day !== onlyDay) continue;
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push({ t: row.t, lat: Number(row.lat), lon: Number(row.lon) });
}

if (byDay.size === 0) {
  console.error(onlyDay ? "no fixes on " + onlyDay : "no fixes in " + trackPath);
  process.exit(1);
}

const metres = (a, b) => {
  const dx = (b.lon - a.lon) * LON_SCALE;
  const dy = (b.lat - a.lat) * LAT_SCALE;
  return Math.sqrt(dx * dx + dy * dy);
};

function mapFor(day, fixes) {
  fixes.sort((a, b) => new Date(a.t) - new Date(b.t));
  const points = fixes.map((f) => ({ ...f, ...screen(f.lon, f.lat) }));
  // A gap of more than a few hundred metres between consecutive fixes is the tracker
  // having been off, not a drive. Joining those would draw a road that never existed,
  // so the line breaks into separate strokes instead.
  const runs = [];
  let run = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (metres(fixes[i - 1], fixes[i]) > 400) {
      runs.push(run);
      run = [];
    }
    run.push(points[i]);
  }
  runs.push(run);

  const strokes = runs.filter((r) => r.length > 1).map((r) =>
    `<path d="${r.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")}" ` +
    `fill="none" stroke="#ff9d3d" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`
  ).join("\n");
  // Where it stood still shows as nothing on a line, so every fix gets a faint dot:
  // a cluster of them is a stop, and on a day of five fixes it is all there is.
  const dots = points.map((p) =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.1" fill="#ffd166" opacity="0.5"/>`
  ).join("");
  const first = points[0];
  const last = points[points.length - 1];
  // Haloed, because these sit wherever the day happened to start and stop — which is
  // often right on top of the Man's own label.
  const label = (p, text, dy) =>
    `<text x="${(p.x + 12).toFixed(1)}" y="${(p.y + dy).toFixed(1)}" font-size="20" ` +
    `font-family="Menlo, monospace" stroke="#06090f" stroke-width="4" paint-order="stroke" ` +
    `fill="rgba(255,255,255,0.94)">${text}</text>`;

  // Only the track. The streets are one shared file the page puts underneath, because
  // inlining them here meant eleven copies of the same 112 KB of roads. The viewBox
  // matches the base exactly, so stacking the two at any width lines them up.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="0 0 ${meta.width} ${meta.height}">
${strokes}
${dots}
<circle cx="${first.x.toFixed(1)}" cy="${first.y.toFixed(1)}" r="7" fill="#7dffa8"/>
<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="7" fill="#ff5c7a"/>
${label(first, clock(first.t), -12)}
${label(last, clock(last.t), 24)}
</svg>
`;
}

mkdirSync(outDir, { recursive: true });
// The base goes next to the overlays so the two travel together and the publisher has
// one folder to copy. Left as svg: it is 112 KB, and it is a line drawing, which is
// the case where svg both looks better and weighs less than a raster of it.
copyFileSync(basePath, join(outDir, "playa-streets.svg"));

let bytes = 0;
for (const [day, fixes] of [...byDay.entries()].sort()) {
  const svgPath = join(outDir, day + ".track.svg");
  writeFileSync(svgPath, mapFor(day, fixes));
  const size = statSync(svgPath).size;
  bytes += size;
  console.log("  " + day + "  " + String(fixes.length).padStart(3) + " fixes  " +
    (size / 1024).toFixed(1) + " KB");
}
console.log("\n  " + byDay.size + " overlay(s) + the base map in " + outDir.replace(repo + "/", "") +
  "  (" + (bytes / 1024).toFixed(0) + " KB of track, " +
  (statSync(join(outDir, "playa-streets.svg")).size / 1024).toFixed(0) + " KB of streets shared)");
