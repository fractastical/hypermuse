#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { setInterval } from "node:timers";
import QRCode from "qrcode";
// Phones need https before they will hand over a position at all — see the note
// at the top of hermes-tls.mjs.
import { answer, help } from "./lib/hermes-answers.mjs";
import { createHermesDb } from "./lib/hermes-db.mjs";
import { ensureCert, lanAddresses } from "./lib/hermes-tls.mjs";
import { pointsFrom } from "./lib/journeys.mjs";
// Naming a place is shared with the story tool, so the dispatch calls a corner
// what the panel called it all night.
import { distanceMeters, loaded as places, nearestPlace, placeCoords } from "./lib/playa-places.mjs";

const root = process.cwd();
// Its own port rather than 8080. It serves the repo as well as the API, so it
// can be the only server running — but 8080 is where npm start already is, and
// defaulting on top of that meant the two could never be up at once. On 8124 it
// runs beside a plain static server, and the overlay finds it either way.
const port = Number(process.env.PORT || 8124);
const host = process.env.HOST || "0.0.0.0";
const mock = process.argv.includes("--mock");
const samplePath = join(root, "data", "hermes", "sample-state.json");
const sample = JSON.parse(readFileSync(samplePath, "utf8"));
// The real listing if there is one, the shipped samples otherwise. activities.json
// is a wrapper with a note and a timezone; the older sample file is a bare array.
const listingPath = join(root, "data", "hermes", "activities.json");
const samplePath2 = join(root, "data", "hermes", "sample-activities.json");
const listing = existsSync(listingPath) ? JSON.parse(readFileSync(listingPath, "utf8")) : null;
const sampleActivities = listing
  ? (Array.isArray(listing) ? listing : listing.activities || [])
  : existsSync(samplePath2) ? JSON.parse(readFileSync(samplePath2, "utf8")) : sample.activities || [];
const bigArtCarsPath = join(root, "data", "hermes", "big-art-cars.json");
const BIG_ART_KEYWORDS_DEFAULT = [
  "mutant vehicle",
  "art car",
  "vehicle",
  "bus",
  "ship",
  "pirate",
  "train",
  "dragon car",
  "mobile stage"
];
function loadBigArtConfig() {
  const envWords = String(process.env.HERMES_BIG_ART_KEYWORDS || "").split(",")
    .map((s) => s.trim().toLowerCase()).filter(Boolean);
  const base = {
    keywords: envWords.length ? envWords : BIG_ART_KEYWORDS_DEFAULT,
    names: [],
    uids: []
  };
  if (!existsSync(bigArtCarsPath)) return base;
  try {
    const body = JSON.parse(readFileSync(bigArtCarsPath, "utf8"));
    return {
      keywords: (Array.isArray(body.keywords) ? body.keywords : base.keywords)
        .map((s) => String(s || "").trim().toLowerCase()).filter(Boolean),
      names: (Array.isArray(body.names) ? body.names : [])
        .map((s) => String(s || "").trim().toLowerCase()).filter(Boolean),
      uids: (Array.isArray(body.uids) ? body.uids : [])
        .map((s) => String(s || "").trim()).filter(Boolean)
    };
  } catch {
    return base;
  }
}
const bigArtConfig = loadBigArtConfig();
const artDir = join(root, "data", "hermes", "art");
function latestArtPath() {
  if (!existsSync(artDir)) return null;
  const files = readdirSync(artDir)
    .map((name) => ({ name, m: /^(\d{4})-art\.json$/.exec(name) }))
    .filter((f) => f.m)
    .sort((a, b) => Number(b.m[1]) - Number(a.m[1]));
  return files.length ? join(artDir, files[0].name) : null;
}
function loadArtPieces() {
  const path = latestArtPath();
  if (!path) return { path: null, pieces: [] };
  try {
    const body = JSON.parse(readFileSync(path, "utf8"));
    const rows = Array.isArray(body) ? body : body.rows || [];
    const pieces = rows
      .map((row) => {
        const lat = Number(row && row.location && row.location.gps_latitude);
        const lon = Number(row && row.location && row.location.gps_longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const firstImage = Array.isArray(row && row.images) && row.images.length
          ? (row.images[0] && (row.images[0].image_url || row.images[0].url || row.images[0].src || ""))
          : "";
        const image = String(
          firstImage ||
          row && row.image_url ||
          row && row.thumbnail_url ||
          row && row.image ||
          ""
        ).trim();
        const link = String(
          row && row.url ||
          row && row.website ||
          row && row.instagram ||
          row && row.facebook ||
          ""
        ).trim();
        return {
          uid: row.uid || "",
          name: String(row.name || "Unnamed Art").trim() || "Unnamed Art",
          artist: String(row.hometown || "").trim(),
          about: String(row.description || "").trim(),
          image,
          link,
          lat,
          lon
        };
      })
      .filter(Boolean);
    return { path, pieces };
  } catch {
    return { path, pieces: [] };
  }
}
const loadedArt = loadArtPieces();
const artPieces = loadedArt.pieces.map((piece) => {
  const blob = `${piece.name} ${piece.about || ""}`.toLowerCase();
  const nameHit = bigArtConfig.names.includes(String(piece.name || "").toLowerCase());
  const uidHit = bigArtConfig.uids.includes(String(piece.uid || ""));
  const keywordHit = bigArtConfig.keywords.some((key) => key && blob.includes(key));
  return { ...piece, bigArtCar: Boolean(nameHit || uidHit || keywordHit) };
});
// Times in the listing are playa local, wherever the laptop thinks it is.
const TZ = process.env.HERMES_TZ || (listing && listing.timezone) || "America/Los_Angeles";
// One hand of listings: the overlay puts an icon on the map for each of these and
// cycles the panel through them one at a time, so this is both how many markers
// the map carries and how long the rotation takes to come round.
const ACTIVITY_LIMIT = Number(process.env.HERMES_ACTIVITY_LIMIT || 10);
// Local guide rather than city guide: past this distance a listing is still real
// but no longer nearby enough to act on from where the dot is now.
const ACTIVITY_MAX_M = Math.max(100, Number(process.env.HERMES_ACTIVITY_MAX_M || 2000));
// Show what is on now by default. Optional grace keeps an event from vanishing
// the second the clock crosses its end minute.
const ACTIVITY_ACTIVE_ONLY = String(process.env.HERMES_ACTIVITY_ACTIVE_ONLY || "1") !== "0";
const ACTIVITY_ENDED_GRACE_MIN = Math.max(0, Number(process.env.HERMES_ACTIVITY_ENDED_GRACE_MIN || 0));
// "Near now" means close to this moment in schedule terms, not only geographically.
// Events that started long ago can still be running; these stay available but are
// ranked behind ones starting around now.
const ACTIVITY_NOW_WINDOW_MIN = Math.max(0, Number(process.env.HERMES_ACTIVITY_NOW_WINDOW_MIN || 180));
const ART_LIMIT = Math.max(0, Number(process.env.HERMES_ART_LIMIT || 80));
const ART_MAX_M = Math.max(200, Number(process.env.HERMES_ART_MAX_M || 4000));
const WEATHER_PROVIDER = String(process.env.HERMES_WEATHER_PROVIDER || "auto").trim().toLowerCase();
const ACCU_KEY = String(
  process.env.ACCUWEATHER_API_KEY ||
  process.env.HERMES_ACCUWEATHER_API_KEY ||
  ""
).trim();
const WEATHER_TIMEOUT_MS = Math.max(2000, Number(process.env.HERMES_WEATHER_TIMEOUT_MS || 8000));
const ACCU_LOC_TTL_MS = Math.max(300000, Number(process.env.HERMES_ACCU_LOC_TTL_MS || 6 * 3600000));
const WEATHER_CACHE_MS = Math.max(5000, Number(process.env.HERMES_WEATHER_CACHE_MS || 20000));
// A secret carried in the link, because /api/location does not report a position
// so much as decide one: it moves the dot, renames the corner and re-ranks every
// listing the panel advertises. On the wifi alone that needed nothing, since
// being on the wifi was the credential. Reached through a tunnel it is the open
// internet, where an address that can be guessed is an address that will be, and
// the moon would announce whatever a stranger felt like.
//
// Kept in a file rather than demanded as an environment variable so the ordinary
// way to start the server stays "npm run hermes:server" and the link printed at
// startup is always the one that works.
const tokenPath = join(root, "data", "hermes", "phone-token.txt");
const TOKEN = process.env.HERMES_TOKEN || (() => {
  try {
    const saved = existsSync(tokenPath) ? readFileSync(tokenPath, "utf8").trim() : "";
    if (saved) return saved;
  } catch { /* unreadable reads the same as absent: make a new one */ }
  const made = randomBytes(8).toString("hex");
  try {
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, made + "\n");
  } catch { /* not written is survivable; it just changes on the next restart */ }
  return made;
})();

// Anything on this machine is already inside: the alpha watcher, the mock route
// and hermes-post-location all post to 127.0.0.1 and predate the token.
//
// The proxy headers are the important half. A tunnel connects from loopback too,
// so remoteAddress alone would wave the entire internet through on the strength
// of cloudflared running locally — the exact hole the token exists to close.
const fromThisMachine = (req) => {
  if (req.headers["x-forwarded-for"] || req.headers["x-forwarded-proto"]) return false;
  const ip = String(req.socket.remoteAddress || "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
};

const clients = new Set();

// Where the night gets written down. The overlay's fading trail is memory in a
// browser tab — reload the kiosk, or lose power for a second, and everywhere the
// car has been goes with it. This is the record: one JSON object per line,
// appended as fixes arrive, so nothing is ever rewritten and a hard stop costs
// at most the line being written. Read back at boot, so restarting the server
// mid-week does not amputate the trail.
//
// The mock route keeps its own file. It teleports between landmarks kilometres
// apart, and a log of where the car was is worth nothing if invented positions
// are mixed into it. HERMES_TRACK=off writes none of it.
const trackOff = process.env.HERMES_TRACK === "off";
const trackPath = (!trackOff && process.env.HERMES_TRACK) ||
  join(root, "data", "hermes", mock ? "track-mock.jsonl" : "track.jsonl");
const TRACK_KEEP = Number(process.env.HERMES_TRACK_KEEP || 20000);
const locationFeedPath = process.env.HERMES_LOCATION_FEED ||
  join(root, "data", "hermes", mock ? "location-feed-mock.jsonl" : "location-feed.jsonl");
const LOCATION_FEED_LIMIT = Math.max(100, Number(process.env.HERMES_LOCATION_FEED_LIMIT || 50000));
const locationFeedRecent = [];
const artClosestPath = process.env.HERMES_ART_CLOSEST_LOG ||
  join(root, "data", "hermes", mock ? "art-closest-mock.jsonl" : "art-closest.jsonl");
const ART_CLOSEST_LIMIT = Math.max(100, Number(process.env.HERMES_ART_CLOSEST_LIMIT || 50000));
const artClosestRecent = [];
const pickupPath = join(root, "data", "hermes", "pickup-requests.jsonl");
const PICKUP_LIMIT = Math.max(1, Number(process.env.HERMES_PICKUP_LIMIT || 80));
const PICKUP_COOLDOWN_MS = Math.max(0, Number(process.env.HERMES_PICKUP_COOLDOWN_MS || 30000));
const PICKUP_PAST_GRACE_MIN = Math.max(0, Number(process.env.HERMES_PICKUP_PAST_GRACE_MIN || 2));
const PICKUP_REQUIRE_APPROVAL = String(process.env.HERMES_PICKUP_REQUIRE_APPROVAL || "1") !== "0";
const PICKUP_SYNC_MS = Math.max(5000, Number(process.env.HERMES_PICKUP_SYNC_MS || 30000));
const PICKUP_REMOTE_WRITE = String(process.env.HERMES_PICKUP_REMOTE_WRITE || "1") !== "0";
const pickupRecent = [];
const peopleGraphPath = join(root, "data", "hermes", "people-graph-events.jsonl");
const PEOPLE_GRAPH_LIMIT = Math.max(100, Number(process.env.HERMES_PEOPLE_GRAPH_LIMIT || 5000));
const peopleGraphRecent = [];
let pickupLastSyncAt = 0;
let pickupSyncRunning = false;
const pickupLastByIp = new Map();
// A parked car still posts every few seconds. A point earns a line when it is
// somewhere new, or when enough time has passed that the log ought to say the
// car was still there — otherwise a still night is either thousands of identical
// lines or a gap indistinguishable from the server being down.
const TRACK_MIN_M = Number(process.env.HERMES_TRACK_MIN_M || 3);
const TRACK_REST_MS = Number(process.env.HERMES_TRACK_REST_MS || 120000);

let db = null;
let track = loadTrack();
locationFeedRecent.push(...readLocationFeedLog());
artClosestRecent.push(...readArtClosestLog());

function loadTrack() {
  if (trackOff || !existsSync(trackPath)) return [];
  const points = [];
  for (const line of readFileSync(trackPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const point = JSON.parse(line);
      if (Number.isFinite(point.lat) && Number.isFinite(point.lon)) points.push(point);
    } catch {
      // A half-written final line is the only damage an append-only log can take,
      // and losing one fix is not worth refusing to load the week.
    }
  }
  return points.slice(-TRACK_KEEP);
}

function recordTrack(fix, at) {
  if (trackOff) return false;
  const last = track[track.length - 1];
  // The same fix arriving again is not a new point. The Alpha answers every poll
  // with whatever it last managed to fix, so an unchanged satellite time means
  // the car has not reported moving, however lively the conversation looks.
  if (last && fix.gpsTimestamp && last.gps === fix.gpsTimestamp) return false;
  const moved = last ? distanceMeters(last.lat, last.lon, fix.lat, fix.lon) : Infinity;
  const rested = last ? Date.parse(at) - Date.parse(last.t) : Infinity;
  if (moved < TRACK_MIN_M && !(rested >= TRACK_REST_MS)) return false;
  // Six decimals is about 10cm, which is two orders of magnitude finer than the
  // fix itself and keeps a line short enough that a week of them is a few MB.
  const point = {
    t: at,
    lat: Number(fix.lat.toFixed(6)),
    lon: Number(fix.lon.toFixed(6))
  };
  if (fix.gpsTimestamp) point.gps = fix.gpsTimestamp;
  if (Number.isFinite(fix.accuracyM) && fix.accuracyM > 0) point.acc = Math.round(fix.accuracyM);
  if (fix.source) point.src = fix.source;
  if (fix.nearestArt) point.art = String(fix.nearestArt);
  if (fix.nearestArtUid) point.artUid = String(fix.nearestArtUid);
  if (Number.isFinite(fix.nearestArtDistanceM)) point.artM = Math.round(Number(fix.nearestArtDistanceM));
  if (fix.nearestBigArtCar) point.bigArt = String(fix.nearestBigArtCar);
  if (fix.nearestBigArtCarUid) point.bigArtUid = String(fix.nearestBigArtCarUid);
  if (Number.isFinite(fix.nearestBigArtCarDistanceM)) point.bigArtM = Math.round(Number(fix.nearestBigArtCarDistanceM));
  track.push(point);
  if (track.length > TRACK_KEEP) track.splice(0, track.length - TRACK_KEEP);
  try {
    mkdirSync(dirname(trackPath), { recursive: true });
    appendFileSync(trackPath, JSON.stringify(point) + "\n");
    if (db) db.saveTrackPoint(point).catch((err) =>
      console.error(`[hermes] could not write track point to postgres: ${err.message}`));
    return true;
  } catch (err) {
    // A log that cannot be written is not a reason to stop knowing where you are.
    console.error(`[hermes] could not write the track: ${err.message}`);
    if (db) db.saveTrackPoint(point).catch((dberr) =>
      console.error(`[hermes] could not write track point to postgres: ${dberr.message}`));
    return false;
  }
}

function readLocationFeedLog() {
  if (!existsSync(locationFeedPath)) return [];
  const rows = [];
  for (const line of readFileSync(locationFeedPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (item && typeof item === "object") rows.push(item);
    } catch { /* skip malformed line */ }
  }
  return rows.slice(-LOCATION_FEED_LIMIT);
}

function saveLocationFeed(entry) {
  locationFeedRecent.push(entry);
  if (locationFeedRecent.length > LOCATION_FEED_LIMIT) {
    locationFeedRecent.splice(0, locationFeedRecent.length - LOCATION_FEED_LIMIT);
  }
  try {
    mkdirSync(dirname(locationFeedPath), { recursive: true });
    appendFileSync(locationFeedPath, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error(`[hermes] could not write location feed log: ${err.message}`);
  }
  if (db) db.saveLocationFeed(entry).catch((err) =>
    console.error(`[hermes] could not write location feed to postgres: ${err.message}`));
}

function nearestArtPiece(lat, lon) {
  if (!artPieces.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  for (const piece of artPieces) {
    const d = distanceMeters(lat, lon, piece.lat, piece.lon);
    if (!best || d < best.distanceM) best = { ...piece, distanceM: d };
  }
  return best;
}

function nearestBigArtCar(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const onlyBig = artPieces.filter((piece) => piece.bigArtCar);
  if (!onlyBig.length) return null;
  let best = null;
  for (const piece of onlyBig) {
    const d = distanceMeters(lat, lon, piece.lat, piece.lon);
    if (!best || d < best.distanceM) best = { ...piece, distanceM: d };
  }
  return best;
}

function readArtClosestLog() {
  if (!existsSync(artClosestPath)) return [];
  const rows = [];
  for (const line of readFileSync(artClosestPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (item && typeof item === "object") rows.push(item);
    } catch { /* skip malformed line */ }
  }
  return rows.slice(-ART_CLOSEST_LIMIT);
}

function saveArtClosest(entry) {
  artClosestRecent.push(entry);
  if (artClosestRecent.length > ART_CLOSEST_LIMIT) {
    artClosestRecent.splice(0, artClosestRecent.length - ART_CLOSEST_LIMIT);
  }
  try {
    mkdirSync(dirname(artClosestPath), { recursive: true });
    appendFileSync(artClosestPath, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error(`[hermes] could not write nearest-art log: ${err.message}`);
  }
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (fwd) return fwd;
  return String(req.socket.remoteAddress || "");
}

const tidy = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const boolish = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
const severityRankFromText = (value, fallback = 5) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "low") return 3;
  if (raw === "medium") return 5;
  if (raw === "high") return 8;
  if (raw === "critical") return 10;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(10, Math.round(n)));
};
const severityTextFromRank = (rank) => {
  const n = Math.max(1, Math.min(10, Math.round(Number(rank) || 5)));
  if (n >= 9) return "critical";
  if (n >= 7) return "high";
  if (n >= 4) return "medium";
  return "low";
};
function eventSeverityRank(entry, fallback = 5) {
  if (!entry || typeof entry !== "object") return fallback;
  const direct = Number(entry.severityRank);
  if (Number.isFinite(direct)) return Math.max(1, Math.min(10, Math.round(direct)));
  return severityRankFromText(entry.severity, fallback);
}

function hasAdminPickupAccess(req, url, body = null) {
  if (fromThisMachine(req)) return true;
  const queryToken = url ? String(url.searchParams.get("token") || url.searchParams.get("t") || "") : "";
  const headerToken = String(req.headers["x-hermes-token"] || "");
  const bodyToken = body && typeof body === "object" ? String(body.token || "") : "";
  const given = queryToken || headerToken || bodyToken;
  return Boolean(given && given === TOKEN);
}

function normalizedApprovalStatus(request) {
  const raw = String(request && request.approvalStatus || "").toLowerCase();
  if (raw === "approved" || raw === "rejected" || raw === "pending") return raw;
  if (request && request.approved === true) return "approved";
  if (request && request.approved === false) return "pending";
  // Backward compatibility: legacy rows had no approval fields.
  return "approved";
}

function isApprovedRequest(request) {
  return normalizedApprovalStatus(request) === "approved";
}

function parseRequestWhen(text, baseMs) {
  const raw = String(text || "").trim().toLowerCase();
  if (!raw) return NaN;
  if (["now", "asap", "soon"].includes(raw)) return baseMs;

  // Duration forms: "15m", "1h20m", "90s", "in 10 min".
  const cleaned = raw.replace(/^in\s+/, "").replace(/\b(minutes?|mins?)\b/g, "m")
    .replace(/\b(hours?|hrs?)\b/g, "h").replace(/\bseconds?|secs?\b/g, "s")
    .replace(/\bdays?\b/g, "d");
  const token = /(\d+)\s*([smhd])/g;
  let total = 0;
  let seen = 0;
  let m;
  while ((m = token.exec(cleaned))) {
    const n = Number(m[1]);
    total += m[2] === "d" ? n * 86400000
      : m[2] === "h" ? n * 3600000
        : m[2] === "m" ? n * 60000
          : n * 1000;
    seen += m[0].length;
  }
  if (total > 0 && seen >= cleaned.replace(/\s+/g, "").length) return baseMs + total;

  // Clock forms: "23:10", "11:45pm", "7am".
  const c = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i.exec(raw.replace(/\s+/g, ""));
  if (c) {
    let hour = Number(c[1]);
    const minute = Number(c[2] || 0);
    const ap = (c[3] || "").toLowerCase();
    if (minute > 59) return NaN;
    if (ap) {
      if (hour < 1 || hour > 12) return NaN;
      if (hour === 12) hour = 0;
      if (ap === "pm") hour += 12;
    } else if (hour > 23) return NaN;
    const at = new Date(baseMs);
    at.setHours(hour, minute, 0, 0);
    if (at.getTime() <= baseMs) at.setDate(at.getDate() + 1);
    return at.getTime();
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function requestAtMs(request) {
  const stored = Date.parse(request && request.pickupAt);
  if (Number.isFinite(stored)) return stored;
  const base = Date.parse(request && request.at) || Date.now();
  return parseRequestWhen(request && request.pickupWhen, base);
}

function isActiveRequest(request, now = Date.now()) {
  const kind = String((request && request.requestType) || "pickup");
  if (kind !== "pickup") return true;
  const at = requestAtMs(request);
  if (!Number.isFinite(at)) return false;
  return at + PICKUP_PAST_GRACE_MIN * 60000 >= now;
}

function pickNowPlaying(requests, now = Date.now()) {
  const dj = (Array.isArray(requests) ? requests : [])
    .filter((r) => isApprovedRequest(r))
    .filter((r) => String((r && r.requestType) || "") === "dj-set")
    .map((r) => ({ request: r, at: requestAtMs(r) }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => a.at - b.at);
  if (!dj.length) return { nowPlaying: null, upNext: null };
  // Small lead window: a request for "now" or "in a minute" should read as live.
  const leadMs = 5 * 60000;
  const started = dj.filter((r) => r.at <= now + leadMs);
  const nowPlaying = started.length ? started[started.length - 1].request : null;
  const upNextHit = dj.find((r) => r.at > now + leadMs);
  const upNext = upNextHit ? upNextHit.request : null;
  return { nowPlaying, upNext };
}

function readPickupLog() {
  if (!existsSync(pickupPath)) return [];
  const rows = [];
  for (const line of readFileSync(pickupPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (item && (item.place || item.requestType === "dj-set")) rows.push(item);
    } catch { /* skip malformed line */ }
  }
  return rows.slice(-PICKUP_LIMIT);
}

pickupRecent.push(...readPickupLog());

function readPeopleGraphLog() {
  if (!existsSync(peopleGraphPath)) return [];
  const rows = [];
  for (const line of readFileSync(peopleGraphPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (item && item.id) rows.push(item);
    } catch { /* skip malformed line */ }
  }
  return rows.slice(-PEOPLE_GRAPH_LIMIT);
}

peopleGraphRecent.push(...readPeopleGraphLog());

function persistPeopleGraphEvent(entry) {
  try {
    mkdirSync(dirname(peopleGraphPath), { recursive: true });
    appendFileSync(peopleGraphPath, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error(`[hermes] could not write people graph event: ${err.message}`);
  }
  if (db) db.savePeopleGraphEvent(entry).catch((err) =>
    console.error(`[hermes] could not write people graph event to postgres: ${err.message}`));
}

function upsertPeopleGraphEvent(entry, persist = true) {
  if (!entry || typeof entry !== "object") return false;
  const id = String(entry.id || "").trim();
  if (!id) return false;
  const ix = peopleGraphRecent.findIndex((row) => String(row && row.id || "") === id);
  if (ix >= 0) {
    const was = peopleGraphRecent[ix];
    const changed = JSON.stringify(was) !== JSON.stringify(entry);
    if (!changed) return false;
    peopleGraphRecent[ix] = entry;
    if (persist) persistPeopleGraphEvent(entry);
    return true;
  }
  peopleGraphRecent.push(entry);
  if (peopleGraphRecent.length > PEOPLE_GRAPH_LIMIT) {
    peopleGraphRecent.splice(0, peopleGraphRecent.length - PEOPLE_GRAPH_LIMIT);
  }
  if (persist) persistPeopleGraphEvent(entry);
  return true;
}

function normalizePersonName(name) {
  return tidy(name || "", 80);
}

function personKey(name) {
  const norm = normalizePersonName(name).toLowerCase();
  if (!norm) return "";
  const cleaned = norm.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned) return cleaned;
  return `u-${Buffer.from(norm).toString("hex").slice(0, 24)}`;
}

function personNodeId(name, fallback = "unknown") {
  return `person:${personKey(name) || fallback}`;
}

function pushNode(nodes, id, kind, label, extra = {}) {
  if (!id || nodes.has(id)) return;
  nodes.set(id, { id, kind, label, ...extra });
}

function pushEdge(edges, id, from, to, kind, label, extra = {}) {
  if (!id || !from || !to) return;
  edges.set(id, { id, from, to, kind, label, ...extra });
}

function buildPeopleGraph({ includeRequests = true } = {}) {
  const nodes = new Map();
  const edges = new Map();
  const score = new Map();
  const introLinks = [];

  const bump = (name, key, by = 1) => {
    if (!name) return;
    const id = personNodeId(name, key);
    const s = score.get(id) || { noShows: 0, ethicalBreaches: 0, intros: 0, requests: 0 };
    s[key] = Number(s[key] || 0) + by;
    score.set(id, s);
  };

  for (const entry of peopleGraphRecent) {
    const type = String(entry && entry.type || "").toLowerCase();
    const at = entry && entry.at ? String(entry.at) : "";
    const note = tidy(entry && entry.note, 220);
    if (type === "intro") {
      const fromName = normalizePersonName(entry.fromPerson || entry.from || "");
      const toName = normalizePersonName(entry.toPerson || entry.to || entry.person || "");
      if (!fromName || !toName) continue;
      const fromId = personNodeId(fromName, "intro-from");
      const toId = personNodeId(toName, "intro-to");
      pushNode(nodes, fromId, "person", fromName);
      pushNode(nodes, toId, "person", toName);
      pushEdge(edges, `intro:${entry.id}`, fromId, toId, "intro", "introduced", { at, note, by: entry.by || "" });
      introLinks.push({ edgeId: `intro:${entry.id}`, fromId, toId, at, note, by: entry.by || "" });
      bump(fromName, "intros", 1);
      continue;
    }
    if (type === "incident" || type === "attendance") {
      const person = normalizePersonName(entry.person || "");
      if (!person) continue;
      const pId = personNodeId(person, "incident-person");
      pushNode(nodes, pId, "person", person);
      const kind = String(entry.kind || "").toLowerCase();
      const status = String(entry.status || entry.outcome || "").toLowerCase();
      const incKind = kind || status || "incident";
      const severityRank = eventSeverityRank(entry, incKind === "ethical-breach" ? 7 : 5);
      const severity = severityTextFromRank(severityRank);
      const riskPoints = incKind === "ethical-breach"
        ? severityRank
        : Math.max(1, Math.round(severityRank * 0.7));
      const iId = `incident:${entry.id}`;
      const iLabel = incKind === "no-show" ? "No-show" : incKind === "ethical-breach" ? "Ethical breach" : incKind;
      pushNode(nodes, iId, "incident", iLabel, {
        severity,
        severityRank,
        riskPoints,
        at,
        note,
        requestId: entry.requestId || ""
      });
      pushEdge(edges, `person-incident:${entry.id}`, pId, iId, "incident", iLabel, {
        severity,
        severityRank,
        riskPoints,
        at
      });
      if (incKind === "no-show") bump(person, "noShows", 1);
      if (incKind === "ethical-breach") bump(person, "ethicalBreaches", 1);
      bump(person, "riskPoints", riskPoints);
      continue;
    }
    if (type === "resolution" || type === "appeal" || type === "judgement") {
      const person = normalizePersonName(entry.person || "");
      if (!person) continue;
      const pId = personNodeId(person, "resolution-person");
      pushNode(nodes, pId, "person", person);
      const kind = String(entry.kind || "").toLowerCase();
      const verdict = String(entry.verdict || "").toLowerCase();
      const severityRank = eventSeverityRank(entry, kind === "restitution" ? 6 : 5);
      const severity = severityTextFromRank(severityRank);
      const rId = `resolution:${entry.id}`;
      const label = kind === "restitution" ? "Restitution" : kind === "appeal" ? "Appeal" : "Third-party judgement";
      pushNode(nodes, rId, "resolution", label, {
        severity,
        severityRank,
        at,
        note,
        verdict,
        by: entry.by || "",
        requestId: entry.requestId || ""
      });
      pushEdge(edges, `person-resolution:${entry.id}`, pId, rId, "resolution", label, {
        at,
        verdict,
        by: entry.by || ""
      });
      if (kind === "appeal") bump(person, "appeals", 1);
      if (kind === "restitution") {
        bump(person, "restitutions", 1);
        bump(person, "mitigationPoints", severityRank);
      }
      if (kind === "third-party-judgement") {
        bump(person, "judgements", 1);
        if (verdict === "clear" || verdict === "mitigate") {
          bump(person, "mitigatingJudgements", 1);
          bump(person, "mitigationPoints", verdict === "clear" ? 10 : Math.max(1, Math.round(severityRank * 0.8)));
        }
        if (verdict === "uphold") {
          bump(person, "upheldJudgements", 1);
          bump(person, "riskPoints", Math.max(1, Math.round(severityRank * 0.5)));
        }
      }
      continue;
    }
  }

  if (includeRequests) {
    for (const request of pickupRecent) {
      const who = normalizePersonName(request && request.who || "anonymous");
      const whoId = personNodeId(who, "anonymous");
      const reqKey = String(
        request && request.id ||
        `${request && request.at || ""}|${request && request.who || ""}|${request && request.place || ""}|${request && request.requestType || ""}`
      );
      const reqId = `request:${reqKey}`;
      const rType = String(request && request.requestType || "pickup");
      const label = rType === "dj-set" ? "DJ/live booking" : "Pickup request";
      pushNode(nodes, whoId, "person", who);
      pushNode(nodes, reqId, "request", label, {
        requestType: rType,
        place: request && request.place ? String(request.place) : "",
        at: request && request.at ? String(request.at) : "",
        approvalStatus: normalizedApprovalStatus(request)
      });
      pushEdge(edges, `requested:${reqId}`, whoId, reqId, "requested", "requested", {
        at: request && request.at ? String(request.at) : "",
        place: request && request.place ? String(request.place) : "",
        requestType: rType
      });
      bump(who, "requests", 1);
    }
  }

  for (const [id, s] of score.entries()) {
    if (!nodes.has(id)) continue;
    nodes.set(id, { ...nodes.get(id), ...s });
  }

  // "Guilt by association": if A introduced B and B has incidents, A inherits an
  // association risk score. This is separate from direct incidents on A.
  for (const link of introLinks) {
    const target = nodes.get(link.toId);
    const source = nodes.get(link.fromId);
    if (!target || !source) continue;
    const targetNoShows = Number(target.noShows || 0);
    const targetBreaches = Number(target.ethicalBreaches || 0);
    const targetRawPoints = Number(target.riskPoints || 0);
    const targetMitigationPoints = Number(target.mitigationPoints || 0);
    const targetRisk = Math.max(0, targetRawPoints - targetMitigationPoints);
    if (targetRisk <= 0) continue;
    const src = score.get(link.fromId) || { noShows: 0, ethicalBreaches: 0, intros: 0, requests: 0 };
    src.associationNoShows = Number(src.associationNoShows || 0) + targetNoShows;
    src.associationBreaches = Number(src.associationBreaches || 0) + targetBreaches;
    src.associationRisk = Number(src.associationRisk || 0) + targetRisk;
    src.associationRiskPoints = Number(src.associationRiskPoints || 0) + targetRisk;
    src.associationPeople = Number(src.associationPeople || 0) + 1;
    score.set(link.fromId, src);

    const prior = edges.get(link.edgeId) || {};
    edges.set(link.edgeId, {
      ...prior,
      associationRisk: targetRisk,
      associationRiskPoints: targetRisk,
      associationNoShows: targetNoShows,
      associationBreaches: targetBreaches,
      associationFlag: true
    });
  }

  for (const [id, s] of score.entries()) {
    if (!nodes.has(id)) continue;
    nodes.set(id, { ...nodes.get(id), ...s });
  }

  const stats = [...nodes.values()]
    .filter((n) => n.kind === "person")
    .map((n) => ({
      id: n.id,
      name: n.label,
      noShows: Number(n.noShows || 0),
      ethicalBreaches: Number(n.ethicalBreaches || 0),
      intros: Number(n.intros || 0),
      requests: Number(n.requests || 0),
      appeals: Number(n.appeals || 0),
      restitutions: Number(n.restitutions || 0),
      judgements: Number(n.judgements || 0),
      mitigatingJudgements: Number(n.mitigatingJudgements || 0),
      upheldJudgements: Number(n.upheldJudgements || 0),
      riskPoints: Number(n.riskPoints || 0),
      mitigationPoints: Number(n.mitigationPoints || 0),
      associationNoShows: Number(n.associationNoShows || 0),
      associationBreaches: Number(n.associationBreaches || 0),
      associationPeople: Number(n.associationPeople || 0),
      associationRisk: Number(n.associationRisk || 0),
      totalRisk: Number(n.riskPoints || 0) + Number(n.associationRisk || 0),
      mitigation: Number(n.mitigationPoints || 0),
      netRisk: Math.max(0, (Number(n.riskPoints || 0) + Number(n.associationRisk || 0)) - Number(n.mitigationPoints || 0))
    }))
    .sort((a, b) =>
      (b.netRisk - a.netRisk) ||
      (b.totalRisk - a.totalRisk) ||
      (b.ethicalBreaches - a.ethicalBreaches) ||
      (b.noShows - a.noShows) ||
      (b.associationRisk - a.associationRisk) ||
      (b.requests - a.requests) ||
      a.name.localeCompare(b.name)
    );

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    stats
  };
}

function persistPickup(entry) {
  try {
    mkdirSync(dirname(pickupPath), { recursive: true });
    appendFileSync(pickupPath, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error(`[hermes] could not write pickup request: ${err.message}`);
  }
  if (db) db.savePickup(entry).catch((err) =>
    console.error(`[hermes] could not write pickup request to postgres: ${err.message}`));
}

function upsertPickup(entry, persist = true) {
  if (!entry || typeof entry !== "object") return false;
  const id = String(entry.id || "").trim();
  if (!id) return false;
  const ix = pickupRecent.findIndex((row) => String(row && row.id || "") === id);
  if (ix >= 0) {
    const was = pickupRecent[ix];
    const changed = JSON.stringify(was) !== JSON.stringify(entry);
    if (!changed) return false;
    pickupRecent[ix] = entry;
    if (persist) persistPickup(entry);
    return true;
  }
  pickupRecent.push(entry);
  if (pickupRecent.length > PICKUP_LIMIT) pickupRecent.splice(0, pickupRecent.length - PICKUP_LIMIT);
  if (persist) persistPickup(entry);
  return true;
}

const trimSlash = (s) => String(s || "").replace(/\/+$/, "");
function upstreamPickupBase(req) {
  const raw = String(process.env.HERMES_PICKUP_SYNC_URL || process.env.HERMES_PICKUP_URL || "").trim();
  if (!raw) return "";
  try {
    const target = new URL(raw);
    const host = String(req && req.headers && req.headers.host || "").split(":")[0].toLowerCase();
    if (host && target.host.toLowerCase() === host) return "";
    return trimSlash(target.origin);
  } catch {
    return "";
  }
}

async function syncPickupsFromUpstream(req) {
  const base = upstreamPickupBase(req);
  if (!base) return 0;
  if (pickupSyncRunning) return 0;
  const now = Date.now();
  if (now - pickupLastSyncAt < PICKUP_SYNC_MS) return 0;
  pickupSyncRunning = true;
  pickupLastSyncAt = now;
  try {
    const url = `${base}/api/hermes/pickup`;
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 0;
    const body = await res.json().catch(() => null);
    const rows = Array.isArray(body && body.requests) ? body.requests : [];
    let changed = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const item = {
        id: String(row.id || ""),
        at: row.at || new Date().toISOString(),
        who: row.who || "anonymous",
        intention: row.intention || "",
        requestType: row.requestType === "dj-set" ? "dj-set" : "pickup",
        place: row.place || "",
        pickupWhen: row.pickupWhen || "asap",
        pickupAt: row.pickupAt || null,
        equipmentNeeded: row.equipmentNeeded || "",
        approvalStatus: ["approved", "pending", "rejected"].includes(String(row.approvalStatus || "").toLowerCase())
          ? String(row.approvalStatus || "").toLowerCase()
          : "approved",
        approvedBy: row.approvedBy || "",
        approvedAt: row.approvedAt || null,
        lat: Number.isFinite(Number(row.lat)) ? Number(row.lat) : NaN,
        lon: Number.isFinite(Number(row.lon)) ? Number(row.lon) : NaN,
        note: row.note || "",
        source: row.source || "web-app",
        ip: row.ip || ""
      };
      if (upsertPickup(item, true)) changed++;
    }
    if (changed) console.log(`[hermes] pickup sync: ${changed} request(s) updated from ${base}`);
    return changed;
  } catch {
    return 0;
  } finally {
    pickupSyncRunning = false;
  }
}

async function submitPickupUpstream(req, payload) {
  if (!PICKUP_REMOTE_WRITE) return null;
  const base = upstreamPickupBase(req);
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/hermes/pickup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || body.ok === false || !body.request) return null;
    return body.request;
  } catch {
    return null;
  }
}

async function submitPickupApprovalUpstream(req, payload) {
  if (!PICKUP_REMOTE_WRITE) return false;
  const base = upstreamPickupBase(req);
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/hermes/pickup/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hermes-token": TOKEN },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function bootstrapDatabase() {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) return;
  try {
    db = await createHermesDb(url);
    const dbTrack = await db.loadTrack(TRACK_KEEP);
    if (dbTrack.length > track.length) track = dbTrack;
    const dbFeed = await db.loadLocationFeed(LOCATION_FEED_LIMIT);
    if (dbFeed.length > locationFeedRecent.length) {
      locationFeedRecent.splice(0, locationFeedRecent.length, ...dbFeed);
    }
    const dbPickups = await db.loadPickups(PICKUP_LIMIT);
    if (dbPickups.length > pickupRecent.length) {
      pickupRecent.splice(0, pickupRecent.length, ...dbPickups);
    }
    const dbGraph = await db.loadPeopleGraphEvents(PEOPLE_GRAPH_LIMIT);
    if (dbGraph.length > peopleGraphRecent.length) {
      peopleGraphRecent.splice(0, peopleGraphRecent.length, ...dbGraph);
    }
    console.log(`[hermes] postgres: connected (${dbTrack.length} track, ${dbPickups.length} requests, ${dbGraph.length} graph events)`);
  } catch (err) {
    db = null;
    console.error(`[hermes] postgres disabled: ${String(err.message || err).split("\n")[0]}`);
  }
}

await bootstrapDatabase();

function pickupLocalUrl(req) {
  const hostHeader = String(req.headers.host || "").trim();
  const hostOnly = hostHeader.split(":")[0].replace(/^\[|\]$/g, "");
  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = req.socket.encrypted || forwarded === "https" ? "https" : "http";
  let hostPort = hostHeader || `127.0.0.1:${port}`;
  const localHost = !hostOnly || hostOnly === "localhost" || hostOnly === "127.0.0.1" || hostOnly === "::1";
  if (localHost) {
    const lan = lanAddresses()[0];
    if (lan) hostPort = `${lan}:${port}`;
  }
  return `${proto}://${hostPort}/hermes-live.html`;
}

function pickupPublicUrl(req) {
  const forced = String(process.env.HERMES_PICKUP_URL || "").trim();
  if (forced) return forced;
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  if (forwardedHost) return `https://${forwardedHost}/hermes-live.html`;
  // If cloudflared is running, prefer its public URL so QR scans work off-LAN.
  try {
    const quick = join(process.env.HOME || "", "Library", "Logs", "hypermuse", "cloudflared.err.log");
    if (quick && existsSync(quick)) {
      const text = readFileSync(quick, "utf8");
      const all = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi);
      const latest = all && all[all.length - 1];
      if (latest) return `${latest}/hermes-live.html`;
    }
  } catch { /* no public URL available */ }
  return "";
}

function pickupAppUrl(req, mode = "local") {
  const local = pickupLocalUrl(req);
  const pub = pickupPublicUrl(req);
  if (mode === "public") return pub || local;
  if (mode === "auto") return pub || local;
  return local;
}

function graphLocalUrl(req) {
  return pickupLocalUrl(req).replace(/\/hermes-live\.html(?:\?.*)?$/, "/hermes-crew-graph.html");
}

function graphPublicUrl(req) {
  const base = pickupPublicUrl(req);
  if (!base) return "";
  return String(base).replace(/\/hermes-live\.html(?:\?.*)?$/, "/hermes-crew-graph.html");
}

function graphAppUrl(req, mode = "local") {
  const local = graphLocalUrl(req);
  const pub = graphPublicUrl(req);
  if (mode === "public") return pub || local;
  if (mode === "auto") return pub || local;
  return local;
}

// Where we last actually were beats where the sample says we were. A restart used
// to drop the car back to the seed — "1200 Promenade", a position nobody chose —
// and hold it there until the next fix arrived, which on a handheld that has been
// unplugged is never. The track's last line is the honest answer, and it is
// carried with its own timestamps so the panel reads it as old rather than as
// current. HERMES_RESUME=0 comes up on the seed instead.
const resume = process.env.HERMES_RESUME === "0" ? null : track[track.length - 1];
let state = {
  ...sample,
  fix: resume
    ? {
      source: resume.src || "track-log",
      lat: resume.lat,
      lon: resume.lon,
      accuracyM: Number(resume.acc) || 0,
      gpsTimestamp: resume.gps || null,
      ageSec: 0
    }
    : sample.fix,
  updatedAt: resume ? resume.t : new Date().toISOString()
};

const route = [
  { lat: 40.783247448000054, lon: -119.20788409599999, label: "The Man", kind: "landmark" },
  { lat: 40.78809942300006, lon: -119.201499636, label: "The Temple", kind: "landmark" },
  { lat: 40.777372264000064, lon: -119.21561156099995, label: "Center Camp", kind: "landmark" },
  { lat: 40.78324539500005, lon: -119.22530772999994, label: "730 & G Plaza", kind: "plaza" },
  { lat: 40.77700777200005, lon: -119.19967544699995, label: "3 & B Plaza", kind: "plaza" },
  { lat: 40.79920382300003, lon: -119.20376686899999, label: "Deep-Playa Music Zone (DMZ)", kind: "deep-playa" }
];
let routeIndex = 0;

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".webm", "video/webm"],
  [".mp4", "video/mp4"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"]
]);

// Two different ages, and confusing them flatters the fix. updatedAt is when we
// last heard from the device, which a watcher refreshes every few seconds no
// matter how old the reading it is carrying; gpsTimestamp is when the satellites
// actually fixed the position. A handheld sitting on USB can answer instantly
// with a fix hours old, and reporting that as seconds old is how a stale dot
// gets believed. ageSec is the fix's own age whenever the device tells us.
function withAges(s) {
  const updated = Date.parse(s.updatedAt || 0);
  const heardSec = Number.isFinite(updated) ? Math.max(0, Math.round((Date.now() - updated) / 1000)) : null;
  const fixed = Date.parse((s.fix && s.fix.gpsTimestamp) || "");
  const fixSec = Number.isFinite(fixed) ? Math.max(0, Math.round((Date.now() - fixed) / 1000)) : null;
  return {
    ...s,
    fix: {
      ...s.fix,
      ageSec: fixSec != null ? fixSec : heardSec,
      heardSec
    }
  };
}

function publish() {
  const data = `event: state\ndata: ${JSON.stringify(withAges(state))}\n\n`;
  for (const res of clients) res.write(data);
}

function clock(at) {
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

// Labels are worked out per request rather than written down. A listing carries a
// start time, and "starts in 28 min" is only true for a minute — hand-written
// labels were still promising that hours later. An explicit timeLabel still wins,
// so the older sample file reads exactly as it did.
function timing(activity, now) {
  const start = Date.parse(activity.start || "");
  if (!Number.isFinite(start)) {
    return {
      startsAt: NaN,
      endsAt: NaN,
      startsInMin: Number.isFinite(Number(activity.startsInMin)) ? Number(activity.startsInMin) : Infinity,
      timeLabel: activity.timeLabel || "time unknown"
    };
  }
  const minutes = Number(activity.minutes) > 0 ? Number(activity.minutes) : 60;
  const end = start + minutes * 60000;
  const startsInMin = Math.round((start - now) / 60000);
  let timeLabel;
  if (activity.timeLabel) timeLabel = activity.timeLabel;
  else if (now >= start && now <= end) timeLabel = `now until ${clock(end)}`;
  else if (now > end) timeLabel = `ended at ${clock(end)}`;
  else if (startsInMin <= 90) timeLabel = `starts in ${startsInMin} min`;
  else timeLabel = `${clock(start)}`;
  return { startsAt: start, startsInMin, timeLabel, endsAt: end };
}

function rankedActivities(lat, lon) {
  const now = Date.now();
  return sampleActivities
    .map((activity) => {
      // A listing that arrives with its own coordinate keeps it. Art is surveyed
      // and most of it stands in open playa, where there is no corner to snap to
      // and an address like "9:15 2300', Open Playa" geocodes to nothing at all.
      const surveyed = Number.isFinite(activity.lat) && Number.isFinite(activity.lon)
        ? { lat: activity.lat, lon: activity.lon, source: "surveyed" }
        : null;
      const at = surveyed || placeCoords(activity.place || activity.placeName || activity.location);
      const distanceM = at ? distanceMeters(lat, lon, at.lat, at.lon) : Number(activity.distanceM || Infinity);
      return {
        ...activity,
        ...timing(activity, now),
        location: activity.location || activity.placeName || "location unknown",
        lat: at ? at.lat : null,
        lon: at ? at.lon : null,
        distanceM: Math.round(distanceM),
        coordinateSource: at ? at.source : "unplaced"
      };
    })
    // Only what is near enough to matter from this location. Unplaced listings
    // carry Infinity and drop out here by design.
    .filter((activity) => Number.isFinite(activity.distanceM) && activity.distanceM <= ACTIVITY_MAX_M)
    // What is happening now, near the mark. This can be relaxed with
    // HERMES_ACTIVITY_ACTIVE_ONLY=0 if a show wants upcoming listings too.
    .filter((activity) => {
      if (!ACTIVITY_ACTIVE_ONLY) return true;
      if (!Number.isFinite(activity.startsAt) || !Number.isFinite(activity.endsAt)) return false;
      return now >= activity.startsAt && now <= activity.endsAt + ACTIVITY_ENDED_GRACE_MIN * 60000;
    })
    // Something that finished an hour ago is not news. Kept briefly past its end
    // so a thing you are standing in the middle of does not vanish off the panel.
    .filter((activity) => !Number.isFinite(activity.endsAt) || now < activity.endsAt + 15 * 60000)
    .sort((a, b) => {
      // First prefer events scheduled close to now (starts within +/- window).
      const aNearNow = Math.abs(Number(a.startsInMin)) <= ACTIVITY_NOW_WINDOW_MIN ? 0 : 1;
      const bNearNow = Math.abs(Number(b.startsInMin)) <= ACTIVITY_NOW_WINDOW_MIN ? 0 : 1;
      if (aNearNow !== bNearNow) return aNearNow - bNearNow;
      // Then among each bucket, keep closest-first geography.
      const aNear = a.distanceM <= 200 ? 0 : 1;
      const bNear = b.distanceM <= 200 ? 0 : 1;
      if (aNear !== bNear) return aNear - bNear;
      // Finally, pick whichever starts nearest this minute.
      const aClock = Math.abs(Number(a.startsInMin));
      const bClock = Math.abs(Number(b.startsInMin));
      if (aClock !== bClock) return aClock - bClock;
      const aNow = a.startsInMin <= 0 ? 0 : 1;
      const bNow = b.startsInMin <= 0 ? 0 : 1;
      if (aNow !== bNow) return aNow - bNow;
      const aSoon = a.startsInMin >= 0 && a.startsInMin <= 60 ? 0 : 1;
      const bSoon = b.startsInMin >= 0 && b.startsInMin <= 60 ? 0 : 1;
      if (aSoon !== bSoon) return aSoon - bSoon;
      return a.distanceM - b.distanceM;
    })
    // The overlay shows one of these at a time and cycles, so it wants a hand to
    // deal from rather than the three it can fit at once. Still capped: past a
    // dozen the rotation takes longer to come round than the events last.
    .slice(0, ACTIVITY_LIMIT);
}

function rankedArt(lat, lon) {
  if (!artPieces.length || ART_LIMIT <= 0) return [];
  return artPieces
    .map((piece) => ({
      kind: "art",
      title: piece.name,
      location: piece.artist || "deep playa art",
      artist: piece.artist || "",
      about: piece.about || "",
      image: piece.image || "",
      link: piece.link || "",
      lat: piece.lat,
      lon: piece.lon,
      distanceM: Math.round(distanceMeters(lat, lon, piece.lat, piece.lon)),
      uid: piece.uid,
      bigArtCar: Boolean(piece.bigArtCar)
    }))
    .filter((piece) => Number.isFinite(piece.distanceM) && piece.distanceM <= ART_MAX_M)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, ART_LIMIT);
}

const accLocationCache = new Map();
const weatherCache = new Map();
const weatherArrow = (deg) => ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
const weatherThresholdMm15 = 0.05;

async function fetchJson(url, timeoutMs = WEATHER_TIMEOUT_MS, headers = undefined) {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

function destinationPoint(lat, lon, bearingDegNow, metersOut) {
  const rad = bearingDegNow * Math.PI / 180;
  const dLat = (Math.cos(rad) * metersOut) / 111320;
  const cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const dLon = (Math.sin(rad) * metersOut) / (111320 * cosLat);
  return { lat: lat + dLat, lon: lon + dLon };
}

function bearingDeg(aLat, aLon, bLat, bLon) {
  const to = Math.PI / 180;
  const y = Math.sin((bLon - aLon) * to) * Math.cos(bLat * to);
  const x = Math.cos(aLat * to) * Math.sin(bLat * to) -
    Math.sin(aLat * to) * Math.cos(bLat * to) * Math.cos((bLon - aLon) * to);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function openMeteoRows(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.responses)) return data.responses;
  if (data && Array.isArray(data.latitude) && Array.isArray(data.longitude)) {
    return data.latitude.map((lat, i) => ({
      latitude: lat,
      longitude: data.longitude[i],
      minutely_15: Array.isArray(data.minutely_15) ? data.minutely_15[i] : data.minutely_15
    }));
  }
  return data ? [data] : [];
}

async function weatherFromOpenMeteo(lat, lon) {
  const radiiKm = [10, 20, 35, 50];
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315];
  const pts = [{ lat, lon }];
  for (const r of radiiKm) {
    for (const b of bearings) pts.push(destinationPoint(lat, lon, b, r * 1000));
  }
  const lats = pts.map((p) => p.lat.toFixed(5)).join(",");
  const lons = pts.map((p) => p.lon.toFixed(5)).join(",");
  const rainUrl = "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lats}&longitude=${lons}&minutely_15=precipitation&forecast_minutely_15=12&timezone=auto`;
  const windUrl = "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}&current=wind_speed_10m,wind_gusts_10m,wind_direction_10m&hourly=precipitation_probability,precipitation&forecast_hours=12&timezone=auto`;
  const [rainBody, windBody] = await Promise.all([
    fetchJson(rainUrl),
    fetchJson(windUrl)
  ]);
  const rows = openMeteoRows(rainBody);
  if (!rows.length) throw new Error("open-meteo returned no rows");
  const mapped = rows.map((row) => {
    const rLat = Number(row.latitude);
    const rLon = Number(row.longitude);
    const d = Number.isFinite(rLat) && Number.isFinite(rLon) ? distanceMeters(lat, lon, rLat, rLon) : Infinity;
    const b = Number.isFinite(rLat) && Number.isFinite(rLon) ? bearingDeg(lat, lon, rLat, rLon) : NaN;
    const p0 = Number(row && row.minutely_15 && Array.isArray(row.minutely_15.precipitation) ? row.minutely_15.precipitation[0] : NaN);
    return { row, d, b, p0 };
  });
  const center = mapped.slice().sort((a, b) => a.d - b.d)[0];
  const raining = mapped
    .filter((m) => m.d > 100 && Number.isFinite(m.p0) && m.p0 >= weatherThresholdMm15)
    .sort((a, b) => a.d - b.d);
  let etaMin = NaN;
  const centreSeries = center && center.row && center.row.minutely_15 && Array.isArray(center.row.minutely_15.precipitation)
    ? center.row.minutely_15.precipitation
    : [];
  for (let i = 0; i < centreSeries.length; i++) {
    const p = Number(centreSeries[i]);
    if (Number.isFinite(p) && p >= weatherThresholdMm15) { etaMin = i * 15; break; }
  }
  const cur = windBody && windBody.current ? windBody.current : {};
  const hourly = windBody && windBody.hourly ? windBody.hourly : {};
  const hourlyTimes = Array.isArray(hourly.time) ? hourly.time : [];
  const hourlyProb = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : [];
  const hourlyMm = Array.isArray(hourly.precipitation) ? hourly.precipitation : [];
  let nextLikely = null;
  for (let i = 0; i < Math.min(hourlyTimes.length, hourlyProb.length); i++) {
    const p = Number(hourlyProb[i]);
    const mm = Number(hourlyMm[i]);
    if (Number.isFinite(p) && p >= 20) {
      nextLikely = {
        at: String(hourlyTimes[i] || ""),
        inMin: i * 60,
        probPct: p,
        precipMm: Number.isFinite(mm) ? mm : NaN
      };
      break;
    }
  }
  const windKph = Number(cur.wind_speed_10m);
  const gustKph = Number(cur.wind_gusts_10m);
  const windDirDeg = Number(cur.wind_direction_10m);
  const nearest = raining.length
    ? { d: raining[0].d, b: raining[0].b, dir: Number.isFinite(raining[0].b) ? weatherArrow(raining[0].b) : "•" }
    : null;
  return {
    provider: "open-meteo",
    rainNow: center ? Number(center.p0) : NaN,
    etaMin,
    nextLikely,
    nearest,
    windKph: Number.isFinite(windKph) ? windKph : NaN,
    gustKph: Number.isFinite(gustKph) ? gustKph : NaN,
    windDirDeg: Number.isFinite(windDirDeg) ? windDirDeg : NaN
  };
}

async function accuweatherLocationKey(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = accLocationCache.get(key);
  const now = Date.now();
  if (hit && (now - hit.at) < ACCU_LOC_TTL_MS) return hit.locKey;
  const url = "https://dataservice.accuweather.com/locations/v1/cities/geoposition/search" +
    `?apikey=${encodeURIComponent(ACCU_KEY)}&q=${encodeURIComponent(`${lat},${lon}`)}`;
  const body = await fetchJson(url);
  const locKey = String(body && body.Key || "").trim();
  if (!locKey) throw new Error("accuweather location key not found");
  accLocationCache.set(key, { at: now, locKey });
  return locKey;
}

async function weatherFromAccu(lat, lon) {
  if (!ACCU_KEY) throw new Error("no accuweather api key");
  const locKey = await accuweatherLocationKey(lat, lon);
  const curUrl = `https://dataservice.accuweather.com/currentconditions/v1/${encodeURIComponent(locKey)}?apikey=${encodeURIComponent(ACCU_KEY)}&details=true`;
  const hrUrl = `https://dataservice.accuweather.com/forecasts/v1/hourly/12hour/${encodeURIComponent(locKey)}?apikey=${encodeURIComponent(ACCU_KEY)}&details=true&metric=true`;
  const [currentBody, hourlyBody] = await Promise.all([fetchJson(curUrl), fetchJson(hrUrl)]);
  const cur = Array.isArray(currentBody) && currentBody.length ? currentBody[0] : {};
  const hourly = Array.isArray(hourlyBody) ? hourlyBody : [];
  let etaMin = NaN;
  let nextLikely = null;
  for (let i = 0; i < hourly.length; i++) {
    const h = hourly[i] || {};
    const prob = Number(h.PrecipitationProbability);
    const hasRainType = String(h.PrecipitationType || "").toLowerCase() === "rain";
    const mm = Number(h && h.Rain && h.Rain.Value);
    const when = String(h.DateTime || "");
    if (!nextLikely && Number.isFinite(prob) && prob >= 20) {
      nextLikely = {
        at: when,
        inMin: i * 60,
        probPct: prob,
        precipMm: Number.isFinite(mm) ? mm : NaN
      };
    }
    if ((Number.isFinite(prob) && prob >= 35) || (hasRainType && Number.isFinite(prob) && prob >= 20)) {
      etaMin = i * 60;
      break;
    }
  }
  const precipPastHour = Number(cur && cur.Precip1hr && cur.Precip1hr.Metric && cur.Precip1hr.Metric.Value);
  const hasPrecip = Boolean(cur && cur.HasPrecipitation);
  const rainNow = Number.isFinite(precipPastHour) ? precipPastHour / 4 : (hasPrecip ? 0.1 : 0);
  const windKph = Number(cur && cur.Wind && cur.Wind.Speed && cur.Wind.Speed.Metric && cur.Wind.Speed.Metric.Value);
  const gustKph = Number(cur && cur.WindGust && cur.WindGust.Speed && cur.WindGust.Speed.Metric && cur.WindGust.Speed.Metric.Value);
  const windDirDeg = Number(cur && cur.Wind && cur.Wind.Direction && cur.Wind.Direction.Degrees);
  return {
    provider: "accuweather",
    locationKey: locKey,
    rainNow: Number.isFinite(rainNow) ? rainNow : NaN,
    etaMin,
    nextLikely,
    windKph: Number.isFinite(windKph) ? windKph : NaN,
    gustKph: Number.isFinite(gustKph) ? gustKph : NaN,
    windDirDeg: Number.isFinite(windDirDeg) ? windDirDeg : NaN
  };
}

function mergeWeather(preferred, fallback) {
  if (!preferred && !fallback) return null;
  if (!preferred) return fallback;
  if (!fallback) return preferred;
  return {
    ...fallback,
    ...preferred,
    nearest: preferred.nearest || fallback.nearest || null,
    nextLikely: preferred.nextLikely || fallback.nextLikely || null,
    provider: `${preferred.provider}+${fallback.provider}`
  };
}

function angleDeltaDeg(a, b) {
  let d = Math.abs(((a - b) % 360 + 360) % 360);
  if (d > 180) d = 360 - d;
  return d;
}

function windDrivenEta(weather) {
  const nearest = weather && weather.nearest ? weather.nearest : null;
  const d = Number(nearest && nearest.d);
  const b = Number(nearest && nearest.b);
  const windKph = Number(weather && weather.windKph);
  const windDirDeg = Number(weather && weather.windDirDeg);
  if (!Number.isFinite(d) || !Number.isFinite(b) || !Number.isFinite(windKph) || !Number.isFinite(windDirDeg) || windKph <= 0) {
    return { etaWindMin: NaN, windPushKph: NaN, alignDeg: NaN, rainToHermesDeg: NaN, windTowardDeg: NaN };
  }
  const rainToHermesDeg = (b + 180) % 360;
  const windTowardDeg = (windDirDeg + 180) % 360;
  const alignDeg = angleDeltaDeg(rainToHermesDeg, windTowardDeg);
  const windPushKph = windKph * Math.max(0, Math.cos(alignDeg * Math.PI / 180));
  const etaWindMin = windPushKph > 0.4 ? ((d / 1000) / Math.max(0.05, windPushKph)) * 60 : NaN;
  return { etaWindMin, windPushKph, alignDeg, rainToHermesDeg, windTowardDeg };
}

// The seed ships with a hand-written label and a hand-written handful of
// listings, and both drift from the coordinates beside them. The label read "near
// 7:30 & E" for a fix half a kilometre out by the Temple, so the panel named a
// street corner while the map correctly drew the dot in open playa; the listings
// were three invented ones, which a server holding eleven real side quests would
// advertise until the first fix landed. Naming and ranking the seed exactly the
// way every later fix is named and ranked keeps the words, the markers and the
// listing telling one story from the moment the server comes up.
//
// Down here rather than beside the state it fixes: this needs the geocoder, the
// clock and the listing, all of which are declared below that point.
if (Number.isFinite(Number(state.fix && state.fix.lat)) && Number.isFinite(Number(state.fix && state.fix.lon))) {
  const seedLat = Number(state.fix.lat);
  const seedLon = Number(state.fix.lon);
  state.place = nearestPlace(seedLat, seedLon) || state.place;
  state.activities = rankedActivities(seedLat, seedLon);
  state.art = rankedArt(seedLat, seedLon);
}

// Two feeds can run at once — the Alpha over USB and a phone posting over the
// network — and the Alpha's habit is to freeze on the position it held when the
// cable went in, then repeat it every ten seconds. Last writer wins would let
// that frozen fix drag the map backwards off a live phone on every poll, so the
// freshest fix keeps the position instead. The minute of slack is for clock skew
// between two devices, far under the gap that matters. And a fix that stops
// being refreshed stops defending, so if the winner goes quiet the other feed
// takes over rather than both of them being locked out.
const FIX_SKEW_MS = 60000;
const FIX_HOLD_MS = 90000;
let acceptedAt = 0;

// How long a phone keeps the position after it stops reporting. Long enough to
// cover a pocket, a locked screen or a walk behind a shipping container; short
// enough that a phone which has genuinely left with its owner hands over before
// anyone notices the dot has stopped.
const PHONE_PIN_MS = Number(process.env.HERMES_PHONE_PIN_MS || 120000);
let phonePin = { source: "", at: 0 };
// Phone GPS can report wildly broad circles when signal is poor. A "fix" that
// says ±1km is not a position for local event ranking, so by default it is
// treated as no fix at all. Set HERMES_MAX_ACCURACY_M=0 to disable this gate.
const MAX_ACCURACY_M = Math.max(0, Number(process.env.HERMES_MAX_ACCURACY_M || 1000));
// Phone-feed stability gate: do not move Hermes on a single shaky update.
// A source must provide at least two high-confidence fixes in a row before a move
// is accepted, which suppresses jumpy "first fix" behavior.
const PHONE_HIGH_CONF_M = Math.max(1, Number(process.env.HERMES_PHONE_HIGH_CONF_M || 50));
const PHONE_HIGH_CONF_STREAK = Math.max(1, Number(process.env.HERMES_PHONE_HIGH_CONF_STREAK || 2));
const PHONE_HIGH_CONF_WINDOW_MS = Math.max(10000, Number(process.env.HERMES_PHONE_HIGH_CONF_WINDOW_MS || 180000));
const PHONE_HIGH_CONF_PAIR_MAX_M = Math.max(20, Number(process.env.HERMES_PHONE_HIGH_CONF_PAIR_MAX_M || 200));
const phoneHighConfidence = new Map();

// The van has one position, and two people sharing at once is not two opinions
// about it — it is a coin toss every few seconds. The staleness check above
// cannot help: it compares GPS timestamps, and a browser sends none, so both
// phones report "now" and each one overwrites the other. Left alone, Hermes
// ping-pongs between them and the track log records the whole argument as
// kilometres travelled.
//
// So the first phone to speak holds the position and the rest stand by. Only
// phones: the collar and the handheld carry real timestamps and are already
// arbitrated on freshness, which is the behaviour those feeds were built around.
function phoneHolder(source) {
  if (!source.startsWith("phone-")) return "";
  const held = phonePin.source && Date.now() - phonePin.at < PHONE_PIN_MS ? phonePin.source : "";
  if (held && held !== source) return held;
  phonePin = { source, at: Date.now() };
  return "";
}

const fixTimeOf = (gpsTimestamp, fallback) => {
  const gps = Date.parse(gpsTimestamp || "");
  return Number.isFinite(gps) ? gps : Date.parse(fallback || "");
};

function phoneConfidenceGate(source, lat, lon, accuracyM) {
  if (!source.startsWith("phone-")) return { ok: true, reason: "" };
  const finite = Number.isFinite(accuracyM) && accuracyM > 0;
  if (!finite || accuracyM > PHONE_HIGH_CONF_M) {
    phoneHighConfidence.delete(source);
    return {
      ok: false,
      reason: `low confidence phone fix (${Math.round(accuracyM || 0)}m) — need ${PHONE_HIGH_CONF_STREAK} updates <= ${PHONE_HIGH_CONF_M}m`
    };
  }
  const now = Date.now();
  const prior = phoneHighConfidence.get(source);
  let streak = 1;
  if (prior && now - prior.at <= PHONE_HIGH_CONF_WINDOW_MS) {
    const deltaM = distanceMeters(prior.lat, prior.lon, lat, lon);
    if (deltaM <= PHONE_HIGH_CONF_PAIR_MAX_M) streak = prior.streak + 1;
  }
  phoneHighConfidence.set(source, { lat, lon, at: now, streak });
  if (streak < PHONE_HIGH_CONF_STREAK) {
    return {
      ok: false,
      reason: `gps settling (${streak}/${PHONE_HIGH_CONF_STREAK}) — waiting for another <= ${PHONE_HIGH_CONF_M}m fix`
    };
  }
  return { ok: true, reason: "" };
}

function setLocation(fix, meta = {}) {
  const lat = Number(fix.lat);
  const lon = Number(fix.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("lat and lon must be finite numbers");
  }
  const at = fix.timestamp || new Date().toISOString();
  // A person feeding this from a phone gives a name rather than a source string,
  // so the track log says who was carrying it and two phones can be told apart.
  const named = String(fix.name || "").trim().replace(/[^\w -]/g, "").slice(0, 24);
  const source = named ? `phone-${named}` : String(fix.source || "unknown");
  const accuracyM = Number(fix.accuracyM || fix.accuracy || 0);
  const nearestArt = nearestArtPiece(lat, lon);
  const nearestBig = nearestBigArtCar(lat, lon);
  const locationFeedEntry = {
    at: new Date().toISOString(),
    reportedAt: at,
    source,
    name: named || null,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    accuracyM: Number.isFinite(accuracyM) && accuracyM > 0 ? Math.round(accuracyM) : null,
    gpsTimestamp: fix.gpsTimestamp || null,
    ip: String(meta.ip || ""),
    method: String(meta.method || ""),
    userAgent: String(meta.userAgent || "").slice(0, 200),
    nearestArt: nearestArt ? nearestArt.name : null,
    nearestArtUid: nearestArt ? nearestArt.uid : null,
    nearestArtDistanceM: nearestArt ? Math.round(nearestArt.distanceM) : null,
    nearestBigArtCar: nearestBig ? nearestBig.name : null,
    nearestBigArtCarUid: nearestBig ? nearestBig.uid : null,
    nearestBigArtCarDistanceM: nearestBig ? Math.round(nearestBig.distanceM) : null
  };

  // A test is a question, not a fix. Everyone handed the instructions taps the
  // same example URL to prove they can reach the server, and without this each of
  // them teleports Hermes to the example coordinates and leaves a point there —
  // the story's first draft had a five kilometre journey that was nothing but the
  // dot bouncing between test positions and back.
  if (String(fix.test || "") === "1" || String(fix.test || "").toLowerCase() === "true") {
    saveLocationFeed({
      ...locationFeedEntry,
      accepted: false,
      test: true,
      reason: "test only — reachable, nothing recorded"
    });
    return { accepted: false, test: true, reason: "test only — reachable, nothing recorded" };
  }

  const holder = phoneHolder(source);
  if (holder) {
    const reason = `${holder.replace(/^phone-/, "")} is feeding Hermes`;
    saveLocationFeed({
      ...locationFeedEntry,
      accepted: false,
      test: false,
      reason
    });
    return { accepted: false, reason };
  }
  if (MAX_ACCURACY_M > 0 && Number.isFinite(accuracyM) && accuracyM > MAX_ACCURACY_M) {
    const reason = `low confidence fix (${Math.round(accuracyM)}m) — waiting for <= ${MAX_ACCURACY_M}m`;
    saveLocationFeed({
      ...locationFeedEntry,
      accepted: false,
      test: false,
      reason
    });
    return {
      accepted: false,
      reason
    };
  }
  const confidenceGate = phoneConfidenceGate(source, lat, lon, accuracyM);
  if (!confidenceGate.ok) {
    saveLocationFeed({
      ...locationFeedEntry,
      accepted: false,
      test: false,
      reason: confidenceGate.reason
    });
    return { accepted: false, reason: confidenceGate.reason };
  }

  const incoming = fixTimeOf(fix.gpsTimestamp, at);
  const held = fixTimeOf(state.fix && state.fix.gpsTimestamp, state.updatedAt);
  const defended = Date.now() - acceptedAt < FIX_HOLD_MS;
  if (defended && Number.isFinite(incoming) && Number.isFinite(held) && held - incoming > FIX_SKEW_MS) {
    const reason = `held: a fix ${Math.round((held - incoming) / 1000)}s fresher is live`;
    saveLocationFeed({
      ...locationFeedEntry,
      accepted: false,
      test: false,
      reason
    });
    return { accepted: false, reason };
  }
  acceptedAt = Date.now();

  const trackPointLogged = recordTrack({
    lat,
    lon,
    accuracyM,
    gpsTimestamp: fix.gpsTimestamp || null,
    source,
    nearestArt: nearestArt ? nearestArt.name : "",
    nearestArtUid: nearestArt ? nearestArt.uid : "",
    nearestArtDistanceM: nearestArt ? nearestArt.distanceM : NaN,
    nearestBigArtCar: nearestBig ? nearestBig.name : "",
    nearestBigArtCarUid: nearestBig ? nearestBig.uid : "",
    nearestBigArtCarDistanceM: nearestBig ? nearestBig.distanceM : NaN
  }, at);
  state = {
    ...state,
    fix: {
      source,
      lat,
      lon,
      accuracyM,
      // Kept as the absolute time rather than an age, so the overlay can tick it
      // up between fixes instead of freezing on whatever it was told once.
      gpsTimestamp: fix.gpsTimestamp || null,
      ageSec: 0
    },
    place: fix.place || nearestPlace(lat, lon),
    activities: rankedActivities(lat, lon),
    art: rankedArt(lat, lon),
    updatedAt: at
  };
  publish();
  saveLocationFeed({
    ...locationFeedEntry,
    accepted: true,
    test: false,
    reason: null,
    trackPointLogged
  });
  if (nearestArt) {
    saveArtClosest({
      at,
      source,
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      art: nearestArt.name,
      artUid: nearestArt.uid,
      artArtist: nearestArt.artist || "",
      distanceM: Math.round(nearestArt.distanceM),
      bigArtCar: Boolean(nearestArt.bigArtCar)
    });
  }
  if (nearestBig) {
    saveArtClosest({
      at,
      source,
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      art: nearestBig.name,
      artUid: nearestBig.uid,
      artArtist: nearestBig.artist || "",
      distanceM: Math.round(nearestBig.distanceM),
      bigArtCar: true,
      group: "big-art-car"
    });
  }
  return { accepted: true };
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        req.destroy();
        reject(new Error("request body too large"));
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(body);
}

// Anything under here is never served, whatever the url asks for. The server's
// own private key lives in the tree it is serving, and this machine is handing
// that tree out to a camp wifi.
const NEVER_SERVE = [
  join("data", "hermes", "tls"),
  join("data", "hermes", "phone-token.txt"),
  join("data", "hermes", "pickup-requests.jsonl"),
  join("data", "hermes", "location-feed.jsonl"),
  join("data", "hermes", "location-feed-mock.jsonl"),
  join("data", "hermes", "art-closest.jsonl"),
  join("data", "hermes", "art-closest-mock.jsonl")
];

function staticPath(urlPath) {
  const requested = decodeURIComponent(urlPath.split("?")[0]);
  const rel = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
  const full = normalize(resolve(root, rel));
  if (full !== root && !full.startsWith(root + sep)) return null;
  for (const kept of NEVER_SERVE) {
    const at = join(root, kept);
    if (full === at || full.startsWith(at + sep)) return null;
  }
  return full;
}

function serveFile(req, res) {
  const full = staticPath(req.url || "/");
  if (!full || !existsSync(full)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found\n");
    return;
  }
  const st = statSync(full);
  if (!st.isFile()) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("forbidden\n");
    return;
  }
  res.writeHead(200, {
    "content-type": mime.get(extname(full).toLowerCase()) || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(full).pipe(res);
}

// Named rather than inline, because two servers share it: plain http for the
// moon and the overlay on this machine, and https for phones, which cannot use
// their location on anything else.
const handle = async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type"
      });
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    // The public request domain is for dispatch, not for the promo homepage, so
    // landing on "/" should go straight to the form.
    if (req.method === "GET" && url.pathname === "/") {
      const hostOnly = String(req.headers.host || "").split(":")[0].toLowerCase();
      if (hostOnly === "request.returnofhermes.com") {
        res.writeHead(302, { location: "/hermes-live.html", "cache-control": "no-store" });
        res.end("redirecting to /hermes-live.html\n");
        return;
      }
    }
    if (req.method === "GET" && url.pathname === "/api/hermes/state") {
      sendJson(res, 200, withAges(state));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/hermes/weather") {
      const fallbackLat = Number(state && state.fix && state.fix.lat);
      const fallbackLon = Number(state && state.fix && state.fix.lon);
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      const useLat = Number.isFinite(lat) ? lat : fallbackLat;
      const useLon = Number.isFinite(lon) ? lon : fallbackLon;
      if (!Number.isFinite(useLat) || !Number.isFinite(useLon)) {
        sendJson(res, 400, { ok: false, error: "missing location; provide lat/lon or feed Hermes first" });
        return;
      }
      const asked = String(url.searchParams.get("provider") || WEATHER_PROVIDER || "auto").trim().toLowerCase();
      const wantAccu = asked === "accuweather" || asked === "accu" || (asked === "auto" && !!ACCU_KEY);
      const cacheKey = `${asked}|${useLat.toFixed(4)},${useLon.toFixed(4)}`;
      const cacheHit = weatherCache.get(cacheKey);
      if (cacheHit && (Date.now() - cacheHit.at) <= WEATHER_CACHE_MS) {
        sendJson(res, 200, { ok: true, ...cacheHit.body, cached: true });
        return;
      }
      let open = null;
      let accu = null;
      let openErr = null;
      let accuErr = null;
      try { open = await weatherFromOpenMeteo(useLat, useLon); } catch (err) { openErr = err; }
      if (wantAccu) {
        try { accu = await weatherFromAccu(useLat, useLon); } catch (err) { accuErr = err; }
      }
      const merged = mergeWeather(accu, open);
      if (!merged) {
        sendJson(res, 502, {
          ok: false,
          error: "weather providers unavailable",
          openMeteoError: openErr ? String(openErr.message || openErr) : null,
          accuweatherError: accuErr ? String(accuErr.message || accuErr) : null
        });
        return;
      }
      const confRain = merged.nearest && Number.isFinite(merged.nearest.d)
        ? (merged.nearest.d <= 15000 ? "high" : merged.nearest.d <= 35000 ? "medium" : "low")
        : "low";
      const windEta = windDrivenEta(merged);
      const confEta = Number.isFinite(windEta.etaWindMin)
        ? (windEta.alignDeg <= 30 ? "high" : windEta.alignDeg <= 60 ? "medium" : "low")
        : (Number.isFinite(merged.etaMin) ? (merged.etaMin <= 45 ? "high" : merged.etaMin <= 120 ? "medium" : "low") : "low");
      const confWind = Number.isFinite(merged.windKph) ? "high" : "low";
      const payload = {
        ok: true,
        provider: merged.provider,
        lat: useLat,
        lon: useLon,
        rainNow: merged.rainNow,
        nearest: merged.nearest || null,
        etaMin: merged.etaMin,
        nextLikely: merged.nextLikely || null,
        etaWindMin: windEta.etaWindMin,
        windPushKph: windEta.windPushKph,
        windKph: merged.windKph,
        gustKph: merged.gustKph,
        windDirDeg: merged.windDirDeg,
        confidences: { rain: confRain, eta: confEta, wind: confWind },
        notes: {
          usingAccu: Boolean(accu),
          openMeteoFallback: Boolean(open),
          hasAccuKey: Boolean(ACCU_KEY),
          windRainAlignmentDeg: windEta.alignDeg
        }
      };
      weatherCache.set(cacheKey, { at: Date.now(), body: payload });
      sendJson(res, 200, payload);
      return;
    }
    // The track so far, so a browser that has just been opened — or reopened —
    // draws the night behind the car instead of starting its trail from wherever
    // the kiosk happened to be relaunched.
    if (req.method === "GET" && url.pathname === "/api/hermes/track") {
      const minutes = Number(url.searchParams.get("minutes"));
      const limit = Math.min(Number(url.searchParams.get("limit")) || 4000, TRACK_KEEP);
      const cutoff = Number.isFinite(minutes) && minutes > 0 ? Date.now() - minutes * 60000 : null;
      const recent = cutoff ? track.filter((p) => Date.parse(p.t) >= cutoff) : track;
      const points = recent.slice(-limit);
      sendJson(res, 200, {
        count: points.length,
        logged: track.length,
        file: trackOff ? null : trackPath,
        points
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/hermes/location-feed") {
      if (!fromThisMachine(req)) {
        const given = String(url.searchParams.get("token") || req.headers["x-hermes-token"] || "");
        if (given !== TOKEN) {
          sendJson(res, 403, { ok: false, error: "missing or wrong token — use the link from the QR code" });
          return;
        }
      }
      const limit = Math.min(Number(url.searchParams.get("limit")) || 200, LOCATION_FEED_LIMIT);
      const acceptedOnly = String(url.searchParams.get("accepted") || "");
      const entries = (acceptedOnly === "1")
        ? locationFeedRecent.filter((entry) => entry.accepted === true)
        : (acceptedOnly === "0")
          ? locationFeedRecent.filter((entry) => entry.accepted === false)
          : locationFeedRecent;
      const rows = entries.slice(-Math.max(1, limit));
      sendJson(res, 200, {
        count: rows.length,
        logged: locationFeedRecent.length,
        file: locationFeedPath,
        entries: rows
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/hermes/art-closest") {
      if (!fromThisMachine(req)) {
        const given = String(url.searchParams.get("token") || req.headers["x-hermes-token"] || "");
        if (given !== TOKEN) {
          sendJson(res, 403, { ok: false, error: "missing or wrong token — use the link from the QR code" });
          return;
        }
      }
      const limit = Math.min(Number(url.searchParams.get("limit")) || 200, ART_CLOSEST_LIMIT);
      const group = tidy(url.searchParams.get("group") || "all", 20).toLowerCase();
      const pool = group === "big-art-car"
        ? artClosestRecent.filter((row) => row && row.bigArtCar)
        : artClosestRecent;
      const rows = pool.slice(-Math.max(1, limit));
      const unique = new Map();
      for (const row of pool) {
        const key = String(row && row.artUid || row && row.art || "").trim();
        if (!key) continue;
        const prior = unique.get(key);
        if (!prior || Number(row.distanceM) < Number(prior.closestM)) {
          unique.set(key, {
            art: row.art,
            artUid: row.artUid || "",
            artist: row.artArtist || "",
            closestM: Number(row.distanceM),
            bigArtCar: Boolean(row.bigArtCar)
          });
        }
      }
      sendJson(res, 200, {
        ok: true,
        group,
        count: rows.length,
        logged: pool.length,
        file: artClosestPath,
        uniqueArtCount: unique.size,
        uniqueClosest: [...unique.values()].sort((a, b) => a.closestM - b.closestM).slice(0, 200),
        entries: rows
      });
      return;
    }
    // The same question the bot answers, in words, over http. Two reasons it is
    // here and not only in the bot: the wording can be checked without a linked
    // phone, and if WhatsApp is down or nobody has set the bot up, the answer is
    // still one URL away from anyone on the network.
    if (req.method === "GET" && url.pathname === "/api/hermes/ask") {
      const q = url.searchParams.get("q") || "where";
      const said = answer(q, {
        points: pointsFrom(track),
        activities: state.activities,
        now: Date.now(),
        zone: TZ
      });
      const plain = said ? said.text : help();
      if (url.searchParams.get("format") === "text") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        res.end(`${plain}\n`);
        return;
      }
      sendJson(res, 200, { q, intent: said ? said.intent : null, text: plain });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/hermes/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "connection": "keep-alive",
        "access-control-allow-origin": "*"
      });
      clients.add(res);
      res.write(`event: state\ndata: ${JSON.stringify(withAges(state))}\n\n`);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/hermes/pickup-qr.svg") {
      const mode = tidy(url.searchParams.get("mode") || "local", 12).toLowerCase();
      const target = tidy(url.searchParams.get("url") || pickupAppUrl(req, mode), 600);
      const svg = await QRCode.toString(target, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 1,
        width: 360,
        color: { dark: "#04101a", light: "#ffffff" }
      });
      res.writeHead(200, {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*"
      });
      res.end(svg);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/hermes/pickup-url") {
      const mode = tidy(url.searchParams.get("mode") || "local", 12).toLowerCase();
      const localUrl = pickupLocalUrl(req);
      const publicUrl = pickupPublicUrl(req) || null;
      const selected = pickupAppUrl(req, mode);
      sendJson(res, 200, { ok: true, mode, url: selected, localUrl, publicUrl });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/hermes/graph-url") {
      if (!hasAdminPickupAccess(req, url)) {
        sendJson(res, 403, { ok: false, error: "graph share link requires admin token" });
        return;
      }
      const mode = tidy(url.searchParams.get("mode") || "local", 12).toLowerCase();
      const localUrl = graphLocalUrl(req);
      const publicUrl = graphPublicUrl(req) || null;
      const selectedBase = graphAppUrl(req, mode);
      const withToken = `${selectedBase}${selectedBase.includes("?") ? "&" : "?"}t=${TOKEN}`;
      sendJson(res, 200, { ok: true, mode, url: withToken, localUrl, publicUrl, tokenized: withToken });
      return;
    }
    if (url.pathname === "/api/hermes/graph" && (req.method === "GET" || req.method === "POST")) {
      if (req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!hasAdminPickupAccess(req, url, body)) {
          sendJson(res, 403, { ok: false, error: "graph edits require admin token" });
          return;
        }
        const action = tidy(body.action || body.type || body.eventType, 24).toLowerCase();
        const who = tidy(body.by || body.intermediary || body.who || body.name || "admin", 40);
        const note = tidy(body.note || body.details || "", 400);
        const source = tidy(body.source || "crew-admin", 40);
        const severityRaw = tidy(body.severity || "", 12).toLowerCase();
        const severityRank = eventSeverityRank({
          severityRank: body.severityRank == null ? body.rank : body.severityRank,
          severity: severityRaw
        }, 5);
        const severity = ["low", "medium", "high", "critical"].includes(severityRaw)
          ? severityRaw
          : severityTextFromRank(severityRank);
        const requestId = tidy(body.requestId || body.request || "", 80);
        const linkedRequest = requestId
          ? pickupRecent.find((row) => String(row && row.id || "") === requestId)
          : null;
        let entry = null;
        if (action === "intro" || action === "introduced") {
          const fromPerson = tidy(body.from || body.introducedBy || body.introBy, 80);
          const toPerson = tidy(body.to || body.person || body.name, 80);
          if (!fromPerson || !toPerson) {
            sendJson(res, 400, { ok: false, error: "intro needs both from and to person" });
            return;
          }
          entry = {
            id: randomBytes(6).toString("hex"),
            at: new Date().toISOString(),
            type: "intro",
            fromPerson,
            toPerson,
            person: toPerson,
            kind: "intro",
            severity: "low",
            severityRank: 2,
            note,
            by: who,
            source,
            ip: clientIp(req)
          };
        } else if (action === "no-show" || action === "noshow" || action === "attendance") {
          const person = tidy(
            body.person || body.target || body.noShowPerson ||
            (linkedRequest && linkedRequest.who) ||
            "",
            80
          );
          if (!person) {
            sendJson(res, 400, { ok: false, error: "no-show needs person (or requestId tied to a request)" });
            return;
          }
          entry = {
            id: randomBytes(6).toString("hex"),
            at: new Date().toISOString(),
            type: "attendance",
            person,
            kind: "no-show",
            severity,
            severityRank,
            note,
            requestId: requestId || (linkedRequest && linkedRequest.id) || "",
            requestType: linkedRequest && linkedRequest.requestType ? linkedRequest.requestType : tidy(body.requestType || "", 24),
            place: linkedRequest && linkedRequest.place ? linkedRequest.place : tidy(body.place || "", 120),
            status: "no-show",
            by: who,
            source,
            ip: clientIp(req)
          };
        } else if (action === "ethical-breach" || action === "breach" || action === "incident") {
          const person = tidy(body.person || body.target || body.name, 80);
          if (!person) {
            sendJson(res, 400, { ok: false, error: "ethical-breach needs person" });
            return;
          }
          entry = {
            id: randomBytes(6).toString("hex"),
            at: new Date().toISOString(),
            type: "incident",
            person,
            kind: "ethical-breach",
            severity,
            severityRank,
            note,
            requestId: requestId || "",
            requestType: tidy(body.requestType || "", 24),
            place: tidy(body.place || "", 120),
            by: who,
            source,
            ip: clientIp(req)
          };
        } else if (action === "appeal" || action === "restitution" || action === "third-party-judgement" || action === "judgement") {
          const person = tidy(body.person || body.target || body.name, 80);
          if (!person) {
            sendJson(res, 400, { ok: false, error: `${action} needs person` });
            return;
          }
          const rawVerdict = tidy(body.verdict || body.summaryJudgement || body.decision, 24).toLowerCase();
          const verdict = ["clear", "mitigate", "uphold", "pending", "accepted", "rejected"].includes(rawVerdict) ? rawVerdict : "";
          const kind = action === "judgement" ? "third-party-judgement" : action;
          entry = {
            id: randomBytes(6).toString("hex"),
            at: new Date().toISOString(),
            type: kind === "third-party-judgement" ? "judgement" : "resolution",
            person,
            kind,
            severity,
            severityRank,
            verdict: verdict || (kind === "appeal" ? "pending" : ""),
            note,
            requestId: requestId || (linkedRequest && linkedRequest.id) || "",
            requestType: linkedRequest && linkedRequest.requestType ? linkedRequest.requestType : tidy(body.requestType || "", 24),
            place: linkedRequest && linkedRequest.place ? linkedRequest.place : tidy(body.place || "", 120),
            by: who,
            source,
            ip: clientIp(req)
          };
        } else {
          sendJson(res, 400, { ok: false, error: "action must be intro, no-show, ethical-breach, appeal, restitution, or third-party-judgement" });
          return;
        }
        upsertPeopleGraphEvent(entry, true);
        const graph = buildPeopleGraph({ includeRequests: true });
        sendJson(res, 200, {
          ok: true,
          event: entry,
          graph
        });
        return;
      }
      const includeRequests = !["0", "false", "no", "off"].includes(String(url.searchParams.get("includeRequests") || "1").toLowerCase());
      const graph = buildPeopleGraph({ includeRequests });
      const noShows = graph.stats.filter((s) => s.noShows > 0);
      const breaches = graph.stats.filter((s) => s.ethicalBreaches > 0);
      const assoc = graph.stats.filter((s) => s.associationRisk > 0);
      sendJson(res, 200, {
        ok: true,
        includeRequests,
        counts: {
          people: graph.nodes.filter((n) => n.kind === "person").length,
          requests: graph.nodes.filter((n) => n.kind === "request").length,
          incidents: graph.nodes.filter((n) => n.kind === "incident").length,
          resolutions: graph.nodes.filter((n) => n.kind === "resolution").length,
          intros: graph.edges.filter((e) => e.kind === "intro").length
        },
        highestRisk: graph.stats
          .filter((s) => s.noShows > 0 || s.ethicalBreaches > 0 || s.associationRisk > 0)
          .map((s) => ({ ...s, questionable: (s.netRisk || 0) > 0 }))
          .slice(0, 30),
        noShowPeople: noShows.slice(0, 50),
        ethicalBreachPeople: breaches.slice(0, 50),
        associationRiskPeople: assoc.slice(0, 50),
        recentEvents: peopleGraphRecent.slice().reverse().slice(0, 300),
        nodes: graph.nodes,
        edges: graph.edges,
        stats: graph.stats
      });
      return;
    }
    if (url.pathname === "/api/hermes/pickup/approve" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!hasAdminPickupAccess(req, url, body)) {
        sendJson(res, 403, { ok: false, error: "admin approval requires the feed link token" });
        return;
      }
      const id = tidy(body.id, 80);
      if (!id) {
        sendJson(res, 400, { ok: false, error: "request id is required" });
        return;
      }
      const statusRaw = tidy(body.status || body.approvalStatus, 12).toLowerCase();
      const approve = body.approved == null ? true : boolish(body.approved);
      const status = ["approved", "rejected", "pending"].includes(statusRaw)
        ? statusRaw
        : (approve ? "approved" : "rejected");
      const ix = pickupRecent.findIndex((row) => String(row && row.id || "") === id);
      if (ix < 0) {
        sendJson(res, 404, { ok: false, error: "request not found" });
        return;
      }
      const who = tidy(body.by || body.who || body.name || "admin", 40);
      const nowIso = new Date().toISOString();
      const current = pickupRecent[ix] || {};
      const next = {
        ...current,
        approvalStatus: status,
        approvedBy: status === "approved" ? who : "",
        approvedAt: status === "approved" ? nowIso : null
      };
      upsertPickup(next, true);
      await submitPickupApprovalUpstream(req, {
        id,
        status,
        approvalStatus: status,
        approvedBy: next.approvedBy || who,
        approvedAt: next.approvedAt || null
      });
      sendJson(res, 200, { ok: true, request: next });
      return;
    }
    if (url.pathname === "/api/hermes/pickup" && (req.method === "POST" || req.method === "GET")) {
      if (req.method === "GET") {
        await syncPickupsFromUpstream(req);
        const includePending = boolish(url.searchParams.get("includePending")) || boolish(url.searchParams.get("all"));
        const admin = includePending ? hasAdminPickupAccess(req, url) : false;
        const requests = pickupRecent
          .slice()
          .reverse()
          .filter((request) => isActiveRequest(request))
          .filter((request) => {
            if (!PICKUP_REQUIRE_APPROVAL) return true;
            if (admin) return true;
            return isApprovedRequest(request);
          })
          .map((request) => ({
            ...request,
            approvalStatus: normalizedApprovalStatus(request),
            approved: normalizedApprovalStatus(request) === "approved"
          }));
        const { nowPlaying, upNext } = pickNowPlaying(requests);
        sendJson(res, 200, {
          ok: true,
          count: requests.length,
          includePending: Boolean(includePending && admin),
          requiresApproval: PICKUP_REQUIRE_APPROVAL,
          requests,
          nowPlaying,
          upNext
        });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const ip = clientIp(req);
      const now = Date.now();
      const last = pickupLastByIp.get(ip) || 0;
      if (PICKUP_COOLDOWN_MS > 0 && now - last < PICKUP_COOLDOWN_MS) {
        sendJson(res, 429, {
          ok: false,
          error: `too soon — wait ${Math.ceil((PICKUP_COOLDOWN_MS - (now - last)) / 1000)}s`
        });
        return;
      }
      const who = tidy(body.who || body.name, 40);
      const intention = tidy(body.intention || body.intent, 120);
      const requestTypeRaw = tidy(body.requestType || body.type || body.kind, 24).toLowerCase();
      const requestType = requestTypeRaw === "dj" || requestTypeRaw === "djset" || requestTypeRaw === "dj-set"
        ? "dj-set"
        : "pickup";
      const place = tidy(body.place, 120);
      const note = tidy(body.note, 220);
      const equipmentNeeded = tidy(body.equipmentNeeded || body.equipment || body.gear, 160);
      const pickupWhen = tidy(body.pickupWhen || body.when || body.pickupAt, 80);
      if (requestType === "pickup" && !place) {
        sendJson(res, 400, { ok: false, error: "pickup place is required" });
        return;
      }
      const where = place ? placeCoords(place) : null;
      const pickupAtMs = requestType === "pickup"
        ? parseRequestWhen(pickupWhen || "asap", now)
        : parseRequestWhen(pickupWhen || "", now);
      const payload = {
        who: who || "anonymous",
        intention,
        requestType,
        place: place || (requestType === "dj-set" ? "wherever Hermes is now" : ""),
        pickupWhen: pickupWhen || "asap",
        equipmentNeeded,
        note,
        approvalStatus: PICKUP_REQUIRE_APPROVAL ? "pending" : "approved",
        approvedBy: "",
        approvedAt: null
      };
      const mirrored = await submitPickupUpstream(req, payload);
      const request = mirrored || {
        id: randomBytes(5).toString("hex"),
        at: new Date(now).toISOString(),
        ...payload,
        pickupAt: Number.isFinite(pickupAtMs) ? new Date(pickupAtMs).toISOString() : null,
        lat: where && Number.isFinite(where.lat) ? Number(where.lat) : NaN,
        lon: where && Number.isFinite(where.lon) ? Number(where.lon) : NaN,
        approvalStatus: ["approved", "pending", "rejected"].includes(String(payload.approvalStatus || "").toLowerCase())
          ? String(payload.approvalStatus || "").toLowerCase()
          : "approved",
        approvedBy: payload.approvedBy || "",
        approvedAt: payload.approvedAt || null,
        source: mirrored ? "web-app" : "public-live-local",
        ip
      };
      request.approvalStatus = normalizedApprovalStatus(request);
      request.approvedBy = tidy(request.approvedBy || "", 40);
      request.approvedAt = request.approvalStatus === "approved"
        ? (new Date(Date.parse(request.approvedAt || "") || now).toISOString())
        : null;
      pickupLastByIp.set(ip, now);
      upsertPickup(request, true);
      sendJson(res, 200, { ok: true, request });
      return;
    }
    // GET as well as POST, because the other end of this is a phone: an iOS
    // Shortcut builds a URL in one step and needs a JSON body constructed by
    // hand, and a URL can be pasted into Safari to prove the path works before
    // anything is automated.
    if (url.pathname === "/api/location" && (req.method === "POST" || req.method === "GET")) {
      // Read from the query either way: the phone page puts it in the URL so the
      // token rides along in the link people are handed, and a link is the only
      // thing anyone at a show is going to be given.
      if (!fromThisMachine(req)) {
        const given = String(url.searchParams.get("token") || req.headers["x-hermes-token"] || "");
        if (given !== TOKEN) {
          sendJson(res, 403, { ok: false, error: "missing or wrong token — use the link from the QR code" });
          return;
        }
      }
      const fix = req.method === "GET"
        ? Object.fromEntries(url.searchParams)
        : JSON.parse((await readBody(req)) || "{}");
      const result = setLocation(fix, {
        ip: clientIp(req),
        method: req.method,
        userAgent: req.headers["user-agent"]
      });
      // Somebody who has just been handed a link and told to tap it needs to know
      // in one line whether it worked. The whole state is a screenful of JSON and
      // reads like an error to anyone not expecting it.
      if (req.method === "GET") {
        sendJson(res, 200, {
          ok: true,
          accepted: result.accepted,
          // Passed through so the phone page can say who has the position rather
          // than guess at it — the page posts with GET, so this shape is the only
          // one it ever sees.
          reason: result.reason,
          feeding: state.fix.source,
          hermesAt: `${state.fix.lat}, ${state.fix.lon}`,
          // The shortcut this used to talk about is gone: /phone does the job in
          // a browser now, and telling someone to go and build one is worse than
          // saying nothing.
          note: result.test
            ? "You can reach Hermes. Nothing was recorded — open /phone to start sharing."
            : result.accepted
              ? "Hermes has your position. Leave the page open."
              : `Not used: ${result.reason}. Another phone is feeding Hermes right now.`
        });
        return;
      }
      sendJson(res, 200, { ok: true, ...result, state: withAges(state) });
      return;
    }

    // Short enough to read out across a camp or type from a photo of a whiteboard.
    // The whole point of the phone page is that it is handed to people, and
    // "/phone.html" is two more things to get wrong than "/phone".
    if (req.method === "GET" && /^\/phone(\/|\.html)?$/.test(url.pathname)) {
      // Sent to https if it arrived any other way. A phone loading this over
      // plain http gets a page that looks perfectly fine and can never actually
      // read its location — browsers refuse outside a secure context, and a LAN
      // address is not one. Silently useless is the worst of the options, so an
      // http link is bounced rather than served. Localhost is exempt: it counts
      // as secure on its own, and the show itself runs there.
      const host = String(req.headers.host || "").split(":")[0];
      const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
      // A tunnel counts too. Cloudflare and Tailscale both terminate TLS at their
      // edge and hand us plain http on the loopback, so the socket looks insecure
      // while the phone's connection is genuinely https — and bouncing it to the
      // LAN address is the one thing guaranteed not to work from off the network.
      // Trusting the header is safe here because the redirect is a courtesy, not
      // a control: a browser lied to into staying on http still refuses to give
      // up a position, which is the outcome this was steering away from anyway.
      const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
      const secure = req.socket.encrypted || forwarded === "https";
      if (!secure && !local && host) {
        // Query carried across, or the token in the link is lost on the way to
        // the page that needs it and every phone lands on a page that cannot post.
        const to = `https://${host}:${phonePort}/phone${url.search}`;
        res.writeHead(302, { location: to, "cache-control": "no-store" });
        res.end(`the phone page needs https so your browser will share location: ${to}\n`);
        return;
      }
      req.url = "/phone.html";
    }

    serveFile(req, res);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || String(err) });
  }
};

const server = createServer(handle);

// The phone side, on https, because a browser will not give up a position over
// plain http to anything but localhost — the moon is on this machine and is fine,
// a phone across the wifi is not. HERMES_PHONE=off skips it.
const phonePort = Number(process.env.HERMES_PHONE_PORT || port + 1);
function startPhoneListener() {
  if (String(process.env.HERMES_PHONE || "").toLowerCase() === "off") return;
  const addresses = lanAddresses();
  if (!addresses.length) {
    console.log("[hermes] phones: no network address on this machine, nothing to hand out");
    return;
  }
  let tls;
  try {
    tls = ensureCert(join(root, "data", "hermes", "tls"), addresses);
  } catch (err) {
    // Not fatal. The moon does not need this; only the phones do, and saying so
    // plainly beats a stack trace in the middle of a show.
    console.log(`[hermes] phones: no certificate (${String(err.message || err).split("\n")[0]})`);
    console.log("[hermes] phones: needs openssl on PATH — phones cannot share location without it");
    return;
  }
  createTlsServer({ key: tls.key, cert: tls.cert }, handle)
    .on("error", (err) => console.log(`[hermes] phones: ${err.message}`))
    .listen(phonePort, host, () => {
      if (tls.fresh) console.log("[hermes] phones: made a fresh certificate for this network");
      // The http one is what gets handed out, even though the page can only work
      // over https. It redirects, and it survives being typed: an address with no
      // scheme in front of it is tried as http, and http aimed at the https port
      // is not a redirect but a connection failure. So the link that forgives
      // being retyped from a photo of a whiteboard is this one.
      for (const ip of addresses) {
        console.log(`[hermes] phones -> http://${ip}:${port}/phone?t=${TOKEN}   (share this one)`);
      }
      // Said out loud because it is the one thing people will ask about, and
      // whoever is running the show has to be able to answer it without
      // guessing: the certificate is self-signed, so the warning is expected.
      console.log(`[hermes] phones: it lands on https://…:${phonePort}/phone, which warns once —`);
      console.log("[hermes] phones: self-signed certificate, tap through and location works");
    });
}

if (mock) {
  setInterval(() => {
    routeIndex = (routeIndex + 1) % route.length;
    const point = route[routeIndex];
    setLocation({
      source: "mock-route",
      lat: point.lat,
      lon: point.lon,
      accuracyM: 7 + routeIndex,
      place: {
        label: point.label,
        kind: point.kind,
        detail: "Mock playa route"
      }
    });
  }, 8000);
}

server.listen(port, host, () => {
  console.log(`[hermes] serving ${root}`);
  // show=1 matters: without it the page comes up as a bare moon with an empty
  // orbit and a black iris, because the acts and the clips are parameters.
  console.log(`[hermes] moon: http://127.0.0.1:${port}/hypermoon.html?show=1&kiosk=1&hermes=1`);
  console.log(`[hermes] state: http://127.0.0.1:${port}/api/hermes/state`);
  console.log(`[hermes] crew graph: http://127.0.0.1:${port}/hermes-crew-graph.html`);
  console.log(trackOff
    ? "[hermes] track log off (HERMES_TRACK=off)"
    : `[hermes] track: ${trackPath} (${track.length} point(s) so far)`);
  const upstream = upstreamPickupBase({ headers: { host: "" } });
  if (upstream) {
    console.log(`[hermes] pickup sync: upstream ${upstream} every ${Math.round(PICKUP_SYNC_MS / 1000)}s`);
    if (PICKUP_REMOTE_WRITE) console.log("[hermes] pickup write mode: mirror to web app, local fallback");
  } else {
    console.log("[hermes] pickup sync: local-only (no upstream configured)");
  }
  console.log(`[hermes] art: ${artPieces.length} pieces from ${loadedArt.path || "none"} (<= ${ART_MAX_M}m, cap ${ART_LIMIT})`);
  console.log(`[hermes] big art cars: ${artPieces.filter((p) => p.bigArtCar).length} matched (config ${bigArtCarsPath})`);
  console.log(`[hermes] nearest-art log: ${artClosestPath} (${artClosestRecent.length} entries)`);
  console.log(`[hermes] people graph events: ${peopleGraphPath} (${peopleGraphRecent.length} entries)`);
  // Said out loud because an empty city is silent otherwise: every fix would be
  // named after the nearest official point from a kilometre away, or not at all,
  // and the panel would look merely vague rather than broken.
  console.log(places.intersections
    ? `[hermes] city: ${places.intersections} corners, ${places.cpns} official points`
    : `[hermes] no city loaded from ${places.gisDir} — places will not be named`);
  // Said out loud, because a resumed position looks exactly like a live one on
  // the map and the difference matters when you are wondering why it has not
  // moved: nothing is feeding it until a watcher is running.
  console.log(resume
    ? `[hermes] resumed at ${resume.lat},${resume.lon} from the track log — run npm run hermes:alpha for live fixes`
    : `[hermes] no track log to resume from, holding the seed position — run npm run hermes:alpha for live fixes`);
  startPhoneListener();
  console.log(`[hermes] or leave the show on :8080 and add ?hermes=1 — the overlay finds :${port}`);
  if (mock) console.log("[hermes] mock route enabled");
});
