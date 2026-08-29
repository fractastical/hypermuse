// Shoots the mandala cycle where it means something — orbiting, mid-gather,
// held, and back out — so the ring can be tuned by looking at it instead of by
// standing in front of a two-and-a-half minute act waiting for it to come round.
//
//   npm run metavillan:check
//   EXTRA="&mandr=0.9&mandaim=1&mandscale=1.6" npm run metavillan:check
//
// The act's timings are shortened here, but everything about how the ring looks
// is left at the show's defaults unless EXTRA says otherwise. Needs the server:
// npm start.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = "artifacts/metavillan";
mkdirSync(OUT, { recursive: true });
const q = "content=orbit&orbitseq=metavillan&giforbit=8&nosound=1&stars=0&meteors=0" +
  "&mandsec=4&mandhold=8&mandmove=2.5" + (process.env.EXTRA || "");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  page:", m.text()); });
await page.goto(`http://127.0.0.1:8080/hypermoon.html?${q}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__gifswarm?.sourceCount() > 0, null, { timeout: 30000 })
  .catch(() => { throw new Error("nothing decoded — is assets/metavillan/ built? npm run metavillan"); });
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

await shoot("cycle-orbit");
await until((s) => s.form > 0.35 && s.form < 0.75);
await shoot("cycle-gather");
await until((s) => s.phase === "hold");
await page.waitForTimeout(1500);
await shoot("cycle-hold");
await until((s) => s.phase === "orbit" && s.form === 0);
await shoot("cycle-back");
await browser.close();
console.log(`shots -> ${OUT}`);
