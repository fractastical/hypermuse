#!/usr/bin/env node
const url = process.env.HERMES_URL || "http://127.0.0.1:8080/api/location";
const lat = Number(process.argv[2] || process.env.HERMES_LAT || 40.78645);
const lon = Number(process.argv[3] || process.env.HERMES_LON || -119.20332);
const accuracyM = Number(process.argv[4] || process.env.HERMES_ACCURACY_M || 8);

const body = {
  source: "manual",
  lat,
  lon,
  accuracyM,
  timestamp: new Date().toISOString()
};

const resp = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

const text = await resp.text();
console.log(resp.status, text);
