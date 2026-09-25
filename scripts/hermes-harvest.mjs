#!/usr/bin/env node
// Takes everything the Alpha wrote down while it was on its own and puts it in
// the track log.
//
//   npm run hermes:harvest
//   npm run hermes:harvest -- --dry
//   npm run hermes:harvest -- --from=/tmp/gpx --since=2026-08-25
//
// The handheld will not record and talk at the same time. Plugged in it flushes
// its files once and then freezes them — the same object id, the same byte count,
// minutes apart, while the collar it is listening to is in a moving vehicle — so
// nothing can read a live position out of it over USB. Unplugged it logs
// faithfully, and hands the whole lot over on the next connection.
//
// So it is a recorder rather than a feed, and this is the harvest. Phones cover
// live position; this covers the miles nobody was watching, which is most of them
// and the part the story is made of. The live log had eighteen points for a day
// the collar had recorded forty-two and the handheld two hundred.
//
// Appends, never rewrites. The server has the same file open and appends to it as
// fixes arrive, and a read-modify-write here would silently drop whatever landed
// in between. Points therefore go in out of order, which is the reading side's
// problem to sort.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const trackPath = process.env.HERMES_TRACK || join(root, "data", "hermes", "track.jsonl");
const dry = process.argv.includes("--dry");
// The handheld's current track is a rolling log, not this week's: ours came back
// with points from July last year still in it. Everything is kept by default,
// because throwing away real fixes is not this script's call to make and the
// reading side segments on time gaps anyway — but --since is here for when you
// want the log to be the event and nothing else.
const from = (process.argv.find((a) => a.startsWith("--from=")) || "").slice(7) || null;
const sinceArg = (process.argv.find((a) => a.startsWith("--since=")) || "").slice(8);
const since = sinceArg ? Date.parse(sinceArg) : null;
if (sinceArg && !Number.isFinite(since)) {
  console.error(`--since=${sinceArg} is not a date I can read`);
  process.exit(1);
}

// What each file on the device is, because the log wants to know which of the two
// GPS receivers a point came from. The collar is the one worth having: its own
// receiver, its own radio, and it keeps running when the handheld is docked.
const FILES = [
  { name: "Dog.gpx", src: "alpha-collar-gpx", what: "collar" },
  { name: "Current.gpx", src: "alpha-handheld-gpx", what: "handheld" }
];

const distanceMeters = (aLat, aLon, bLat, bLon) => {
  const latM = (bLat - aLat) * 111320;
  const lonM = (bLon - aLon) * 111320 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  return Math.hypot(latM, lonM);
};

// Both <trkpt> and <wpt>, self-closing or not: the track logs use trackpoints
// with a time inside each one, and .Position.gpx is a lone self-closing waypoint
// whose only time is in the metadata.
function parseGpx(xml) {
  const points = [];
  const re = /<(wpt|trkpt)\s+lat="([^"]+)"\s+lon="([^"]+)"\s*(\/>|>([\s\S]*?)<\/\1>)/gi;
  for (const m of xml.matchAll(re)) {
    const lat = Number(m[2]);
    const lon = Number(m[3]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const body = m[5] || "";
    const time = (/<time>([^<]+)<\/time>/i.exec(body) || [])[1] || null;
    points.push({ lat, lon, time });
  }
  // A file with one waypoint and no time inside it still has the metadata time,
  // which is when the unit wrote the position down.
  if (points.length === 1 && !points[0].time) {
    points[0].time = (/<time>([^<]+)<\/time>/i.exec(xml) || [])[1] || null;
  }
  return points.filter((p) => p.time);
}

// A mounted unit, if one ever appears. The Alpha 300 never does — it offers one
// vendor-specific MTP interface and nothing else, whatever its USB Mode menu
// claims — but other Garmins do, and reading a file beats driving libmtp.
function mountedGpx(name) {
  let volumes = [];
  try { volumes = readdirSync("/Volumes"); } catch { return null; }
  const rels = [`Garmin/GPX/Current/${name}`, `Garmin/GPX/${name}`, `GPX/${name}`, name];
  for (const volume of volumes) {
    for (const rel of rels) {
      const path = join("/Volumes", volume, rel);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

let mtpIds = null;
async function mtpFiles() {
  if (mtpIds) return mtpIds;
  const { stdout } = await run("mtp-files", [], { maxBuffer: 32 << 20 });
  mtpIds = new Map();
  let pending = null;
  for (const line of stdout.split("\n")) {
    const id = /^File ID:\s*(\d+)/.exec(line.trim());
    if (id) { pending = Number(id[1]); continue; }
    const named = /^Filename:\s*(.+)$/.exec(line.trim());
    if (named && pending != null) { mtpIds.set(named[1].trim(), pending); pending = null; }
  }
  return mtpIds;
}

async function readDeviceFile(name) {
  // A directory of files copied off by hand, which is also how to harvest a
  // connection that has since been unplugged: the pull leaves its copy behind.
  if (from) {
    const path = join(from, name);
    return existsSync(path) ? { xml: readFileSync(path, "utf8"), how: path } : null;
  }
  const mounted = mountedGpx(name);
  if (mounted) return { xml: readFileSync(mounted, "utf8"), how: mounted };
  const ids = await mtpFiles();
  const id = ids.get(name);
  if (id == null) return null;
  const scratch = join(tmpdir(), `hermes-harvest-${name}`);
  try { unlinkSync(scratch); } catch { /* not there */ }
  await run("mtp-getfile", [String(id), scratch]);
  const xml = readFileSync(scratch, "utf8");
  // Object ids are positional and the device renumbers them as it writes, so a
  // read can succeed and hand back whatever slid into the slot.
  if (!/<gpx/i.test(xml)) throw new Error(`MTP object ${id} is not ${name} any more`);
  return { xml, how: `MTP object ${id}` };
}

// What the log already holds, so a harvest can be run as often as you like.
// Keyed on the satellite timestamp, which is the identity of a fix — the same
// point re-read from the device on the next connection is the same point.
function existing() {
  const seen = new Set();
  const points = [];
  if (!existsSync(trackPath)) return { seen, points };
  for (const line of readFileSync(trackPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const point = JSON.parse(line);
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
      points.push(point);
      if (point.gps) seen.add(`${point.src || ""}|${point.gps}`);
    } catch { /* a half-written last line is all an append-only log can break */ }
  }
  return { seen, points };
}

const { seen, points: had } = existing();
const lines = [];
let read = 0;
let device = false;

for (const file of FILES) {
  let got = null;
  try {
    got = await readDeviceFile(file.name);
  } catch (err) {
    console.log(`  ${file.what.padEnd(9)} ${file.name}: ${err.message}`);
    continue;
  }
  if (!got) { console.log(`  ${file.what.padEnd(9)} ${file.name}: not on the device`); continue; }
  device = true;
  const parsed = parseGpx(got.xml);
  read += parsed.length;
  let fresh = 0;
  for (const point of parsed) {
    const stamp = new Date(point.time).toISOString();
    if (since != null && Date.parse(stamp) < since) continue;
    if (seen.has(`${file.src}|${stamp}`)) continue;
    seen.add(`${file.src}|${stamp}`);
    lines.push({
      t: stamp,
      lat: Number(point.lat.toFixed(6)),
      lon: Number(point.lon.toFixed(6)),
      gps: stamp,
      src: file.src
    });
    fresh++;
  }
  console.log(`  ${file.what.padEnd(9)} ${parsed.length} point(s) from ${got.how}, ${fresh} new`);
}

if (!device) {
  console.log("\nNothing to read. Plug the Alpha in — and if it is connected, check");
  console.log("nothing else is holding the MTP session: only one process gets it, so");
  console.log("stop the watcher first (pkill -f alpha-watcher).");
  process.exit(1);
}

if (!lines.length) {
  console.log(`\nNothing new — the log already has all ${read} of them.`);
  process.exit(0);
}

// Sorted on the way in as a courtesy to anything reading the tail, even though
// the file is unordered by construction and readers have to sort anyway.
lines.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
const span = (a, b) => {
  const mins = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
  return mins < 90 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
};
// Distance is only distance within a run of points that belong together. Summed
// straight down a rolling log it counts the drive home from last summer as trail,
// which is how a day at a festival came out as twenty-two thousand kilometres.
const RUN_GAP_MS = 3600000;
let walked = 0;
const runs = [[lines[0]]];
for (let i = 1; i < lines.length; i++) {
  const gap = Date.parse(lines[i].t) - Date.parse(lines[i - 1].t);
  if (gap > RUN_GAP_MS) { runs.push([lines[i]]); continue; }
  walked += distanceMeters(lines[i - 1].lat, lines[i - 1].lon, lines[i].lat, lines[i].lon);
  runs[runs.length - 1].push(lines[i]);
}
console.log(`\n${lines.length} new point(s) in ${runs.length} run(s), about ${(walked / 1000).toFixed(1)}km of trail`);
for (const r of runs) {
  const a = r[0].t, b = r[r.length - 1].t;
  console.log(`  ${a.slice(0, 16).replace("T", " ")}  ${String(r.length).padStart(4)} point(s)  ${span(a, b)}`);
}
console.log(`log was ${had.length} point(s), would be ${had.length + lines.length}`);

if (dry) {
  console.log("\n--dry, nothing written.");
  process.exit(0);
}
mkdirSync(dirname(trackPath), { recursive: true });
appendFileSync(trackPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
console.log(`appended to ${trackPath}`);
