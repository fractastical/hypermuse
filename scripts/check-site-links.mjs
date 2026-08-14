// Every link on the published pages, checked.
//
//   npm run check:links          against the committed files
//   LIVE=1 npm run check:links   against https://fractastical.github.io/hypermuse/
//
// Two failures this catches, which look identical from a browser and have
// opposite fixes. A file referenced by a page but never committed is broken
// forever and shows up in the local pass, because artifacts/ is gitignored and
// it is easy to point a page at a render that only exists on this machine. A
// file that is committed and still 404s on the live site is almost always
// Pages mid-deploy, serving the previous tree for a minute or two after a push
// - so the local pass is clean and only LIVE=1 complains. Run the local pass
// first: if it is clean, wait and run the live one again before believing it.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const LIVE = process.env.LIVE === "1";
const BASE = process.env.SITE || "https://fractastical.github.io/hypermuse/";
// Paths from the repository root, which is also the site root: Pages builds
// this repo from its root, so the landing page exists twice and both copies
// need checking - they resolve their assets from different depths.
const PAGES = ["index.html", "docs/index.html", "docs/press/index.html"];

const refsIn = (html) => [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]))]
  .filter((r) => !/^(https?:|mailto:|tel:|#|data:)/.test(r));

const bad = [];
let checked = 0;

if (LIVE) {
  for (const page of PAGES) {
    const base = new URL(page.replace(/index\.html$/, ""), BASE).href;
    const res = await fetch(base);
    if (!res.ok) { bad.push([page, "(the page itself)", res.status]); continue; }
    for (const r of refsIn(await res.text())) {
      const url = new URL(r, base).href;
      // Range rather than HEAD: the 24 MB poem is on this page and there is no
      // reason to pull it to find out that it exists.
      const hit = await fetch(url, { headers: { Range: "bytes=0-99" } });
      checked++;
      if (!hit.ok && hit.status !== 206) bad.push([page, r, hit.status]);
    }
  }
} else {
  // Tracked rather than merely present, since the whole failure mode is a page
  // pointing at something that works here and does not exist for anyone else.
  const tracked = new Set(execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n"));
  for (const page of PAGES) {
    const file = path.join(ROOT, page);
    const dir = path.dirname(file);
    for (const r of refsIn(fs.readFileSync(file, "utf8"))) {
      const target = path.normalize(path.join(dir, r.split(/[?#]/)[0]));
      const rel = path.relative(ROOT, target);
      checked++;
      if (!fs.existsSync(target)) { bad.push([page, r, "missing"]); continue; }
      if (fs.statSync(target).isDirectory()) {
        // index.html and nothing else. A README used to count, because Jekyll
        // renders one as the index of a directory that has none - but .nojekyll
        // turns that off, and a directory whose only index was a README now
        // gives a listing or a 404 rather than a page.
        if (!fs.existsSync(path.join(target, "index.html"))) bad.push([page, r, "no index.html"]);
      } else if (!tracked.has(rel)) {
        bad.push([page, r, "not committed"]);
      }
    }
  }
}

console.log(`checked ${checked} links ${LIVE ? `on ${BASE}` : "in the committed tree"}`);
for (const [page, ref, why] of bad) console.log(`  BROKEN  ${page}  ${ref}  ${why}`);
if (bad.length) {
  console.log(`\n${bad.length} broken.` + (LIVE ? " If the local pass is clean, this is probably a deploy still in flight." : ""));
  process.exit(1);
}
console.log("all good");
