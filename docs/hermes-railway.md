# Hermes Always-On (Railway + Postgres)

This deploy keeps `request.returnofhermes.com` online even when the laptop is off.

## 1) Create Railway project

1. Push this repo to GitHub.
2. In Railway, create a new project from the repo.
3. Add a **Postgres** service in the same project.
4. Add a custom domain on the web service: `request.returnofhermes.com`.

## 2) Required variables

Set these on the Railway web service:

- `HERMES_PICKUP_URL=https://request.returnofhermes.com/`
- `HERMES_PHONE=off`
- `HERMES_RESUME=1`
- `HERMES_ACTIVITY_MAX_M=2000` (or your preferred range)
- `HERMES_ART_MAX_M=4000`
- `HERMES_ART_LIMIT=80`

Railway injects `DATABASE_URL` from Postgres automatically.

## 3) Optional variables

- `BM_API_KEY=...` to ingest current-year official Burning Man API data.
- `HERMES_TOKEN=...` to pin the location token across restarts.
- `HERMES_TZ=America/Los_Angeles`
- `HERMES_WEATHER_PROVIDER=auto` (`auto`, `open-meteo`, or `accuweather`)
- `ACCUWEATHER_API_KEY=...` to enable AccuWeather weather data
- `HERMES_ACCUWEATHER_API_KEY=...` (alias of `ACCUWEATHER_API_KEY`)

You can verify the key locally with:

- `npm run hermes:accuweather`
- optional coords: `ACCUWEATHER_LAT=40.78 ACCUWEATHER_LON=-119.20 npm run hermes:accuweather`

## 4) Data model

When `DATABASE_URL` is present, Hermes writes to Postgres:

- `hermes_track_points`
- `hermes_location_feed`
- `hermes_pickup_requests`

Local JSONL files remain as fallback and compatibility mode.

## 5) Validate after deploy

- `https://request.returnofhermes.com/` should open the request form.
- `https://request.returnofhermes.com/api/hermes/state` should return JSON.
- `https://request.returnofhermes.com/api/hermes/pickup` should return requests.

