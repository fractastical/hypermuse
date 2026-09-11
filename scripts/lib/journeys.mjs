// Carving a night out of a track log.
//
// A log is a list of coordinates. A journey is a thing that happened: Hermes sat
// somewhere for a while, went somewhere else, sat again. Everything the story
// tells is read off that shape, so this is where the shape gets found.
//
// Three ideas, in order of how much they matter:
//
// A gap in the log is not a straight line. The recorder is unplugged for hours at
// a time and the phones only feed within range of one router, so long silences are
// the normal case and joining across them would invent a route through the city
// that nothing drove. Points more than a gap apart are therefore different
// journeys, and the story says it does not know what happened in between.
//
// A stop is not a point, it is a cluster. GPS wanders ten or twenty metres while
// parked, so a stationary hour arrives as an hour of slightly different
// coordinates. Anything staying inside a radius counts as one place.
//
// A brief pause is not a stop. Waiting to turn is not somewhere Hermes went, and
// a story that lists it reads like a GPS trace rather than a night, so a cluster
// has to last a while before it earns a name.
import { distanceMeters, nearestPlace } from "./playa-places.mjs";

// Long enough that a stalled watcher or an unplugged handheld reads as a silence
// rather than as a very slow drive.
export const SESSION_GAP_MS = 30 * 60000;
// About two camp frontages. Wider and neighbouring camps merge into one stop;
// narrower and parked GPS drift looks like driving up and down the street.
export const STOP_RADIUS_M = 45;
// Under this it was a pause, not a place.
export const STOP_MIN_MS = 8 * 60000;

export function readTrack(text) {
  const records = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { continue; }
  }
  return pointsFrom(records);
}

// The same cleaning, for a caller that already holds the records as objects —
// the running server keeps its log in memory and would otherwise have to
// re-read and re-parse the file it just wrote to answer a question about it.
export function pointsFrom(records) {
  const points = [];
  const seen = new Set();
  for (const point of records) {
    if (!point || typeof point !== "object") continue;
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // The satellite time is when the position was true; the line's own timestamp
    // is only when it reached the log, which for a harvest is hours later and
    // would file a whole night under the minute it was plugged in.
    const ms = Date.parse(point.gps || point.t);
    if (!Number.isFinite(ms)) continue;
    // The harvest appends and the server appends, and both may hold the same fix.
    const key = `${ms}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ ms, lat, lon, src: point.src || "" });
  }
  // Appended out of order by construction: a harvest drops a whole night in after
  // the live fixes that were written while it was happening.
  points.sort((a, b) => a.ms - b.ms);
  return points;
}

// Runs of points close enough in time to be one continuous record.
export function sessions(points, gapMs = SESSION_GAP_MS) {
  const out = [];
  let run = [];
  for (const point of points) {
    if (run.length && point.ms - run[run.length - 1].ms > gapMs) {
      out.push(run);
      run = [];
    }
    run.push(point);
  }
  if (run.length) out.push(run);
  return out;
}

// Greedy clusters: take the earliest point still unassigned and absorb every
// following point that stays within the radius of the running centroid.
function findStops(points, radiusM, minMs) {
  const stops = [];
  let i = 0;
  while (i < points.length) {
    let j = i;
    let sumLat = points[i].lat;
    let sumLon = points[i].lon;
    let lat = points[i].lat;
    let lon = points[i].lon;
    while (j + 1 < points.length &&
      distanceMeters(lat, lon, points[j + 1].lat, points[j + 1].lon) <= radiusM) {
      j++;
      sumLat += points[j].lat;
      sumLon += points[j].lon;
      lat = sumLat / (j - i + 1);
      lon = sumLon / (j - i + 1);
    }
    const dwellMs = points[j].ms - points[i].ms;
    if (j > i && dwellMs >= minMs) {
      stops.push({ from: i, to: j, lat, lon, dwellMs });
      i = j + 1;
    } else {
      i++;
    }
  }
  return stops;
}

const walked = (points, from, to) => {
  let metres = 0;
  for (let i = from + 1; i <= to; i++) {
    metres += distanceMeters(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return metres;
};

// One session as a sequence of stops and the legs between them. Legs keep the
// bounding stop's point at each end, so a leg's distance is the whole way from
// where it left to where it arrived rather than the middle of it.
export function timeline(points, opts = {}) {
  const radiusM = opts.radiusM || STOP_RADIUS_M;
  const minMs = opts.minMs || STOP_MIN_MS;
  const stops = findStops(points, radiusM, minMs);
  const out = [];
  let cursor = 0;
  for (const stop of stops) {
    if (stop.from > cursor) {
      out.push({
        kind: "leg",
        from: cursor,
        to: stop.from,
        startMs: points[cursor].ms,
        endMs: points[stop.from].ms,
        metres: walked(points, cursor, stop.from),
        place: nearestPlace(points[stop.from].lat, points[stop.from].lon)
      });
    }
    out.push({
      kind: "stop",
      from: stop.from,
      to: stop.to,
      lat: stop.lat,
      lon: stop.lon,
      startMs: points[stop.from].ms,
      endMs: points[stop.to].ms,
      dwellMs: stop.dwellMs,
      place: nearestPlace(stop.lat, stop.lon)
    });
    cursor = stop.to;
  }
  const last = points.length - 1;
  if (cursor < last) {
    // A journey that ends in motion. Where it was going is not in the log — the
    // record simply stops — so the last point is where it was last seen and not
    // where it arrived, and the story has to word it that way.
    out.push({
      kind: "leg",
      from: cursor,
      to: last,
      startMs: points[cursor].ms,
      endMs: points[last].ms,
      metres: walked(points, cursor, last),
      place: nearestPlace(points[last].lat, points[last].lon),
      openEnded: true
    });
  }
  return out;
}

// A journey is a session with its shape worked out and its ends named. Sessions of
// a single point are still returned: "Hermes was here at 4pm and we know nothing
// else" is a true and sometimes the only available story.
export function journeys(points, opts = {}) {
  return sessions(points, opts.gapMs).map((run) => {
    const events = timeline(run, opts);
    const first = run[0];
    const last = run[run.length - 1];
    const moving = events.filter((e) => e.kind === "leg");
    const stopped = events.filter((e) => e.kind === "stop");
    return {
      startMs: first.ms,
      endMs: last.ms,
      points: run,
      events,
      metres: walked(run, 0, run.length - 1),
      movingMs: moving.reduce((sum, e) => sum + (e.endMs - e.startMs), 0),
      stoppedMs: stopped.reduce((sum, e) => sum + e.dwellMs, 0),
      stops: stopped.length,
      from: nearestPlace(first.lat, first.lon),
      to: nearestPlace(last.lat, last.lon),
      sources: [...new Set(run.map((p) => p.src).filter(Boolean))]
    };
  });
}
