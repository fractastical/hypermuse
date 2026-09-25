# Hypermoon live-show transfer

Unzip this archive **into the repo root** on the live machine (it mirrors the
repo layout and safely overwrites `hypermoon.html` / `controller.html` with the
latest versions). Then:

    npm start          # http-server on :8080  (or: npx http-server -c-1 -p 8080 .)

- Output window: `http://localhost:8080/hypermoon.html?kiosk=1`
  (or open it from the controller's "open output" button)
- Controller: `http://localhost:8080/controller.html`

**Hot keys in the output window.** The controller drives everything from another
window, which is fine at a desk and useless on a car at night: there is nowhere
to put the laptop and nothing to read it by. So the layers go in and out from the
keyboard of the machine the show is on, and every key answers on screen — a key
that silently does nothing, because the layer was already out or this show never
had one, is worse than no key at all.

`g` orbiting sprites · `v` vajras · `s` stars · `b` backdrop clip · `f` the
flashed mark · `i` the iris · `n` hands on to the next orbit act · `m` gathers or
scatters the flower · `a` goes up and shows where we are · `0` puts everything
back · `?` lists the lot with what is currently in and out.

A toggle puts back what it took out rather than a default, so a starfield taken
down and brought back comes back at the count the show was running. Anything with
cmd, ctrl or alt held is left to the browser, so quitting and reloading still
work. `?hotkeys=0` turns the whole thing off for an installation that might get
leant on.

**The playa overlay.** `?hermes=1` puts what is on nearby in the top right and a
Black Rock City street map, with the position and the track on it, in the bottom
left. Without that parameter the script returns immediately and nothing about the
show changes, so it costs nothing to leave in.

Listings are shown **one at a time and cycled**, about ten seconds each
(`?hermeshold=` in seconds), with a thin bar along the bottom counting the card
down. Three at once meant the third was always sliced off mid-word and none of
them had room for an icon. Each listing carries an animated icon chosen from its
own words — a stargate gets a UFO, a poetry reading gets a butterfly — and the
same icon is stamped on the map where the listing is, ringed in amber for the one
the panel is currently talking about. Up to ten listings are carried at once, so
the map reads as the legend and the panel walks through it.

The icons live in `hermes/icons/`, picked out of the GifCities library by
`npm run hermes:icons`. They are tracked in git, unlike the library itself, since
the overlay refers to them by name. A slot is a meaning rather than a picture, so
re-running the picker changes which gif means "portal" without touching the rule
that says a stargate is one. Only cut-outs are eligible: the picker decodes each
candidate and rejects anything carrying its own background, because on the night
sky a gif with a background is a coloured box with a picture in it.

**The position is coordinates**, to five decimal places, and nothing else. It
used to name the nearest official point, which reads well in a plaza and lies on
a street: parked on F between the 8:30 and 8:45 radials, the nearest point in the
city's own CPN layer was the ice store at 9 o'clock, 277m off, and the panel said
"near Ice Nine Arctica" over a dot that was nowhere near it. A corner is only
your address if you are standing on it, and past that the honest answer is the
number — the map underneath draws where that is, and the listings still say where
*they* are in the city's words, because those are written down rather than
guessed. The server goes on working out a name (it is what the journey dispatches
narrate from); the panel just does not put it on screen.

**The trail is also a log.** The map draws where you have been as a fading tail,
brightest at the head and thinning back over half an hour (`?hermestrail=` in
minutes), after which it settles to a faint thread and stays for the session
(`?hermeslog=` in hours). The bottom of the map says what it adds up to in
distance and time.

Behind that, `scripts/hermes-server.mjs` appends every fix it accepts to
`data/hermes/track.jsonl`, one JSON object per line — so the record survives a
reload, a restart, or a power cut, which the browser's own trail does not. A page
that has just been opened asks for the log and draws the night it missed. The file
is git-ignored: it is a record of where the car actually was. `HERMES_TRACK=off`
writes none of it, and the mock route keeps its own file so invented positions are
never mixed into a real week.

Because the log exists, a restarted server **resumes from the last logged
position** rather than dropping back to the seed. `HERMES_RESUME=0` overrides it.

It reads `/api/hermes/state` and an event stream from `scripts/hermes-server.mjs`
(`npm run hermes:server`, or `hermes:mock` to drive it round an invented route
with no hardware). That server serves the repo as well as the API, so it can be
the only thing running — but it listens on **8124** rather than 8080, because
8080 is where `npm start` already is and the two could otherwise never be up at
once. The overlay tries its own origin first and 8124 second and keeps whichever
answers, so either arrangement works: the show on `npm start` with the API
beside it, or everything out of the one server on 8124. `?hermesapi=` pins it if
the API is on another machine.

Position comes from a Garmin Alpha: `npm run hermes:post <lat> <lon>` pushes one
by hand, and `npm run hermes:alpha` polls the handheld and posts what it finds.
`--once` does a single read and says what it saw, which is the thing to run when
the dot is not where the device says it is.

The watcher reads a mounted volume if it finds one, and otherwise pulls files over
MTP with libmtp (`brew install libmtp`). Either way it prefers `.Position.gpx`, the
live file the unit rewrites with where it is *now*, and falls back to the track log.
A log's last point is only the current position if the unit has been moving, so the
two are posted under different source names and the panel says `last moved 4h ago`
in grey for a log against `fix 4h old` in amber for a live file that has gone quiet
— a parked car and a broken feed look identical in the numbers and should not read
the same.

**The Alpha 300 cannot do live position over USB, and this is not a software
problem.** Its USB Mode menu offers Mass Storage, but selecting it changes nothing:
the device enumerates one single vendor-specific interface named MTP
(`0x091e:0x50ef`, `bInterfaceClass 255`), with no mass-storage interface and no
serial interface, so nothing mounts under `/Volumes` and no OS can make it. Linux
is no better — same descriptor, and the `garmin_gps` driver and `gpsbabel -i garmin`
speak the old native protocol this unit does not implement. Worse, the receiver
appears to power down when the unit enters transfer mode: `.Position.gpx` gets one
fresh write at the moment of connection and then freezes, so each replug buys
exactly one fix. `--once` will show you this — the same GPS timestamp, poll after
poll, while the age climbs.

**The dog collar is not a way around it either, and now we know why.** `npm run
hermes:collar` points the watcher at `Dog.gpx`, the collar's track as the handheld
records it. A TT 25 does have its own receiver and its own radio, and it does keep
reporting to the handheld — but the handheld is what writes the file, and *the
handheld stops writing files while it is tethered*. Tested with the collar in a
moving vehicle: on connection `Dog.gpx` jumped from 17 points to 42, the newest 30
seconds old and a kilometre away, and then froze. `mtp-files` fifty seconds apart
returned the same object ids at the same byte counts while the vehicle was still
moving. It is not the watcher caching, and it is not libmtp: the device genuinely
does not write while it is plugged in.

**So treat the Alpha as a recorder, not a feed.** It logs faithfully with nothing
attached and hands the whole lot over on the next connection, which is what
`npm run hermes:harvest` is for — see below. Live position is a phone's job.

Two libmtp cautions. It does not recognise the Alpha's USB ID and drops the device
often, so expect `No Devices have been found` and let the watcher's backoff handle
it. And object ids are positional: the device renumbers them whenever it writes, so
an id is leased for a minute and dropped early if a read comes back as something
other than GPX. Only one process can hold the MTP session, so stop the watcher
before poking at the device by hand.

A phone is the fallback that always works. `/api/location` takes GET as well as
POST, so an iOS Shortcut looping Get Current Location into a URL feeds it with no
cable at all. Both can run at once: the freshest fix holds the position, with a
minute of slack for clock skew, and a feed that goes quiet for ninety seconds stops
defending so the other takes over.

Add `&test=1` to the URL you hand people. It answers "you can reach Hermes" and
records nothing. Without it, everyone who taps the example link to check it works
teleports the dot to the example coordinates and leaves a point there — the first
draft of a story dispatch had a five-kilometre journey in it that was nothing but
the position bouncing between test posts.

### Harvesting the recorder

```bash
npm run hermes:harvest              # plug the Alpha in first
npm run hermes:harvest -- --dry     # say what it would take, take nothing
npm run hermes:harvest -- --since=2026-08-24 --from=/tmp/gpx
```

Pulls `Dog.gpx` (collar) and `Current.gpx` (handheld) and merges their trackpoints
into `data/hermes/track.jsonl` under `alpha-collar-gpx` and `alpha-handheld-gpx`.
Plugging in once at the end of the night backfills every mile logged while nothing
was tethered: on the first real run it took the log from 18 points to 152.

It appends and never rewrites, because the server has the same file open and a
read-modify-write here would drop whatever landed in between. Points therefore go
in out of order, and readers sort. Each point is filed under its **satellite**
timestamp rather than the moment it arrived, or a whole night would be recorded as
having happened during the minute the cable went in. Run it as often as you like:
a fix already in the log is recognised and skipped.

Two things to expect. The handheld's `Current.gpx` is a rolling log, not this
week's — ours still had points from July of the previous year, which is what
`--since` is for, and why distances are only summed within runs of points less than
an hour apart. And only one process gets the MTP session, so stop the watcher
first. `--from=<dir>` reads files copied off by hand, which also covers a
connection that has since been unplugged: the pull leaves its copy in `$TMPDIR`.

### Phones as the live feed

Hand out **`http://<mac-ip>:8124/phone`**. They tap through a certificate warning
once, type a name, tap once more, allow location, and leave the tab open.

The exact address is printed on startup, so read it off the log rather than
working it out:

```
[hermes] phones -> http://192.168.1.75:8124/phone   (share this one)
```

That link is http even though the page can only work over https, and it is the
right one to share for a dull reason: it redirects, and it survives being typed.
An address with no scheme in front of it gets tried as http, and http aimed at the
https port is not a redirect but a connection failure — so handing out the https
address directly means anyone who retypes it from a photo of a whiteboard, without
the `https://`, gets an error instead of a page.

#### Why https, and why the warning

Browsers refuse `navigator.geolocation` outside a "secure context", and a LAN
address over plain http is not one — Chrome and Safari both fail it with *Only
secure origins are allowed* **before** the user is asked to allow anything.
Pre-granting the permission makes no difference; it is the origin being rejected,
not the request. Localhost is exempt, which is why the moon on the Mac is fine on
http and a phone across the camp wifi is not.

This is worth being blunt about because the failure is silent and it fooled this
build once already: the page loads, looks perfectly healthy, and simply never
gets a position. It was verified against `127.0.0.1` — a secure context — and
passed, while the LAN address it was actually going to be used on could not have
worked.

So the server signs its own certificate on startup, into `data/hermes/tls/`
(gitignored, key `0600`, and the whole directory is refused by the file server so
the private key cannot be fetched off the wifi it is protecting). There is no
internet out here to get a real one with, so each phone waves the warning through
once. The address goes in `subjectAltName` as an IP entry, because a certificate
for a hostname does nothing for `https://192.168.1.75`; the pair is regenerated
whenever the camp's addresses change, since a certificate that does not name the
address being typed produces a warning iOS will not let you past.

An http link to `/phone` is answered with a redirect to the https one rather than
being served, because a page that looks fine and can never read a location is the
worst of the available outcomes. So an old link, or someone typing the show's port
out of habit, still lands in the right place.

`HERMES_PHONE=off` skips the listener entirely; `HERMES_PHONE_PORT` moves it.

This exists because the alternative did not survive contact with reality: talking a
dozen people through building an iOS Shortcut, in the dark, in the dust, on phones
whose owners have never opened the Shortcuts app. The browser already has a
geolocation API behind a permission prompt everyone has seen, so the page is a
link instead of a recipe, and it works the same on iPhone and Android.

It uses `watchPosition`, so the phone reports when it has moved rather than being
asked every few seconds and handing back the same fix — fresher and easier on the
battery. The name is kept in `localStorage`, so a phone that gets locked and
reopened comes back as the same source instead of a second nameless one competing
with the phone it was a minute ago. When another phone is fresher the page says
"someone else is closer to the moon" rather than "failed", because several people
sharing at once is the normal case and not an error to go and debug.

Caveats worth saying out loud when handing it out: **the certificate warning is
expected and has to be tapped through**, **the tab has to stay open** — phones
suspend background tabs, and it resumes when you come back to it — and everyone
must be on the same wifi as the Mac, though no internet is needed.

`/api/location` still takes GET and POST directly for anything scripted, and
`&test=1` proves the path without writing to the track log.

### The story: "Hermes was here"

```bash
npm run hermes:story                       # everything in the log
npm run hermes:story -- --day=2026-08-29   # one day
npm run hermes:story -- --json             # the data, for something else to render
```

Writes `artifacts/hermes-story/index.html` — the trail drawn on the city with
numbered stops, beside a telling of the night — and a markdown copy next to it.
The directory is the whole dispatch, map included, so it can be moved anywhere as
it stands.

Every sentence is read off the log. A journey is a run of fixes with no gap longer
than half an hour; inside one, a stop is a cluster staying within 45m for at least
eight minutes, and the rest is legs. Those three numbers are what separate a night
from a list of coordinates: without the gap rule the page draws a straight line
through the city that nothing drove, without the cluster radius a parked hour of
GPS drift reads as driving up and down the street, and without the dwell minimum
every wait to turn becomes somewhere Hermes went. Silences are stated rather than
crossed. Stops are named by the same geocoder the live panel uses
(`scripts/lib/playa-places.mjs`, shared so the dispatch cannot call a corner
something different from what the screen called it all night), and anything in the
listings that was on near a stop while Hermes was standing there gets a line.

The page crops the map to what the night covered, always keeping the Man in frame,
and draws the base from `playa-streets.svg` so the crop stays sharp. It draws its
own trail once on load rather than presenting it finished, because an arriving
trail is a night and a drawn one is a diagram; `?play=0` shows the finished map
straight away, and `?upto=N` draws the first N fixes and stops there.

### The trail as a gif

```bash
npm run hermes:gif                                    # needs the story built and a server up
npm run hermes:gif -- --frames=140 --fps=24 --width=900
npm run hermes:gif -- --keep                          # leave the frames for inspection
```

Writes `hermes-trail.gif` into the dispatch directory, which the page then links
from the map caption on its next build — so the order is `hermes:story`,
`hermes:gif`, `hermes:story` again. Needs the server running (`npm start`): a
canvas drawing an SVG off `file://` is blocked as cross-origin, and the map would
come out blank.

Frames are shot with `?upto=`, one page load each, so frame N is a pure function
of N. Capturing off a running clock instead gives a different gif every time and
no way to tell a rendering bug from a slow frame. The schedule comes out of the
page itself, so the gif and the live playback are the same animation and not two
that resemble each other — including the pacing, which is by distance travelled
and not by fix count. That matters more than it sounds: two thirds of a typical
log is a van parked at camp, and paced by count two thirds of the animation is a
stationary dot followed by the actual drive going past in a rush.

`h` hides and shows the overlay's panels, which is why it is not also the key for
the hot key list.

### Fitting the overlay round the hardware

The screen is not all ours. A ratchet strap across the glass takes a band of it,
and no amount of clamping font sizes wins against something physically in the way
— the panel has to move instead. So the listings run as a thin bar along the top
above the moon, which needs only a strip and leaves the whole right-hand side
clear, and the strip can be pushed down past whatever crosses the screen.

```
?hermesevents=bar     one line along the top (the default)
?hermesevents=card    the old block in the top right corner
?hermesbartop=470     px from the top, to sit clear of a strap
?hermesbarh=88        px tall
?hermesinset=40       px all panels keep away from every edge
```

In the bar, who yields to whom when it gets narrow is deliberate: the blurb goes
first and can go to nothing, the time and distance next, and the title only after
that and never below a few characters — a listing with no title is not a listing.
Below 900px wide the blurb is dropped outright, because the title and the time are
the listing and the rest is a courtesy.

```bash
npm run hermes:overlay                              # 1920x1080
STRAP=470,120 npm run hermes:overlay                # band 120px tall, 470px down
STRAP=470,120 EXTRA="&hermesbartop=610" npm run hermes:overlay
SIZE=3840x2160 npm run hermes:overlay
```

`STRAP` draws a hazard band over the shot where something covers the glass and
then says which panels are under it, so the layout can be moved clear by looking
rather than by carrying a laptop back and forth to the installation. It also
reports the box of every panel and whether any line is being clipped — which a
picture cannot tell you, since the clipped part is by definition the part you
cannot see.

## What's new in this build

- **Backdrop layer**: gifs/images pinned exactly behind the moon disc
  (`backdrop` field in the controller, or `?backdrop=` URL param). `.mp4`,
  `.webm`, `.mov` and `.m4v` play there too — the clip loops muted (browsers
  only autoplay silent video), is cropped to fill the circle rather than
  letterboxed into it, and `backspeed` sets its playback rate. Pair it with
  `iris` to open the disc onto the clip. Several comma-separated sources
  crossfade on the `backsec` timer as before; with video only the shown clip
  decodes, so a playlist costs about what one clip costs.
- **Circle clips** (`npm run clips`): xfeeefeee.net streams through a Bunny
  player but publishes its finished files under `/releases/`, linked from its
  own pages. `scripts/fetch-xfeeefeee.mjs` enumerates those (`--list`),
  downloads the ones you name (or a default six), and centre-crops each 1440p
  master to a small square loop in `assets/xfeeefeee/circle/` — the circle
  discards the sides regardless, and a 113MB master becomes about 8MB. Masters
  are kept so a re-cut is free; both directories are outside git like the rest
  of the media. The controller's **circle clip** picker reads the manifest the
  script writes, so a new cut shows up on reload, and **◉ reveal clip** loads
  it (or the whole set, crossfading) and irises the disc open onto it.
  Note the square crop lands on whatever is mid-frame, which in this source is
  usually a face or torso — worth previewing before projecting one.
- **Clip segments** (`npm run clips:cut`): most of a four-minute clip is
  somebody dancing in a bedroom, and the few abstract stretches that suit the
  moon are buried minutes apart. List the good ones by in/out seconds in
  `assets/xfeeefeee/segments.json` and the script cuts them to their own short
  loops in `assets/xfeeefeee/segments/`, which the backdrop can then play as
  often as you like — a 15s loop simply repeats for its whole `backsec` slot.
  Cuts are re-encoded rather than stream-copied: these masters use long GOPs,
  so a copy would either slip seconds off the mark or open on grey macroblocks.
  Finding the segments is a looking job — contact-sheet a clip with
  `ffmpeg -i clip.mp4 -vf "fps=1/3,scale=192:192,tile=10x8" sheet.png` and read
  the timestamps off the tile positions. The one flower run across the current
  six is `the-shadow-of-you` at 192.5–208s, cut as `shadow-blooms`.
- **Starter kit** (`npm run starter`): the moon discs, vajra proxies and eye
  backdrop have always been small enough to ship in git, but the scraped gif
  library and the downloaded clips are not — so a fresh clone ran the show with
  an empty orbit and an iris opening onto black. The kit bakes low-bandwidth
  copies of both into `assets/starter/`: a 60s excerpt of each backdrop clip at
  360px (one slot's worth, so it is swapped out about when it would have looped)
  and the gif themes the orbit asks for, minus everything already marked reject.
  About 10MB for the pair. What goes in is read off the `kiosk:show` URL rather
  than listed in the script, so changing the rotation or the orbit themes
  changes the kit on the next build. Nothing needs configuring to use it: the
  page asks for the real media first and falls back per file, so a machine
  holding the masters never touches a proxy. Verified both ways by 404ing
  exactly the paths `.gitignore` excludes.
- **LED pixel output** (`npm run pixels`): drives an Advatek PixLite — the
  E16-S Mk3 takes 16 outputs of up to 1,020 RGB pixels, 96 universes, over
  sACN or Art-Net. A browser cannot open a UDP socket, so the page cannot
  address the controller itself: `scripts/pixel-bridge.mjs` holds a WebSocket
  open, hands the moon a pixel map, and turns the sampled bytes it gets back
  into lighting protocol. See "Driving an LED rig" below.
- **Moon opacity** slider: fades the whole moon to reveal the backdrop.
- **Iris reveal**: `◉ reveal eye seal` / `● seal moon` buttons + `iris reveal`,
  `iris size` sliders — opens a fully transparent hole (inner 70% of the disc
  by default) so the eye-seal gif shows through while the limb stays.
- **Reveal zoom** slider: zooms the gif into its centre as the iris opens, so
  at full open only the eye fills the aperture (`?iriszoom=`, default 2.5×).
- **Backdrop gif speed** slider: replays the gif's whole loop faster/slower
  (`?backspeed=`, needs Chrome for ImageDecoder — kiosk Chrome is fine).
- **Moon size** slider (`?moonscale=`): shrinks/grows the whole moon while it
  stays pinned to the screen centre.
- **Nudge X / Y** sliders (`?moonx=`, `?moony=`): shift the moon off centre by
  hand, in disc radii, positive right and up. The disc centres itself and does
  it well — it is measured off the video's alpha and lands within half a percent
  of a radius — so this is for squaring the moon up to a fan hub or a projected
  frame by eye, not for fixing the centring. If it looks off-centre and the
  measurement says it is not, that is the shadowed limb: part of the moon cannot
  be told from a black background, so what you see is clipped on one side.
  `node scripts/probe-moon-framing.mjs` prints both numbers and the nudge that
  cancels the difference (about `moonx=0.10` on the default loop).
- **Guest logos** (`guest logo` field, or `?logo=`): someone else's mark takes
  the word's place on the shadowed panel. See below.
- **A program never stops.** The output walks the schedule one entry per
  rotation and wraps back to the first act forever, so leaving it running all
  night is the intended way to use it — nothing has to be restarted and
  nothing gets cut off. The hour is a *framing* target, not a cutoff: it is
  how often you want the whole arc to come round. The program editor says
  which side of that you're on ("fits the hour" / "repeats 2.4× per hour" /
  an amber "comes round every 1.4 h, past the hour"), and `fit to hour`
  rescales every act's cycles to land on it. The two timed effects (the
  eclipse transit and the blood fade) default to 45 minutes for the same
  reason, and the eclipse can be set to recur. At the nominal 18 s
  rotation: `hour` is 201 rotations ≈ 60 min, `library` ≈ 13.5 min (so it
  comes round 4× an hour), `folds` ≈ 11 min, `nightfishing` ≈ 4.5 min, `eye10`
  and `eyefolds` ≈ 3 min.
- **Program presets** in the program dropdown: `library` (the whole effect
  library, a different one every 3rd rotation — the good unattended default),
  `carousel` (the same library with no word-only rotation between the acts, so
  every single rotation is a different effect — 15 rotations ≈ 4.5 min a lap,
  the one to run when the moon is the centrepiece rather than the wallpaper),
  `gifcities` (the GifCities swarm alone, a different scraped theme each act —
  a couple of minutes of lava lamps finding each other and spelling something
  before the hearts take over, ≈ 12 min a lap; needs `npm run gifs` first),
  `eye10` (word-only moon, the eye seal irises open every 10th rotation),
  `folds` (the bucky fold repertoire every 3rd rotation), `eyefolds` (folds +
  the eye every 10th), plus the original `hour`. In the custom program editor,
  `eye` is a valid act content — it triggers the iris reveal instead of the
  window.
- **Sub-pixel disc centering**: the iris hole / backdrop alignment no longer
  drifts by a few pixels at fullscreen.
- **The backdrop now seats on the moon properly.** Two things used to leave a
  gif sitting small inside the limb with a ring of moon around it, which reads
  as it being off centre. The disc's radius was measured from a bounding box on
  a coarse sample grid, which came out about 3.5% under and breathed as the
  rounding flipped between the two axes; it is now taken from the mask's area,
  which lands within 0.3% and holds still. And a gif was pinned by its file
  canvas rather than by its artwork, so the margin a circular gif is usually
  exported with (about 8% on the eye seal) became a gap. The visible content is
  now measured over the loop and seated on the disc by its own centre and
  extent, so any gif fills the disc whatever padding it ships with. `backfit=0`
  restores the old behaviour for a source framed off centre deliberately, and
  `backscale` still trims the result. `npm run probe:center` prints where the
  backdrop and the moon each landed, in pixels.
- **Blood moon**: `🌕→🔴 blood moon` / `natural moon` buttons + a strength
  slider and tint color picker — grades the whole disc to a copper-red
  eclipse look, live, on any of the moon videos (`?bloodmoon=0..1`,
  `?bloodtint=RRGGBB`). Craters and the word mosaic keep their relief.
- **Blood fade timer**: `▶ fade to blood` / `▶ fade to natural` over N
  minutes (default 120 — a two-hour eclipse), `✖ hold` freezes it where it
  is. The fade runs inside the output window, so the controller can be
  closed once it's started; the export query resumes a mid-fade eclipse
  after a reload (`?bloodmoon=&bloodtarget=&bloodfade=`).
- **Earth's shadow** (`?eclipse=0..1`): the eclipse as an event rather than a
  grade. The umbra is a disc 2.6 moon radii across inside a 4.6-radius
  penumbra — the real proportions — and the moon drifts through it along a
  chord, so 0 is first contact on one side and 1 is last contact on the
  other. The shadow's curved edge cuts across the craters on the way in;
  inside it the surface is lit only by sunlight refracted through the earth's
  atmosphere, copper and brighter toward the rim, with the turquoise fringe
  the ozone layer puts just inside the edge. Controls: the `earth's shadow`
  slider scrubs the transit by hand, `▶ run eclipse` runs it over N minutes
  (default 45) and, with `again every N min` set (`?eclipseevery=`), leaves a
  clear sky for that long and then brings the shadow round again — otherwise
  it is a single pass, which is a lot of nothing across a long night. Both
  ends of a transit are a clear moon, so the rewind is invisible. Also
  `● jump to totality`, `✖ hold`, `clear shadow`. The value
  readout names the phase (penumbral / partial / totality). `shadow path`
  (`?eclipsepath=`) is how centrally it passes — 0 is dead through the
  middle, past about 1.6 it never goes total — and `totality depth`
  (`?eclipsedeep=`, default 0.7) is how dark totality gets, since the real
  thing is far darker than a show wants. Like the blood fade, the transit
  runs in the output window and survives the controller closing, and the
  export query resumes it mid-eclipse.
- **Starfield** (`?stars=N`): a parallax sky painted under everything, so the
  moon and the orbiting vajras have something to move against instead of flat
  black. Stars sit at their own depths — the near ones drift faster and carry
  a faint diffraction cross — and each twinkles on its own phase, a little
  harder when the music's highs are up. `meteors / min` (`?meteors=`, default
  5) sets how often one crosses, `sky drift` (`?stardrift=`) scales the whole
  sky's pace (near stars cross the screen in about ten minutes at 1×). The
  moon occludes it, so the disc still reads as solid.
- **Dancing mumins** (`?content=mumins`, or "dancing mumins" in the window
  content dropdown): a ring of little round trolls hopping in a circle on the
  dark side. Drawn in-page, so there's no asset to copy — `?mumins=1..9` sets
  the troupe size and `?muminbpm=` the dance tempo. The window opens wider
  than usual for them; the `window size ×` slider trims it.
- **The star fisher** (`?content=fisher`, or "star fisher" in the window
  content dropdown): one mumin sits out on a crescent with a line in the
  dark, hooks a drifting star, cups it and lets it go — and every third catch
  the freed stars swing into a heart over its head while it waves. Also drawn
  in-page: `?fishersec=` sets how long a catch takes (default 15s),
  `?fisherheart=` how many catches per heart (3), `?fisherzoom=` the size.
  The `nightfishing` program keeps it in rotation with the mumins and the eye.
- **Fisher companion** (`?fisherlive=1`, or the `fisher companion` checkbox):
  the same little scene hung in the sky beside the moon on its own layer
  instead of inside the window — so he keeps fishing while the window runs the
  sonic sphere, the folds, anything. Everything else carries on untouched.
  `size` (`?fisherlivesize=`, in disc radii), `angle` (`?fisherliveangle=`,
  degrees round the disc, 200 puts him at the lower left) and `out`
  (`?fisherlivedist=`, how far from the centre) place him. He follows the moon
  when you resize it.
- **Sonic sphere** (`?content=harmonics`, or "sonic sphere" in the window
  content dropdown): the actual normal modes of a vibrating sphere. A lattice
  sphere is displaced by a real spherical harmonic Y(l,m) and rings in place —
  the lobes swing out, pass through round, and come back inverted, trading
  warm for cold, with the nodal lines staying dark because that is where the
  surface never moves. It walks up the harmonic series, morphing each mode
  into the next; `?harmsec=` sets how long a mode is held (default 5s). Bass
  drives it harder. Drawn in-page, no assets.
- **Cymatics plate** (`?content=cymatics`, or "cymatics plate"): a Chladni
  figure. The glowing curves are the nodes of a driven square plate and the
  sand walks downhill until it settles on them, because those are the only
  places that are still. The mode changes every `?cymsec=` seconds (default 7)
  and the grains scatter and re-gather; how violently they are thrown about
  follows the music. `?cymgrains=` sets the amount of sand (default 4200).
- **GifCities swarm** (`?content=gifswarm`, or "gifcities swarm"): a few dozen
  animated GIFs off GeoCities pages, rescued by the Internet Archive, running
  as coupled oscillators on the dark side. Each one circles its own small orbit
  and the point it sits at is its Kuramoto phase, so while the phases are
  scattered the field is noise; as the coupling passes critical they pull each
  other into step and — being all at the same point of their own orbits — the
  whole swarm starts breathing as one thing. Then it collapses onto the lit
  cells of a word, holds it, and scatters. The lock is emergent rather than
  keyframed, so it happens somewhere new every pass.

  The word is timed off the rotation rather than off a clock of its own. The
  swarm gathers as the anchored panel swings towards the viewer, is fully formed
  as it passes square on, and disperses as it leaves; each approach takes the
  next entry in `gifwords`, so `gifwords=hermes,-` says HERMES to your face
  every other turn instead of spelling it at the back of the moon and resting
  through the near side. An entry with no letters in it is that rest.

  Long words wrap: six letters across the opening on one line is a thin strip
  no one can read, and HER over MES is twice the size. The block is fitted to
  whatever part of the panel survives its cover-crop, so the swarm always fills
  the opening it has rather than a square it imagines it has.

  Unlike the other generators, the swarm keeps its window most of the way open
  over sunlit terrain (`?wingate=`, 0.7 here against 0.05 elsewhere) and paints
  opaque rather than adding light. A glow welling out of the surface has to be
  sealed in daylight or it is a ghost; keyed cut-outs do not, and sealing them
  meant that on a clip with no dark side the only place the swarm ever appeared
  was squashed flat against the limb, which is no place to read a word.

  A few of them leave the window altogether and take the vajras' tilted lanes
  around the disc, passing in front on the near half and eaten by the limb on
  the way behind — the window is a patch of texture on a sphere and can never
  cross the silhouette, so orbiting is the only way a gif gets out there.
  `?giforbit=` sets how many (5 by default, 0 turns them off), with
  `?giforbitradius=` and `?giforbitscale=`.

  `?content=orbit[:theme]` is that orbit layer on its own: nothing is drawn on
  the surface at all, no window and no word, just gifs going round a moon that
  stays a moon. Each orbiter takes another gif out of the pool every lap
  (`?giforbitswap=`, in laps; 0 keeps the one it was dealt), and it changes at
  the deepest point behind the disc where the sprite is clipped away, so nobody
  ever watches one gif cut to another.

  `?orbitseq=` gives the orbit acts, `|` between them, each act a list of themes
  to draw from — `?orbitseq=ankh|seahorse,jellyfish,seaweed|coral,starfish` runs
  ankhs, then a reef, then starfish, and comes back round. `?orbitact=` is the
  seconds each act holds (150) and `?orbitfade=` the dissolve between them
  (1.2s). An act change is a moment in the show and is allowed to be seen, but
  the pool is only ever torn down and rebuilt with the layer already faded to
  nothing, so it is a dissolve rather than a cut — and a theme with only a few
  good gifs to its name is worth pairing with another, or eight lanes will be
  showing three gifs between them.

  Nothing orbits without a transparent background. GeoCities gifs are a mixed
  bag: some carry a transparent index, plenty were pasted onto a flat white or
  black rectangle, and against a moon and a starfield the flat ones read as
  floating postage stamps rather than as things. So the loader reads the
  background colour off the corners, knocks it out and crops to what is left —
  and if that cannot be done, because the corners disagree or because knocking
  the colour out takes the subject with it, the gif is dropped at decode time
  instead of flown. The test is how much of its own bounding box the shape holds
  back, not whether a clear pixel exists somewhere: a white card in a wide
  transparent margin, or a bevelled plaque that loses only its frame line to the
  key, is still a card and still a plaque.

  `vajra` is a reserved act name rather than a theme. The dorje loops that
  garnish the other acts get one of their own: all six clips instead of the
  three the show otherwise runs, grown to `?vajraactscale=` (1.7) of their
  ornament size on the way in and back down on the way out, with the gif layer
  simply staying out for the act's length. Nothing is decoded for it, so the
  hand-over into it is instant, and it is the one act that is spinning brass on
  a black sky rather than a swarm — worth putting between two turns of
  GeoCities rather than next to the ankhs.

  `metavillan` (or `mv`) is the other reserved name, and the only act that does
  something the lanes cannot. It flies the collected Metavillan marks — the same
  lanes, the same pool, just a different index to read — and then every
  `?mandsec=` (12) seconds it takes them out of those lanes: over `?mandmove=`
  (3) they gather into rings of petals round the moon, hold for `?mandhold=`
  (30) while the rings turn, and scatter back.

  `?mandrings=` (3) is how many rings, spread evenly from `?mandr0=` (0.5 of the
  disc radius) out to `?mandr=` (1.2), and it is the difference between the
  single flower this started as and the long form. Set it to 1 and everything
  goes back to that flower, defaults included: one ring of eight at 1.16 grown
  to 1.5. Leave it at 3 and the act flies `?markorbit=` (27) marks rather than
  the `?giforbit=` (8) a gif act does, dealt over the rings in proportion to
  their radius — 5, 9 and 13 at the defaults — so the gap between petals comes
  out about equal on all of them. Those extra lanes are built at load and simply
  not shown until the marks come in, fading up over `?markin=` (2.5); a gif act
  never flies more than its eight. Petals grow with the ring they sit on out of
  `?mandscale=` (1.1 with rings, 1.5 for the lone flower), because one size for
  all of them crowds the inner rings and leaves the outer one looking sparse.

  1.2 is as far out as the outermost ring can go, and it is the ceiling on the
  whole formation: the disc measures about 0.35 frame heights, so a ring there
  plus half a petal is the whole of the half frame there is. Push `?mandr=`
  past it and the top and bottom marks are cut off by the edge of the screen —
  which looks fine in a tall browser window, where the show is letterboxed into
  a band and there is black above and below to spill into, and is unmissable on
  the 16:9 it gets projected on. More marks go in by adding a ring rather than
  by widening the ones there are.

  Each ring turns at its own rate off `?mandspin=` (0.22 rad/s, which is the
  outermost; inner rings go faster by the square root of the radius ratio) and
  alternate rings turn the other way unless `?mandcounter=0`, which is what
  keeps a mandala from reading as a wheel. They are also offset half a gap turn
  about, so petals interleave with the ring inside them rather than lining up
  into spokes. And they arrive one at a time, `?mandstagger=` (1.1) seconds
  apart, inside out on the way in and outside in on the way out: the rosette is
  built and dismantled rather than switched on, and at three rings that is a
  good five seconds of monograms swinging into place.

  Just over 1 sets a ring outside the limb, where the moon is the heart of the
  flower and the marks are petals going round it. Under 1 puts them on the face
  instead, which is a seal rather than a flower — `?mandrings=1&mandr=0.58` is
  the tight mandala, and during the show a ring that small lands inside the iris
  and frames the backdrop clip. With three rings the default span crosses the
  limb, so the inner two are seals on the face and the outer one is petals.

  Which way each V faces follows from that, and getting it backwards is the
  difference between a flower and a dozen darts aimed at the same rock. Petals
  point away from whatever the ring is arranged around: outside the limb that is
  the moon, so they radiate, while a ring on the face has no centre until the
  marks make one, so there they point in and their tips close on a void. Hence
  the decision is made per ring off its own radius, and `?mandaim=` overriding
  all of them at once is only worth setting by hand to see the wrong one.

  The marks also run through the hues as they go — `?markhue=` (0.3 rad/s) turns
  every mark about the grey axis of the colour cube, which cycles the colour and
  leaves the brightness, so a mark keeps its gradient and the chrome one keeps
  its metal. `?markhuespread=` (1) starts each petal a further step round the
  wheel round its own ring, with each ring offset again from the last, so every
  ring is a full spectrum that turns and no two of them show the same colour at
  the same angle.
  `?markhue=0` leaves the collected colourways as they were shot. Only the marks
  are turned: a GeoCities gif is the colour it was in 1999.

  The colour is held back until the flower exists. A monogram is a shape before
  it is a colourway and the shape reads hardest with nothing else in it, so the
  flock orbits and gathers in grey and the colour becomes something that happened
  to a finished thing rather than a property it flew in wearing. `?markmono=0`
  turns that off and lets the marks arrive already coloured. `?markbloom=` (8s)
  is how long the front takes to cross the whole rosette, and wants to fit inside
  `mandhold` with room to spare or the flower comes apart mid-bloom; on the way
  out it drains in under half that, because colour lingering on a dispersing ring
  reads as a bug rather than a farewell. `?markbloomedge=` (0.6 of the sweep) is
  the width of the front — a hard edge is a wipe, this is a fade
  travelling — and wants to be wider than one ring's share of the sweep, or the
  rings light one after another and read as three events instead of one bloom.
  `?markbloomspin=` (1) is how much of the front's travel is rotation rather than
  expansion: at 0 the colour arrives ring by ring, and turning it as it expands
  makes one spiral arm sweeping outward with petals of every ring mid-fade at
  once. What each petal reveals is the hue it already had from `markhuespread`
  and its ring's offset, which is why this reads as colour spreading through the
  flower rather than a lamp being switched on behind it. Once everything is lit,
  `?markwave=` (0.22) leaves a shallow desaturation still going round on a
  `?markwavesec=` (7s) turn, so a held flower keeps moving instead of arriving at
  flat colour and stopping there. The desaturation is toward grey along the very
  luminance the sprite's alpha gate reads, so draining the colour cannot change
  which pixels count as backing plate — with any other weights the marks flicker
  as the colour goes, which is the one thing a slow fade must not do.

  `npm run metavillan:check` shoots the cycle where it means something, the bloom
  included, so the rings can be tuned by looking at them instead of standing in
  front of a two-and-a-half minute act waiting for it to come round.

  A sprite on the far side of its lane is hidden by the limb, so it crosses to
  the face while nobody can see it move and fades in where it lands, and a mark
  that is due to take another out of the pool holds the change until it is back
  in its lane — mid-rosette it is on the face being read rather than passing
  behind the disc, and that is the one place a cut would be seen. The rest is
  the same trap twice, which is that an act's name changes at the top of the
  dissolve while the last act's sprites are still on screen. So the rings are
  dropped outright at the bottom of the dissolve rather than eased out, or a
  half-formed rosette would outlive the hand-over and gather the next act's gifs
  into it — and the hues and the extra lanes wait on the pool itself rather than
  on the act name, or they would recolour the outgoing act's gifs on their way
  down.

  `npm run metavillan` brings marks in: it crops each one to its own bounds —
  they arrive as a glyph floating in a wide transparent margin, and a fixed
  sprite scale would otherwise render the margin and fly the mark at a third the
  size of the gifs beside it, differently for each file — scales it to sprite
  resolution and rewrites the index. Pass it any number of files, rerun it to
  add more. Unlike the scraped libraries these are tracked in git, because there
  is no script that can fetch a collected set back. `npm run metavillan:check`
  shoots the cycle at five points — orbiting, the inner ring seated with the
  outer one still in its lane, mid-gather, held, back out — into
  `artifacts/metavillan/`, so the rings can be tuned by looking at them rather
  than by standing in front of a two-and-a-half minute act waiting for it to
  come round; `EXTRA="&mandrings=4&markorbit=32"` shoots a variant.

  `npm run gifs:pool` reports what each act of the show's sequence actually
  flies — curated, tried, and how many were dropped as tiles — and writes a
  sheet of the survivors over a checkerboard to `artifacts/gifpool/`, so a thin
  act shows up before a show rather than during one. `THEMES="coral,starfish"`
  reports one act, `RAW=1` adds a sheet of every gif a theme scraped, curation
  and keying both ignored, which is the sheet to mark up after a fresh pull.

  `npm exec -- node scripts/check-gifswarm.mjs` shoots a few approaches, moon
  and bare canvas side by side, and prints how gathered and how synchronised
  the swarm was in each — `WORDS=` and `PASSES=` to taste.

  Run `npm run gifs` first or the window stays empty: that scrapes GifCities
  into `assets/gifcities/`, which is gitignored like the rest of the media. The
  default pull is about forty each of moon, spaceship, ufo, alien, rocket,
  planet, saturn, galaxy, astronaut, comet, satellite, telescope, earth, sun,
  star, lava lamp, rainbow, peace, smiley, mushroom, spiral, yin yang, skull,
  pentagram, candle, pyramid, ankh, dragon, wizard, crystal, heart, butterfly,
  flower, angel, fairy, cat, flame and eye. `THEMES="ufo,dragon" npm run gifs`
  adds just those, `PER=60` changes the depth. Runs are cumulative — the index
  is read back in first, a theme that is already full is skipped rather than
  re-fetched, and deleting a file is how you ask for a different one next time.

  Queries are single words wherever possible, because the filter insists the
  *last* word of the query appears in the filename: "space ship" goes looking
  for ships and finds pirates, where "spaceship" finds ships in space.

- **Curating the gif library** (`gif-curator.html`, or "curate gifs…" in the
  hypermoon panel): search there matches the GIF's old URL rather than the
  picture, so a themed pull always lands passengers — an E-Mail banner filed
  under butterfly, a Click Here button under eye. The curator is a contact
  sheet of the whole library for throwing those out quickly. Click to reject,
  shift-click to star, or hover and press `x`, `s`, `u`. Filter by theme or by
  what is already marked, and search filenames.

  Tiles show each GIF the way the swarm will draw it — background keyed out,
  cropped, animating — over a checkerboard, so an opaque backing plate the trim
  could not key is obvious at a glance. Those are dropped by the loader anyway,
  which leaves the curator for the thing no rule can judge: the wrong subject
  rather than the wrong shape, and a rectangular subject on a transparent
  background — a product shot, a wide text card — which passes the loader and
  still reads as a tile in the air. Only the tiles near the viewport are live,
  so a library of thousands still scrolls.

  Marks are held in `localStorage`, which the moon shares because it is served
  from the same origin, so rejecting something removes it from a moon running
  on that machine within a second or two. Starred GIFs go to the front of the
  pool, so a picked-over library leads with the good ones. "download
  curation.json" writes the marks out to drop in `assets/gifcities/` and carry
  to the show machine, where they become that machine's starting point.

  `?gifwords=muse,moon,love` sets what it spells (short words read best — the
  glyphs are the same coarse 5×7 the letter mosaic uses), `?giftheme=heart`
  restricts it to one theme, `?gifs=` the swarm size (default 100), `?gifk=`
  the coupling (default 2.6; critical is near 1.4, so below about 1.5 it never
  syncs), `?gifsec=` seconds per word (default 22).

  Plenty of these GIFs were pasted onto a flat white or black rectangle by
  whoever made them, which would read as a swarm of tiles rather than shapes,
  so the background colour is sampled off the corners and knocked out. GIFs
  whose corners disagree are left alone.
- **The jitterbug listens** (`?content=foldjitter`): Fuller's vector
  equilibrium has exactly one degree of freedom — the whole collapse through
  the icosahedron to the octahedron is a single number — so the bass can drive
  it directly. A hit slams it shut and it springs back open, which turns the
  geometry into a readout of the room rather than a clock. It is on a spring,
  not a tracker, so the rebound is what you see on the beat. Scaled by the
  `intensity` control like everything else musical; in silence it falls back
  to the timed VE → icosa → octa cycle, so an unattended moon still moves.
- **Window depth** slider (`?winparallax=0..1`): how far inside the shell the
  content hangs. Above zero it slides against its own frame as the window
  turns away, the way something at depth would, and the walls of the opening
  shade it toward the rim — which is what makes the sonic sphere read as
  suspended inside a hollow moon rather than screened on its surface.
  Defaults low for the drawn figures and half open for everything else.
- **Window solidity** slider (`?winsolid=0..1`): window content is normally
  added as *light*, which is right for glowing screens and wireframes but
  turns drawn figures into ghosts. At 1 the content is painted opaque onto
  the surface instead. Defaults to solid for the mumins, glow for everything
  else, and is not carried across a content switch.
- **Window opening** slider (`?winbox=0..1`): whether the window is a hole.
  At 1 a rectangle of shell is cut away and the content is recessed in it,
  which is what a screen or a photograph wants and what the CRT keeps. At 0
  there is no opening: the content wells up through a soft oval, and the
  surface gives way only under the content's own ink instead of across the
  whole of its bounding box. That box was what made the cymatics plate and
  the sonic sphere read as dark panels with borders pasted onto the terrain
  rather than as something the moon was doing. Defaults to 1 for `crt`,
  `screen`, images and video, and 0 for everything the page draws itself.
- **Unattended-show survival** (macOS): `npm run show:mac` holds a power
  assertion and launches the kiosk with occlusion/throttling disabled;
  `npm run show:mac:status` reports what the machine will do, and
  `npm run show:mac:off` releases it. The output page also takes a screen
  wake lock on its own (`?awake=0` opts out) and keeps rendering off a timer
  if the compositor stops calling it (`?ticker=`, `?keepfps=`), so the LAN
  broadcast survives a blanked or occluded display. See "Locking" below.
- **Fold loop clips** (`artifacts/fold-loops/*.mp4`): the fold repertoire
  pre-baked as square videos incl. red wireframe variants — usable as window
  content or backdrops on machines without the live makers.

## A second projector: the poem screen

For a two-surface room, the controller's **Poem screen** panel puts the poem on
its own projector next to the moon. It opens `crt-terminal.html` loaded with
`trinitypoem.txt` and drives it live over the same `hypermoon` channel: look,
pacing, forward/back, pause, restart. Put that window on the second output and
the moon on the first — one machine with two outputs, so there is no network in
the path and nothing to drift.

A 402 × 226 cm surface is 16:9 to within a millimetre, which is what the moon
letterboxes to, so it fills one exactly with no bars (disc about 156 cm across).

The one number that matters is type size, and it is decided by how many lines
are on screen at once, because the fit has to accommodate the tallest screen in
the script. On a 226 cm high surface a whole nine-line stanza gives 7 cm
capitals and dies at about 11 m; three lines at a time gives 19 cm and reads to
about 28 m. The panel's readout states this for your screen height as you move
the slider, so it can be set against the actual room rather than guessed. Three
lines takes the poem to 82 screens, about 9m 45s at 13 characters a second — or
about 13m 30s as a turning triangle, which pays 0.9s a line for the turn.

The **shape** control sets the poem around an equilateral triangle instead, a
line to each side. The poem is three words to the line, so a screen of three
lines is nine words — three a side — and it falls into the shape without any
reflowing.

By default the triangle turns a third of a turn each time a new line starts, so
the line being written is always the one along the bottom, upright and left to
right; the finished ones ride up the other two sides and the shape goes round
once a screen. It is free in size — a triangle sits in the same box whichever
face is down, so it is full size whenever it is still. It is not free in time:
nothing is written while it turns, since otherwise the start of every line goes
down while its side is still swinging. **Turn takes** is therefore time added to
each line, 0.9s by default, so a three-line screen runs 2.7s longer; take the
same off the **hold** to get the old length back, or tap a beat and the typing is
hurried to fit both. Uncheck **turn to the line being written** to hold the shape
still. **Free spin** is the other thing, an unending rotation, and that one does
cost a third of the type size.

The triangle's own **edges** are off: the words carry the shape by themselves and
drawn lines only compete with them. The slider puts them back if a room wants
them.

**Keys.** The poem window takes them directly, so the machine at the projector
does not need the controller in front of it; the panel takes the same ones. Hold
shift for a bigger step. Keys typed into a field in the controller are left
alone, so this does not get in the way of the rest of the panel.

`→` `←` put down the next word or take one back · `space` pauses · `home`
restarts · `r` `t` type slower and faster · `1`–`9` are speeds straight off,
4 to 40 characters a second · `-` `=` shorten and lengthen the hold · `0` puts
the pace back · `pgdn` `pgup` step a whole screen · `b` taps the beat,
`shift+b` drops it · `,` `.` change how many beats a screen gets.

**The arrows are on words.** Pause with `space` and the poem stops writing
itself, and then it only moves when you move it, a word at a time — which is how
you walk it along with someone reading aloud. It rolls into the next or previous
screen at either end. `pgdn`/`pgup` is what a presenter's clicker sends, so a
clicker steps whole stanzas with nothing to set up.

**Tap `b` along to the music** four or more times and the poem stops running on
a stopwatch: each screen is then given a whole number of beats, however long its
own lines are, so it stays in time with the room instead of drifting a second
every long stanza. The hold soaks up the difference and the typing is only
hurried if the words would not otherwise land in time — the speed you set is a
floor, not a target. The panel shows the bpm and what a screen is costing.

Lines are not thrown away when their screen ends. Each one keeps turning, and
when it comes round to its side again it is drawn a step smaller and fainter,
sinking toward the middle of the seal — so the poem spirals inward and dims out
rather than being cut, and there is no seam between screens. **Trail** sets how
many are kept, **depth** how fast they shrink, **dim** how fast they fade. Set
trail to 0 for the three lines alone.

Either way the shape costs about half the size of flat lines (10.5 cm capitals,
16 m against 18.8 cm and 28 m), because an equilateral triangle in a 16:9 frame
runs out of height long before it runs out of width.

If the two projectors are instead butted into one wide wall, remember the moon
is centred and would sit on the seam — offset it or keep the pictures separate.

Fuller notes, parameters and the measuring commands (`npm run probe:poem`,
`preview:poem`, `test:poem`) are in the main `README.md`. To see the pair before
the room exists, `npm run demo:projectors` renders both outputs at 1920x1080 and
a captioned side-by-side into `artifacts/demos/`.

## Putting someone else's logo on the moon

The word already owns a panel on the shadowed side: the survey finds the
darkest patch of terrain in the first revolution and pins the letters to it, so
they curve with the sphere and slide off the limb. A guest mark rides exactly
the same panel. Paste a path into `guest logo` in the controller and it takes
the word's place, live:

```
hypermoon.html?logo=assets/synbiobeta-logo.png
```

Several guests are comma-separated, and they change hands round the back of the
moon rather than cutting in front of anyone — the next mark is simply already
there when the panel comes round. `hold` is how long each one keeps the slot.
The token `word` is the mosaic itself, so a list can keep the host in the
rotation:

```
?logo=word,assets/one.png,assets/two.png&logosec=40
```

Check a mark before an audience does:

```
npm run preview:logo -- assets/synbiobeta-logo.png
```

which writes `artifacts/logo-preview-plain.png` and `-cubes.png`, shot with the
panel square to the camera.

Worth knowing:

- **Two treatments.** `plain` (the default) draws the supplied artwork, which
  is what a guest normally wants and the only thing a wordmark survives.
  `cubes` rebuilds the mark out of the same astronaut/moon image cubes the
  letters are made of, so a guest is made of the same material as the word —
  good for a bold monogram, and it will shred anything finer.
- **Dark artwork still works.** The panel is added as light, so a mark supplied
  as black-on-transparent would otherwise be nothing at all on an unlit moon.
  Those are detected and shown as their own silhouette in moonlight instead, so
  you can hand over whatever the guest sent. The silhouette is cut by darkness
  rather than by coverage, so counter-shapes painted white instead of knocked
  out of the alpha — a ring, letters reversed out of a badge — stay as holes
  with the terrain showing through.
- **SVG works**, which is usually what a press kit sends. So do PNG and any
  other format the browser can decode.
- **A guest gets a wider panel than the word** (`logoscale`, default 1.7×),
  because the word reads at the measured patch size only by virtue of being
  five cells to a glyph.
- `logoink` (default 0.42) dims plain artwork; raise it for a mark that is
  getting lost, lower it for one that glares.
- The panel is one slot, so a running program still owns it: on the rotations
  where an effect opens the window wordless, the guest steps aside with the
  word and comes back on the next word rotation.

## The mark, and going up from the art car

Separate from the guest panel above: `?flash=` throws a mark over the whole disc
for a few seconds a minute, so the moon briefly *becomes* the mark. The show
preset already carries `flash=hermes/logo.png`.

```
hypermoon.html?flash=hermes/logo.png&flashsec=60&flashhold=3
```

### Paint, not just light

The mark used to be added as pure light, which is why it washed out: additive
blending can only ever brighten, so a mark thrown on the lit face of the moon
loses most of its contrast exactly where the moon is brightest. It is now laid on
as paint with some glow left over, which is what makes it read as both stronger
and darker.

- `flashink` (default 0.88) — how opaque the paint is. `0` is the old pure glow.
- `flashinkdark` (0.3) — how far the artwork's colour is pulled toward black. A
  little goes a long way: the supplied mark has a lit rim doing most of the
  legibility work, and blacking that out to make it "darker" loses the thing
  being darkened.
- `flashshadow` (0.07) and `flashshadowdark` (0.62) — a dark halo just outside
  the mark, in units of its own radius, so it sits on the surface rather than
  floating in front of it. It is also what keeps the mark readable once the climb
  below has shrunk it to a dot on a pale map.
- `flashcircle` (1) — treat the mark as a round badge and cut it to a circle
  rather than trusting its alpha. **`hermes/logo.png` has no alpha channel** —
  it is a circular badge on a black square — which the old additive pass got away
  with because black adds nothing. Paint cannot: it would lay the square down as
  a slab. Keying on brightness instead is worse, because measured on that artwork
  the surround is black to within 0.004 but 3% of the badge interior is that dark
  too, so a brightness key punches holes through the darkest strokes of the
  glyph, precisely where the contrast was wanted. Set `flashcircle=0` for artwork
  that has real alpha.

### The climb

Straight after the mark has held, the camera leaves the roof of the art car and
goes up. The mark shrinks as the ground falls away, the city resolves around it
out of nothing, and what was a mark filling the moon ends as a dot with the whole
plateau round it and streets you can name. The mark never stops being the same
object — that is what makes the two shots one shot rather than a map cutting in.

On by default wherever there is a mark. `?aerial=0` turns it off and gives the
mark its plain rise-hold-fall back.

- `aerialrise` (3.4s) climbing · `aerialhold` (5s) at altitude · `aerialfall`
  (1.5s) fading out. These extend the flash period rather than fitting inside it,
  so `flashsec` still sets how often the whole thing comes round.
- `aerialnear` (460m) and `aerialfar` (3900m) — metres across the disc at the
  bottom and the top of the climb. The near end is deliberately not tighter: the
  street image carries city-scale line weights, and a single block of it enlarged
  to fill the moon is one white band. Under the mark at the start of the climb it
  is barely visible anyway, which is what buys the licence.
- The zoom between them is geometric, not linear — altitude that doubles at a
  steady rate is what an ascent actually looks like. Interpolating the span
  straight spends most of the climb crawling over the last few hundred metres.
- `aerialframe` (0.72) — how far the camera comes off the vertical on the way up.
  At `0` it is a true plumb line and the mark stays dead centre the whole way,
  which is honest but never quite shows where it is: the city arrives around it
  and slides off one edge. Letting the camera lean puts the city in frame and the
  mark travels out to its own place in it.
- `aerialmark` (0.11) — the mark's size at altitude, in disc diameters.
  `aerialdim` (0.84) — how opaque the map is over the moon. `aerialtrail` (6) —
  hours of track to draw behind the dot.

### What else is on, out there

The climb also pins the other listings where they actually are, each one the
event's icon on a dark plate ringed in that listing's own colour. The colour is
the join: the same listing is that colour as a polygon on the corner map and as
the badge on the event bar, so a pin on the moon and a name in the bar are
findable as the same thing. Ten of them, in the server's ranked order, which is
the order the bar cycles.

The icons are the gifs, not polygons, because there is finally room for them —
the corner map learned the hard way that fourteen pixels of hollow nineties line
art on a street grid reads as a smudge, and a pin on the full disc is three or
four times that. They animate, since the browser keeps running a detached gif and
the canvas takes whatever frame is showing.

- `aerialevents` (10) — how many to pin. `aerialpin` (0.072) — pin size in disc
  diameters. `aerialpinsat` (0.5) — how far up before they start arriving, after
  the streets, so the shot reads as ground, then city, then what is happening
  in it.
- Pins are a fixed size on screen rather than scaled with the zoom, because a pin
  is a label on the map, not a thing lying on the ground getting smaller as you
  climb away from it.
- **The top of the climb is set by what has to be in shot**, not by `aerialfar`:
  the whole point of going up is to show what else is on, so a listing past the
  limb is the shot failing at its job, and how far out tonight's listings happen
  to be is not something a default can know. `aerialfar` is the floor, and the
  ceiling is capped at 2.2× it so one listing geocoded to the wrong side of the
  playa cannot pull the camera back until the city is a smudge.
- Listings whose `place` the geocoder could not resolve are dropped rather than
  stacked on the Man, which is where a null would put them.
- Pins landing on each other fan out into a ring, and pins landing under the
  Hermes badge are pushed out until they clear it — being next to Hermes is
  exactly why a listing ranks first, so that collision is the common case, and
  the badge must not hide the very things the climb went up to show.

Icons and mark colours now live in `js/hermes-marks.js`, shared by the corner map,
the event bar and the aerial pins, because a listing that is a pink pentagon on
one map and a green star on another is two listings to anyone watching.

Press `a` to go up now instead of waiting out the rest of the minute. It says why
not when it can't — no fix yet, no map loaded, mark toggled out — because both
things it needs arrive over the network, and "nothing happened" is a bad answer
to be given in front of a crowd.

The position comes from the same Hermes server the overlay uses, on port 8124,
fetched between climbs rather than during one so the ground never moves under the
camera mid-shot. **If the server is down or there is no fix, the climb simply
does not happen** and the mark flashes as it always did. The city image itself is
a static asset, so a map with no fix still loads and still waits.

Look at it frame by frame without waiting on the clock:

```
npm run hermes:aerial
EXTRA="&aerialframe=0&aerialnear=900" npm run hermes:aerial
```

which parks the climb at six altitudes and writes them to `artifacts/aerial/`,
reporting the span in metres and where the mark landed at each. Needs the server
up and a fix in the log for the car to be over.

`js/playa-map.js` is the projection and the aerial renderer, and is the version
meant to be shared — the overlay's corner map and the story page still carry
their own copies of the same origin-at-the-Man, rotate-to-the-Temple maths.

## Included assets

| Path | Purpose |
|------|---------|
| `hypermoon.html`, `controller.html` | latest show + control panel |
| `js/threejs.org_build_three.js`, `js/cdn.jsdelivr.net_npm_tone.js`, `js/cdn.jsdelivr.net_npm_@tonejs_midi.js` | vendored libs |
| `loops/3d moon/web/*.webm` | the rotating alpha moon videos (all 4 variants) |
| `assets/esoteric-geometries-circles-warp.gif` | the eye-seal backdrop gif |
| `artifacts/moon-cube-index.json`, `artifacts/color-cubes/` | letter-mosaic tiles |
| `assets/estoteric/web/` | sutra-pages slideshow preset |
| `artifacts/crt-terminal-green.mp4` | CRT window preset |
| `artifacts/sample-sonicsphere-silent.webm` | sonicsphere window preset |
| `audio-manifest.json`, `video-manifest.json` | controller pickers |
| `package.json` | `npm start` server script |
| `js/stream-broadcast.js`, `stream-view.html`, `scripts/stream-server.mjs` | LAN streaming (see below) |

## LAN streaming ("stream to LAN" toggle)

Run the signaling relay alongside the web server, then flip the toggle in the
controller (or open the moon with `?stream=1`):

    npm install            # once - needs the "ws" package
    npm run stream:server  # ws relay on :8081

Other devices watch at `http://<live-machine-ip>:8080/stream-view.html`.
The video flows peer-to-peer; the relay only handles the handshake.

## Driving an LED rig (Advatek PixLite)

The moon can light physical pixels as well as a screen. A PixLite E16-S Mk3
takes sACN or Art-Net over ethernet and drives 16 outputs of up to 1,020 RGB
pixels each, 96 universes in total.

Browsers cannot open UDP sockets, so the page cannot speak to the controller.
Instead the work is split: a bridge process owns the protocol, and the page
only ever looks at what it drew.

    npm run pixels:map -- halo --leds 240 --name moon-halo   # 1. describe the rig
    npm run pixels                                           # 2. start the bridge
    # 3. open the moon with ?pixels=1

The bridge hands the map to the page over a WebSocket; the page samples those
points out of a small composite of what the room sees — starfield, backdrop
clip and moon, not just the WebGL layer — and posts the bytes back; the bridge
packs them into universes and sends them on.

**Maps.** `scripts/make-pixel-map.mjs` writes to `maps/`. Points live in one of
two spaces. Disc-space points are given in disc radii from the moon's centre,
resolved against the disc the page has actually measured, so a halo holds the
limb through a `moonscale` change, a resize or a centring nudge. Frame-space
points are normalised to the rendered frame, for fixtures that relate to the
screen rather than to the moon.

    halo    --leds 240 --radius 0.92        ring around the disc (disc space)
    disc    --rings 12 --per 10             concentric rings filling it (disc space)
    grid    --w 32 --h 32 --serp 1          matrix, serpentine (frame space)
    strips  --count 8 --leds 144            uprights, one output each (frame space)

Universes are allocated in whole blocks per output, 170 RGB pixels each, the
way you would patch it in Advatek Assistant — so a patch change on one output
never shifts the ones after it. The generator warns if a map exceeds 16
outputs, 1,020 pixels on an output, or 96 universes.

**Fixtures that are not around the moon.** `sweep` is for a long run laid along
something else — strips down the sides of a car, a batten along a bar. Each run
carries a horizontal slice of the moon taken in disc radii, not across the
frame: a frame-space line is mostly empty space with the moon in the middle of
it, so it lights its centre third and leaves the ends dark, where spanning the
diameter puts the moon along the whole run.

    node scripts/make-pixel-map.mjs sweep --runs 4 --leds 120 --name car-sides

Recorded off a running show, that keeps 99% of the run lit, with the terrain
drifting slowly along it as the moon turns and colour arriving at the ends as
orbiting gifs cross. The obvious-looking alternative — unrolling the orbit path
along the strip, `halo --radius 1.2` — sweeps much further (the brightest point
travels 88% of the run against 55%) but only ever lights half of it, because
orbiters are small sprites against empty sky. It reads as an unlit strip with
occasional darts in it. Worth knowing before wiring a car for the wrong one.

Note that a bare moon is grey, so a fixture carrying a slice of it is close to
white. Colour along the run comes from whatever else is on screen: a `backdrop=`
behind the disc, the window content, the orbiting gifs at the ends.

**Sending.** sACN multicast by default, which is fine on a bench; name the
controller for a show network. Art-Net if you prefer it.

    PIXLITE=192.168.0.50 npm run pixels
    PROTOCOL=artnet PIXLITE=192.168.0.50 npm run pixels
    MAP=maps/moon-disc.json FPS=40 npm run pixels

**Which cable the light leaves by.** Plugging in ethernet is not enough on its
own. A unicast packet consults the routing table, so naming the controller
(`PIXLITE=`) sends it out of whichever port owns the rig's subnet and is the
right answer at a show. Multicast and broadcast do not: they leave by whichever
interface the OS favours, which on a laptop with Wi-Fi up is usually the Wi-Fi.
The rig then stays dark while the bridge cheerfully reports packets out, which
looks exactly like a wiring fault. Name the port if you want them anyway:

    IFACE=en7 npm run pixels                        # multicast out the cable
    PROTOCOL=artnet IFACE=en7 npm run pixels        # broadcasts to en7's subnet

The bridge prints the interfaces it can see, says which one it is leaving by,
and refuses to start on a name that is not there rather than quietly sending
nowhere. Art-Net broadcast goes to the subnet's own broadcast address when a
port is named, which survives a switch better than the all-ones address.

`pixelgamma` (default 2.2) and `pixelgain` on the moon's URL correct for LEDs
being driven linearly while the frame is sRGB; without the curve everything
below half brightness reads far too hot.

**Bringing it up.** The bridge lights the rig with no browser attached, which
separates a wiring or patch fault from a content one:

    TEST=chase npm run pixels        # one pixel walks each output in turn
    TEST=rgb npm run pixels          # whole rig cycles red, green, blue
    TEST=white LEVEL=0.2 npm run pixels

`pixel-preview.html` shows what the rig is being told, so a map can be looked at
rather than inferred from packet counts. It attaches to the bridge as a monitor
and is sent the same frame the controller gets, gamma and gain already applied,
in two views: the runs in wire order, where a strip wired back to front is
obvious, and where every LED samples from, drawn against the moon, where a run
pointing into empty space is obvious. The test patterns come through the same
buffer, so a map can be checked with no moon and no controller anywhere:

    MAP=maps/car-sides.json TEST=chase npm run pixels
    open http://localhost:8080/pixel-preview.html

Give it a minute before judging a disc-space map. The page surveys where the
disc actually is over a revolution of playback before pinning it, so for the
first half minute the sample points are working off an estimate and the run will
light less of itself than it eventually will.

`node scripts/check-pixels.mjs` proves the whole chain with no hardware at all:
it stands a fake controller on the loopback, runs a headless moon against it,
and validates the E1.31 framing, the universes that arrived, the frame rate and
whether anything is actually lit.

## Locking, sleep, and unattended runs (macOS)

macOS gives no supported way to draw over the login window: once the session
locks, the login window owns every display and the show is off screen until
someone types the password. Screen recording is blocked there too. So the
whole strategy is to keep the machine from reaching that state.

    npm run show:mac:status   # displaysleep, lock delay, who's holding the display awake
    npm run show:mac          # hold the assertion + launch the kiosk
    npm run show:mac:off      # release it

`show:mac` holds a `caffeinate -dimsu` assertion (no sudo, nothing on the
system is modified) and launches Chrome with
`--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`,
`--disable-background-timer-throttling` and
`--disable-features=CalculateNativeWinOcclusion`, without which Chrome starves
an occluded window and the canvas freezes. It probes for whichever local port
is actually serving `hypermoon.html` rather than assuming 8080 — worth knowing
if another project already owns that port. `--harden` additionally disables the
screensaver and sets `displaysleep 0` (sudo, restored by `off`).

Two things still lock a Mac that this cannot prevent: locking it by hand
(Ctrl-Cmd-Q, Apple menu) and closing the lid. Check `sysadminctl -screenLock
status` — if the delay is "immediate", any display sleep locks the session
instantly.

The output page defends itself too. It takes a screen wake lock (visible as
Chrome's "Blink Wake Lock" in `show:mac:status`) and re-takes it whenever the
page becomes visible again. Its frame pump prefers `requestAnimationFrame` but
falls back to a timer whenever the compositor stops answering, so the canvas —
and the LAN broadcast captured from it — keeps producing frames even while the
window is occluded or the display is blanked. `window.__hyperstitionStats.pump`
reports `frames`, `timerFrames`, `stalls` and the wake lock state if you need
to prove it is still alive.

- **Vajras that actually orbit.** A dorje in front of the moon now *covers*
  the surface (the clips are keyed off their black background and composited
  properly, instead of being added as light, which made them look painted on)
  and the far half of each lane is clipped per pixel against the disc, so a
  dorje is eaten by the limb, vanishes behind the moon and comes out the
  other side. The **vajra lane opening** slider (`?vajratilt=0.05..1`) sets
  how far a lane opens vertically, measured against the disc rather than
  against the lane's width — that is what guarantees every lane turns inside
  the limb instead of only the innermost one. `vajra orbit radius` still sets
  how wide they swing at the sides.

## Dorje clips

The orbiting vajras and the vajra cave play from
`loops/VAJRA DORJE ANIMATIONS/web/` — 360p proxies, about 6 MB for the set,
which travel with the kit. They exist because the masters are 1080p at
32 Mbit/s each: decoding four or six of those at once tears the sprites into
macroblock garbage, and nothing is gained when a sprite renders 120 px tall.
Rebuild them from the masters with `npm run build:vajra:proxies`. The full
`loops/VAJRA DORJE ANIMATIONS/` masters (~734 MB) are *not* included; if a
proxy is missing the sprite falls back to the master path automatically.

## Making a demo reel

`npm run export:reel` walks every effect in turn — word mosaic, mumins, star
fisher, CRT, incantation, vajra cave, the folds, the sonic sphere, the
cymatics plate, orbiting vajras, the eye iris, blood moon, earth's shadow,
starfield, moon size — captions each one and writes
`artifacts/hypermoon-effects-reel.mp4` (about a minute). `SCENES=fisher,blood`
renders just those, `SCENE_MS=` changes the time per scene.

`npm run export:clips` captures the same pass but writes one little video per
effect into `artifacts/demos/effects/` instead of the montage — handy for
showing a single effect without scrubbing. `CLIPS=1 npm run export:reel`
writes both.

## Rendering it onto a holographic fan

`npm run export:holofan` shows what the moon looks like on one of those
spinning LED "3D hologram" fans, at a size worth having: a 180 cm disc with a
figure beside it for scale.

The numbers are a real unit rather than invented ones. A 180 cm fan carries 2512
LEDs across eight blades, which is 314 down each arm at 2.87 mm pitch, and turns
at 350 rpm — about 47 image refreshes a second. It is filmed at 30 fps, like the
phone footage it is imitating, and that is worth knowing because it is where the
look comes from: 47 passes a second against 30 frames lands near one and a half
passes per frame, and missing the whole number is what sets the shutter wedges
crawling round the disc instead of strobing. Change the rpm and it will strobe.

That 2.87 mm pitch is the number to remember when sizing a guest's mark. It is
the real limit on how fine a logo can be before the arm cannot resolve it, and
it is coarser than it sounds at 180 cm.

It runs in two passes. First it films the moon square, the way a clip would be
loaded onto the fan's own controller, cueing a short sequence by hand — the
iris opening on the eye seal, the sonic sphere in the window, blood moon, then
a slow earth's shadow that is at its deepest as the shot ends. Then
`holofan.html` plays that clip back through a simulated arm of LEDs and the
result is filmed in turn, ending at
`artifacts/demos/hypermoon-holofan-180cm.mp4` (about 45 s).

What the simulation actually does: the picture is resampled into polar
coordinates, so it arrives as concentric rings of light on the LED pitch rather
than as square pixels; unlit pixels are simply air, so the room shows straight
through the dark side of the moon; the arm leaves a faint update seam chasing
the rotation; and the LED rings are band-limited against the pixel footprint,
so they are crisp when the camera is close and dissolve into an even glow when
it is not — which is what a camera does and what stops the whole thing turning
into a moire starburst.

It also films badly on purpose, because a clean one of these does not exist on
video. The shutter is open for less than the gap between arm passes, so part of
each sweep has already gone dark by the time the frame is read: soft wedges
crawl round the disc behind a bright edge where the arm itself was caught
mid-exposure. On top of that a rolling-shutter band drifts through the picture,
the LEDs' own switching beats against the frame rate, and every few seconds a
slice of a turn never gets written at all. `shutter=1` turns the wedges off,
`artifacts=0` turns the lot off.

### Two framings

The default shot is about the hardware: it opens wide enough to read 180 cm off
the figure beside it, then pushes in until the LED rings and the update seam
resolve.

`SHOT=room npm run export:holofan` is the other one, and stands back across the
lobby for the whole shot — roughly where an audience is when they come across
the thing. It writes
`artifacts/demos/hypermoon-holofan-180cm-room.mp4`. At that range the disc
stops being a diagram of a fan and starts being an object hanging in a space,
which is the version to show somebody deciding whether to put one in a room.

Standing back needs more set, so the shot brings its own: a ceiling (open black
above a lobby reads as a void), and six people rather than one. One of them
stands behind the disc and on the limb rather than dead centre — a silhouette
running unbroken out of the room and into the picture is the whole claim of the
format in a single frame, and it only reads where the moon is dim enough not to
wash it out. It is at its best over the blood moon.

Both framings are on `holofan.html` directly as `?shot=push` (default) and
`?shot=room`, and everything the preset picks — `dist`, `dist2`, `people`,
`ceil`, `ceilh`, `orbitdeg`, `notefade` — can still be set by hand on top.

Worth knowing:

- `SKIP_SOURCE=1` reuses `artifacts/holofan-source.mp4` instead of re-filming
  the moon, which is most of the runtime. Both framings can share one source
  clip, so the second one costs only the minute it takes to film the fan.
- `STILL=1` writes a single frame instead of a video, for eyeballing changes.
- `DIAM=` in centimetres. The dimension line and the caption follow it, and so
  does everything physical, so `DIAM=65` really does look like a desk fan.
- `venue=lobby` (the default) stands it in a bright panelled room under house
  lights, which is where all the manufacturers' footage is shot and the harder
  demonstration by far: the room is brighter than most of the picture and the
  wall's panel seams run straight on through the moon. `venue=dark` is the
  version for an actual venue, where the disc is the only thing lighting
  anything. The two want different gain, and pick it up automatically.
- `FAN_QUERY=` passes anything through to the page, e.g.
  `FAN_QUERY="leds=448&rpm=900&dollysec=0&orbit=0"`.
- `MOON_QUERY=` does the same for the moon pass.

`holofan.html` also runs on its own against any clip:
`holofan.html?src=artifacts/demos/effects/hypermoon-eye.mp4&diam=180`. Useful
knobs are `leds` (per arm), `steps` (angular samples a turn), `rpm`, `gain`,
`glow`, `haze`, `duty`, `zoom`, `shutter`, `artifacts`, `venue`, and `person`,
`dim`, `room`, `label` to strip the room back to just the disc. `FAN_NTH=1`
films at 60 fps instead of 30, which is worth seeing once for how much worse
the wedges look.
