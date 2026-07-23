// Bakes a standalone loop video for every bucky/fold window mode, plus red
// variants of the wireframe modes, into artifacts/fold-loops/. These are the
// pre-rendered clips for dark-side bleed-through (content=<path>) so the
// repertoire works as plain video anywhere (projectors, CRTs, other machines).
//
//   node scripts/export-fold-loops.mjs            # all
//   node scripts/export-fold-loops.mjs foldhelix  # just one mode (+ its red)
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_DIR = "artifacts/fold-loops";
mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true });

const RED = "ink=ff3b30&ink2=ff8a5c";
// seconds = one full animation period of the mode (from the maker timelines)
const MODES = [
  { key: "fold", seconds: 12, red: true },
  { key: "foldsonic", seconds: 12, red: false }, // faces are video, red ink only tints the outline
  { key: "foldhelix", seconds: 15, red: true },
  { key: "foldjitter", seconds: 13.6, red: true },
  { key: "foldgeo", seconds: 12, red: true },
  { key: "foldivm", seconds: 12, red: true },
];

const only = process.argv[2];
const jobs = [];
for (const m of MODES) {
  if (only && m.key !== only) continue;
  jobs.push({ out: `${OUT_DIR}/${m.key}.mp4`, query: `content=${m.key}&solo=1&texsize=1080`, seconds: m.seconds });
  if (m.red) {
    jobs.push({ out: `${OUT_DIR}/${m.key}-red.mp4`, query: `content=${m.key}&solo=1&texsize=1080&${RED}`, seconds: m.seconds });
  }
}

for (const job of jobs) {
  console.log(`\n=== baking ${job.out} (${job.seconds}s) ===`);
  execFileSync(process.execPath, ["scripts/export-hyperstition-moon-video.mjs"], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      HYPERSTITION_PAGE: "hypermoon.html",
      HYPERSTITION_EXTRA_QUERY: job.query,
      OUTPUT_VIDEO: job.out,
      CAPTURE_MS: String(Math.round(job.seconds * 1000)),
      EXPORT_WIDTH: "1080",
      EXPORT_HEIGHT: "1080",
      BUILD_MOON_CUBES: "0",
    },
  });
}
console.log(`\nall fold loops baked into ${OUT_DIR}/`);
