#!/usr/bin/env node
// Labels Hermes fixes with the nearest art piece, or "deep playa".
//
//   npm run hermes:art:nearby
//   npm run hermes:art:nearby -- --year=2025
//   npm run hermes:art:nearby -- --max=300 --dry
//
// This does two things in one run:
// 1) Downloads and saves the full official art list for the chosen year.
// 2) Enriches every track point with a nearest-art label for analytics.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { distanceMeters } from "./lib/playa-places.mjs";
import { readTrack } from "./lib/journeys.mjs";

const root = process.cwd();
const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const year = Number(arg("year", new Date().getFullYear()));
const dry = flag("dry");
const trackPath = process.env.HERMES_TRACK || join(root, "data", "hermes", "track.jsonl");
const outDir = join(root, "data", "hermes", "art");
const artOut = arg("artOut", join(outDir, `${year}-art.json`));
const pointsOut = arg("out", join(outDir, `${year}-track-near-art.jsonl`));
const summaryOut = arg("summaryOut", join(outDir, `${year}-track-near-art-summary.json`));
const maxNearM = Math.max(1, Number(arg("max", process.env.HERMES_ART_NEAR_M || 250)));

const ARCHIVE = "https://bm-innovate.s3.amazonaws.com/archive";
const LIVE = "https://api.burningman.org/api/v1";
const key = process.env.BM_API_KEY || "";

const basic = () => "Basic " + Buffer.from(key.includes(":") ? key : `${key}:`).toString("base64");

async function grabArt() {
  const thisYear = new Date().getFullYear();
  const live = Boolean(key) && year >= thisYear;
  const url = live ? `${LIVE}/art?year=${year}` : `${ARCHIVE}/${year}/art.json`;
  const res = await fetch(url, live ? { headers: { authorization: basic() } } : undefined);
  if (live && (res.status === 401 || res.status === 403)) {
    throw new Error(`${url}\n  refused BM_API_KEY. Request one at https://api.burningman.org/`);
  }
  if (!res.ok) throw new Error(`${url}\n  answered ${res.status} ${res.statusText}`);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) throw new Error(`${url}\n  did not answer with a list`);
  return { rows, url };
}

function withGps(rows) {
  return rows
    .map((row) => {
      const lat = Number(row && row.location && row.location.gps_latitude);
      const lon = Number(row && row.location && row.location.gps_longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        uid: row.uid || "",
        name: String(row.name || "Unnamed Art").trim() || "Unnamed Art",
        category: String((row.hometown && row.hometown.trim()) || ""),
        lat,
        lon
      };
    })
    .filter(Boolean);
}

function nearestArt(point, art) {
  let best = null;
  for (const piece of art) {
    const d = distanceMeters(point.lat, point.lon, piece.lat, piece.lon);
    if (!best || d < best.distanceM) best = { ...piece, distanceM: d };
  }
  return best;
}

function enrich(points, art) {
  return points.map((point) => {
    const nearest = nearestArt(point, art);
    const close = nearest && nearest.distanceM <= maxNearM;
    return {
      t: new Date(point.ms).toISOString(),
      lat: Number(point.lat.toFixed(6)),
      lon: Number(point.lon.toFixed(6)),
      src: point.src || "",
      nearestArt: close ? nearest.name : "deep playa",
      nearestArtUid: close ? nearest.uid : "",
      nearestArtDistanceM: nearest ? Math.round(nearest.distanceM) : null,
      nearestArtCategory: close ? nearest.category : ""
    };
  });
}

function summarize(rows) {
  const counts = new Map();
  for (const row of rows) {
    const keyName = row.nearestArt || "deep playa";
    counts.set(keyName, (counts.get(keyName) || 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name, fixes]) => ({ name, fixes }));
  const deep = counts.get("deep playa") || 0;
  return { totalFixes: rows.length, deepPlayaFixes: deep, artTaggedFixes: rows.length - deep, top };
}

async function main() {
  if (!existsSync(trackPath)) {
    throw new Error(`no track log at ${trackPath}`);
  }

  const { rows: artRows, url } = await grabArt();
  const artGps = withGps(artRows);
  if (!artGps.length) {
    throw new Error(`downloaded art list has no GPS rows (${url})`);
  }
  const points = readTrack(readFileSync(trackPath, "utf8"));
  if (!points.length) {
    throw new Error(`track log has no usable points (${trackPath})`);
  }

  const enriched = enrich(points, artGps);
  const summary = {
    year,
    source: url,
    generated: new Date().toISOString(),
    maxNearM,
    artRows: artRows.length,
    artGpsRows: artGps.length,
    ...summarize(enriched)
  };

  console.log(`art source: ${url}`);
  console.log(`art rows: ${artRows.length} (${artGps.length} with GPS)`);
  console.log(`track points: ${points.length}`);
  console.log(`nearby threshold: ${maxNearM}m`);
  console.log(`deep playa fixes: ${summary.deepPlayaFixes}`);
  console.log(`art-tagged fixes: ${summary.artTaggedFixes}`);

  if (dry) {
    console.log("\n--dry, no files written");
    return;
  }

  mkdirSync(dirname(artOut), { recursive: true });
  mkdirSync(dirname(pointsOut), { recursive: true });
  mkdirSync(dirname(summaryOut), { recursive: true });
  writeFileSync(artOut, `${JSON.stringify({ year, source: url, generated: new Date().toISOString(), rows: artRows }, null, 2)}\n`);
  writeFileSync(pointsOut, enriched.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeFileSync(summaryOut, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`\nwrote art list: ${artOut}`);
  console.log(`wrote enriched track: ${pointsOut}`);
  console.log(`wrote summary: ${summaryOut}`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
