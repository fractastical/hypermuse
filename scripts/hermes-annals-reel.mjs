#!/usr/bin/env node
// One highlight per day, cut together into a reel.
//
//   node scripts/hermes-annals-reel.mjs                 # plan only
//   node scripts/hermes-annals-reel.mjs --apply
//   node scripts/hermes-annals-reel.mjs --apply --seconds=6
//
// The annals already hold the three things a title card needs — the day, the headline
// somebody wrote for it, and the arithmetic underneath — and the day folders now hold
// the photographs. This picks one piece of media per day and lays the card over it.
//
// Typography is done in the browser and ffmpeg is handed a finished transparent PNG.
// drawtext can put words on a frame but it cannot wrap a sentence, and these headlines
// are sentences; every alternative involves guessing where the line breaks. Chrome
// already knows.
//
// Motion is chosen per source. A clip plays. A still gets a slow push in, because a
// held frame in a sequence of moving ones reads as a fault. Days with no photographs
// still get a card over a dark field rather than being dropped: September 3rd has the
// best writing of the eleven and no pictures at all.
//
// Silent on purpose. The clips were shot minutes apart in wind and crowds, and cutting
// between their audio is worse than nothing; a single music bed belongs over the top of
// the finished file.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const SEG = Number((args.find(a => a.startsWith('--seconds=')) || '').split('=')[1]) || 5;
const FPS = 30;
const W = 1920, H = 1080;
const outDir = 'artifacts/hermes-annals';
const workDir = path.join(outDir, 'reel-work');
const outFile = path.join(outDir, 'annals-reel.mp4');

async function annalsJson() {
  const { stdout } = await execFileAsync('node', ['scripts/hermes-annals.mjs', '--json'], { maxBuffer: 1 << 26 });
  const parsed = JSON.parse(stdout);
  const days = parsed.days || parsed.entries || parsed;
  return Array.isArray(days) ? days : Object.values(days);
}

async function duration(file) {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file]);
    const value = Number(stdout.trim());
    return Number.isFinite(value) ? value : 0;
  } catch { return 0; }
}

/**
 * The day's highlight. A clip beats a still because the reel wants movement, and the
 * longest clip beats a short one because a two second clip cannot fill a five second
 * slot without looping visibly. annals-media.json can override by setting
 * "highlight": true on an entry.
 */
async function pickHighlight(day) {
  const media = day.media || [];
  if (media.length === 0) return null;
  const chosen = media.find(m => m.highlight);
  if (chosen) return { ...chosen, seconds: await duration(chosen.src) };
  const videos = [];
  for (const m of media.filter(m => m.shoot === 'video')) {
    videos.push({ ...m, seconds: await duration(m.src) });
  }
  videos.sort((a, b) => b.seconds - a.seconds);
  if (videos.length && videos[0].seconds >= 1.5) return videos[0];
  const still = media.find(m => m.shoot !== 'video');
  return still ? { ...still, seconds: 0 } : (videos[0] || null);
}

function factsLine(facts) {
  const bits = [];
  if (facts.fixes) bits.push(`${facts.fixes} fixes`);
  if (facts.distance) bits.push(facts.distance);
  if (facts.journeys) bits.push(`${facts.journeys} journey${facts.journeys === 1 ? '' : 's'}`);
  if (Array.isArray(facts.art) && facts.art.length) bits.push(`${facts.art.length} art within reach`);
  if (Array.isArray(facts.requests) && facts.requests.length) bits.push(`${facts.requests.length} asked of Hermes`);
  return bits.join('  ·  ');
}

/**
 * The card. When there is no photograph behind it the account goes in the space the
 * picture would have filled, because five seconds of an empty frame with a line of
 * text in the corner reads as a missing asset rather than a quiet day.
 */
const cardHtml = (day, index, total, withAccount) => `<!doctype html><meta charset="utf-8">
<style>
  html,body { margin:0; width:${W}px; height:${H}px; background:transparent; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color:#eaf4ff; }
  .scrim { position:absolute; left:0; right:0; bottom:0; height:46%;
    background:linear-gradient(to top, rgba(4,8,14,0.94) 0%, rgba(4,8,14,0.78) 45%, rgba(4,8,14,0) 100%); }
  .account { position:absolute; left:76px; right:76px; top:170px; font-size:31px; line-height:1.5;
    color:rgba(226,242,255,.86); max-width:1500px; }
  .mark { position:absolute; top:54px; left:76px; font-size:23px; letter-spacing:.34em;
    text-transform:uppercase; color:rgba(180,230,255,.82); }
  .count { position:absolute; top:54px; right:76px; font-size:23px; letter-spacing:.2em;
    color:rgba(180,230,255,.62); }
  .wrap { position:absolute; left:76px; right:76px; bottom:82px; }
  .day { font-size:34px; letter-spacing:.16em; text-transform:uppercase;
    color:rgba(150,220,255,.92); margin-bottom:16px; }
  .head { font-size:78px; line-height:1.06; font-weight:600; letter-spacing:-.015em;
    text-shadow:0 3px 26px rgba(0,0,0,.8); }
  .facts { margin-top:22px; font-size:29px; color:rgba(214,236,255,.84); }
  .rule { width:112px; height:4px; background:rgba(120,220,255,.75); margin:26px 0 0; }
</style>
<div class="scrim"></div>
<div class="mark">The Annals of Hermes</div>
<div class="count">${index} / ${total}</div>
${withAccount ? `<div class="account">${String(day.account || '').split(/(?<=\.)\s+/).slice(0, 3).join(' ')}</div>` : ''}
<div class="wrap">
  <div class="day">${day.facts.dayName}</div>
  <div class="head">${day.headline}</div>
  <div class="facts">${factsLine(day.facts)}</div>
  <div class="rule"></div>
</div>`;

// ── plan ───────────────────────────────────────────────────────────────────────
const days = await annalsJson();
const plan = [];
for (let i = 0; i < days.length; i++) {
  const day = days[i];
  const highlight = await pickHighlight(day);
  plan.push({ day, highlight, index: i + 1 });
}

console.log(`The Annals of Hermes — ${days.length} days, ${SEG}s each, ${(days.length * SEG)}s total`);
console.log(apply ? `mode: APPLY -> ${outFile}\n` : 'mode: plan only — pass --apply to render\n');
for (const item of plan) {
  const h = item.highlight;
  const kind = !h ? 'card only (no photographs)' : (h.shoot === 'video' ? `clip ${h.seconds.toFixed(1)}s` : 'still');
  console.log(`  ${item.day.day}  ${kind.padEnd(26)} ${h ? path.basename(h.src) : ''}`);
  console.log(`     ${item.day.headline}`);
}
if (!apply) process.exit(0);

// ── render ─────────────────────────────────────────────────────────────────────
const { chromium } = await import(path.resolve('node_modules/playwright/index.mjs'));
mkdirSync(workDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });

// A blurred copy of the frame fills the sides, because most of this was shot on a
// phone held upright and black bars either side of every other segment look like a
// mistake rather than a choice.
const fill = (label) => `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:2,setsar=1[bg];`
  + `[0:v]${label},setsar=1[fg];`
  + `[bg][fg]overlay=(W-w)/2:(H-h)/2[base];`
  + `[base][1:v]overlay=0:0,format=yuv420p[v]`;

const segments = [];
for (const item of plan) {
  const card = path.join(workDir, `card-${item.day.day}.png`);
  await page.setContent(cardHtml(item.day, item.index, plan.length, !item.highlight), { waitUntil: 'load' });
  await page.screenshot({ path: card, omitBackground: true });

  const seg = path.join(workDir, `seg-${item.day.day}.mp4`);
  const encode = ['-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-t', String(SEG), '-an', seg];
  let cmd;
  if (!item.highlight) {
    cmd = ['-y', '-nostdin', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=0x070d16:s=${W}x${H}:r=${FPS}:d=${SEG}`,
      '-i', card, '-filter_complex', `[0:v][1:v]overlay=0:0,format=yuv420p[v]`, '-map', '[v]', ...encode];
  } else if (item.highlight.shoot === 'video') {
    // Start a second in when there is room: the first moment of a phone clip is the
    // hand still moving. Loop only if the clip is shorter than the slot.
    const start = item.highlight.seconds > SEG + 1.5 ? 1 : 0;
    const loop = item.highlight.seconds < SEG ? ['-stream_loop', '-1'] : [];
    cmd = ['-y', '-nostdin', '-loglevel', 'error', ...loop, '-ss', String(start), '-i', item.highlight.src,
      '-i', card, '-filter_complex', fill(`scale=${W}:${H}:force_original_aspect_ratio=decrease`),
      '-map', '[v]', ...encode];
  } else {
    // zoompan wants a frame count, and it reads d in output frames.
    const zoom = `scale=${W * 1.6}:-2,zoompan=z='min(zoom+0.0007,1.16)':d=${SEG * FPS}`
      + `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`;
    cmd = ['-y', '-nostdin', '-loglevel', 'error', '-loop', '1', '-t', String(SEG), '-i', item.highlight.src,
      '-i', card, '-filter_complex',
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:2,setsar=1[bg];`
      + `[0:v]${zoom},setsar=1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[base];[base][1:v]overlay=0:0,format=yuv420p[v]`,
      '-map', '[v]', ...encode];
  }

  try {
    await execFileAsync('ffmpeg', cmd, { maxBuffer: 1 << 24 });
    segments.push(seg);
    console.log(`  rendered ${item.day.day}  ${(statSync(seg).size / 1024 ** 2).toFixed(1)} MB`);
  } catch (error) {
    console.log(`  FAILED ${item.day.day}: ${String(error.stderr || error.message).slice(0, 300)}`);
  }
}
await browser.close();

if (!segments.length) { console.log('\n  nothing rendered'); process.exit(1); }

const listFile = path.join(workDir, 'segments.txt');
writeFileSync(listFile, segments.map(s => `file '${path.resolve(s)}'`).join('\n') + '\n');
await execFileAsync('ffmpeg', ['-y', '-nostdin', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
  '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outFile], { maxBuffer: 1 << 24 });

console.log(`\n  ${segments.length} segments -> ${outFile}`);
console.log(`  ${(statSync(outFile).size / 1024 ** 2).toFixed(1)} MB, ${segments.length * SEG}s`);
if (!args.includes('--keep-work')) rmSync(workDir, { recursive: true, force: true });
