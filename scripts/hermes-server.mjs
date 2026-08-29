#!/usr/bin/env node
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { setInterval } from "node:timers";

const root = process.cwd();
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const mock = process.argv.includes("--mock");
const samplePath = join(root, "data", "hermes", "sample-state.json");
const sample = JSON.parse(readFileSync(samplePath, "utf8"));
const activitiesPath = join(root, "data", "hermes", "sample-activities.json");
const sampleActivities = existsSync(activitiesPath) ? JSON.parse(readFileSync(activitiesPath, "utf8")) : sample.activities || [];
const cpnPath = join(root, "data", "hermes", "2026", "gis", "cpns.geojson");
const cpns = existsSync(cpnPath) ? JSON.parse(readFileSync(cpnPath, "utf8")).features
  .filter((feature) => feature.geometry && feature.geometry.type === "Point")
  .map((feature) => ({
    name: feature.properties && feature.properties.NAME || "Unknown CPN",
    lon: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1]
  })) : [];
const streetPath = join(root, "data", "hermes", "2026", "gis", "street_lines.geojson");
const streetIntersections = [];
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
      if (!pointNames.has(key)) pointNames.set(key, { lon: coordinate[0], lat: coordinate[1], names: new Set() });
      pointNames.get(key).names.add(String(name));
    }
  }
  for (const point of pointNames.values()) {
    const names = [...point.names].sort();
    if (names.length >= 2) streetIntersections.push({ ...point, names });
  }
}
const clients = new Set();

let state = {
  ...sample,
  updatedAt: new Date().toISOString()
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

function withAges(s) {
  const updated = Date.parse(s.updatedAt || 0);
  const ageSec = Number.isFinite(updated) ? Math.max(0, Math.round((Date.now() - updated) / 1000)) : null;
  return {
    ...s,
    fix: {
      ...s.fix,
      ageSec
    }
  };
}

function publish() {
  const data = `event: state\ndata: ${JSON.stringify(withAges(state))}\n\n`;
  for (const res of clients) res.write(data);
}

function distanceMeters(aLat, aLon, bLat, bLon) {
  const latM = (aLat - bLat) * 111320;
  const lonM = (aLon - bLon) * Math.cos(((aLat + bLat) / 2) * Math.PI / 180) * 111320;
  return Math.hypot(latM, lonM);
}

function kindForName(name) {
  if (/temple|man|center camp/i.test(name)) return "landmark";
  if (/plaza/i.test(name)) return "plaza";
  if (/dmz|deep/i.test(name)) return "deep-playa";
  if (/portal|promenade|station|camp|artery|dmv/i.test(name)) return "place";
  return "poi";
}

function nearestIntersection(lat, lon) {
  if (!streetIntersections.length) return null;
  let nearest = null;
  for (const intersection of streetIntersections) {
    const distanceM = distanceMeters(lat, lon, intersection.lat, intersection.lon);
    if (!nearest || distanceM < nearest.distanceM) nearest = { ...intersection, distanceM };
  }
  return nearest;
}

function nearestPlace(lat, lon) {
  const nearest = nearestIntersection(lat, lon);
  if (nearest) {
    return {
      label: nearest.names.join(" & "),
      kind: "GPS position",
      detail: ""
    };
  }
  if (!cpns.length) return state.place;
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

function rankedActivities(lat, lon) {
  return sampleActivities
    .map((activity) => {
      const cpn = cpnByName(activity.placeName || activity.location);
      const distanceM = cpn ? distanceMeters(lat, lon, cpn.lat, cpn.lon) : Number(activity.distanceM || Infinity);
      return {
        ...activity,
        location: activity.location || activity.placeName || "location unknown",
        lat: cpn ? cpn.lat : null,
        lon: cpn ? cpn.lon : null,
        distanceM: Math.round(distanceM),
        coordinateSource: cpn ? "official CPN" : "sample"
      };
    })
    .sort((a, b) => {
      const aNear = a.distanceM <= 200 ? 0 : 1;
      const bNear = b.distanceM <= 200 ? 0 : 1;
      if (aNear !== bNear) return aNear - bNear;
      const aNow = a.startsInMin <= 0 ? 0 : 1;
      const bNow = b.startsInMin <= 0 ? 0 : 1;
      if (aNow !== bNow) return aNow - bNow;
      const aSoon = a.startsInMin >= 0 && a.startsInMin <= 60 ? 0 : 1;
      const bSoon = b.startsInMin >= 0 && b.startsInMin <= 60 ? 0 : 1;
      if (aSoon !== bSoon) return aSoon - bSoon;
      return a.distanceM - b.distanceM;
    })
    .slice(0, 3);
}

function setLocation(fix) {
  const lat = Number(fix.lat);
  const lon = Number(fix.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("lat and lon must be finite numbers");
  }
  state = {
    ...state,
    fix: {
      source: String(fix.source || "unknown"),
      lat,
      lon,
      accuracyM: Number(fix.accuracyM || fix.accuracy || 0),
      ageSec: 0
    },
    place: fix.place || nearestPlace(lat, lon),
    activities: rankedActivities(lat, lon),
    updatedAt: fix.timestamp || new Date().toISOString()
  };
  publish();
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

function staticPath(urlPath) {
  const requested = decodeURIComponent(urlPath.split("?")[0]);
  const rel = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
  const full = normalize(resolve(root, rel));
  if (full !== root && !full.startsWith(root + sep)) return null;
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

const server = createServer(async (req, res) => {
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
    if (req.method === "GET" && url.pathname === "/api/hermes/state") {
      sendJson(res, 200, withAges(state));
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
    if (req.method === "POST" && url.pathname === "/api/location") {
      const body = await readBody(req);
      setLocation(JSON.parse(body || "{}"));
      sendJson(res, 200, { ok: true, state: withAges(state) });
      return;
    }

    serveFile(req, res);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || String(err) });
  }
});

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
  console.log(`[hermes] moon: http://127.0.0.1:${port}/hypermoon.html?kiosk=1&hermes=1`);
  console.log(`[hermes] state: http://127.0.0.1:${port}/api/hermes/state`);
  if (mock) console.log("[hermes] mock route enabled");
});
