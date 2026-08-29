#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = join(root, "data", "hermes", "2026", "map");
const svgPath = join(outDir, "playa-streets.svg");
const pngPath = join(outDir, "playa-streets.png");
const width = 1400;
const height = 900;

const streets = JSON.parse(readFileSync(join(root, "data", "hermes", "2026", "gis", "street_lines.geojson"), "utf8"));
const cpns = JSON.parse(readFileSync(join(root, "data", "hermes", "2026", "gis", "cpns.geojson"), "utf8"));

function cpnPoint(name) {
  const wanted = name.toLowerCase();
  const feature = cpns.features.find((f) => String(f.properties?.NAME || "").toLowerCase() === wanted);
  if (!feature || feature.geometry?.type !== "Point") throw new Error(`missing CPN ${name}`);
  const [lon, lat] = feature.geometry.coordinates;
  return { lon, lat };
}

const man = cpnPoint("The Man");
const temple = cpnPoint("The Temple");
const latScale = 111320;
const lonScale = Math.cos(man.lat * Math.PI / 180) * 111320;
let rotation = 0;

function rawMeters(lon, lat) {
  return {
    x: (lon - man.lon) * lonScale,
    y: (lat - man.lat) * latScale
  };
}

{
  const t = rawMeters(temple.lon, temple.lat);
  rotation = (Math.PI / 2) - Math.atan2(t.y, t.x);
}

function rotatePoint(lon, lat) {
  const p = rawMeters(lon, lat);
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return {
    x: p.x * c - p.y * s,
    y: p.x * s + p.y * c
  };
}

const all = [];
for (const feature of streets.features) {
  const coords = feature.geometry?.coordinates || [];
  if (feature.geometry?.type !== "LineString") continue;
  coords.forEach(([lon, lat]) => all.push(rotatePoint(lon, lat)));
}
const extraBoundsCpns = new Set([
  "The Temple",
  "Deep-Playa Music Zone (DMZ)",
  "Deep-Playa Music Zone 2 (DMZ2)"
]);
for (const feature of cpns.features) {
  if (feature.geometry?.type !== "Point") continue;
  if (!extraBoundsCpns.has(feature.properties?.NAME)) continue;
  const [lon, lat] = feature.geometry.coordinates;
  all.push(rotatePoint(lon, lat));
}

const b = all.reduce((acc, p) => ({
  minX: Math.min(acc.minX, p.x),
  minY: Math.min(acc.minY, p.y),
  maxX: Math.max(acc.maxX, p.x),
  maxY: Math.max(acc.maxY, p.y)
}), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

const pad = 70;
const scale = Math.min((width - pad * 2) / (b.maxX - b.minX), (height - pad * 2) / (b.maxY - b.minY));
const mapW = (b.maxX - b.minX) * scale;
const mapH = (b.maxY - b.minY) * scale;
const ox = (width - mapW) / 2;
const oy = (height - mapH) / 2;

function screen(lon, lat) {
  const p = rotatePoint(lon, lat);
  return {
    x: ox + (p.x - b.minX) * scale,
    y: oy + (b.maxY - p.y) * scale
  };
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;"
  }[ch]));
}

function pathFor(coords) {
  return coords.map(([lon, lat], i) => {
    const p = screen(lon, lat);
    return `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }).join(" ");
}

function styleFor(name) {
  if (name === "ESP") return "stroke:rgba(255,255,255,0.96);stroke-width:7.2;fill:none;stroke-linecap:round;stroke-linejoin:round";
  if (/^\d/.test(name || "")) return "stroke:rgba(248,252,255,0.86);stroke-width:4.8;fill:none;stroke-linecap:round;stroke-linejoin:round";
  return "stroke:rgba(232,238,242,0.78);stroke-width:4.2;fill:none;stroke-linecap:round;stroke-linejoin:round";
}

const paths = streets.features
  .filter((feature) => feature.geometry?.type === "LineString")
  .map((feature) => `<path d="${pathFor(feature.geometry.coordinates)}" style="${styleFor(feature.properties?.name)}"/>`)
  .join("\n");

const manPt = screen(man.lon, man.lat);
const templePt = screen(temple.lon, temple.lat);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<g opacity="1">
${paths}
<path d="M${manPt.x.toFixed(1)} ${manPt.y.toFixed(1)} L${templePt.x.toFixed(1)} ${templePt.y.toFixed(1)}" style="stroke:rgba(255,255,255,0.58);stroke-width:3.4;fill:none;stroke-linecap:round"/>
<circle cx="${manPt.x.toFixed(1)}" cy="${manPt.y.toFixed(1)}" r="12" fill="rgba(255,255,255,0.98)"/>
<path d="M${templePt.x.toFixed(1)} ${(templePt.y - 13).toFixed(1)} L${(templePt.x + 12).toFixed(1)} ${(templePt.y + 10).toFixed(1)} L${(templePt.x - 12).toFixed(1)} ${(templePt.y + 10).toFixed(1)} Z" fill="none" stroke="rgba(255,255,255,0.94)" stroke-width="4.2"/>
<text x="${(manPt.x + 19).toFixed(1)}" y="${(manPt.y + 5).toFixed(1)}" fill="rgba(255,255,255,0.94)" font-size="28" font-family="Menlo, monospace">MAN</text>
<text x="${(templePt.x + 20).toFixed(1)}" y="${(templePt.y + 5).toFixed(1)}" fill="rgba(255,255,255,0.88)" font-size="26" font-family="Menlo, monospace">TEMPLE</text>
</g>
</svg>
`;

mkdirSync(dirname(svgPath), { recursive: true });
writeFileSync(svgPath, svg);
writeFileSync(join(outDir, "playa-streets-metadata.json"), JSON.stringify({
  source: "Burning Man 2026 official GIS street_lines.geojson and cpns.geojson",
  image: "playa-streets.png",
  width,
  height,
  origin: man,
  rotation,
  bounds: b,
  scale,
  offset: { x: ox, y: oy }
}, null, 2));

const result = spawnSync("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel", "error",
  "-i", svgPath,
  "-frames:v", "1",
  pngPath
], { stdio: "inherit" });

if (result.status !== 0) {
  console.log(`[hermes-map] wrote SVG ${svgPath}; ffmpeg PNG conversion failed`);
  process.exit(result.status || 1);
}
console.log(`[hermes-map] wrote ${pngPath}`);
