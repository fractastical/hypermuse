// Shoots the mandala cycle where it means something — orbiting, the first ring
// seated with the rest still out, mid-gather, held, and back out — so the rings
// can be tuned by looking at them instead of by standing in front of a
// two-and-a-half minute act waiting for it to come round.
//
//   npm run metavillan:check
//   EXTRA="&mandr=0.9&mandaim=1&mandscale=1.6" npm run metavillan:check
//   ACT=coral npm run metavillan:check      # a theme rosette rather than marks
//
// The act's timings are shortened here, but everything about how the ring looks
// is left at the show's defaults unless EXTRA says otherwise. Needs the server:
// npm start.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

// Which act to shoot. The rosette is no longer the monograms' alone — a theme
// named in mandacts gathers too — so the checker has to be able to point at
// either, and keep their shots apart.
const ACT = process.env.ACT || "metavillan";
const OUT = process.env.OUT || `artifacts/${ACT.replace(/[^a-z0-9]+/gi, "-")}`;
mkdirSync(OUT, { recursive: true });
// The hold is long enough for the colour to finish arriving, and the bloom is
// shortened to match: at the show's eight seconds against this eight-second hold
// the flower would scatter still half grey, and the shot meant to show a lit
// rosette would show a stalled one.
const q = `content=orbit&orbitseq=${encodeURIComponent(ACT)}&giforbit=8&nosound=1&stars=0&meteors=0` +
  "&mandsec=4&mandhold=16&mandmove=2.5&markbloom=5" + (process.env.EXTRA || "");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  page:", m.text()); });
// Either server serves the repo, so shoot against whichever is already up.
const port = process.env.PORT || 8080;
await page.goto(`http://127.0.0.1:${port}/hypermoon.html?${q}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gifswarm?.sourceCount() > 0, null, { timeout: 30000 })
  .catch(() => {
    throw new Error(`nothing decoded for "${ACT}" — ` + (ACT === "metavillan"
      ? "is assets/metavillan/ built? npm run metavillan"
      : "is the gif library built, and does that theme have anything in it? npm run gifs"));
  });
const cdp = await page.context().newCDPSession(page);
const state = () => page.evaluate(() => window.__gifswarm.mandala());

const shoot = async (name) => {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
  console.log(`  ${name.padEnd(14)} ${JSON.stringify(await state())}`);
};
// Waits on the swarm's own report of the phase rather than on a clock, so the
// held shot is of the ring held and not of it still on its way there.
const until = async (ok, tries = 500, every = 70) => {
  for (let i = 0; i < tries; i++) {
    if (ok(await state())) return;
    await page.waitForTimeout(every);
  }
};

console.log(`  lanes ${(await state()).lanes}, rings ` +
  (await state()).rings.map((r) => `${r.n}@${r.r}`).join(" + "));

await shoot("cycle-orbit");
// The rings arrive inside out, so there is a moment with the inner one seated
// and the outer one barely under way. That is the shot that shows whether the
// stagger reads as marks coming in or as a formation stuttering. Nothing to
// catch on a one-ring flower, which arrives all at once by definition.
if ((await state()).rings.length > 1) {
  await until((s) => s.rings[0].form >= 1 && s.rings[s.rings.length - 1].form < 0.5);
  await shoot("cycle-arrive");
}
await until((s) => s.form > 0.35 && s.form < 0.75);
await shoot("cycle-gather");
await until((s) => s.phase === "hold");
// The colour arriving is its own sequence, and a single held shot cannot show
// whether it spreads or merely appears. Three points across the front: barely
// started, half the flower lit, and everything through.
if ((await state()).bloom != null) {
  await until((s) => s.bloom >= 0.2);
  await shoot("bloom-early");
  await until((s) => s.bloom >= 0.55);
  await shoot("bloom-half");
  await until((s) => s.bloom >= 0.999);
  await shoot("bloom-full");
} else {
  await page.waitForTimeout(1500);
}
await shoot("cycle-hold");
await until((s) => s.phase === "orbit" && s.form === 0);
await shoot("cycle-back");
await browser.close();
console.log(`shots -> ${OUT}`);
