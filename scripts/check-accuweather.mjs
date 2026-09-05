#!/usr/bin/env node

const apiKey = String(
  process.env.ACCUWEATHER_API_KEY ||
  process.env.HERMES_ACCUWEATHER_API_KEY ||
  ""
).trim();
const lat = Number(process.env.ACCUWEATHER_LAT || 40.783247448000054);
const lon = Number(process.env.ACCUWEATHER_LON || -119.20788409599999);

if (!apiKey) {
  console.error("Missing ACCUWEATHER_API_KEY (or HERMES_ACCUWEATHER_API_KEY).");
  process.exit(1);
}
if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error("Invalid ACCUWEATHER_LAT/ACCUWEATHER_LON.");
  process.exit(1);
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

const geoUrl = "https://dataservice.accuweather.com/locations/v1/cities/geoposition/search" +
  `?apikey=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(`${lat},${lon}`)}`;
const geo = await fetchJson(geoUrl);
const locationKey = String(geo && geo.Key || "").trim();
if (!locationKey) {
  throw new Error("AccuWeather returned no location key.");
}

const currentUrl = `https://dataservice.accuweather.com/currentconditions/v1/${encodeURIComponent(locationKey)}?apikey=${encodeURIComponent(apiKey)}&details=true`;
const hourlyUrl = `https://dataservice.accuweather.com/forecasts/v1/hourly/12hour/${encodeURIComponent(locationKey)}?apikey=${encodeURIComponent(apiKey)}&details=true&metric=true`;
const [currentRows, hourlyRows] = await Promise.all([fetchJson(currentUrl), fetchJson(hourlyUrl)]);
const current = Array.isArray(currentRows) && currentRows.length ? currentRows[0] : {};
const hourly = Array.isArray(hourlyRows) ? hourlyRows : [];
const firstRain = hourly.find((row) => Number(row && row.PrecipitationProbability) >= 35);

console.log("[accuweather] key ok");
console.log(`[accuweather] location key: ${locationKey}`);
console.log(`[accuweather] localized name: ${geo && geo.LocalizedName ? geo.LocalizedName : "unknown"}`);
console.log(`[accuweather] current precip: ${current && current.HasPrecipitation ? "yes" : "no"}`);
console.log(`[accuweather] wind km/h: ${Number(current && current.Wind && current.Wind.Speed && current.Wind.Speed.Metric && current.Wind.Speed.Metric.Value) || 0}`);
console.log(`[accuweather] gust km/h: ${Number(current && current.WindGust && current.WindGust.Speed && current.WindGust.Speed.Metric && current.WindGust.Speed.Metric.Value) || 0}`);
if (firstRain) {
  console.log(`[accuweather] first rain-prob>=35%: ${firstRain.DateTime}`);
} else {
  console.log("[accuweather] no >=35% rain probability in 12h forecast");
}
