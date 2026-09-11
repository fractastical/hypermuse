// Turning playa coordinates into somewhere, and somewhere back into coordinates.
//
// Two jobs that look like one. Going from a fix to a name is what the overlay and
// the story want: "8:45 & E", or a landmark when there is no corner near enough to
// claim. Going the other way is what a listing wants, because an event says where
// it is the way a person would say it and the map needs a dot.
//
// Lifted out of the server so the story tool names places the same way the live
// panel does. Two implementations would drift, and the drift would show up as the
// dispatch calling a corner by a different name than the screen did all night.
//
// Paths resolve from this file rather than the working directory, so a script run
// from anywhere gets the same city.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const gisDir = process.env.HERMES_GIS || join(repo, "data", "hermes", "2026", "gis");

export function distanceMeters(aLat, aLon, bLat, bLon) {
  const latM = (aLat - bLat) * 111320;
  const lonM = (aLon - bLon) * Math.cos(((aLat + bLat) / 2) * Math.PI / 180) * 111320;
  return Math.hypot(latM, lonM);
}

const cpnPath = join(gisDir, "cpns.geojson");
export const cpns = existsSync(cpnPath)
  ? JSON.parse(readFileSync(cpnPath, "utf8")).features
    .filter((feature) => feature.geometry && feature.geometry.type === "Point")
    .map((feature) => ({
      name: (feature.properties && feature.properties.NAME) || "Unknown CPN",
      lon: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1]
    }))
  : [];

const streetPath = join(gisDir, "street_lines.geojson");
export const streetIntersections = [];
// Every point of every named street, kept so an address naming a corner the city
// does not have can still be placed. The quarter-hour radials stop at F, so there
// is no such thing as 8:45 & E, and a listing written by eye will happily say it.
const streetPoints = new Map();
if (existsSync(streetPath)) {
  const pointNames = new Map();
  const streets = JSON.parse(readFileSync(streetPath, "utf8")).features || [];
  for (const feature of streets) {
    const name = feature.properties && feature.properties.name;
    const coordinates = feature.geometry && feature.geometry.coordinates;
    if (!name || !Array.isArray(coordinates)) continue;
    for (const coordinate of coordinates) {
      if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
      const key = `${Number(coordinate[0]).toFixed(6)},${Number(coordinate[1]).toFixed(6)}`;
      if (!pointNames.has(key)) {
        pointNames.set(key, { lon: coordinate[0], lat: coordinate[1], names: new Set() });
      }
      pointNames.get(key).names.add(String(name));
      if (!streetPoints.has(String(name))) streetPoints.set(String(name), []);
      streetPoints.get(String(name)).push({ lon: coordinate[0], lat: coordinate[1] });
    }
  }
  for (const point of pointNames.values()) {
    const names = [...point.names].sort();
    if (names.length >= 2) streetIntersections.push({ ...point, names });
  }
}

// Corners by name, so a listing can say where it is the way a person would.
// Stored both ways round because "8:45 & E" and "E & 8:45" are the same corner.
const cornersByName = new Map();
for (const point of streetIntersections) {
  const key = (names) => names.join(" & ").toLowerCase();
  cornersByName.set(key(point.names), point);
  if (point.names.length === 2) cornersByName.set(key([...point.names].reverse()), point);
}

export function kindForName(name) {
  if (/temple|man|center camp/i.test(name)) return "landmark";
  if (/plaza/i.test(name)) return "plaza";
  if (/dmz|deep/i.test(name)) return "deep-playa";
  if (/portal|promenade|station|camp|artery|dmv/i.test(name)) return "place";
  return "poi";
}

export function nearestIntersection(lat, lon) {
  if (!streetIntersections.length) return null;
  let nearest = null;
  for (const intersection of streetIntersections) {
    const distanceM = distanceMeters(lat, lon, intersection.lat, intersection.lon);
    if (!nearest || distanceM < nearest.distanceM) nearest = { ...intersection, distanceM };
  }
  return nearest;
}

// A corner is only your address if you are standing near it. There is always a
// nearest intersection, even from a kilometre out in open playa, and naming it
// regardless put the panel's label nowhere near the dot the map drew. A block
// is roughly 60m, so past that fall through to the official points, which is
// what deep playa is actually named by.
const INTERSECTION_M = 70;

export function nearestPlace(lat, lon) {
  const nearest = nearestIntersection(lat, lon);
  if (nearest && nearest.distanceM <= INTERSECTION_M) {
    return {
      label: nearest.names.join(" & "),
      kind: "intersection",
      detail: `${Math.round(nearest.distanceM)}m from the corner`
    };
  }
  // Nothing to name it with. Callers keep whatever label they already had rather
  // than replacing a true one with a blank.
  if (!cpns.length) return null;
  let best = null;
  for (const cpn of cpns) {
    const distanceM = distanceMeters(lat, lon, cpn.lat, cpn.lon);
    if (!best || distanceM < best.distanceM) best = { ...cpn, distanceM };
  }
  return {
    label: best.distanceM <= 35 ? best.name : `near ${best.name}`,
    kind: kindForName(best.name),
    detail: `${Math.round(best.distanceM)}m from official CPN`
  };
}

function cpnByName(name) {
  const wanted = String(name || "").toLowerCase();
  return cpns.find((cpn) => cpn.name.toLowerCase() === wanted);
}

const CLOCK = /^(\d{1,2}):(\d{2})$/;
const clockMinutes = (text) => {
  const m = CLOCK.exec(String(text).trim());
  return m ? (Number(m[1]) % 12) * 60 + Number(m[2]) : null;
};

// The street a name means, which is not always a street that exists. "5:55" is
// nobody's address but it is obviously 6:00, so a radial snaps to the nearest one
// the city was actually built with, up to half an hour away.
function resolveStreet(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  for (const key of streetPoints.keys()) if (key.toLowerCase() === raw.toLowerCase()) return key;
  const want = clockMinutes(raw);
  if (want == null) return "";
  let best = "";
  let bestDelta = Infinity;
  for (const key of streetPoints.keys()) {
    const have = clockMinutes(key);
    if (have == null) continue;
    const delta = Math.min(Math.abs(have - want), 720 - Math.abs(have - want));
    if (delta < bestDelta) { bestDelta = delta; best = key; }
  }
  return bestDelta <= 30 ? best : "";
}

// The closest the two streets come to each other. For a real corner that is the
// corner; for 8:45 & E, where the radial stops one ring short, it is the end of
// 8:45 and the point of E nearest to it, which is where somebody saying "8:45 and
// E" is standing.
function meetingPoint(a, b) {
  const first = streetPoints.get(a) || [];
  const second = streetPoints.get(b) || [];
  let best = null;
  for (const p of first) {
    for (const q of second) {
      const d = distanceMeters(p.lat, p.lon, q.lat, q.lon);
      if (!best || d < best.d) best = { d, p, q };
    }
  }
  if (!best) return null;
  return { lat: (best.p.lat + best.q.lat) / 2, lon: (best.p.lon + best.q.lon) / 2, gap: best.d };
}

function lookupPlace(name) {
  const raw = String(name || "").trim();
  const corner = cornersByName.get(raw.toLowerCase());
  if (corner) return { lat: corner.lat, lon: corner.lon, source: "street corner" };
  const parts = raw.split("&").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 2) {
    const a = resolveStreet(parts[0]);
    const b = resolveStreet(parts[1]);
    if (a && b) {
      const exact = cornersByName.get([a, b].sort().join(" & ").toLowerCase());
      if (exact) {
        const snapped = a.toLowerCase() !== parts[0].toLowerCase() ||
          b.toLowerCase() !== parts[1].toLowerCase();
        return { lat: exact.lat, lon: exact.lon, source: snapped ? `${a} & ${b}` : "street corner" };
      }
      const met = meetingPoint(a, b);
      if (met) return { lat: met.lat, lon: met.lon, source: `near ${a} & ${b}` };
    }
  }
  const cpn = cpnByName(raw);
  if (cpn) return { lat: cpn.lat, lon: cpn.lon, source: "official CPN" };
  return null;
}

// A street corner first, an official point second. Lets a listing be addressed
// like a person would address it — "9:15 & J" — and still land on the map. Cached
// because the walk over two street geometries is not free and the answer for a
// given address never changes.
const placeCache = new Map();
export function placeCoords(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  if (placeCache.has(key)) return placeCache.get(key);
  const found = lookupPlace(name);
  placeCache.set(key, found);
  return found;
}

// So a caller can say out loud whether it got a city or an empty directory,
// which is the difference between "open playa" and a missing geojson.
export const loaded = {
  cpns: cpns.length,
  intersections: streetIntersections.length,
  streets: streetPoints.size,
  gisDir
};
