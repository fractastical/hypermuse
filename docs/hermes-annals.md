# The Annals of Hermes

A day-by-day account of the week: what the car did, where it went, and the photographs
somebody chose to show. Eleven days, 2026-08-28 to 2026-09-07.

## Where it all lives

| What | Where | In git? |
| --- | --- | --- |
| The written account, per day | `data/hermes/annals-narratives.json` | yes |
| Captions and art-car credits | `data/hermes/annals-media.json` | yes |
| The photographs and clips | `assets/hermes-annals/<day>/` | no, too large |
| Position fixes behind the maps | `data/hermes/track.jsonl` | no, private |
| Which photos are public | `data/hermes/annals-curation.json` | yes |
| The published page | `docs/annals/` | yes |

The facts in each day's account — kilometres, farthest fix, how much of the day was deep
playa — are computed from the track log rather than typed, so they cannot drift from it.

## Building it

```sh
npm run hermes:annals:photos -- --apply   # file a camera dump into day folders
npm run hermes:annals:maps                # one track overlay per day
npm run hermes:annals:index               # what the curator reads
# open annals-curator.html, choose photos, mark a best-of, download the json
npm run hermes:annals:publish -- --apply  # build docs/annals/
```

`hermes:annals:photos` is the only step that needs doing once. It sorts by capture time in
playa local time, not UTC, because a photograph taken at one in the morning belongs to the
night before rather than to the next day. It also converts what a browser cannot open —
HEIC to JPEG, HEVC to H.264 — and writes a poster frame beside every clip.

`hermes:annals:reel` is separate: one highlight per day cut into a single video, for when
the week wants to be ninety seconds rather than a page.

## The maps

`scripts/hermes-day-maps.mjs` draws each day's fixes over the official city plan. It does
not recompute the projection. `scripts/build-hermes-map.mjs` recorded the origin, rotation,
bounds, scale and offset it used beside the base map, and reading those back is the only
way an overlay is guaranteed to sit on the streets rather than near them.

Output is one shared `playa-streets.svg` and a small transparent `<day>.track.svg` per day,
which the page stacks. Inlining the streets into each day instead would have meant eleven
copies of the same 112 KB of roads; this way the whole set is about 240 KB.

### Stops, not a route

The maps draw circles and arcs rather than a line, because a line was a lie. The log's
median gap is two seconds and its median step four metres: the fixes arrive as dense
bursts a few metres wide, and then jump a kilometre to the next burst with nothing
recorded in between. On 28 August all forty-nine fixes sit inside forty-one metres across
six hours — the car was parked, and what varied was the GPS.

Joining those in order drew a scribble at every stop and an invented road between them.
So each burst is collapsed into a stop instead: fixes within 120 metres of each other are
one place, sized by how long it stayed, and revisiting a place draws one circle rather
than two. Moves between stops are dashed curves, because the driving was never logged and
a straight solid line would claim a route the data does not know. The faint shaded area is
the convex hull of the stops — roughly the ground the day covered.

Green is the day's first stop, red the last. A day with one stop gets no red, since
there is nowhere for it to point.

## Choosing what is public

Nothing is published unless it is chosen. `annals-curator.html` lists every photograph and
clip; clicking one marks it public, and **best of day** makes it that day's lead — shown
full width above the account, one per day. A day with nothing marked simply has no lead.

Choices persist in the browser as you make them. **download annals-curation.json** hands
them to the publisher; save it into `data/hermes/`.

The publisher clears `docs/annals/media/` on every run and copies only what is chosen, so
unchoosing something removes it rather than leaving it orphaned on the site. Stills are
re-encoded to 1600 px and clips to 720p, which is what makes the page openable on a phone
in a place with no signal.

Ride requests are left out by default. `--with-requests` includes them, and it publishes
the names of the people who asked, which is why it is not the default.

Some of what was photographed is topless. **18+** on a tile holds that one back: it stays
chosen, and the ordinary build leaves it out. `--explicit` puts it in. The default is the
censored build, deliberately — the uncensored one should need somebody to type a flag,
because it is the build that cannot be taken back once a crawler has been round. Both runs
say what they did, so a held-back file is never silently held back or silently published.

In the curator a held-back tile is blurred and badged; hovering its **18+** badge uncovers
it, which is a small target on purpose. The flag rides in `annals-curation.json` next to
`publish` and `lead`, so it survives the download the same way a caption does.

**The accounts name people.** The narratives mention DJs and guests by name. That is a
choice worth making deliberately before the page goes public, and it is not something the
publisher can decide for you.

## Comments

The page posts to `/api/hermes/annals/comments`, which takes a name and a body and nothing
else — no account, no email. Rate limited per address, and the raw log is never served.

Taking a comment down means setting `hidden` on its row; the read path filters those out.
`HERMES_ANNALS_COMMENTS=0` closes the box altogether. On Railway these live in Postgres
because the container disk is discarded on deploy, and a comment is the one thing here
that cannot be reconstructed from anything else. See `docs/hermes-railway.md`.

## The people graph

`data/hermes/people-graph-events.jsonl` records introductions, no-shows and one ethical
breach, by name. It is gitignored, and it should stay that way.

`npm run hermes:anon -- --apply` writes `people-graph-events.anon.jsonl`, which is safe to
commit: the events, dates, kinds and severities survive, and every name becomes a stable
pseudonym so the shape of the graph still reads — the same person introduced, then
reported, then making restitution.

The pseudonyms are HMACs under a secret in `data/hermes/.anon-salt`, which is gitignored.
This matters more than it looks. The names here are ordinary first names and a few public
figures, so a plain hash would publish a lookup table rather than a pseudonym: guess a few
hundred names, hash each, and read off who was censored. Keyed, that attack needs the salt.

Keep the salt. Losing it means the next run invents different pseudonyms for the same
people, and the committed file's history stops lining up with itself.

Notes do not survive either, and that is the point. Swapping a name for a pseudonym only
helps if the sentence around it could have been about anybody, and these sentences cannot:
one described broken bottles, two abandoned bikes and a bag of urine, and anybody who was
in camp can name that person from the description alone. So the public file carries a fixed
phrase per kind — "Conduct complaint recorded", "Did not attend as expected" — and the prose
stays in the gitignored original. There is no judgement call left to get wrong when somebody
adds a row in a hurry. `place` and `requestId` are dropped for the same reason: a corner of
the city identifies a person, and an id lets two files be joined back together.

One thing it cannot fix. A date plus a severity in a small community is itself a clue —
anonymised is not anonymous when the reader was there.

## Still open

- The real names are in git history from before the log was ignored. Anonymising the
  working copy does not remove them; that needs a history rewrite.
- The narratives have not been read through for names yet.
