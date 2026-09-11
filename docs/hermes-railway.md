# Hermes Always-On (Railway + Postgres)

This deploy keeps the site online even when the laptop is off.

Until this is done, the laptop *is* the origin: `cloudflared` runs a tunnel from
`~/.cloudflared/config.yml` to `127.0.0.1:8124`, so closing the lid takes all
three hostnames down with it.

## 1) Create Railway project

1. Push this repo to GitHub.
2. In Railway, create a new project from the repo. It picks up `railway.json`
   for the start command and healthcheck.
3. Add a **Postgres** service in the same project. This is not optional: the
   container filesystem is ephemeral, so without it every redeploy discards the
   track log, the location feed and the pickup requests.
4. Add all three custom domains on the web service, or it will not answer for
   them: `returnofhermes.com`, `www.returnofhermes.com`,
   `request.returnofhermes.com`.

## 2) Required variables

Set these on the Railway web service:

- `HERMES_PICKUP_URL=https://returnofhermes.com/`
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

## 5) Point DNS off the tunnel

All three names are Cloudflare CNAMEs to
`4cbac6f0-8dac-4a8f-b53b-2293f25bb891.cfargotunnel.com`, which is this laptop.
Repoint each to the Railway target (`<something>.up.railway.app`):

| Name | Type | Value |
| --- | --- | --- |
| `returnofhermes.com` | CNAME | the Railway target |
| `www` | CNAME | the Railway target |
| `request` | CNAME | the Railway target |

Set them to **DNS only** (grey cloud) until Railway reports the certificate
issued; a proxied record hides the origin from the ACME check and the domain
sits pending. Once it is green, the proxy can go back on with SSL mode Full
(strict). Cloudflare flattens the CNAME at the apex, so the root needs no A
record.

Then stop the tunnel on the laptop, which is no longer serving anything:

```
pkill -f 'cloudflared tunnel run hermes-return'
```

## 6) Validate after deploy

Check the apex, not just the subdomain — the apex is what the QR code on the
moon display points at:

- `https://returnofhermes.com/` should redirect to `/hermes-live.html`.
- `https://returnofhermes.com/api/hermes/state` should return JSON.
- `https://returnofhermes.com/api/hermes/pickup` should return requests.
- The startup log should say `art: 341 pieces` and `city: 308 corners`. Zero of
  either means a data file did not make it into the build.

