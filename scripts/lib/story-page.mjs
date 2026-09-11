// The story as a page, with the trail drawn on the same map the kiosk draws.
//
// The projection is the map's own, read out of the metadata the renderer wrote
// beside the image: a point's pixel is offset + (metres - bounds.min) * scale and
// nothing else. Deriving a fit here instead is what once stood fixes off the
// streets the panel said they were on, so the numbers come from the file.
//
// One page, no build step, no dependencies. Open it off a disk, drop it on
// Pages, mail it to somebody — a dispatch that needs a server to be read is not
// a dispatch. The map image is the only outside part, copied in next to it.
const esc = (text) => String(text == null ? "" : text)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// Bold in the wording survives into the page, because the same sentences are
// written to a text file and markdown is what makes that readable too.
const strong = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

export function renderPage(story) {
  // Every point gets a number in one running order across the whole night, so the
  // trail can be drawn part-way and the drawing be the same part-way every time.
  // Counted rather than timed: two thirds of this record is gaps, and an
  // animation on the clock would spend most of itself watching nothing happen.
  let counted = 0;
  const journeys = story.journeys.map((journey) => {
    const first = counted;
    counted += journey.points.length;
    return {
      label: journey.label,
      hue: journey.hue,
      first,
      points: journey.points.map((p) => [Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6))]),
      stops: journey.beats
        .filter((beat) => beat.kind === "stop")
        .map((beat) => ({
          n: beat.n,
          lat: beat.lat,
          lon: beat.lon,
          place: beat.place,
          // Where in the running order this stop is finished being stood in, so
          // its marker lands as the trail reaches it rather than sitting on the
          // map from the first frame giving away where the night went.
          at: first + (beat.to || 0)
        }))
    };
  });
  const data = { meta: story.map, total: counted, journeys };

  const journeyHtml = story.journeys.map((journey) => `
      <section class="journey" style="--hue:${journey.hue}">
        <h3><span class="swatch"></span>${esc(journey.label)}</h3>
        <p class="headline">${strong(journey.headline)}</p>
        <ol class="beats">
          ${journey.beats.map((beat) => `
          <li class="${beat.kind}">
            ${beat.kind === "stop" ? `<span class="pin">${beat.n}</span>` : `<span class="pin move"></span>`}
            <div>
              <span class="at">${esc(beat.time)}</span> ${strong(beat.text)}
              ${(beat.nearby || []).length ? `<ul class="nearby">${beat.nearby
                .map((line) => `<li>${strong(line)}</li>`).join("")}</ul>` : ""}
            </div>
          </li>`).join("")}
        </ol>
        ${journey.silenceAfter ? `<p class="silence">${strong(journey.silenceAfter)}</p>` : ""}
      </section>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(story.title)} — ${esc(story.subtitle)}</title>
<style>
  :root { color-scheme: dark; --ink: #f4faff; --dim: #8fa6b8; --bg: #06090f; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 40px 24px 80px; }
  header { border-bottom: 1px solid #1b2735; padding-bottom: 24px; margin-bottom: 32px; }
  h1 { font-size: clamp(30px, 6vw, 54px); margin: 0; letter-spacing: -0.02em; }
  .sub { color: var(--dim); font-size: clamp(15px, 2.4vw, 20px); margin: 6px 0 0; }
  .tally { margin: 18px 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px; color: var(--dim); }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 36px; align-items: start; }
  /* Held in view only when it is beside the telling. Stacked — on a phone, or in
     a narrow window — a sticky map is pinned above the text and the whole story
     scrolls underneath it. */
  @media (min-width: 901px) {
    .layout { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; }
    .mapwrap { position: sticky; top: 24px; }
  }
  canvas { width: 100%; height: auto; display: block; border: 1px solid #1b2735;
    border-radius: 10px; background: #080d14; }
  .caption { color: var(--dim); font-size: 12px; margin-top: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .caption a { color: #7fd4ff; }
  .journey { margin: 0 0 40px; }
  .journey h3 { font-size: 15px; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--dim); margin: 0 0 10px; display: flex; align-items: center; gap: 9px; }
  .swatch { width: 11px; height: 11px; border-radius: 50%;
    background: hsl(var(--hue) 85% 62%); box-shadow: 0 0 12px hsl(var(--hue) 85% 62% / 0.7); }
  .headline { font-size: clamp(19px, 2.6vw, 25px); line-height: 1.4; margin: 0 0 18px; }
  .beats { list-style: none; margin: 0; padding: 0; }
  .beats li { display: flex; gap: 12px; padding: 7px 0; align-items: flex-start; }
  .pin { flex: 0 0 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;
    font: 600 12px/1 ui-monospace, Menlo, monospace; background: hsl(var(--hue) 85% 62%);
    color: #06090f; margin-top: 2px; }
  .pin.move { background: none; border-left: 2px dotted hsl(var(--hue) 40% 45%);
    border-radius: 0; height: 26px; margin-left: 11px; flex-basis: 2px; }
  .at { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dim);
    font-size: 13px; margin-right: 4px; }
  .nearby { margin: 6px 0 2px; padding-left: 16px; color: var(--dim); font-size: 14px; }
  .silence { color: #6f8598; font-style: italic; font-size: 14px;
    border-left: 2px solid #1b2735; padding-left: 14px; margin: 20px 0 0; }
  footer { color: #5d7286; font-size: 12px; margin-top: 48px; padding-top: 20px;
    border-top: 1px solid #1b2735; font-family: ui-monospace, Menlo, monospace; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(story.title)}</h1>
    <p class="sub">${esc(story.subtitle)}</p>
    <p class="tally">${esc(story.tally)}</p>
  </header>
  <div class="layout">
    <div class="mapwrap">
      <canvas id="map" width="1400" height="900"></canvas>
      <p class="caption">${esc(story.mapCaption)}${story.gif
        ? ` · <a href="${esc(story.gif)}">animation as a gif</a>`
        : ""}</p>
    </div>
    <div class="telling">
${journeyHtml}
      <footer>${strong(story.footer)}</footer>
    </div>
  </div>
</div>
<script>
const STORY = ${JSON.stringify(data)};
// Deliberately on the window: the gif renderer reads the length of the night out
// of here to work out its frames. A top-level const in a classic script is in the
// global lexical scope and not a property of window, so without this the page
// looks empty from outside and the renderer cannot tell that from a broken build.
window.STORY = STORY;
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const meta = STORY.meta;

// The map's own transform, not one fitted here.
function rotated(lon, lat) {
  const o = meta.origin;
  const x = (lon - o.lon) * Math.cos(o.lat * Math.PI / 180) * 111320;
  const y = (lat - o.lat) * 111320;
  const c = Math.cos(meta.rotation || 0);
  const s = Math.sin(meta.rotation || 0);
  return { x: x * c - y * s, y: x * s + y * c };
}
// Where a coordinate falls in the map image.
function onImage(lat, lon) {
  const p = rotated(lon, lat);
  return {
    x: meta.offset.x + (p.x - meta.bounds.minX) * meta.scale,
    y: meta.offset.y + (meta.bounds.maxY - p.y) * meta.scale
  };
}

// The whole image is mostly empty: the render carries wide margins around the
// city, and a night spent in one quadrant comes out as a hairline in a field of
// grey. So the page shows the part of the map the night happened in, widened
// until there is enough city around it to place it — the Man and a few rings are
// what make a trail mean anything — and never zoomed past the point where the
// street grid stops being recognisable.
const VIEW_MIN_SPAN = 620;
const VIEW_PAD = 0.22;
const view = (() => {
  const all = STORY.journeys.flatMap((j) => j.points.map(([lat, lon]) => onImage(lat, lon)));
  const wide = { x: 0, y: 0, w: meta.width, h: meta.height };
  if (all.length < 2) return wide;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  // The Man is the one landmark worth keeping in frame whatever happened, since
  // everything on the playa is described by where it is relative to it.
  const man = onImage(meta.origin.lat, meta.origin.lon);
  minX = Math.min(minX, man.x); maxX = Math.max(maxX, man.x);
  minY = Math.min(minY, man.y); maxY = Math.max(maxY, man.y);

  const pad = Math.max((maxX - minX) * VIEW_PAD, (maxY - minY) * VIEW_PAD, 40);
  let w = Math.max(maxX - minX + pad * 2, VIEW_MIN_SPAN);
  let h = w * (meta.height / meta.width);
  if (h < maxY - minY + pad * 2) {
    h = maxY - minY + pad * 2;
    w = h * (meta.width / meta.height);
  }
  // Slid back inside the image rather than shrunk, so the aspect ratio the canvas
  // was sized for survives and nothing is stretched.
  let x = (minX + maxX) / 2 - w / 2;
  let y = (minY + maxY) / 2 - h / 2;
  if (w >= meta.width || h >= meta.height) return wide;
  x = Math.max(0, Math.min(meta.width - w, x));
  y = Math.max(0, Math.min(meta.height - h, y));
  return { x, y, w, h };
})();

const zoom = meta.width / view.w;
function project(lat, lon) {
  const p = onImage(lat, lon);
  return { x: (p.x - view.x) * zoom, y: (p.y - view.y) * (canvas.height / view.h) };
}

const base = new Image();
// What to do once the city is there. Set at the bottom, where it is decided
// whether this is a still, a frame of the gif, or the page drawing its own trail.
let ready = () => draw();
base.onload = () => ready();
// The vector city, rasterised by the browser at whatever size it is drawn. The
// page crops into the map, and the PNG is 1400 pixels wide for the whole playa —
// a quadrant of it blown up to fill a canvas is a blur of soft grey bands. The
// SVG has the same coordinate space and no such limit. The PNG is the fallback,
// and no map at all is still a page: the trail is the subject and the city is
// only there to place it.
base.onerror = () => {
  if (base.src.endsWith(".svg")) { base.src = "playa-streets.png"; return; }
  ready();
};

// Two journeys that both ended the night at camp put their markers on the same
// pixel, and one circle with a number in it is then a lie about how many stops
// there were. Anything sharing a spot gets fanned around it. Worked out once,
// because it must not shuffle between frames of an animation.
const spots = (() => {
  const crowd = new Map();
  for (const journey of STORY.journeys) {
    for (const stop of journey.stops) {
      const p = project(stop.lat, stop.lon);
      const key = Math.round(p.x / 26) + ":" + Math.round(p.y / 26);
      if (!crowd.has(key)) crowd.set(key, []);
      crowd.get(key).push(stop);
      stop._at = p;
    }
  }
  for (const together of crowd.values()) {
    if (together.length < 2) continue;
    together.forEach((stop, i) => {
      const a = (i / together.length) * Math.PI * 2 - Math.PI / 2;
      stop._at = { x: stop._at.x + Math.cos(a) * 16, y: stop._at.y + Math.sin(a) * 16 };
    });
  }
  return true;
})();

function draw(cut) {
  const upto = cut == null ? Infinity : cut;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (base.complete && base.naturalWidth) {
    ctx.globalAlpha = 0.62;
    ctx.drawImage(base, view.x, view.y, view.w, view.h, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }

  let head = null;
  for (const journey of STORY.journeys) {
    const colour = "hsl(" + journey.hue + " 85% 62%)";
    const have = Math.max(0, Math.min(journey.points.length, upto - journey.first + 1));
    if (!have) continue;
    const pts = journey.points.slice(0, have).map(([lat, lon]) => project(lat, lon));
    if (have < journey.points.length || upto === Infinity) head = { p: pts[pts.length - 1], colour };
    if (pts.length > 1) {
      // Drawn twice: a wide soft pass for the glow, a thin one for the line. A
      // single stroke at this width on a pale street grid disappears into it.
      ctx.strokeStyle = colour;
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 9;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
    for (const stop of journey.stops) {
      if (stop.at > upto) continue;
      const p = stop._at;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.strokeStyle = "#06090f";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = "#06090f";
      ctx.font = "700 15px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(stop.n), p.x, p.y + 1);
    }
  }

  // Where the trail has got to. Without it a growing line is ambiguous about
  // which end is growing, and the eye has to work out the direction of travel
  // from the shape instead of being told.
  if (head && head.p && upto !== Infinity) {
    ctx.beginPath();
    ctx.arc(head.p.x, head.p.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#f4faff";
    ctx.fill();
    ctx.strokeStyle = head.colour;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

// How far along the trail each point is. The animation is paced by this rather
// than by how many points there are, because the log's sampling rate has nothing
// to do with the night: two thirds of these fixes are a van parked at camp, and
// paced by count two thirds of the animation is a stationary dot followed by the
// actual drive going past in a rush. Distance resets between journeys, so the
// jump across an eleven-hour silence is not treated as ground covered.
const paced = (() => {
  const steps = [];
  let run = 0;
  for (const journey of STORY.journeys) {
    let prev = null;
    for (const [lat, lon] of journey.points) {
      const p = project(lat, lon);
      if (prev) run += Math.hypot(p.x - prev.x, p.y - prev.y);
      steps.push(run);
      prev = p;
    }
  }
  return { steps, total: run || 1 };
})();

// The frame schedule, exposed so the page's own playback and the gif renderer
// step through the same pictures rather than two animations that merely resemble
// each other. Eased out, so it sets off at a pace and settles rather than
// stopping dead.
STORY.upto = (through) => {
  const f = 1 - Math.pow(1 - Math.max(0, Math.min(1, through)), 1.7);
  const want = f * paced.total;
  let lo = 0;
  let hi = paced.steps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (paced.steps[mid] < want) lo = mid + 1; else hi = mid;
  }
  return lo;
};

// ?upto=N draws the first N points and stops there, which is how the frames of
// the gif are shot: one number in, one exact picture out, no clock involved.
// Otherwise the page draws its own trail once on load, because a trail that
// arrives is a night and a trail already drawn is a diagram — and then rests at
// the whole thing, so anyone scrolling back sees the finished map.
const asked = new URLSearchParams(location.search);
const upto = asked.get("upto");
const PLAY_SEC = Number(asked.get("play") == null ? 5.5 : asked.get("play"));
if (upto != null) {
  ready = () => draw(Number(upto));
} else if (PLAY_SEC > 0 && STORY.total > 2) {
  ready = () => {
    let started = null;
    const step = (now) => {
      if (started == null) started = now;
      const through = Math.min(1, (now - started) / (PLAY_SEC * 1000));
      draw(STORY.upto(through));
      if (through < 1) requestAnimationFrame(step);
      else draw();
    };
    requestAnimationFrame(step);
  };
}
// Last, so the handlers above are all in place before it can possibly fire —
// a cached svg can be decoded before the next line runs.
base.src = "playa-streets.svg";
</script>
</body>
</html>
`;
}
