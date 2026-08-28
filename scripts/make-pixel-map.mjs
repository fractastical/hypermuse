// Builds the pixel map the PixLite bridge samples the moon through.
//
// A map says, for every LED on the rig, which point of the rendered frame it
// takes its colour from — and which controller output and universe it lives
// on. Everything downstream is generic: change the map and the same bridge
// drives a halo, a pixel disc, or a matrix without touching any other code.
//
// Points live in one of two spaces, declared per output:
//
//   "disc"   in disc radii from the centre of the moon — 1.0 is the limb. The
//            page resolves these against the disc it has actually measured, so
//            a halo stays on the edge through any moonscale, window size or
//            centring nudge. Anything ringing or filling the moon wants this.
//   "frame"  normalised to the rendered frame, 0,0 top-left. For fixtures that
//            relate to the screen rather than to the moon — a matrix behind
//            the booth, uprights either side.
//
// Neither space carries a resolution, so a map outlives the display it was
// made on.
//
//   node scripts/make-pixel-map.mjs halo --leds 240 --output 1
//   node scripts/make-pixel-map.mjs disc --rings 12 --output 1 --name moon-disc
//   node scripts/make-pixel-map.mjs grid --w 32 --h 32 --outputs 4
//   node scripts/make-pixel-map.mjs strips --count 8 --leds 144
//   node scripts/make-pixel-map.mjs sweep --runs 4 --leds 120 --name car-sides
//
// Writes maps/<name>.json. Feed one to the bridge with MAP=maps/<name>.json.
import fs from "node:fs";
import path from "node:path";

const PIX_PER_UNIVERSE = 170;   // 510 of a universe's 512 channels, RGB
const MAX_PER_OUTPUT = 1020;    // E16-S Mk3, expanded mode off
const MAX_OUTPUTS = 16;

const argv = process.argv.slice(2);
const shape = (argv[0] || "").toLowerCase();
const arg = (k, d) => {
  const i = argv.indexOf("--" + k);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const num = (k, d) => Number(arg(k, d));

const NAME = arg("name", shape);

function halo() {
  // One ring of LEDs around the disc, ambilight style. The sample radius sits
  // a little inside the limb by default: a fixture ringing the moon should
  // carry the colour spilling off its edge, and sampling on or past the limb
  // catches the falloff into space and reads dead.
  const n = Math.round(num("leds", 240));
  const r = num("radius", 0.92);                    // in disc radii
  const start = num("start", -90) * Math.PI / 180;  // 0th LED at 12 o'clock
  const dir = arg("dir", "cw") === "ccw" ? -1 : 1;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = start + dir * (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return { space: "disc", runs: [pts] };
}

function disc() {
  // Concentric rings filling the moon — the disc rebuilt in pixels. Each ring
  // carries as many LEDs as its circumference can hold at the innermost ring's
  // spacing, so density stays even instead of crowding the middle.
  const rings = Math.round(num("rings", 12));
  const per = Math.round(num("per", 12));   // LEDs on the innermost ring
  const R = num("radius", 0.95);
  const pts = [];
  for (let ring = 0; ring < rings; ring++) {
    const rr = ((ring + 0.5) / rings) * R;
    const n = Math.max(1, Math.round(per * (ring + 0.5)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (ring % 2 ? Math.PI / n : 0);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
  }
  return { space: "disc", runs: [pts] };
}

function grid() {
  // A matrix, serpentine by default because that is how strip is almost always
  // physically run — end of one row folds back into the start of the next.
  const w = Math.round(num("w", 32));
  const h = Math.round(num("h", 32));
  const serp = arg("serp", "1") !== "0";
  const pts = [];
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < w; i++) {
      const x = serp && y % 2 ? w - 1 - i : i;
      pts.push([(x + 0.5) / w, (y + 0.5) / h]);
    }
  }
  return { space: "frame", runs: [pts] };
}

function strips() {
  // Vertical bars — truss uprights, a row of battens behind the booth. Each
  // strip is its own run, so each gets its own controller output.
  const count = Math.round(num("count", 8));
  const leds = Math.round(num("leds", 144));
  const y0 = num("top", 0.05), y1 = num("bottom", 0.95);
  const runs = [];
  for (let s = 0; s < count; s++) {
    const x = count === 1 ? 0.5 : (s + 0.5) / count;
    const pts = [];
    for (let i = 0; i < leds; i++) {
      pts.push([x, y0 + (y1 - y0) * (leds === 1 ? 0.5 : i / (leds - 1))]);
    }
    runs.push(pts);
  }
  return { space: "frame", runs };
}

function sweep() {
  // Long runs laid along something that is not the screen — strips down the
  // sides of a car, a batten along a bar - each carrying a horizontal slice of
  // the moon, so anything crossing the disc travels the length of the fixture.
  //
  // The slice is taken in disc radii rather than across the frame. A line across
  // the frame is mostly empty space with the moon in the middle of it, so a
  // frame-space strip lights its centre third and leaves the ends dark; spanning
  // the diameter instead puts the moon along the whole run. The default span
  // reaches past the limb, because the gifs orbit outside it (giforbitradius
  // 1.2) and passing one should reach the ends of the run.
  const runs = Math.round(num("runs", 2));
  const leds = Math.round(num("leds", 120));
  const span = num("span", 1.3);            // in disc radii, each way from centre
  const y = num("y", 0);                    // 0 = the centre line, where it is brightest
  const spread = num("spread", 0);          // fan the runs either side of y
  // Strip on the far side of a car is usually run the other way round, so its
  // first LED is at the back. Reversing alternate runs puts the sweep the same
  // way along the vehicle on both sides.
  const mirror = arg("mirror", "0") !== "0";
  const out = [];
  for (let s = 0; s < runs; s++) {
    const yy = runs === 1 || !spread ? y : y + spread * ((s / (runs - 1)) - 0.5) * 2;
    const pts = [];
    for (let i = 0; i < leds; i++) {
      const t = leds === 1 ? 0.5 : i / (leds - 1);
      pts.push([-span + 2 * span * t, yy]);
    }
    if (mirror && s % 2) pts.reverse();
    out.push(pts);
  }
  return { space: "disc", runs: out };
}

const SHAPES = { halo, disc, grid, strips, sweep };
if (!SHAPES[shape]) {
  console.log("usage: node scripts/make-pixel-map.mjs <halo|disc|grid|strips> [options]\n");
  console.log("  halo    --leds 240 --radius 0.92 --start -90 --dir cw   (radius in disc radii)");
  console.log("  disc    --rings 12 --per 12 --radius 0.95");
  console.log("  grid    --w 32 --h 32 --serp 1");
  console.log("  strips  --count 8 --leds 144 --top 0.05 --bottom 0.95");
  console.log("  sweep   --runs 2 --leds 120 --span 1.3 --y 0 --spread 0 --mirror 0\n");
  console.log("  common  --name <file> --output <first output no> --universe <first universe>");
  process.exit(1);
}

const { space, runs } = SHAPES[shape]();
// One run per output unless the caller asked for fewer outputs than runs, in
// which case runs are concatenated onto outputs in order — which is what a rig
// with several short strips daisy-chained onto one port actually looks like.
const wantOutputs = Math.round(num("outputs", runs.length));
const perOutput = Math.ceil(runs.length / Math.max(1, wantOutputs));
const grouped = [];
for (let i = 0; i < runs.length; i += perOutput) {
  grouped.push(runs.slice(i, i + perOutput).flat());
}

const firstOutput = Math.round(num("output", 1));
const firstUniverse = Math.round(num("universe", 1));
let universe = firstUniverse;
const outputs = grouped.map((pixels, i) => {
  const o = { output: firstOutput + i, universe, space, pixels };
  // Universes are consumed in whole blocks per output, the way the PixLite is
  // patched in Advatek Assistant: an output's runs never share a universe with
  // the next output's, or a patch change on one shifts every output after it.
  universe += Math.ceil(pixels.length / PIX_PER_UNIVERSE);
  return o;
});

const total = outputs.reduce((n, o) => n + o.pixels.length, 0);
const warn = [];
if (outputs.length > MAX_OUTPUTS) warn.push(`${outputs.length} outputs — the E16-S has ${MAX_OUTPUTS}`);
outputs.forEach((o) => {
  if (o.pixels.length > MAX_PER_OUTPUT) {
    warn.push(`output ${o.output} has ${o.pixels.length} pixels — max is ${MAX_PER_OUTPUT} RGB`);
  }
});
if (universe - firstUniverse > 96) warn.push(`${universe - firstUniverse} universes — the E16-S takes 96`);

fs.mkdirSync("maps", { recursive: true });
const dest = path.join("maps", NAME + ".json");
fs.writeFileSync(dest, JSON.stringify({
  name: NAME, shape, created: new Date().toISOString().slice(0, 10),
  note: space === "disc"
    ? "points in disc radii from the moon's centre; 1.0 is the limb"
    : "points normalised to the rendered frame; 0,0 top-left",
  outputs
}, null, 1) + "\n");

console.log(`${NAME}: ${total} pixels, ${outputs.length} output(s), ` +
  `universes ${firstUniverse}-${universe - 1}`);
outputs.forEach((o) => console.log(
  `  output ${o.output}: ${o.pixels.length} px, universe ${o.universe}+` +
  `${Math.ceil(o.pixels.length / PIX_PER_UNIVERSE) - 1}`));
warn.forEach((w) => console.log("  ! " + w));
console.log(`-> ${dest}`);
