# Hypermoon live-show transfer

Unzip this archive **into the repo root** on the live machine (it mirrors the
repo layout and safely overwrites `hypermoon.html` / `controller.html` with the
latest versions). Then:

    npm start          # http-server on :8080  (or: npx http-server -c-1 -p 8080 .)

- Output window: `http://localhost:8080/hypermoon.html?kiosk=1`
  (or open it from the controller's "open output" button)
- Controller: `http://localhost:8080/controller.html`

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
  could not key is obvious at a glance. Only the tiles near the viewport are
  live, so a library of thousands still scrolls.

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

**Sending.** sACN multicast by default, which is fine on a bench; name the
controller for a show network. Art-Net if you prefer it.

    PIXLITE=192.168.0.50 npm run pixels
    PROTOCOL=artnet PIXLITE=192.168.0.50 npm run pixels
    MAP=maps/moon-disc.json FPS=40 npm run pixels

`pixelgamma` (default 2.2) and `pixelgain` on the moon's URL correct for LEDs
being driven linearly while the frame is sRGB; without the curve everything
below half brightness reads far too hot.

**Bringing it up.** The bridge lights the rig with no browser attached, which
separates a wiring or patch fault from a content one:

    TEST=chase npm run pixels        # one pixel walks each output in turn
    TEST=rgb npm run pixels          # whole rig cycles red, green, blue
    TEST=white LEVEL=0.2 npm run pixels

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
