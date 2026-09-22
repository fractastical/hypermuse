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
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
const allFixes = [];
for (const line of readFileSync(trackPath, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  if (!row || !Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lon))) continue;
  const fix = { t: row.t, ms: new Date(row.t).getTime(), lat: Number(row.lat), lon: Number(row.lon) };
  allFixes.push(fix);
  const day = dayOf(row.t);
  if (onlyDay && day !== onlyDay) continue;
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push(fix);
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

// How close two fixes have to be to count as the same place. The log's median step is
// four metres at two-second intervals, which is a parked car's GPS wandering rather than
// a car moving, so anything under about a block is one spot.
const PLACE_RADIUS_M = 120;

/**
 * The day as a sequence of visits rather than a line.
 *
 * This is what the fixes actually are. They arrive in dense bursts a few metres wide —
 * on 28 August all forty-nine of them sit inside forty-one metres across six hours — and
 * then jump a kilometre to the next burst with nothing logged in between. Joining them
 * in order drew a scribble at every stop and an invented road between them, which is the
 * fragmentation you can see: clusters of line that never connect, because the travel
 * between the clusters was never recorded.
 */
function visitsFrom(fixes) {
  const visits = [];
  let current = null;
  for (const fix of fixes) {
    if (current && metres(current, fix) <= PLACE_RADIUS_M) {
      current.n += 1;
      // Running mean, so a long stay's centre is where it mostly sat rather than where
      // it first arrived.
      current.lon += (fix.lon - current.lon) / current.n;
      current.lat += (fix.lat - current.lat) / current.n;
      current.end = fix.t;
      continue;
    }
    current = { lon: fix.lon, lat: fix.lat, n: 1, start: fix.t, end: fix.t };
    visits.push(current);
  }
  return visits;
}

/** Visits collapsed onto geography, so coming back twice draws one circle, not two. */
function placesFrom(visits) {
  const places = [];
  for (const visit of visits) {
    const seconds = (new Date(visit.end) - new Date(visit.start)) / 1000;
    const hit = places.find((p) => metres(p, visit) <= PLACE_RADIUS_M);
    if (hit) {
      hit.seconds += seconds;
      hit.visits += 1;
      continue;
    }
    places.push({ lon: visit.lon, lat: visit.lat, seconds, visits: 1, first: visit.start });
  }
  return places;
}

/** Andrew's monotone chain, for the faint outline of the ground a day covered. */
function hull(points) {
  if (points.length < 3) return [];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// A shot can be pinned only when the track knows where the car was at that minute.
// Within twenty minutes of a fix, it had not had time to be somewhere else. Across a
// longer quiet stretch it can still be pinned when the fix before it and the fix after
// it are the same spot — the logger slept, the car did not leave. A photograph taken
// in the middle of a move that was never logged is left off the map: the nearest fix
// would be a confident-looking lie.
const NEAR_MS = 20 * 60 * 1000;
const SAME_SPOT_M = 120;
const photosDir = join(repo, "assets", "hermes-annals", "photos");
const curationPath = join(repo, "data", "hermes", "annals-curation.json");

function zonedToMs(y, mo, d, h, mi, s) {
  let guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(new Date(guess));
  const n = (type) => Number(parts.find((p) => p.type === type).value);
  const shown = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return guess - (shown - guess);
}

function wallClock(ms) {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

function stillTaken(file) {
  try {
    const out = execFileSync("sips", ["-g", "creation", file], { encoding: "utf8" });
    const found = out.match(/creation:\s*(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!found) return null;
    // EXIF is the camera's own clock, which on this trip was already playa time, and it
    // carries no zone. Read the numbers as playa local and turn them into an instant.
    const [y, mo, d, h, mi, s] = found.slice(1).map(Number);
    return zonedToMs(y, mo, d, h, mi, s);
  } catch {
    return null;
  }
}

function videoTaken(file) {
  try {
    const out = execFileSync("ffprobe", ["-v", "quiet", "-show_entries", "format_tags", "-of", "json", file],
      { encoding: "utf8" });
    const tags = JSON.parse(out).format?.tags || {};
    // creationdate is the camera's local time. creation_time on a re-export is the
    // export, which can be a week after the shot, so it is not used.
    let raw = tags["com.apple.quicktime.creationdate"];
    if (!raw) return null;
    raw = String(raw).trim();
    if (/[+-]\d{4}$/.test(raw)) raw = raw.slice(0, -2) + ":" + raw.slice(-2);
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function originalVideo(stem) {
  if (!existsSync(photosDir)) return null;
  for (const name of readdirSync(photosDir)) {
    if (name.startsWith(stem + ".") && /\.(mov|mp4|m4v)$/i.test(name)) return join(photosDir, name);
  }
  return null;
}

/** Published shots whose minute can be stood on the track. Keyed by the page's filename. */
function shotsOnTrack(fixes) {
  const curation = existsSync(curationPath) ? JSON.parse(readFileSync(curationPath, "utf8")).publish || {} : {};
  const placed = {};
  const sorted = [...fixes].sort((a, b) => a.ms - b.ms);
  for (const [src, mark] of Object.entries(curation)) {
    if (!mark || mark.publish === false || mark.explicit) continue;
    const file = join(repo, src);
    if (!existsSync(file)) continue;
    const day = (src.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
    if (!day) continue;
    const stem = basename(src).replace(/\.[^.]+$/, "");
    const video = /\.(mp4|mov|m4v)$/i.test(src);
    const taken = video ? videoTaken(originalVideo(stem) || file) : stillTaken(file);
    if (!taken || !sorted.length || taken < sorted[0].ms || taken > sorted[sorted.length - 1].ms) continue;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].ms < taken) lo = mid + 1;
      else hi = mid;
    }
    const next = sorted[Math.min(lo, sorted.length - 1)];
    const prev = sorted[Math.max(lo - 1, 0)];
    const nearer = Math.abs(taken - prev.ms) <= Math.abs(next.ms - taken) ? prev : next;
    const sameSpot = prev !== next && metres(prev, next) <= SAME_SPOT_M;
    if (Math.abs(taken - nearer.ms) > NEAR_MS && !sameSpot) continue;
    const at = nearer;
    const ext = video ? ".mp4" : ".jpg";
    placed[`${day}-${stem}${ext}`] = {
      day: dayOf(taken),
      clock: wallClock(taken),
      ms: taken,
      lat: at.lat,
      lon: at.lon
    };
  }
  return placed;
}

const spell = (seconds) => {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return "a moment";
  if (mins < 60) return mins + " min";
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? hours + " h " + rest + " min" : hours + " h";
};

function mapFor(day, fixes) {
  fixes.sort((a, b) => new Date(a.t) - new Date(b.t));
  const visits = visitsFrom(fixes);
  const places = placesFrom(visits).map((p) => ({ ...p, ...screen(p.lon, p.lat) }));
  const route = visits.map((v) => ({ ...v, ...screen(v.lon, v.lat) }));

  // The ground the day covered, as one soft shape. This is the "roughly here" the stops
  // and the arcs between them only imply.
  const ring = hull(places);
  const area = ring.length >= 3
    ? `<path d="${ring.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")} Z" ` +
      `fill="#ff9d3d" opacity="0.07" stroke="#ff9d3d" stroke-opacity="0.22" stroke-width="2" ` +
      `stroke-linejoin="round"/>`
    : "";

  // One arc per move, curved and dashed. The route between two stops was never logged,
  // so a straight solid line would claim a road it does not know about; a dashed curve
  // reads as "it got from here to there" and says nothing about how.
  const moves = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const span = Math.sqrt(dx * dx + dy * dy);
    if (span < 12) continue;
    // Control point pushed off the midpoint, always the same way round, so a day of
    // moves looks deliberate rather than randomly wobbly.
    const cx = (a.x + b.x) / 2 - dy * 0.14;
    const cy = (a.y + b.y) / 2 + dx * 0.14;
    moves.push(`<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}" ` +
      `fill="none" stroke="#ff9d3d" stroke-width="2.4" stroke-dasharray="7 6" opacity="0.72" stroke-linecap="round"/>`);
  }

  // Sized by how long it stayed, square-rooted so six hours is bigger than ten minutes
  // without being thirty-six times bigger, and clamped so a brief stop is still visible.
  const radius = (seconds) => Math.max(5, Math.min(26, 5 + Math.sqrt(seconds / 60) * 1.7));
  const stops = places.map((p) =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${radius(p.seconds).toFixed(1)}" ` +
    `fill="#ffd166" fill-opacity="0.34" stroke="#ffd166" stroke-width="2"/>`
  ).join("\n");

  // Haloed, because these sit wherever the day happened to go — which is often right on
  // top of the Man's own label.
  const label = (p, text, dy, size = 19) =>
    `<text x="${(p.x + 12).toFixed(1)}" y="${(p.y + dy).toFixed(1)}" font-size="${size}" ` +
    `font-family="Menlo, monospace" stroke="#06090f" stroke-width="4" paint-order="stroke" ` +
    `fill="rgba(255,255,255,0.94)">${text}</text>`;

  // Only the longest few get a duration, or a busy day becomes a wall of text.
  const named = [...places].sort((a, b) => b.seconds - a.seconds).slice(0, 3)
    .filter((p) => p.seconds >= 600)
    .map((p) => label(p, spell(p.seconds), -radius(p.seconds) - 8))
    .join("\n");

  // Shots taken while this day's track knows where the car was. Several frames from
  // one stop become one mark, or the map grows a stack of the same minute.
  const marks = Object.values(shotPlaces).filter((s) => s.day === day)
    .map((s) => ({ ...s, ...screen(s.lon, s.lat) }))
    .sort((a, b) => a.ms - b.ms);
  const clusters = [];
  for (const shot of marks) {
    const hit = clusters.find((c) => Math.hypot(c.x - shot.x, c.y - shot.y) < 24);
    if (hit) {
      hit.x = (hit.x * hit.n + shot.x) / (hit.n + 1);
      hit.y = (hit.y * hit.n + shot.y) / (hit.n + 1);
      hit.n += 1;
      hit.end = shot.clock;
      continue;
    }
    clusters.push({ x: shot.x, y: shot.y, n: 1, start: shot.clock, end: shot.clock });
  }
  // To the left of the mark. Stop durations and the day's first and last clocks sit to
  // the right, and on the scaled map a small offset still lands on top of them.
  for (const c of clusters) {
    const text = c.start === c.end ? c.start
      : (c.start.slice(-2) === c.end.slice(-2) ? c.start.slice(0, -3) + "–" + c.end : c.start + "–" + c.end);
    c.text = text;
    const width = text.length * 9.2;
    c.lx = c.x - width - 22;
    c.ly = c.y + 4;
    if (c.lx < 8) {
      c.lx = c.x + 14;
      c.ly = c.y + 40;
    }
  }
  clusters.sort((a, b) => a.ly - b.ly || a.lx - b.lx);
  for (let i = 1; i < clusters.length; i++) {
    const prev = clusters[i - 1];
    if (Math.abs(clusters[i].lx - prev.lx) < 120 && clusters[i].ly - prev.ly < 18) clusters[i].ly = prev.ly + 18;
  }
  const shotLabel = (c) =>
    `<text x="${c.lx.toFixed(1)}" y="${c.ly.toFixed(1)}" font-size="15" ` +
    `font-family="Menlo, monospace" stroke="#06090f" stroke-width="4" paint-order="stroke" ` +
    `fill="#7fd4ff">${c.text}</text>`;
  const shotDots = clusters.map((c) =>
    `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="5.5" fill="#7fd4ff" stroke="#06090f" stroke-width="1.6"/>\n` +
    shotLabel(c)
  ).join("\n");

  const first = route[0];
  const last = route[route.length - 1];
  // Only the day. The streets are one shared file the page puts underneath, because
  // inlining them here meant eleven copies of the same 112 KB of roads. The viewBox
  // matches the base exactly, so stacking the two at any width lines them up.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="0 0 ${meta.width} ${meta.height}">
${area}
${moves.join("\n")}
${stops}
<circle cx="${first.x.toFixed(1)}" cy="${first.y.toFixed(1)}" r="5" fill="#7dffa8"/>
${route.length > 1 ? `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="5" fill="#ff5c7a"/>` : ""}
${named}
${label(first, clock(first.start), 26)}
${route.length > 1 ? label(last, clock(last.end), 26) : ""}
${shotDots}
</svg>
`;
}

const shotPlaces = shotsOnTrack(allFixes);
const shotCount = Object.keys(shotPlaces).length;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "shot-marks.json"), JSON.stringify(shotPlaces, null, 2) + "\n");
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
  const visits = visitsFrom([...fixes].sort((a, b) => new Date(a.t) - new Date(b.t)));
  const places = placesFrom(visits);
  const longest = places.reduce((best, p) => (p.seconds > best ? p.seconds : best), 0);
  console.log("  " + day + "  " + String(fixes.length).padStart(3) + " fixes -> " +
    String(places.length).padStart(2) + " place(s), " + String(visits.length - 1).padStart(2) +
    " move(s), longest stay " + spell(longest).padEnd(9) + " " + (size / 1024).toFixed(1) + " KB");
}
console.log("\n  " + shotCount + " shot(s) placed on the track, the rest left off — taken while nothing was logging");
console.log("  " + byDay.size + " overlay(s) + the base map in " + outDir.replace(repo + "/", "") +
  "  (" + (bytes / 1024).toFixed(0) + " KB of track, " +
  (statSync(join(outDir, "playa-streets.svg")).size / 1024).toFixed(0) + " KB of streets shared)");
