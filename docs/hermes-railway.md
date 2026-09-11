# Hermes Always-On (Railway + Postgres)

This deploy keeps the site online even when the laptop is off.

Until this is done, the laptop *is* the origin. Two processes have to be up, and
both are launchd agents with `KeepAlive` and `RunAtLoad`, so they start at login
and come back on their own if they crash or are killed:

- `com.hypermuse.hermes-server` — the app, on `127.0.0.1:8124`
- `com.hypermuse.hermes-cloudflared` — `cloudflared tunnel run hermes-return`,
  forwarding all three hostnames there per `~/.cloudflared/config.yml`

They fail differently, which is worth knowing before diagnosing:

- app down, tunnel up → Cloudflare returns **502**, because the connector is
  there but has nothing to forward to
- tunnel down → Cloudflare returns **1033** or **530**, because there is no
  connector at all

What `KeepAlive` cannot survive is the machine: powered off, asleep, or logged
out. These are LaunchAgents, not LaunchDaemons, so they are tied to the login
session — nobody logged in means nothing serving. That is the gap this deploy
closes, and it is the only gap left.

## 1) Create Railway project

1. Push this repo to GitHub.
2. In Railway, create a new project from the repo. It picks up `railway.json`
   for the start command and healthcheck.
3. Add a **Postgres** service in the same project. This is not optional: the
   container filesystem is ephemeral, so without it every redeploy discards the
   track log, the location feed and the pickup requests.
4. Add all three custom domains on the web service, or it will not answer for
   them: `returnofhermes.com`, `www.returnofhermes.com`,
   `request.returnofhermes.com`. Each asks for a port: give it the same number
   as `PORT` below, or the edge routes to a port nothing is listening on and
   every hostname answers 502.

## 2) Required variables

Set these on the Railway web service:

- `PORT=8080` — the server falls back to 8124 when this is unset, so the number
  here and the number in the domain dialog have to agree.
- `HERMES_PICKUP_URL=https://returnofhermes.com/`
- `HERMES_PHONE=off` — otherwise it tries to bind a second https port and make
  certificates for a LAN the container does not have.
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
- `/api/hermes/faults` lists anything the server found wrong at startup, which is
  the quickest way to see a Postgres connection that silently failed.

A note on 8080 in particular. `npm start` in this repo is
`npx http-server -c-1 -p 8080 .`, the same port. `railway.json` overrides it, so
this does not normally arise — but if the override is ever missed, http-server
binds 8080 and serves the repo as static files. The tracker page then loads and
looks correct while every `/api/hermes/*` call returns 404, and because the port
matches, the failure disguises itself as a working deploy. The deploy log tells
them apart: `[hermes] serving` is the right process, an http-server banner is
not.

