// Builds the press kit: the moving work, cut down to sizes git and a browser
// will both accept, into docs/ where GitHub can actually serve it.
//
//   npm run press                 build whatever is missing
//   FORCE=1 npm run press         rebuild everything
//   ONLY=poem,holofan npm run press
//
// Why this exists: artifacts/ is gitignored, so every render in there is
// invisible to anyone who clones or browses the repo - which is everything
// worth showing. Pages serves this repo from its root, so anything committed
// under docs/press is live at
//
//   https://fractastical.github.io/hypermuse/docs/press/
//
// The masters stay in artifacts/ at full size; these are viewing copies. The
// README's own animated strip is GIF rather than MP4 because GitHub will not
// play a repo-relative video in a markdown page, only an image.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";

const ROOT = process.cwd();
const PRESS = path.join(ROOT, "docs", "press");
const CLIPDIR = path.join(PRESS, "clips");
const LOOPDIR = path.join(PRESS, "loops");
const POSTER = path.join(PRESS, "posters");
const GALLERY = path.join(ROOT, "docs", "gallery");
const FORCE = process.env.FORCE === "1";
const only = String(process.env.ONLY || "").trim();
const wanted = only ? new Set(only.split(",").map((s) => s.trim())) : null;
const pick = (id) => !wanted || wanted.has(id);

// Cut points are chosen past each render's settling-in: the moon fades up, the
// fan spins up, the poem has to turn before it writes anything.
const CLIPS = [
  {
    id: "rig", title: "The installation, at night",
    src: "artifacts/demos/hypermuse-rig-4m3.mp4",
    start: 4, len: 24, width: 1152, crf: 30,
    note: "the fan on the 4.3 m tower over its 2.5 m base, dimensioned, with people for scale"
  },
  {
    id: "effects-reel", title: "The effects library, end to end",
    src: "artifacts/demos/hypermoon-effects-reel.mp4",
    start: 0, len: 64, width: 960, crf: 32,
    note: "every effect in the rotation, captioned, in one pass"
  },
  {
    id: "moon", title: "The moon, carousel program",
    src: "artifacts/demos/moon-1920x1080.mp4",
    start: 4, len: 20, width: 1152, crf: 31,
    note: "what goes to the first projector - a different effect each revolution"
  },
  {
    id: "poem", title: "The poem, three words a side",
    src: "artifacts/demos/poem-triangle-1920x1080.mp4",
    start: 6, len: 20, width: 1152, crf: 31,
    note: "the triangle turns a third a line so the words being written are always along the base"
  },
  {
    id: "dual-projector", title: "Both projectors together",
    src: "artifacts/demos/dual-projector-preview.mp4",
    start: 6, len: 20, width: 1280, crf: 32,
    note: "the pair as the room sees them, 402 x 226 cm each"
  },
  {
    id: "holofan-room", title: "On a 180 cm holographic fan",
    src: "artifacts/demos/hypermoon-holofan-180cm-room.mp4",
    start: 6, len: 18, width: 1152, crf: 31,
    note: "the fan at room distance, with people for scale"
  },
  {
    id: "holofan-close", title: "The fan up close",
    src: "artifacts/demos/hypermoon-holofan-180cm.mp4",
    start: 8, len: 16, width: 1152, crf: 31,
    note: "LED persistence, rolling shutter and blade artifacts as a camera sees them"
  },
  {
    id: "art-selects", title: "Art selects",
    src: "artifacts/art-cuts/hypermoon-art-selects-loop.mp4",
    start: 0, len: 27, width: 1152, crf: 31,
    note: "the cuts worth leading with, crossfaded, looping from and to black"
  },
  {
    id: "film", title: "The film (excerpt)",
    src: "artifacts/art-film/hypermoon-film-titled.mp4",
    start: 0, len: 34, width: 1152, crf: 31,
    note: "opening of the titled cut - the whole 2m 10s is in artifacts/art-film"
  }
];

// Short, silent and small enough to sit in a markdown page. GitHub will animate
// a GIF in a README and will not play an MP4, so the strip at the top of the
// README has to be GIF whatever it costs in bytes.
const LOOPS = [
  // The moon and the fan are starfields and gradients, which is the worst case
  // for a palette, so they run smaller and slower than the poem's flat white.
  { id: "rig", src: "artifacts/demos/hypermuse-rig-4m3.mp4", start: 6, len: 6, width: 380, fps: 10 },
  { id: "moon", src: "artifacts/demos/moon-1920x1080.mp4", start: 8, len: 6, width: 380, fps: 10 },
  { id: "poem", src: "artifacts/demos/poem-triangle-1920x1080.mp4", start: 8, len: 7, width: 420, fps: 10 },
  { id: "holofan", src: "artifacts/demos/hypermoon-holofan-180cm-room.mp4", start: 8, len: 6, width: 380, fps: 10 }
];

// The booking sheet, kept here rather than typed into the page so the page and
// the README cannot drift apart. The PDF beside it is the sheet as sent.
const SPEC = {
  about: "An audio-reactive holographic fan, rigged above a DJ booth or standing on its own " +
    "tower. It ships with an equalizer that can be preconfigured for the night's music, and " +
    "it will play VJ loops or 3D visuals supplied as mp4 - or run this show, live and " +
    "reacting to the room.",
  debut: "Debuted at Burning Man PlayAlchemist, 2023.",
  rows: [
    ["Height", "4.3 m to the top of the disc"],
    ["Footprint", "2.5 m square ground frame"],
    ["Install", "2 people, 2.5 hours"],
    ["Breakdown", "2 people, 1 hour"],
    ["Needs", "a ladder, and a laptop with an HDMI port"],
    ["Cost", "750 EUR, single-day install"]
  ],
  contact: [
    ["Joel Dietz", null],
    ["@fractastical", "https://t.me/fractastical"],
    ["+1 (628) 333-1011", "tel:+16283331011"]
  ]
};

// The stills, in the order they should be read rather than alphabetically.
const STILLS = [
  ["rig", "The installation, at night", "4.3 m to the top of the disc, over a 2.5 m square base"],
  ["rig-lit", "The same rig under house lights", "proof it is see-through - the wall behind carries straight on through the picture"],
  ["word", "The word on the dark side", "letter cubes cut from moon footage, pinned to the shadowed terrain"],
  ["eye", "Eye seal iris reveal", "the disc opens to a clear hole onto the seal turning behind it"],
  ["blood", "Blood moon", "a luminance-preserving eclipse grade, fadeable over a two-hour set"],
  ["eclipse", "Earth's shadow", "the umbra crosses the disc, totality lit by refracted sunlight"],
  ["vajras", "Orbiting vajras", "dorje sprites on tilted lanes that pass behind the disc"],
  ["fisher", "The star fisher", "hooks a star, cups it, lets it go - and the freed stars make a heart"],
  ["harmonics", "Sonic sphere", "the real normal modes of a vibrating sphere, driven by the room"],
  ["fold", "Synergetics fold", "Fuller 100.41 - a triangle folding itself into a tetrahedron"],
  ["poem", "The poem, three words a side", "nine words to a screen, one line to each side of the triangle"],
  ["holofan-room", "The fan in a room", "180 cm of spinning LED, black reading as transparent"],
  ["holofan-close", "The fan up close", "persistence of vision, sampled the way the blade sweeps it"]
];

const run = (args) => execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
const kb = (f) => fs.statSync(f).size / 1024;
const size = (f) => (kb(f) > 1024 ? (kb(f) / 1024).toFixed(1) + "M" : kb(f).toFixed(0) + "K");

for (const d of [CLIPDIR, LOOPDIR, POSTER]) fs.mkdirSync(d, { recursive: true });

const missing = [];
const made = [];

for (const c of CLIPS) {
  if (!pick(c.id)) continue;
  const src = path.join(ROOT, c.src);
  const out = path.join(CLIPDIR, `${c.id}.mp4`);
  const poster = path.join(POSTER, `${c.id}.jpg`);
  if (!fs.existsSync(src)) { missing.push(`${c.id} - no ${c.src}`); continue; }
  if (fs.existsSync(out) && !FORCE) { console.log(`  ${c.id.padEnd(15)} kept  ${size(out)}`); made.push(c); continue; }
  run(["-ss", String(c.start), "-t", String(c.len), "-i", src, "-an",
    "-vf", `scale=${c.width}:-2:flags=lanczos`,
    "-c:v", "libx264", "-crf", String(c.crf), "-preset", "slow",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
  // A poster from the middle rather than the first frame, which on a fade-up
  // is black and makes the whole page look broken before anything is played.
  run(["-ss", String(c.len / 2), "-i", out, "-frames:v", "1", "-q:v", "4", poster]);
  console.log(`  ${c.id.padEnd(15)} ${size(out)}  poster ${size(poster)}`);
  made.push(c);
}

for (const l of LOOPS) {
  if (!pick(l.id)) continue;
  const src = path.join(ROOT, l.src);
  const out = path.join(LOOPDIR, `${l.id}.gif`);
  if (!fs.existsSync(src)) { missing.push(`loop ${l.id} - no ${l.src}`); continue; }
  if (fs.existsSync(out) && !FORCE) { console.log(`  loop ${l.id.padEnd(10)} kept  ${size(out)}`); continue; }
  // One palette for the whole clip, dithered coarsely: these are dark frames
  // with a lot of near-black, and fine dither there is pure file size.
  const chain = `fps=${l.fps},scale=${l.width}:-2:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
  run(["-ss", String(l.start), "-t", String(l.len), "-i", src, "-filter_complex", chain, "-loop", "0", out]);
  console.log(`  loop ${l.id.padEnd(10)} ${size(out)}`);
}

// One sheet with every still on it, which is what a magazine or a promoter asks
// for first and what saves them opening eleven files.
const sheetSrc = STILLS.map(([id]) => path.join(GALLERY, `${id}.jpg`)).filter((f) => fs.existsSync(f));
if (!wanted && sheetSrc.length >= 8) {
  const sheet = path.join(PRESS, "contact-sheet.jpg");
  run([...sheetSrc.flatMap((f) => ["-i", f]),
    "-filter_complex",
    sheetSrc.map((_, i) => `[${i}]scale=520:-2:flags=lanczos,pad=520:296:(ow-iw)/2:(oh-ih)/2:black[t${i}]`).join(";") +
    ";" + sheetSrc.map((_, i) => `[t${i}]`).join("") + `xstack=inputs=${sheetSrc.length}:layout=` +
    sheetSrc.map((_, i) => `${(i % 4) * 520}_${Math.floor(i / 4) * 296}`).join("|") + `:fill=black`,
    "-q:v", "4", sheet]);
  console.log(`\n  contact sheet  ${size(sheet)}  (${sheetSrc.length} stills)`);
}

// The page itself. Plain HTML with no build step, because it has to keep
// working from a file:// double-click as well as from Pages.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clipCard = (c) => {
  const f = path.join(CLIPDIR, `${c.id}.mp4`);
  if (!fs.existsSync(f)) return "";
  return `      <figure>
        <video controls loop muted playsinline preload="none"
               poster="posters/${c.id}.jpg" src="clips/${c.id}.mp4"></video>
        <figcaption><b>${esc(c.title)}</b><span>${esc(c.note)}</span>
          <a href="clips/${c.id}.mp4" download>download &middot; ${size(f)}</a></figcaption>
      </figure>`;
};
const stillCard = ([id, title, note]) => {
  const f = path.join(GALLERY, `${id}.jpg`);
  if (!fs.existsSync(f)) return "";
  return `      <figure>
        <a href="../gallery/${id}.jpg"><img loading="lazy" src="../gallery/${id}.jpg" alt="${esc(title)}"/></a>
        <figcaption><b>${esc(title)}</b><span>${esc(note)}</span></figcaption>
      </figure>`;
};

fs.writeFileSync(path.join(PRESS, "index.html"), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Hypermuse &middot; press kit</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:48px 32px 96px; background:#05070a; color:#cfe9ff;
         font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
  main { max-width:1200px; margin:0 auto; }
  h1 { font-size:30px; margin:0 0 6px; letter-spacing:0.01em; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:0.16em;
       color:rgba(207,233,255,0.5); margin:56px 0 18px; font-weight:600; }
  p.lede { color:rgba(207,233,255,0.72); max-width:64ch; margin:0 0 8px; }
  a { color:#7fd3ff; }
  .grid { display:grid; gap:22px; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); }
  figure { margin:0; background:#0a0e14; border:1px solid rgba(127,211,255,0.13); border-radius:10px; overflow:hidden; }
  video, img { display:block; width:100%; background:#000; }
  figcaption { padding:11px 13px 13px; font-size:12.5px; }
  figcaption b { display:block; }
  figcaption span { display:block; color:rgba(207,233,255,0.55); margin:2px 0 6px; }
  footer { margin-top:64px; color:rgba(207,233,255,0.42); font-size:12.5px; max-width:70ch; }
  code { background:rgba(127,211,255,0.09); padding:1px 5px; border-radius:4px; font-size:12px; }
  .book { display:grid; gap:26px; grid-template-columns:minmax(320px,1.15fr) minmax(240px,0.85fr);
          align-items:start; }
  @media (max-width:760px) { .book { grid-template-columns:1fr; } }
  .book table { border-collapse:collapse; width:100%; margin:14px 0 0; }
  .book th, .book td { text-align:left; padding:7px 0; border-bottom:1px solid rgba(127,211,255,0.1);
                       vertical-align:top; font-weight:400; }
  .book th { color:rgba(207,233,255,0.5); width:38%; font-size:12.5px; letter-spacing:0.03em; }
  .sheet { display:block; border:1px solid rgba(127,211,255,0.13); border-radius:10px; overflow:hidden; }
  .sheet img { display:block; width:100%; }
  .contact { margin:16px 0 0; padding:0; list-style:none; }
  .contact li { padding:3px 0; }
</style>
</head>
<body><main>
  <h1>HyperMuse &middot; press kit</h1>
  <p class="lede">An audio-reactive holographic fan on a 4.3 m tower, and the browser-based show
  that drives it: a moon carrying words, geometry and weather on its dark side, with a poem
  screen beside it. Everything here was rendered from the pages in this repository &mdash;
  nothing is concept art.</p>
  <p class="lede">Clips are viewing copies. Full-resolution masters are rebuilt from source with
  the commands at the foot of this page.</p>

  <h2 id="the-installation">The installation</h2>
  <div class="book">
    <div>
      <p class="lede">${esc(SPEC.about)}</p>
      <p class="lede">${esc(SPEC.debut)}</p>
      <table>
${SPEC.rows.map(([k, v]) => `        <tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("\n")}
      </table>
      <ul class="contact">
${SPEC.contact.map(([label, href]) =>
  `        <li>${href ? `<a href="${href}">${esc(label)}</a>` : `<b>${esc(label)}</b>`}</li>`).join("\n")}
      </ul>
    </div>
    <a class="sheet" href="hypermuse-one-pager.pdf">
      <img loading="lazy" src="one-pager.jpg" alt="The HyperMuse booking sheet: specifications, requirements and cost"/>
    </a>
  </div>
  <p class="lede" style="margin-top:14px">The sheet as sent:
  <a href="hypermuse-one-pager.pdf">hypermuse-one-pager.pdf</a>. The clip below is the rig
  itself, rendered to the same dimensions.</p>

  <h2>Motion</h2>
  <div class="grid">
${CLIPS.map(clipCard).filter(Boolean).join("\n")}
  </div>

  <h2>Stills</h2>
  <div class="grid">
${STILLS.map(stillCard).filter(Boolean).join("\n")}
  </div>

  <footer>
    <p>Everything on this page is generated. <code>npm run gallery</code> reshoots the stills,
    <code>npm run press</code> rebuilds the clips and this page, and the full-resolution renders
    come from <code>npm run demo:projectors</code>, <code>npm run export:reel</code>,
    <code>npm run export:art</code>, <code>npm run export:film</code> and
    <code>npm run export:holofan</code>.</p>
    <p>Source: <a href="https://github.com/fractastical/hypermuse">github.com/fractastical/hypermuse</a></p>
  </footer>
</main></body>
</html>
`);

const total = [CLIPDIR, LOOPDIR, POSTER, PRESS]
  .flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f)))
  .filter((f) => fs.statSync(f).isFile())
  .reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`\n  page  docs/press/index.html`);
console.log(`  ${(total / 1024 / 1024).toFixed(1)} MB in docs/press`);
if (missing.length) {
  console.log(`\n  not built, source missing:`);
  for (const m of missing) console.log(`    ${m}`);
}
