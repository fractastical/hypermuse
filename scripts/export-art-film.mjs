#!/usr/bin/env node
/**
 * A short art film, not a sampler. The catalogue reel shows one of everything
 * at one length; this is a structured piece: seven movements, shot lengths that
 * breathe and then tighten, a scale progression from a distant disc to a filled
 * frame, and a return to the opening image so it closes and also loops.
 *
 *   npm run export:film                  # ~1:45, 1920x1080
 *   ACT=signal npm run export:film       # render one movement only
 *   TITLES=0 npm run export:film         # no title / end card
 *   SIZE=1080x1080 npm run export:film   # square for the holofan
 *   KEEP=1 npm run export:film           # keep per-shot clips for re-editing
 *
 * Grammar: hard cuts inside a movement, a dip to black between movements. The
 * dips are baked into the shots as fades, so assembly is a lossless concat.
 * True crossfades, if wanted, are available via scripts/join-cuts.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import {
  withHypermoon, encodeShot, blackClip, concatClips, probeVideo, ensureDir, H264
} from "./lib/hypermoon-capture.mjs";

const ROOT = process.cwd();
const OUT_DIR = path.resolve(ROOT, process.env.OUT_DIR || "artifacts/art-film");
const WORK = path.join(OUT_DIR, "shots");
const FRAMES = path.join(ROOT, "artifacts", "art-film-frames");
const OUTPUT = path.join(OUT_DIR, process.env.OUTPUT_NAME || "hypermoon-dark-side-speaks.mp4");
const [WIDTH, HEIGHT] = (process.env.SIZE || "1920x1080").split("x").map((n) => Number.parseInt(n, 10));
const FPS = Number.parseInt(process.env.FPS || "30", 10);
const TITLES = process.env.TITLES !== "0";
const KEEP = process.env.KEEP === "1";
const PRORES = process.env.PRORES === "1";
const TITLE_TEXT = process.env.TITLE_TEXT || "HYPERSTITION";
const END_TEXT = process.env.END_TEXT || "THE DARK SIDE SPEAKS";
const END_SUB = process.env.END_SUB || "WAIT FOR THE TURN";
const EYE_GIF = "assets/esoteric-geometries-circles-warp.gif";

// Window shots: open the aperture past the measured shadow patch and count more
// mid-grey terrain as shadow, or the content comes out a sealed speck.
const WIN = { angw: "1.35", angh: "0.85", threshold: "0.4" };
// The sky is carried through every shot at a matching density so the cuts read
// as one continuous space rather than separate renders.
const SKY = { stars: "760", stardrift: "1.4" };

/**
 * Seven movements. `seconds` is deliberately uneven: long patient holds to open
 * and close, a tightening run through the geometry, and the longest single hold
 * in the middle on the reveal. `dip` is the black beat that follows a shot.
 */
const MOVEMENTS = [
  {
    act: "void", title: "I. the empty turn",
    shots: [
      // Opens on almost nothing: a small far disc, no incident. Fades up from
      // black so the film starts rather than cuts in.
      { id: "01-void", seconds: 11, fadeIn: 2.2,
        q: { ...SKY, moonscale: "0.42", meteors: "2" } },
      { id: "02-approach", seconds: 8,
        q: { ...SKY, moonscale: "0.72", meteors: "5" }, dip: 0.6 }
    ]
  },
  {
    act: "signal", title: "II. something is transmitting",
    shots: [
      // First evidence of intelligence: a terminal types on the shadowed side.
      { id: "03-terminal", seconds: 7.5, facing: true,
        q: { ...WIN, ...SKY, content: "crt", mosaic: "0", moonscale: "0.92" } },
      { id: "04-word", seconds: 6.5, facing: true,
        q: { ...WIN, ...SKY, word: "hyperstition", angw: "1.95", angh: "0.62", threshold: "0.3", moonscale: "0.95" } },
      { id: "05-incant", seconds: 5, facing: true,
        q: { ...WIN, ...SKY, content: "incant", apparition: "0", moonscale: "0.95" } }
    ]
  },
  {
    act: "resonance", title: "III. the body answers",
    shots: [
      // The message becomes physical: the surface starts to ring.
      { id: "06-cymatics", seconds: 5.5, facing: true,
        q: { ...WIN, ...SKY, content: "cymatics", winbright: "0.8", cymsec: "2.4", angw: "1.4", angh: "0.95" } },
      { id: "07-harmonics", seconds: 5.5, facing: true,
        q: { ...WIN, ...SKY, content: "harmonics", winbright: "0.85", harmsec: "2.4", angw: "1.5", angh: "0.95" } }
    ]
  },
  {
    act: "structure", title: "IV. one plus one equals four",
    // Fuller's Synergetics 108: two open helixes associate into a tetrahedron,
    // dividing the universe into an inside and an outside. Shots tighten here —
    // 4.5, 4, 3.2, 3 — so the geometry accelerates into the reveal.
    shots: [
      { id: "08-fold", seconds: 4.5, facing: true,
        q: { ...WIN, ...SKY, content: "fold", winbright: "0.9" } },
      { id: "09-foldhelix", seconds: 4, facing: true,
        q: { ...WIN, ...SKY, content: "foldhelix", winbright: "0.9" } },
      { id: "10-foldjitter", seconds: 3.2, facing: true,
        q: { ...WIN, ...SKY, content: "foldjitter", winbright: "0.9" } },
      { id: "11-foldgeo", seconds: 3, facing: true,
        q: { ...WIN, ...SKY, content: "foldgeo", winbright: "0.9" }, dip: 0.5 }
    ]
  },
  {
    act: "reveal", title: "V. it opens",
    shots: [
      // Ritual objects gather, then the longest hold in the film: the disc
      // irises open and the thing behind it is looking back.
      { id: "12-vajras", seconds: 4.5,
        q: { ...SKY, vajras: "6", vajraradius: "1.26", vajraTilt: "0.5", meteors: "6" } },
      { id: "13-eye", seconds: 9.5,
        q: { ...SKY, backdrop: EYE_GIF, backscale: "0.98", iris: "0", iriszoom: "2.5", irissec: "4.2", meteors: "3" },
        act: [{ at: 0.14, set: { iris: 1 } }] }
    ]
  },
  {
    act: "shadow", title: "VI. the shadow arrives",
    shots: [
      // Hard cut out of the reveal into consequence. The umbra's edge crossing
      // a still-lit disc is the image; totality is just a dark ball.
      { id: "14-eclipse", seconds: 7.5,
        q: { ...SKY, eclipse: "0.26", eclipsedeep: "0.6", meteors: "0" },
        act: [{ at: 0.04, set: { eclipsetarget: 0.42, eclipserun: 24 } }] },
      { id: "15-blood", seconds: 6.5,
        q: { ...SKY, bloodmoon: "0", meteors: "3" },
        act: [{ at: 0.06, set: { bloodtarget: 1, bloodfade: 5.5 } }], dip: 0.9 }
    ]
  },
  {
    act: "coda", title: "VII. someone is still dancing",
    shots: [
      // After the omen, life carries on regardless. Three dancers rather than a
      // crowd, so each one is big enough to read through the window.
      { id: "16-mumins", seconds: 7, facing: true,
        q: { ...WIN, ...SKY, content: "mumins", mumins: "3", muminzoom: "0.9", muminbpm: "104",
             winbright: "0.55", angw: "1.7", angh: "1.1", winscale: "1.4", threshold: "0.4",
             moonscale: "0.95" } },
      { id: "17-fisher", seconds: 9,
        q: { ...SKY, fisherlive: "1", fishersec: "5", fisherheart: "1", moonscale: "0.9", meteors: "8", vajras: "2" } },
      // Back to the opening framing, so the film closes on its first image.
      { id: "18-return", seconds: 9, fadeOut: 2.6,
        q: { ...SKY, moonscale: "0.42", meteors: "2" } }
    ]
  }
];

const FONTS = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
  "/Library/Fonts/Arial.ttf"
];
const FONT = FONTS.find((f) => fs.existsSync(f));

/**
 * Title / end card: text on black with the same encode settings as the shots.
 * drawtext has no tracking control, so wide letter-spacing (the look the
 * project's flyer uses) is done by spacing the characters in the string.
 */
function card({ out, seconds, lines }) {
  const track = (s) => s.split("").join("\u2009\u2009");
  const draws = lines.map((l) => {
    const size = Math.round(HEIGHT * (l.scale || 0.055));
    const y = `(h-text_h)/2${l.dy ? (l.dy > 0 ? "+" : "-") + Math.abs(Math.round(HEIGHT * l.dy)) : ""}`;
    // Each line fades up and back down inside the card's own duration.
    const alpha = `if(lt(t,${l.in}),0,if(lt(t,${l.in + 0.9}),(t-${l.in})/0.9,if(lt(t,${seconds - 1.1}),1,max(0,(${seconds}-t)/1.1))))`;
    return `drawtext=fontfile=${FONT}:text='${track(l.text.replace(/'/g, ""))}':` +
      `x=(w-text_w)/2:y=${y}:fontsize=${size}:fontcolor=${l.color || "white"}:alpha='${alpha}':` +
      `shadowcolor=black@0.6:shadowx=0:shadowy=0`;
  });
  const enc = spawnSync(ffmpegPath, [
    "-y", "-f", "lavfi", "-i", `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${seconds.toFixed(3)}`,
    "-vf", `${draws.join(",")},format=yuv420p`, "-r", String(FPS), ...H264, "-movflags", "+faststart", out
  ], { encoding: "utf8" });
  if (enc.status !== 0) throw new Error(enc.stderr || "card failed");
  return out;
}

async function main() {
  const only = String(process.env.ACT || "").trim();
  const movements = only ? MOVEMENTS.filter((m) => m.act === only) : MOVEMENTS;
  if (!movements.length) throw new Error(`unknown act: ${only} (have: ${MOVEMENTS.map((m) => m.act).join(", ")})`);

  // SHOT=18-return re-captures just those shots and reuses every other clip
  // already in the work dir, so a single bad take does not cost a whole run.
  // JOIN_ONLY=1 skips capture entirely and restitches what is on disk.
  const shotFilter = String(process.env.SHOT || "").trim();
  const shotRe = shotFilter ? new RegExp(shotFilter) : null;
  const joinOnly = process.env.JOIN_ONLY === "1";

  if (!joinOnly && !shotRe) fs.rmSync(FRAMES, { recursive: true, force: true });
  ensureDir(FRAMES);
  ensureDir(WORK);

  const timeline = []; // clip paths in order
  const log = [];

  const runShots = async (capture) => {
      if (TITLES && !only) {
        const c = card({
          out: path.join(WORK, "00-title.mp4"), seconds: 4.5,
          lines: [{ text: TITLE_TEXT, scale: 0.062, in: 0.5 }]
        });
        timeline.push(c);
        log.push({ shot: "title", seconds: 4.5 });
      }

      for (const mv of movements) {
        console.log(`\n[film] ${mv.title}`);
        for (const shot of mv.shots) {
          const clip = path.join(WORK, `${shot.id}.mp4`);
          const keep = (joinOnly || (shotRe && !shotRe.test(shot.id))) && fs.existsSync(clip);
          if (keep) {
            console.log(`[film]   ${shot.id} reused`);
          } else if (joinOnly || (shotRe && !shotRe.test(shot.id))) {
            console.log(`[film]   ${shot.id} missing, skipped`);
            continue;
          } else {
            process.stdout.write(`[film]   ${shot.id} (${shot.seconds}s)… `);
            const framesDir = path.join(FRAMES, shot.id);
            let count = 0, ms = 0;
            // Long runs can degrade until the compositor is delivering a handful
            // of frames a second, which stretches into a slideshow. Retry those.
            for (let attempt = 0; attempt < 2; attempt++) {
              fs.rmSync(framesDir, { recursive: true, force: true });
              ({ count, ms } = await capture(shot, framesDir));
              const got = count / Math.max(ms / 1000, 0.001);
              if (count >= 2 && got >= FPS * 0.7) break;
              if (attempt === 0) process.stdout.write(`only ${got.toFixed(0)}fps, retrying… `);
            }
            if (count < 2) { console.log("no frames, skipped"); continue; }
            const info = encodeShot({
              framesDir, out: clip, count, measuredMs: ms,
              targetSeconds: shot.seconds, fps: FPS,
              fadeIn: shot.fadeIn || 0,
              // A dip after a shot means fading this one down into the black beat.
              fadeOut: shot.fadeOut || (shot.dip ? Math.min(0.7, shot.dip) : 0),
              prores: PRORES
            });
            console.log(`${info.capturedFps}fps captured`);
          }
          timeline.push(clip);
          log.push({ shot: shot.id, act: mv.act, seconds: shot.seconds });

          if (shot.dip) {
            const b = blackClip({ out: path.join(WORK, `${shot.id}-dip.mp4`), seconds: shot.dip, width: WIDTH, height: HEIGHT, fps: FPS });
            timeline.push(b);
            log.push({ shot: `${shot.id} dip`, seconds: shot.dip });
          }
        }
      }

      if (TITLES && !only) {
        const c = card({
          out: path.join(WORK, "99-end.mp4"), seconds: 6.5,
          lines: [
            { text: END_TEXT, scale: 0.038, in: 0.6, dy: -0.035 },
            { text: END_SUB, scale: 0.026, in: 1.8, dy: 0.05, color: "0xB9C6D6" }
          ]
        });
        timeline.push(c);
        log.push({ shot: "end card", seconds: 6.5 });
      }
  };

  if (joinOnly) {
    await runShots(null);
  } else {
    await withHypermoon({ root: ROOT, width: WIDTH, height: HEIGHT, port: Number.parseInt(process.env.SERVER_PORT || "8233", 10) },
      async ({ capture }) => { await runShots(capture); });
  }

  if (!timeline.length) throw new Error("nothing captured");

  ensureDir(OUT_DIR);
  const result = concatClips({ files: timeline, out: OUTPUT, fps: FPS, workDir: OUT_DIR });
  fs.rmSync(FRAMES, { recursive: true, force: true });
  if (!KEEP) fs.rmSync(WORK, { recursive: true, force: true });

  const mm = Math.floor(result.dur / 60);
  const ss = (result.dur - mm * 60).toFixed(1).padStart(4, "0");
  console.log(`\n[film] ${path.relative(ROOT, OUTPUT)}  ${mm}:${ss}  ${result.w}x${result.h}  ${result.frames} frames @ ${FPS}fps`);
  console.log(JSON.stringify({ runtime: `${mm}:${ss}`, shots: log.length, timeline: log }, null, 2));
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
