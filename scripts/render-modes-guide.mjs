// Builds artifacts/modes-guide.html and renders artifacts/hypermuse-modes-guide.pdf.
// Every feature section carries at least one generated image. Dark moon stills
// are gamma-lifted into artifacts/guide-thumbs/ first so they survive print.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ART = path.join(ROOT, "artifacts");
const THUMBS = path.join(ART, "guide-thumbs");
const ffmpeg = (await import("ffmpeg-static")).default;

// Moon-dark stills that need a gamma lift for print. src is relative to artifacts/.
const LIFT = [
  ["still-crt-bigtext.png", "g-crt-bigtext.jpg"],
  ["still-crt-window-peek-2.png", "g-peek.jpg"],
  ["still-vajra-final-a.png", "g-vajra-orbit.jpg"],
  ["still-vajra-tight-1.png", "g-vajra-tight.jpg"],
  ["still-fold-window.png", "g-fold.jpg"],
  ["still-foldsonic-a.png", "g-foldsonic.jpg"],
  ["still-foldhelix-s3.png", "g-foldhelix.jpg"],
  ["still-foldjitter-1.png", "g-foldjitter.jpg"],
  ["still-foldgeo-1.png", "g-foldgeo.jpg"],
  ["still-foldivm-1.png", "g-foldivm.jpg"],
  ["still-sonic-window.png", "g-sonic-window.jpg"],
  ["still-screen-window.png", "g-screen-window.jpg"],
  ["still-live-word.png", "g-live-word.jpg"],
  ["still-stream-viewer.png", "g-stream-viewer.jpg"],
  ["guide-winscale-1x.png", "g-winscale-1x.jpg"],
  ["guide-winscale-18x.png", "g-winscale-18x.jpg"],
  ["still-incant-bigtext.png", "g-incant-bigtext.jpg"],
];

for (const [src, dst] of LIFT) {
  const from = path.join(ART, src);
  if (!existsSync(from)) { console.warn("missing:", src); continue; }
  execFileSync(ffmpeg, ["-y", "-i", from, "-vf", "eq=gamma=1.45:brightness=0.03:saturation=1.12", "-q:v", "3", path.join(THUMBS, dst), "-loglevel", "error"]);
}
console.log("thumbs lifted");

const img = (rel, cap) => `<figure><img src="${rel}"/><figcaption>${cap}</figcaption></figure>`;
const t = (rel) => `guide-thumbs/${rel}`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 14mm 13mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #14181f; margin: 0; font-size: 10.5pt; line-height: 1.5; }
  h1 { font-size: 24pt; margin: 0 0 2mm; letter-spacing: 0.04em; }
  h2 { font-size: 14pt; margin: 8mm 0 2mm; border-bottom: 2px solid #2b3446; padding-bottom: 1mm; page-break-after: avoid; }
  h3 { font-size: 11pt; margin: 4mm 0 1mm; page-break-after: avoid; }
  p { margin: 1.5mm 0; }
  code { background: #eef1f6; border-radius: 3px; padding: 0 3px; font-size: 9pt; }
  .lead { color: #47526a; font-size: 11pt; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin: 3mm 0; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3mm; margin: 3mm 0; }
  figure { margin: 0; page-break-inside: avoid; }
  figure img { width: 100%; border-radius: 4px; display: block; background: #000; }
  figcaption { font-size: 8pt; color: #5b6579; margin-top: 1mm; }
  .hero img { width: 100%; border-radius: 6px; }
  .section { page-break-inside: avoid; }
  .pagebreak { page-break-before: always; }
  ul { margin: 1.5mm 0 1.5mm 5mm; padding: 0; }
  li { margin: 0.8mm 0; }
  .meta { font-size: 8.5pt; color: #5b6579; }
  table { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 2mm 0; }
  th, td { border: 1px solid #d5dae4; padding: 1.2mm 2mm; text-align: left; }
  th { background: #eef1f6; }
</style></head><body>

<h1>HYPERMUSE — Modes &amp; Control Guide</h1>
<p class="lead">Every renderer, mode and controller in the rig: what it does, how to drive it live, which screens it suits.
Generated ${new Date().toISOString().slice(0, 10)} · regenerate with <code>node scripts/render-modes-guide.mjs</code></p>
<div class="hero">${img(t("pdf-mosaic.jpg"), "hypermoon.html — the HYPERSTITION word mosaic anchored to the rotating moon")}</div>

<h2>1 · Sonicsphere — the harmonic spectrum analyzer</h2>
<p><code>sonicsphere.html</code> is at heart a musical spectrum analyzer. The audio feed runs through an FFT into
<strong>48 logarithmically spaced bands</strong> from 20 Hz to 20 kHz — log spacing means every band spans the same
musical interval, so harmonically related notes light up related bands. The bands split into low / mid / high
thirds, one sphere lane each; whenever a band crosses its (per-band, adaptive) threshold it fires geometry at
that band's point on the sphere, with the band's energy mapped to hue. Chords and harmonies read as simultaneous
structures blooming across the three lanes. The effect profiles below restyle that same band-to-geometry mapping;
switch them live from <code>controller.html</code> (FX mode buttons) or boot with <code>?mode=…</code>.
Good on: main projector, LED walls, holographic fans.</p>
<div class="grid">
${img("guide-sonic-classic.png", "classic — the spectrum analyzer itself: threshold-crossing bands spawn hue-mapped geometry on the low/mid/high lanes")}
${img("guide-sonic-hexca.png", "cellular-automata textures (hierarchical life shown) — hex CA rules B/S, palettes, speed & audio-sync all controller-adjustable")}
${img("guide-sonic-grayscott.png", "gray-scott reaction-diffusion profile (\u201cturing\u201d)")}
${img("guide-sonic-words.png", "word-cloud mode — phrase lists swappable per event")}
</div>
<p class="meta">Pure analyzer (no video backdrops, no sets): <code>sonicsphere.html?demo=1&hideoverlay=1&mode=classic</code>.
Hex CA boot params: <code>?mode=hex&hexrule=B2/S34&hexpalette=aurora&hexspeed=2&hexsync=1&hexaperiodic=0.3</code>; rules cycle hexlife → bloom → maze → pulse → coral.</p>

<h2>2 · Multi-projector rig (3-projector moon object)</h2>
<p>The rig panel in the controller models a physical 3-projector setup around a curved object: per-projector azimuth,
distance, height, FOV, plus live pixel nudge / zoom / roll for alignment. Feeds export as separate videos or one triple-wide strip.</p>
<div class="grid">
${img("controller-rig-panel.png", "controller rig sub-panel — geometry diagrams and per-projector alignment")}
${img("moon-proj-feed-A-frame.png", "pre-warped feed for projector A (of A/B/C, also 5760×1080 triple-wide)")}
</div>

<h2 class="pagebreak">3 · Hypermoon — the dark side of the moon</h2>
<p><code>hypermoon.html</code> is the flagship output: a rotating 3-D moon whose dark hemisphere carries content.
The word mosaic is anchored to fixed lunar coordinates — it rotates with the moon like a geographic feature,
vanishing over the limb and returning. Open from the controller (<em>open hypermoon output</em> launches kiosk mode) —
all sliders broadcast live over a BroadcastChannel.</p>
<div class="grid">
${img(t("pdf-text.jpg"), "word mosaic settled on the tracked dark patch")}
${img(t("g-live-word.jpg"), "live word swap from the controller — type and the moon updates instantly")}
</div>

<h3>Orbiting vajras</h3>
<div class="grid">
${img(t("g-vajra-orbit.jpg"), "spinning dorje clips orbit the moon with depth scaling and occlusion")}
${img(t("g-vajra-tight.jpg"), "orbit radius is a live slider — tight orbit shown")}
</div>

<h2>4 · The window system</h2>
<p>Behind the settled letters sits a recessed <em>window</em> — a shadow-gated cave in the dark hemisphere.
The controller swaps its content live, no reload: CRT terminal, vajra cave, incantation, image slideshows,
any video, even another browser window via screen capture. Readable content uses double-size auto-fit text.</p>
<div class="grid3">
${img(t("pdf-crt-window.jpg"), "content=crt — live CRT terminal, timing line (\u201cWEDNESDAY 22:00\u201d) editable in the controller")}
${img(t("g-crt-bigtext.jpg"), "double-size CRT text for readability through the window")}
${img(t("pdf-vajra-cave.jpg"), "content=vajra — vajras spinning inside the moon")}
${img(t("pdf-incant.jpg"), "content=incant — Vajrasattva mantra plates (wordless mode)")}
${img(t("pdf-sutra.jpg"), "image slideshow — esoteric plates cycling on a timer")}
${img(t("g-screen-window.jpg"), "content=screen — another window mirrored into the moon via screen capture")}
</div>

<h3>Peek cycle &amp; apparitions</h3>
<div class="grid">
${img(t("g-peek.jpg"), "peek cycle — letters periodically dissolve to reveal the window content")}
${img(t("pdf-bleed.jpg"), "apparition scheduler — randomized fade-in / hold / fade-out of a video bleeding through")}
</div>

<h2 class="pagebreak">5 · Bucky repertoire — Fuller folds in the window</h2>
<p>Six Synergetics presets render as wordless window content (the mosaic hides itself for these).
All are controller presets and work in the hour program.</p>
<div class="grid3">
${img(t("g-fold.jpg"), "fold — triangle folds into a tetrahedron")}
${img(t("g-foldsonic.jpg"), "foldsonic — the folding faces carry the baked sonicsphere loop")}
${img(t("g-foldhelix.jpg"), "foldhelix — two triangular helixes associate into a tetrahedron (Synergetics 108)")}
${img(t("g-foldjitter.jpg"), "foldjitter — jitterbug: vector equilibrium contracting to octahedron")}
${img(t("g-foldgeo.jpg"), "foldgeo — icosahedron blooming into a geodesic sphere")}
${img(t("g-foldivm.jpg"), "foldivm — octet truss / isotropic vector matrix growing")}
</div>
<div class="grid">
${img("assoc-b2-events.png", "synergetics-fold.html?mode=associate — standalone page for the 108.01-03 passage")}
${img(t("g-sonic-window.jpg"), "sonicsphere loop as window content behind the word")}
</div>

<h2>6 · Window size &amp; any video on the dark side</h2>
<p>The <em>window size ×</em> slider (0.4–2.5) scales the dark-side window live. The video manifest
(<code>npm run manifest:videos</code>, ~700+ clips) feeds the controller's searchable <em>any video</em> picker with a random button —
any indexed clip plays inside the window immediately.</p>
<div class="grid">
${img(t("g-winscale-1x.jpg"), "window size 1.0 — footprint matches the tracked dark patch")}
${img(t("g-winscale-18x.jpg"), "window size 1.8 — same content, enlarged bleed-through")}
</div>

<h2 class="pagebreak">7 · Controller — one panel drives everything</h2>
<p><code>controller.html</code> talks to every output over BroadcastChannels. The hypermoon panel: moon source, live word,
window preset + content, any-video picker, CRT timing, program selector, stream toggle, and sliders for speed / brightness /
bleed / apparitions / vajras / earthshine / nudge / word size / window size. It self-redirects from <code>file://</code>
to the local server so opened outputs always resolve.</p>
${img("guide-controller-hypermoon.png", "hypermoon panel with program editor — each act: content, cycles, dark rotations, reveal rotations")}

<h3>Hour program (rotation sequencer)</h3>
<p>Acts advance by moon rotation: e.g. two dark rotations word-only, then one reveal rotation of wordless content, × cycles.
The built-in <em>hour</em> program walks CRT → incant → vajra → the six folds → video, ≈61 min at current speed. The editor
composes, reorders and times acts, then applies live.</p>

<h3>Audio deck</h3>
${img("guide-controller-audiodeck.png", "looped bed + three interjection slots with periodicity, jitter and bed ducking — fed by the audio manifest")}

<h2>8 · Live streaming to other devices (LAN)</h2>
<p>The video travels peer-to-peer over WebRTC; a small signaling server just brokers the handshake. To take the
stream on another device (phone, tablet, laptop — anything on the same network):</p>
<ul>
<li><strong>On the host:</strong> <code>npm start</code> (static server on :8080, binds all interfaces) and
<code>npm run stream:server</code> (signaling on :8081 — it prints the exact viewer URL on startup).</li>
<li><strong>Start a broadcast:</strong> either tick <em>stream to LAN</em> in the controller's hypermoon panel
(streams the running moon live, no reload), open <code>hypermoon.html?stream=1</code> directly
(<code>&streamfps=</code> sets the frame rate), or open <code>stream-broadcast.html</code> and pick any window /
tab / screen — sonicsphere, the projection rig, anything.</li>
<li><strong>On the viewing device:</strong> open <code>http://&lt;host-ip&gt;:8080/stream-view.html</code>
(the host's LAN IP, e.g. <code>http://192.168.1.23:8080/stream-view.html</code>). It autoplays muted with zero
clicks; a tap goes fullscreen. Viewers can join or leave any time, can wait before the broadcast starts, and
auto-reconnect if it restarts. One broadcaster at a time — a new one takes over.</li>
</ul>
${img(t("g-stream-viewer.jpg"), "stream-view.html on a second device, live WebRTC feed of the running hypermoon")}

<h2>9 · Real CRT monitors (Ikegami / composite)</h2>
<p><code>crt-terminal.html</code> is a standalone overscan-safe terminal for real CRTs via an HDMI→AV converter into the
Ikegami VIDEO A input. Params: <code>when</code>, <code>text</code>, <code>color</code>, <code>cps</code>, <code>fx=0</code> (clean phosphor), <code>safe</code> padding.
<code>npm run export:crt</code> bakes a 45 s loop for media players.</p>
<div class="grid">
${img(t("pdf-crt-standalone.jpg"), "crt-terminal.html — phosphor green, overscan-safe")}
${img("crt-fx.png", "fx mode — scanlines and roll for extra tube flavor")}
</div>

<h2 class="pagebreak">10 · Baked exports &amp; WOWCube</h2>
<p>Playwright + ffmpeg export any page to video (<code>npm run export:*</code>): hypermoon programs, projector feeds,
sonicsphere sets, the CRT loop. WOWCube masters are square high-contrast 960×960 with 480×480 quadrant tiles per face.</p>
<div class="grid3">
${img(t("pdf-export1.jpg"), "baked hypermoon esoterica loop")}
${img(t("pdf-export2.jpg"), "projector feed export")}
${img(t("pdf-export3.jpg"), "sonicsphere set export")}
</div>
<div class="grid">
${img("wowcube-contact-sheet.png", "WOWCube faces — app screenshots, astronauts, invite")}
${img("invite-hyperstition.png", "friends &amp; family opening — Monday 11:11 pm, password HYPERMOON")}
</div>

<h2>11 · Visual asset library</h2>
<p>Dark-background sources that feed the mosaic tiles, window slideshows and bleeds. Space loops get priority —
they read instantly on the moon and on CRTs.</p>
<h3>Space loops</h3>
<div class="grid3">
${img(t("space-astrofloat.jpg"), "astronaut float")}
${img(t("space-astrorotate.jpg"), "astronaut rotate")}
${img(t("space-moonwalk.jpg"), "moonwalk")}
${img(t("space-crescent.jpg"), "crescent pass")}
${img(t("space-approach.jpg"), "lunar approach")}
${img(t("space-odyssey.jpg"), "odyssey corridor")}
</div>
<h3>Moon sources &amp; vajra clips</h3>
<div class="grid3">
${img(t("moon-6s.jpg"), "3-D moon 6 s loop (default)")}
${img(t("moon-30s.jpg"), "3-D moon 30 s loop")}
${img(t("moon-neon.jpg"), "neon moon variant")}
${img(t("vajra-1.jpg"), "vajra clip 1")}
${img(t("vajra-4.jpg"), "vajra clip 4")}
${img(t("vajra-7.jpg"), "vajra clip 7")}
</div>
<h3>Hyperstition backdrops</h3>
<div class="grid3">
${img(t("hyp-hyperstition.jpg"), "hyperstition title")}
${img(t("hyp-warp.jpg"), "warp")}
${img(t("hyp-watcher.jpg"), "watcher")}
${img(t("hyp-sacred.jpg"), "sacred geometry")}
${img(t("hyp-deepstate.jpg"), "deep state")}
${img(t("hyp-madsci.jpg"), "mad science")}
</div>
<p class="meta">Esoteric plates (Vajrayana mantra scans) stay indexed in <code>assets/estoteric/web/</code> for the incant and slideshow
modes — displayed on the moon rather than reproduced here.</p>

</body></html>`;

writeFileSync(path.join(ART, "modes-guide.html"), html);
console.log("wrote artifacts/modes-guide.html");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + path.join(ART, "modes-guide.html"), { waitUntil: "networkidle" });
await page.pdf({ path: path.join(ART, "hypermuse-modes-guide.pdf"), format: "A4", printBackground: true });
await browser.close();
console.log("wrote artifacts/hypermuse-modes-guide.pdf");
