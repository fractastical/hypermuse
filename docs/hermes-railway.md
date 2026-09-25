# Hermes Always-On (Railway + Postgres)

This deploy keeps the site online even when the laptop is off.

## Where this got to (17 September 2026)

Steps 1 to 4 below are **done**, so read them as history rather than as a
checklist. Do not ask whether the project exists, whether the repo is connected
or whether Postgres was added — the running server answers all three from
outside, without a dashboard or a login:

```
curl -s https://returnofhermes.com/api/hermes/faults |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
    console.log("postgres:", j.faults.at(-1).postgres, "degraded:", j.degraded.length)})'
```

`postgres: true` means it found `DATABASE_URL` and the connection actually
opened, which is a stronger claim than the variable being set; an empty
`degraded` list means nothing else came up short at boot. The custom domains
answer, and `/book`, `/annals` and both APIs return.

One thing is **not** done: **auto-deploy does not fire**. A push lands on GitHub
Pages by itself but does nothing to `returnofhermes.com` until someone triggers
a build by hand, which is the drift step 2 warns about. The last four pushes all
needed a manual refresh. Confirm the live site matches the repo with:

```
curl -sL https://returnofhermes.com/docs/annals/ | grep -c 'class="toc"'
```

Zero means the container is behind and a manual deploy is owed.

## Step 5 was only half done: two names are still the laptop (19 September 2026)

`www` and `request` are **served by this laptop**, through the cloudflared tunnel
that step 5 says to stop. Only the apex was moved to Railway. That is why the
site "only works when the laptop is open" — for two of the three names, it
literally does.

Status codes hide this, because the laptop answers 200 just as happily as Railway
does. Ask each name which process replied instead: every one serves
`/api/hermes/faults`, and the start record names the port it is listening on.

```
for h in returnofhermes.com www.returnofhermes.com request.returnofhermes.com; do
  printf '%-30s ' "$h"
  curl -s "https://$h/api/hermes/faults" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const f=JSON.parse(s).faults.find(x=>x.kind==="start");console.log(f.at, f.message)})'
done
```

**8124 is this laptop. 8080 is Railway.** On 19 September that gave:

| Name | Answers on | Origin | Dies with the lid |
| --- | --- | --- | --- |
| `returnofhermes.com` | `0.0.0.0:8080` | Railway | no |
| `www` | `0.0.0.0:8124` | this laptop | **yes** |
| `request` | `0.0.0.0:8124` | this laptop | **yes** |

Two different start times across the three names is the same evidence from
another angle: they are two different servers, not one behind three aliases.
`~/.cloudflared/config.yml` still routes all three hostnames to
`http://127.0.0.1:8124`, and the tunnel and the local server are both still
running, so the apex is only off the laptop because its DNS was repointed — the
tunnel would still serve it otherwise.

What this does *not* affect: booking. The annals link out to
`https://returnofhermes.com/book`, on the apex, which Railway serves — so the form
people are being asked to fill in for next year stays up with the lid closed.

What it does affect is smaller but not nothing. Anyone who types `www` gets the
laptop. `request` serves the pickup form, whose season is over, but
`hermes/live.html` still gives `request.returnofhermes.com` as its canonical URL,
its `og:url` and its JSON-LD logo, so link previews and anything crawling the
tracker resolve against a host that is only up sometimes.

### Finishing it, in an order that does not break the site

The two names have to exist in Railway *before* Cloudflare has anywhere to point
them, and the tunnel has to keep running until they do.

To ask whether Railway knows a name, ask its router, not its certificate. Point
curl at the Railway edge with `--resolve`, and use `-k` so the wrong certificate
does not stop the request before the answer comes back:

```
for h in returnofhermes.com www.returnofhermes.com request.returnofhermes.com; do
  printf '%-30s ' "$h"
  curl -sk -o /dev/null -w '%{http_code}\n' --resolve "$h:443:69.46.46.79" \
    "https://$h/api/hermes/faults"
done
```

`200` means a service claims that hostname. `404` with a body of
`{"status":"error","code":404,"message":"Application not found"}` means nothing on
Railway does, whatever the dashboard appears to show — that is the router saying
it has no route, and it is the check to trust. On 19 September the apex gave 200
and the other two gave 404 even after an attempt to add them, which is what
"added to the wrong service" looks like from outside.

Do **not** use the certificate as the test of whether a domain was added:

```
echo | openssl s_client -connect 69.46.46.79:443 -servername www.returnofhermes.com 2>/dev/null |
  openssl x509 -noout -subject
```

A subject of `*.up.railway.app` only means no certificate has been issued for that
name yet, and that is also the normal state of a domain that *has* been added and
is still waiting for DNS to point at Railway so the check can pass. It tells you
about step 3, not about step 1.

1. **Railway** → the project → the service already serving the apex → Settings →
   Networking → Custom Domain. Add `www.returnofhermes.com`, then
   `request.returnofhermes.com`. It must be the same service, or the names will
   resolve to something that is not this app. Railway prints a CNAME target per
   domain; keep it for step 2.

2. **Cloudflare** → `returnofhermes.com` → DNS → Records. The `www` and `request`
   records currently point at
   `4cbac6f0-8dac-4a8f-b53b-2293f25bb891.cfargotunnel.com`, which is this laptop.
   Edit each to the Railway target from step 1, and set **Proxy status to DNS only
   (grey cloud)**. Proxied hides the origin from the certificate check and the
   domain sits pending forever — this is the step that most likely caused the
   original drift.

3. **Wait for the certificates.** Re-run the loop above until `www` and `request`
   report their own names rather than `*.up.railway.app`. Railway's dashboard says
   the same thing.

4. **Cloudflare** → flip both back to **Proxied (orange cloud)**, with SSL/TLS
   mode **Full (strict)**.

5. **Confirm before touching the tunnel**, with `npm run check:live`. It has to say
   `up, all off the laptop` and show all three names `from railway`. While any name
   still says `from laptop`, `cloudflared` is load-bearing and stopping it takes
   that name down.

6. **Then stop the tunnel.** It is a launchd agent with `KeepAlive`, so `pkill`
   only gets it restarted; unload the agent instead:

```
launchctl bootout gui/$(id -u)/com.hypermuse.hermes-cloudflared
```

   Leave `com.hypermuse.hermes-server` alone if you still want a local copy on
   8124 for development; nothing public depends on it once step 5 passes.

Do not start at step 6. Removing the tunnel first takes `www` and `request` down
until steps 1 to 4 are finished, and `request` is the pickup form.

One caveat on the apex, which is now a bare `A` record at `69.46.46.79` (the
address is Railway's; `whois` gives `NetName: RLWY-HIKARI-01`, and replies carry
`server: railway-hikari` with no `cf-ray`). It works and it does not depend on
the laptop, but step 5 asked for a proxied CNAME, and Railway hands out a CNAME
target rather than an IP because those edge addresses are not promised to stay
put. A pinned IP is worth revisiting once the other two names are moved.

`npm run check:live` checks all of this on every pass: it reports the origin per
name, warns while any name is still on the laptop, exits non-zero so it cannot be
ignored, and appends each pass to `artifacts/live-log.jsonl` so the next "it went
down" has a record behind it. It also catches a restart between passes and a name
that serves pages while its API does not. `WATCH=60 npm run check:live` leaves it
running.

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
   Turn on **auto-deploy from the connected branch** while you are in here. With
   it off, a push changes nothing that anyone can see: the annals are static
   files served out of the image, so the repo and the live site drift apart
   silently and the only symptom is old writing on a URL you have already handed
   out. Every publish then needs a manual redeploy that is easy to forget.
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
- `HERMES_PICKUP_URL=https://returnofhermes.com/request` — this is handed out
  verbatim, as the QR code and the link a rider is given. The apex itself leads to
  the annals, so the pickup form is a page on that same host: `/request` redirects
  to `/hermes/live.html`. There is no separate hostname for it.
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
- `hermes_annals_comments`

Local JSONL files remain as fallback and compatibility mode.

`hermes_annals_comments` is what the published annals collect from readers, and it is
the one table whose contents cannot be reconstructed from anything: a track point can
be re-imported and a comment cannot. Without `DATABASE_URL` the comments live only in
`data/hermes/annals-comments.jsonl`, which on Railway is a container disk that is
discarded on every deploy — so on Railway the database is not optional for them.

Taking a comment down means setting `hidden` on its row (or on its JSONL line); the
read path filters those out, and the raw file is never served, so nothing withdrawn
comes back through a different door. Set `HERMES_ANNALS_COMMENTS=0` to close the box
altogether.

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

- `https://returnofhermes.com/` should redirect to `/docs/annals/`, and
  `https://returnofhermes.com/docs/annals/` should return the page itself. A
  redirect to `/hermes/live.html` here is the signature of a container built
  before the annals existed — the apex led to the tracker until the annals
  became the front door, so this check used to assert the opposite.
- `https://request.returnofhermes.com/` should still reach `/hermes/live.html`.
  This is the hostname riders are given, and it is the one that must never
  follow the apex to the annals.
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

