// Brings a collected mark into the show as an orbiting sprite.
//
// The marks arrive as big square PNGs with the glyph floating in a wide
// transparent margin — 1254 square with the mark occupying a sixth of it, in
// the batch this was written for. Two things have to happen before one can fly.
// It has to be cropped to its own bounds, or a fixed sprite scale renders the
// margin and the mark comes out a third the size of the gifs beside it, and
// differently sized for each file collected. And it has to come down to sprite
// resolution, because a sprite renders a couple of hundred pixels tall and the
// masters are a third of a megabyte each.
//
// Cropping needs per-pixel alpha, which is a canvas, which is why this runs in
// the browser the repo already drives rather than reaching for an image library.
//
//   node scripts/build-metavillan.mjs ~/Downloads/mark*.png
//   SIZE=512 node scripts/build-metavillan.mjs <files…>
//
// Rerunning is safe: each file is written by its own name, and the index is
// rebuilt from what is in the directory afterwards, so collecting more marks is
// a matter of running this again with the new ones.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = "assets/metavillan";
const SIZE = Math.max(64, Number(process.env.SIZE) || 512);
const PAD = Math.max(0, Number(process.env.PAD) || 2);   // px of margin kept, post-crop
const files = process.argv.slice(2).filter((f) => /\.(png|webp|gif)$/i.test(f));

fs.mkdirSync(OUT, { recursive: true });

if (files.length) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const src of files) {
    const data = "data:image/png;base64," + fs.readFileSync(src).toString("base64");
    const out = await page.evaluate(async ({ data, SIZE, PAD }) => {
      const img = new Image();
      img.src = data;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      // Alpha bounding box. Anything at all opaque counts: the marks have soft
      // edges and clipping them to a higher threshold eats the points.
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (d[(y * c.width + x) * 4 + 3] <= 4) continue;
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
      if (x1 < x0) return null;                       // nothing but margin
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // Square output on the long side, so the glyph keeps its proportions and
      // the sprite's own aspect handling has nothing to undo.
      const side = Math.max(bw, bh) + PAD * 2;
      const s = Math.min(1, SIZE / side);
      const o = document.createElement("canvas");
      o.width = Math.round(side * s); o.height = Math.round(side * s);
      const og = o.getContext("2d");
      og.drawImage(c, x0 - PAD, y0 - PAD, side, side, 0, 0, o.width, o.height);
      return { url: o.toDataURL("image/png"), w: bw, h: bh, out: o.width };
    }, { data, SIZE, PAD });

    if (!out) { console.log(`  ${path.basename(src)}: no opaque pixels, skipped`); continue; }
    // Named off the source so a collected batch keeps whatever the collector
    // called it; the index is what the page reads, not the filename.
    const name = path.basename(src).replace(/\.[^.]+$/, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".png";
    const dest = path.join(OUT, name);
    fs.writeFileSync(dest, Buffer.from(out.url.split(",")[1], "base64"));
    console.log(`  ${name}: cropped ${out.w}x${out.h} -> ${out.out} square,` +
      ` ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
  }
  await browser.close();
}

const marks = fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).sort();
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({
  built: new Date().toISOString(),
  note: "Marks cropped to their own bounds and scaled for sprite use. " +
    "Add more with: node scripts/build-metavillan.mjs <files…>",
  base: OUT + "/",
  marks
}, null, 2) + "\n");
console.log(`${marks.length} mark(s) -> ${OUT}/index.json`);
