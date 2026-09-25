#!/usr/bin/env node
// Feeds the Alpha's own GPS into the hermes server, so the overlay draws where
// the car actually is instead of the seed position it boots with.
//
//   node scripts/hermes-alpha-watcher.mjs          # keep posting
//   node scripts/hermes-alpha-watcher.mjs --once   # one read, for diagnosis
//
// Three ways in, tried in this order every poll, because the handheld presents
// itself differently depending on which USB mode it is in and the mode can be
// changed on the device while this is running:
//
// 1. `.Position.gpx` on a mounted volume. This is the live position — the unit
//    rewrites it every second or so with where it is *now* — and it is the only
//    source worth having. Needs USB Mode set to Mass Storage on the device
//    (Setup > System > USB Mode), which makes it appear under /Volumes.
// 2. The current track log on a mounted volume. A log, so its last point is
//    where the unit last recorded, which is only where it is now if recording is
//    on and it has sky view.
// 3. The track log over MTP. macOS does not mount MTP at all, so the file has to
//    be pulled with libmtp (brew install libmtp) on every poll. Slow, one
//    session at a time, and libmtp does not recognise the Alpha's USB ID, so it
//    wedges easily — a last resort rather than a way to run a show.
//
// The distinction matters and is reported rather than smoothed over: a track log
// that stopped four hours ago will happily answer every poll with a four hour old
// position, and posting that as if it were current is how a stale dot on the map
// gets believed. The fix's own timestamp goes up with it either way, so the panel
// can say how old it is.
import { readFile, unlink } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

const positionPath = process.env.ALPHA_POSITION_PATH || "";
const hermesUrl = process.env.HERMES_URL || "http://127.0.0.1:8124/api/location";
// Live position first, track log second — the same order as the mounted case, and
// for the same reason. It used to be the other way round, which meant that on a
// unit offering both, every poll fetched the log: a position frozen at the moment
// the cable went in, reported for hours as if it were current.
const mtpNames = (process.env.ALPHA_MTP_FILE || ".Position.gpx,Current.gpx").split(",");

// What the three files the Alpha exposes over MTP actually are. Dog.gpx is the
// collar, and the collar is the one GPS in the system that does not stop when the
// handheld goes into transfer mode — its receiver and its radio are its own, so
// the handheld is only listening. Not in the default list: pointing at it is a
// deliberate choice, because it tracks the dog rather than the car. Sources with
// "track" in the name are logs, which only gain a point on movement — the overlay
// keys on that to tell a parked vehicle from a broken feed.
const MTP_FILES = {
  ".Position.gpx": { live: true, source: "alpha-mtp-position", what: "live position over MTP" },
  "Dog.gpx": { live: false, source: "alpha-collar-track", what: "collar track over MTP" },
  "Current.gpx": { live: false, source: "alpha-mtp-track", what: "track log over MTP" }
};
const describe = (name) =>
  MTP_FILES[name] || { live: false, source: "alpha-mtp-track", what: `${name} over MTP` };
const accuracyM = Number(process.env.ALPHA_ACCURACY_M || 10);
const staleSec = Number(process.env.ALPHA_STALE_S || 120);
const once = process.argv.includes("--once");
const scratch = join(tmpdir(), "hermes-alpha-position.gpx");

// Where a Garmin keeps its position when it is mounted. The live file first: the
// track log is a fallback and says so.
const MOUNT_CANDIDATES = [
  { rel: ".Position.gpx", live: true, what: "live position" },
  { rel: "Garmin/GPX/Current/Current.gpx", live: false, what: "track log" },
  { rel: "Garmin/GPX/Current.gpx", live: false, what: "track log" },
  { rel: "GPX/Current.gpx", live: false, what: "track log" }
];

// Worked out every poll rather than once at startup, so switching the device's
// USB mode — which is the fix for a stale track log — is picked up without
// restarting this.
function findSource() {
  if (positionPath && existsSync(positionPath)) {
    const live = /\.Position\.gpx$/i.test(positionPath);
    return { kind: "file", path: positionPath, live, what: live ? "live position" : "file" };
  }
  let volumes = [];
  try {
    volumes = readdirSync("/Volumes");
  } catch {
    // No /Volumes to read is normal on a machine with nothing mounted.
  }
  for (const volume of volumes) {
    for (const candidate of MOUNT_CANDIDATES) {
      const path = join("/Volumes", volume, candidate.rel);
      // Existence is the whole test: only a Garmin has these, so there is no need
      // to guess at volume names, which differ by model and firmware.
      if (existsSync(path)) return { kind: "file", path, live: candidate.live, what: candidate.what };
    }
  }
  return { kind: "mtp", live: false, what: "track log over MTP" };
}

// Both shapes the Alpha writes: a single waypoint in the position file, or a
// track log, in which case the last trackpoint is where it last recorded.
function parsePosition(xml) {
  const points = [...xml.matchAll(/<(wpt|trkpt)\s+lat="([^"]+)"\s+lon="([^"]+)"([\s\S]*?)<\/\1>/gi)];
  const bare = points.length ? null : /<(?:wpt|trkpt)\s+lat="([^"]+)"\s+lon="([^"]+)"/i.exec(xml);
  const last = points[points.length - 1];
  const lat = Number(last ? last[2] : bare && bare[1]);
  const lon = Number(last ? last[3] : bare && bare[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("no usable waypoint or trackpoint in the Alpha file");
  }
  const body = last ? last[4] : xml;
  const fixTime = (/<time>([^<]+)<\/time>/i.exec(body) || [])[1] ||
    [...xml.matchAll(/<time>([^<]+)<\/time>/gi)].pop()?.[1] || null;
  return { lat, lon, fixTime, points: points.length };
}

// Object ids are positional, and the device renumbers them whenever it writes a
// file — so an id that fetched Current.gpx an hour ago now fetches whatever slid
// into that slot. The lookup is a few hundred milliseconds against a ten second
// poll, so re-resolve it on a short lease rather than trusting it indefinitely.
const ID_LEASE_MS = 60000;
let cachedFile = null;

async function mtpFileId() {
  if (cachedFile && Date.now() - cachedFile.at < ID_LEASE_MS) return cachedFile;
  const { stdout } = await run("mtp-files", [], { maxBuffer: 32 << 20 });
  // mtp-files prints a block per file: the id comes first, the name after.
  const ids = new Map();
  let pending = null;
  for (const line of stdout.split("\n")) {
    const id = /^File ID:\s*(\d+)/.exec(line.trim());
    if (id) { pending = Number(id[1]); continue; }
    const name = /^Filename:\s*(.+)$/.exec(line.trim());
    if (name && pending != null) { ids.set(name[1].trim(), pending); pending = null; }
  }
  for (const want of mtpNames) {
    const name = want.trim();
    const hit = ids.get(name);
    if (hit != null) {
      cachedFile = { id: hit, name, ...describe(name), at: Date.now() };
      return cachedFile;
    }
  }
  throw new Error(`device has none of ${mtpNames.join(", ")} — is it in MTP mode?`);
}

async function readViaMtp(retry = true) {
  const file = await mtpFileId();
  await unlink(scratch).catch(() => {});
  try {
    await run("mtp-getfile", [String(file.id), scratch]);
  } catch (err) {
    cachedFile = null;
    throw err;
  }
  const xml = await readFile(scratch, "utf8");
  // A renumbered id fetches the wrong file without failing, so the read looking
  // like GPX is the only proof we got what we asked for. Anything else means the
  // lease is stale early: drop it and resolve the name again.
  if (!/<gpx/i.test(xml)) {
    cachedFile = null;
    if (retry) return readViaMtp(false);
    throw new Error(`MTP object ${file.id} is not ${file.name} any more`);
  }
  return { xml, live: file.live, source: file.source, what: file.what };
}

const since = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

let announced = "";
let warned = false;
let lastFix = "";
let lastSaid = 0;

async function poll() {
  const source = findSource();
  // Over MTP we only learn which file answered by reading it, so announce after.
  const read = source.kind === "file"
    ? { xml: await readFile(source.path, "utf8"), live: source.live, what: `${source.path} (${source.what})` }
    : await readViaMtp();
  if (read.what !== announced) {
    console.log(`[alpha] reading ${read.what}`);
    announced = read.what;
    warned = false;
  }

  const position = parsePosition(read.xml);
  const body = {
    // Live or logged matters downstream, transport does not: a track log's age is
    // how long the car has been parked, a live fix's age is how broken the feed is.
    source: source.kind === "file"
      ? (read.live ? "alpha-position-file" : "alpha-track-file")
      : read.source,
    lat: position.lat,
    lon: position.lon,
    accuracyM,
    gpsTimestamp: position.fixTime,
    timestamp: new Date().toISOString()
  };
  const response = await fetch(hermesUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Hermes HTTP ${response.status}: ${await response.text()}`);

  const age = body.gpsTimestamp ? Math.round((Date.now() - Date.parse(body.gpsTimestamp)) / 1000) : null;
  const fingerprint = `${body.lat},${body.lon},${body.gpsTimestamp}`;
  const moved = fingerprint !== lastFix;
  // A stalled device answers identically every poll, and printing that ten times
  // a minute buries the line that matters. Changes always print; a stall says so
  // once a minute so the terminal still shows a pulse.
  if (moved || Date.now() - lastSaid > 60000 || once) {
    console.log(`[alpha] ${moved ? "" : "still "}${body.lat},${body.lon}` +
      ` fix=${body.gpsTimestamp || "unknown"}${age != null ? ` (${since(age)} old)` : ""}` +
      (position.points ? ` from ${position.points} point(s)` : ""));
    lastSaid = Date.now();
  }
  lastFix = fingerprint;

  // The whole point of the distinction. Said once per source, because it is
  // about the device rather than news about this poll — and said without alarm,
  // since the commonest reason a track log has not moved is that the car has not
  // moved, in which case the old position is the correct one.
  if (!warned && age != null && age > staleSec) {
    warned = true;
    if (read.live) {
      console.log(`[alpha] the live position is ${since(age)} old, so the unit has stopped writing it:`);
      console.log("[alpha] no sky view, or asleep. The coordinates are wherever it last saw the sky.");
    } else {
      console.log(`[alpha] this is the ${read.what}, and it last recorded ${since(age)} ago.`);
      console.log("[alpha] a track log only gains a point on movement, so something parked reads correct and old.");
      if (!mtpNames.some((n) => n.trim() === "Dog.gpx")) {
        console.log("[alpha] the Alpha writes .Position.gpx once it is on, recording, and holding a fix — this checks");
        console.log("[alpha] for it every minute and switches over on its own when it shows up.");
      }
    }
  }
}

console.log(`[alpha] posting to ${hermesUrl}`);

if (once) {
  try {
    await poll();
  } catch (error) {
    console.error(`[alpha] ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// MTP resets the USB interface on every failure, so hammering it makes things
// worse rather than better; a mounted file has no such cost.
let failures = 0;
while (true) {
  let source = "file";
  try {
    source = findSource().kind;
    await poll();
    failures = 0;
  } catch (error) {
    failures++;
    console.error(`[alpha] ${error.message}`);
  }
  const base = Number(process.env.ALPHA_INTERVAL_MS || (source === "file" ? 3000 : 10000));
  const backoff = failures ? Math.min(6, failures) : 1;
  await delay(Math.max(1000, base) * backoff);
}
