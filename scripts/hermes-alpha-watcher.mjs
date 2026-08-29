#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const positionPath = process.env.ALPHA_POSITION_PATH ||
  "/run/user/1000/gvfs/mtp:host=Garmin_A_0000d75ca571/Internal Storage/GARMIN/.Position.gpx";
const hermesUrl = process.env.HERMES_URL || "http://127.0.0.1:8124/api/location";
const intervalMs = Math.max(1000, Number(process.env.ALPHA_INTERVAL_MS || 5000));
const accuracyM = Number(process.env.ALPHA_ACCURACY_M || 10);

function parsePosition(xml) {
  const match = xml.match(/<wpt\s+lat="([^\"]+)"\s+lon="([^\"]+)"/i);
  if (!match) throw new Error("no waypoint found in Alpha position file");
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("invalid Alpha coordinates");
  const fixTime = xml.match(/<time>([^<]+)<\/time>/i)?.[1] || null;
  return { lat, lon, fixTime };
}

async function poll() {
  const xml = await readFile(positionPath, "utf8");
  const position = parsePosition(xml);
  const body = {
    source: "alpha-300-usb",
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
  console.log(`[alpha] ${body.lat},${body.lon} observed=${body.timestamp} fix=${body.gpsTimestamp || "unknown"}`);
}

console.log(`[alpha] watching ${positionPath}`);
console.log(`[alpha] posting to ${hermesUrl} every ${intervalMs}ms`);

while (true) {
  try {
    await poll();
  } catch (error) {
    console.error(`[alpha] ${error.message}`);
  }
  await delay(intervalMs);
}
