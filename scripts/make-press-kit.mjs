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
// Absolute, because a share card's image cannot be a relative path: the crawler
// that renders the preview in WhatsApp or Telegram is not on this origin.
const SITE = "https://fractastical.github.io/hypermuse";
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
    id: "poem-full", title: "The poem, the whole of it",
    src: "artifacts/demos/poem-triangle-full-1920x1080.mp4",
    start: 0, len: 0, width: 1280, crf: 26,
    note: "trinitypoem.txt end to end, 82 screens, one pass of the turning triangle"
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
  // The offer rather than the product name, because the person reading it is
  // deciding whether their mark goes on the thing, not learning a brand.
  slogan: "Be seen on the dark side of the moon",
  rows: [
    ["Height", "4.3 m to the top of the disc, adjustable"],
    ["Footprint", "2.5 m square ground frame"],
    ["Install", "2 people, 2.5 hours"],
    ["Breakdown", "2 people, 1 hour"],
    ["Needs", "a ladder, and a laptop with an HDMI port"],
    ["Cost", "negotiable - 750 EUR is the usual single-day install"]
  ],
  // The whole offer on one line, for the top of both pages, where nobody has
  // committed to reading a table yet.
  line: "4.3 m to the top of the disc, adjustable \u00b7 2.5 m square base \u00b7 two people and " +
    "2.5 hours to build \u00b7 cost negotiable, 750 EUR is the usual single-day install",
  // wa.me rather than tel:, since the number is reached on WhatsApp and a tel:
  // link on a desktop browser opens nothing anybody has.
  contact: [
    ["Joel Dietz", null, null],
    ["@fractastical", "https://t.me/fractastical", "Telegram"],
    ["+1 (628) 333-1011", "https://wa.me/16283331011", "WhatsApp"]
  ]
};

// What a DJ, or a promoter's production manager, asks - which is not what a
// magazine asks. A magazine wants to know what it looks like; these people want
// to know whose name is on it, what it needs from the building, and who has to
// stand next to it all night.
//
// Every claim below is a feature in this repository rather than a promise: the
// mark goes on with ?logo=, the microphone with ?mic=1, the unattended hour with
// ?program=hour, and the screen sizes are the export profiles that already
// exist. Anything we cannot answer from the code is left off the page rather
// than guessed at, because a rider with a wrong number in it is worse than a
// rider with a gap.
const DJ = {
  // Image paths are relative to docs/, so the press kit one directory down
  // prefixes them with ../ and both pages read from one set of files.
  sells: [
    ["Your mark on it, not ours", "gallery/word.jpg",
      "A guest logo sits on the moon's shadowed side the same way the word does - either as clean artwork or rebuilt out of moon footage so it looks like terrain. It is shot and checked at full size beforehand, so nobody discovers on stage that a wordmark is unreadable at forty feet."],
    ["It listens to the room, not to our laptop", "gallery/harmonics.jpg",
      "The machine driving the fan opens its own microphone, so the geometry answers whatever the PA is actually doing. Bass swells the sphere, beats flare the orbiting pieces, loud passages shake the lettering. Nothing has to be routed through us and nothing needs timecode."],
    ["It will play your visuals", "gallery/holofan-room.jpg",
      "Any loop supplied as mp4 goes into the rotation beside the generated show, so the night can be your content, ours, or a cut of the two. The equalizer can be set for the kind of music before doors."],
    ["It runs the set without a VJ", "gallery/eclipse.jpg",
      "The programme is an hour of scheduled acts that loops for as long as the night does - a different effect each revolution, words, eclipses, orbits, geometry. The speed control stretches it, so half speed is a two-hour arc. It takes direction live if you want it, and needs nobody if you do not."],
    ["The fan is not the only output", "gallery/poem.jpg",
      "The same show drives projection - 402 x 226 cm is its native shape, two surfaces if you have them - and LED walls at 1920 x 1080 for a bar screen or 1872 x 1296 for a DJ screen. The poem screen above is what the second projector carries."]
  ],
  // Split so the production manager can read their own column and stop.
  bring: [
    "The fan itself, 180 cm of spinning LED",
    "A box-truss tower and its 2.5 m square ground frame",
    "The show, configured for your night, with your mark already tested on it"
  ],
  venue: [
    "2.5 m square of floor, and the height to use it",
    "A ladder",
    "A laptop with an HDMI port, if you would rather run it yourself",
    "Two people and 2.5 hours to build it, one hour to strike it"
  ]
};

// Styling shared by the landing page and the press kit, so the two cannot drift
// into looking like different projects.
const SHARED_CSS = `  :root { color-scheme: dark; }
  body { margin:0; padding:48px 32px 96px; background:#05070a; color:#cfe9ff;
         font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
  h1 { font-size:34px; margin:0 0 10px; letter-spacing:0.01em; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:0.16em;
       color:rgba(207,233,255,0.5); margin:56px 0 18px; font-weight:600; }
  p.lede { color:rgba(207,233,255,0.72); max-width:64ch; margin:0 0 8px; }
  a { color:#7fd3ff; }
  .cta { display:flex; flex-wrap:wrap; gap:10px; margin:22px 0 10px; }
  .cta a { display:inline-block; padding:11px 20px; border-radius:999px; text-decoration:none;
           font-size:14px; font-weight:600; }
  .cta .go { background:#7fd3ff; color:#04121c; }
  .cta .alt { border:1px solid rgba(127,211,255,0.32); color:#7fd3ff; font-weight:500; }
  .terms { color:rgba(207,233,255,0.5); font-size:13px; max-width:70ch; margin:0; }
  p.tag { font-size:19px; color:rgba(207,233,255,0.9); margin:0 0 14px; letter-spacing:-0.01em; }
  .sells { display:grid; gap:20px; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); margin:0 0 40px; }
  .sells article { background:#0a0e14; border:1px solid rgba(127,211,255,0.13); border-radius:12px;
                   overflow:hidden; display:flex; flex-direction:column; }
  /* 4:3 against 16:9 sources, so cover crops the sides and enlarges the subject.
     These renders are a small bright disc in a large black frame, and at card
     width the uncropped version reads as an empty rectangle. */
  .sells img { display:block; width:100%; aspect-ratio:4/3; object-fit:cover; background:#000; }
  .sells .say { padding:15px 17px 18px; }
  .sells b { display:block; margin:0 0 6px; }
  .sells p { margin:0; color:rgba(207,233,255,0.62); font-size:13.5px; }
  .rider { display:grid; gap:26px; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); }
  .rider h3 { font-size:12.5px; text-transform:uppercase; letter-spacing:0.13em; font-weight:600;
              color:rgba(207,233,255,0.5); margin:0 0 10px; }
  .rider ul { margin:0; padding:0; list-style:none; }
  .rider li { padding:6px 0; border-bottom:1px solid rgba(127,211,255,0.1); font-size:13.5px;
              color:rgba(207,233,255,0.72); }`;

const rider = () => `  <div class="rider">
    <div>
      <h3>What arrives</h3>
      <ul>${DJ.bring.map((x) => `\n        <li>${esc(x)}</li>`).join("")}
      </ul>
    </div>
    <div>
      <h3>What the room provides</h3>
      <ul>${DJ.venue.map((x) => `\n        <li>${esc(x)}</li>`).join("")}
      </ul>
    </div>
  </div>`;

const sellCards = (prefix) => DJ.sells.map(([k, img, v]) =>
  `    <article><img loading="lazy" src="${prefix}${img}" alt="${esc(k)}"/>` +
  `<div class="say"><b>${esc(k)}</b><p>${esc(v)}</p></div></article>`).join("\n");

// The call to action, above the fold on both pages. Someone scanning this on a
// phone between panels has about one screenful of patience: what it is, what it
// costs, and a button that opens a conversation rather than a contact form.
const bookNow = (prefix) => `  <div class="cta">
    <a class="go" href="https://wa.me/16283331011">Book it &middot; WhatsApp</a>
    <a class="alt" href="https://t.me/fractastical">Telegram</a>
    <a class="alt" href="${prefix}hypermuse-one-pager.pdf">Booking sheet, PDF</a>
  </div>
  <p class="terms">${esc(SPEC.line)}</p>`;

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
  const cut = c.len > 0 ? ["-ss", String(c.start), "-t", String(c.len)] : (c.start ? ["-ss", String(c.start)] : []);
  run([...cut, "-i", src, "-an",
    "-vf", `scale=${c.width}:-2:flags=lanczos`,
    "-c:v", "libx264", "-crf", String(c.crf), "-preset", "slow",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
  // A poster from the middle rather than the first frame, which on a fade-up
  // is black and makes the whole page look broken before anything is played.
  const mid = c.len > 0 ? c.len / 2 : 40;
  run(["-ss", String(mid), "-i", out, "-frames:v", "1", "-q:v", "4", poster]);
  console.log(`  ${c.id.padEnd(15)} ${size(out)}  poster ${size(poster)}`);
  made.push(c);
}

// The landing page's hero, cut from the close fan render. Two differences from
// the press-kit copy of the same footage: the caption bar is cropped off the
// bottom, being useful in a press kit and clutter beneath a title, and the crop
// lands it on 2.06:1, which is a better shape for a banner than 16:9 and means
// the browser has less to throw away when it covers a wide box.
const HERO = { id: "hero", src: "artifacts/demos/hypermoon-holofan-180cm.mp4", start: 8, len: 14, width: 1280 };
if (pick(HERO.id)) {
  const src = path.join(ROOT, HERO.src);
  const out = path.join(CLIPDIR, "hero.mp4");
  const poster = path.join(POSTER, "hero.jpg");
  if (!fs.existsSync(src)) missing.push(`hero - no ${HERO.src}`);
  else if (fs.existsSync(out) && !FORCE) console.log(`  hero            kept  ${size(out)}`);
  else {
    run(["-ss", String(HERO.start), "-t", String(HERO.len), "-i", src, "-an",
      "-vf", `crop=iw:trunc(ih*0.864/2)*2:0:0,scale=${HERO.width}:-2:flags=lanczos`,
      "-c:v", "libx264", "-crf", "30", "-preset", "slow",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
    run(["-ss", String(HERO.len / 2), "-i", out, "-frames:v", "1", "-q:v", "4", poster]);
    console.log(`  hero            ${size(out)}  poster ${size(poster)}`);
  }
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
${SHARED_CSS}
  main { max-width:1200px; margin:0 auto; }
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
  .contact em { font-style:normal; color:rgba(207,233,255,0.4); font-size:12px; margin-left:6px; }
</style>
</head>
<body><main>
  <h1>HyperMuse</h1>
  <p class="tag">${esc(SPEC.slogan)}</p>
  <p class="lede">An audio-reactive holographic fan on a 4.3 m tower, and the browser-based show
  that drives it: a moon carrying words, geometry and weather on its dark side, with a poem
  screen beside it. ${esc(SPEC.debut)}</p>
${bookNow("")}

  <h2 id="for-djs">If you are the one playing</h2>
  <div class="sells">
${sellCards("../")}
  </div>
${rider()}

  <h2 id="the-installation">The installation</h2>
  <div class="book">
    <div>
      <p class="lede">${esc(SPEC.about)}</p>
      <table>
${SPEC.rows.map(([k, v]) => `        <tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("\n")}
      </table>
      <ul class="contact">
${SPEC.contact.map(([label, href, via]) =>
  `        <li>${href ? `<a href="${href}">${esc(label)}</a>` : `<b>${esc(label)}</b>`}` +
  `${via ? ` <em>${esc(via)}</em>` : ""}</li>`).join("\n")}
      </ul>
    </div>
    <a class="sheet" href="hypermuse-one-pager.pdf">
      <img loading="lazy" src="one-pager.jpg" alt="The HyperMuse booking sheet: specifications, requirements and cost"/>
    </a>
  </div>
  <p class="lede" style="margin-top:14px">The sheet as sent:
  <a href="hypermuse-one-pager.pdf">hypermuse-one-pager.pdf</a>. It quotes one height and one
  price; the table above is the current answer where the two differ.</p>

  <h2>Motion</h2>
  <p class="lede" style="margin-bottom:18px">Everything below was rendered from the pages in this
  repository &mdash; nothing is concept art. Clips are viewing copies; full-resolution masters are
  rebuilt from source with the commands at the foot of this page.</p>
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

// The landing page, which is the URL that gets pasted into a WhatsApp thread at
// a conference, so it opens with the offer rather than with a list of links.
// Generated from the same SPEC and DJ as the press kit for the same reason the
// booking sheet is: two hand-kept copies of a price disagree eventually.
fs.writeFileSync(path.join(ROOT, "docs", "index.html"), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HyperMuse &middot; a holographic fan you can book</title>
<meta name="description" content="${esc(SPEC.about)}"/>
<meta property="og:title" content="HyperMuse &middot; ${esc(SPEC.slogan)}"/>
<meta property="og:description" content="A 180 cm holographic fan on a 4.3 m tower. Your mark on it, reacting to your set, running the night on its own."/>
<meta property="og:image" content="${SITE}/docs/press/posters/hero.jpg"/>
<meta property="og:url" content="${SITE}/docs/"/>
<meta name="twitter:card" content="summary_large_image"/>
<style>
${SHARED_CSS}
  body { padding:0; }
  main { max-width:1020px; margin:0 auto; padding:0 32px 96px; }
  /* The hero is the whole first screen and the video is the page's background
     for the height of it, so the first thing anyone sees is the thing moving
     rather than a paragraph about it. object-fit:cover means the clip fills
     whatever shape the window is, portrait phone included. */
  .hero { position:relative; height:min(88vh,780px); min-height:440px; overflow:hidden; background:#000; }
  .hero video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  /* Dark at the top so the eye starts on the title, dark at the bottom so the
     text and buttons stay legible over whatever the clip happens to be doing. */
  .hero .veil { position:absolute; inset:0; background:
    linear-gradient(180deg,rgba(5,7,10,0.72) 0%,rgba(5,7,10,0.12) 30%,rgba(5,7,10,0.55) 66%,#05070a 100%); }
  .hero .inner { position:absolute; left:0; right:0; bottom:0; max-width:1020px; margin:0 auto;
                 padding:0 32px 42px; }
  /* Capped in ch as well as px so the slogan breaks into two or three stacked
     lines rather than one thin ribbon across a wide window. */
  .hero h1 { font-size:clamp(33px,5.6vw,62px); line-height:1.06; letter-spacing:-0.025em;
             margin:0 0 16px; max-width:19ch; text-wrap:balance; }
  .hero p.lede { font-size:clamp(15px,2.1vw,18px); max-width:52ch; color:rgba(207,233,255,0.82); }
  .hero .cta { margin:24px 0 12px; }
  .badge { position:absolute; top:26px; left:0; right:0; max-width:1020px; margin:0 auto;
           padding:0 32px; font-size:12px; letter-spacing:0.16em; text-transform:uppercase;
           color:rgba(207,233,255,0.62); }
  .badge b { color:rgba(207,233,255,0.9); letter-spacing:0.2em; }
  ul.more { list-style:none; padding:0; margin:14px 0 0; }
  ul.more li { border-top:1px solid rgba(127,211,255,0.13); }
  ul.more li:last-child { border-bottom:1px solid rgba(127,211,255,0.13); }
  a.row { display:block; padding:15px 2px; text-decoration:none; color:#7fd3ff; }
  a.row span { display:block; color:rgba(207,233,255,0.55); font-size:13.5px; }
  a.row:hover { background:rgba(127,211,255,0.05); }
  table.spec { border-collapse:collapse; width:100%; max-width:620px; margin:0; }
  table.spec th, table.spec td { text-align:left; padding:7px 0; font-weight:400;
                                 border-bottom:1px solid rgba(127,211,255,0.1); vertical-align:top; }
  table.spec th { color:rgba(207,233,255,0.5); width:38%; font-size:12.5px; letter-spacing:0.03em; }
</style>
</head>
<body>
  <section class="hero">
    <video autoplay muted loop playsinline preload="auto" poster="press/posters/hero.jpg">
      <source src="press/clips/hero.mp4" type="video/mp4"/>
    </video>
    <div class="veil"></div>
    <div class="badge"><b>HyperMuse</b> &nbsp;&middot;&nbsp;
      ${esc(SPEC.debut.replace(/^Debuted at /, "").replace(/\.$/, ""))}</div>
    <div class="inner">
      <h1>${esc(SPEC.slogan)}</h1>
      <p class="lede">A 180 cm holographic fan on a 4.3 m tower. Your mark goes on it, it reacts
      to whatever the PA is doing, and it runs the night without anyone standing over it.</p>
${bookNow("press/")}
    </div>
  </section>
<main>

  <h2>If you are the one playing</h2>
  <div class="sells">
${sellCards("")}
  </div>
${rider()}

  <h2>The numbers</h2>
  <table class="spec">
${SPEC.rows.map(([k, v]) => `    <tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("\n")}
  </table>

  <h2>See more of it</h2>
  <ul class="more">
    <li><a class="row" href="press/">Press kit
      <span>Ten clips and thirteen stills, all downloadable &mdash; including the rig at night,
      the fan up close, and an hour of the show cut to a reel</span></a></li>
    <li><a class="row" href="hyperstition/">Hyperstition &middot; moon halo
      <span>Two full-length renders, playing in the page</span></a></li>
    <li><a class="row" href="../">How it is built
      <span>The README: every mode, every parameter, and how to run it yourself</span></a></li>
    <li><a class="row" href="https://github.com/fractastical/hypermuse">Source on GitHub
      <span>github.com/fractastical/hypermuse</span></a></li>
  </ul>

  <h2>Book it</h2>
${bookNow("press/")}
  <p class="terms" style="margin-top:12px">Joel Dietz &middot;
  <a href="https://t.me/fractastical">@fractastical</a> on Telegram &middot;
  <a href="https://wa.me/16283331011">+1 (628) 333-1011</a> on WhatsApp</p>
</main></body>
</html>
`);

const total = [CLIPDIR, LOOPDIR, POSTER, PRESS]
  .flatMap((d) => fs.readdirSync(d).map((f) => path.join(d, f)))
  .filter((f) => fs.statSync(f).isFile())
  .reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`\n  page  docs/index.html`);
console.log(`  page  docs/press/index.html`);
console.log(`  ${(total / 1024 / 1024).toFixed(1)} MB in docs/press`);
if (missing.length) {
  console.log(`\n  not built, source missing:`);
  for (const m of missing) console.log(`    ${m}`);
}
