#!/usr/bin/env node
// Files a flat camera dump into the day folders the annals read, converting anything
// a browser cannot show.
//
//   node scripts/hermes-annals-photos.mjs            # say what would happen
//   node scripts/hermes-annals-photos.mjs --apply
//
// A phone dump arrives as IMG_4205.HEIC with no date in the name, and the annals want
// assets/hermes-annals/<day>/. Three things have to be true before a photograph shows
// up in a day's entry:
//
//   The day has to be the day it was taken, in playa time. Capture dates come back
//   from Spotlight in UTC, and the nights matter here — a photo taken at nine in the
//   evening is already tomorrow in UTC, so binning on the UTC date moves half the
//   night's photographs into the next day's entry.
//
//   HEIC has to go. Chrome answers an <img> pointing at one with an error and nothing
//   else, and .heic is not in the annals' own list of media extensions either, so the
//   file would be skipped twice over.
//
//   The clips are a mix of h264 and HEVC. HEVC does decode in Chrome on this Mac, but
//   only because macOS has a hardware decoder for it; the same file on Windows usually
//   shows nothing. They are normalised so the annals survive being read elsewhere.
//
// Originals are left in place. Re-running skips work already done.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const sourceDir = args.find(a => !a.startsWith('--')) || 'assets/hermes-annals/photos';
const annalsRoot = path.dirname(sourceDir);

const STILL_EXT = new Set(['.heic', '.heif', '.jpg', '.jpeg', '.png']);
const VIDEO_EXT = new Set(['.mov', '.mp4', '.m4v']);
const STILL_MAX = 2400;   // long edge; the originals are 5712px tall and nothing needs that
const VIDEO_MAX = 1600;

// The days the annals cover. Anything outside is still filed, but flagged, because a
// folder the annals never read is a photograph that silently goes missing.
const ANNALS_FIRST = '2026-08-28';
const ANNALS_LAST = '2026-09-07';

async function captureDate(file) {
  const { stdout } = await execFileAsync('mdls', ['-name', 'kMDItemContentCreationDate', '-raw', file]);
  const raw = stdout.trim();
  if (!raw || raw === '(null)') return null;
  const parsed = new Date(raw.replace(' +0000', 'Z').replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The date as it was lived, not as UTC recorded it. */
function playaDay(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

const files = readdirSync(sourceDir).filter(name => {
  if (name.startsWith('.')) return false;
  const ext = path.extname(name).toLowerCase();
  return STILL_EXT.has(ext) || VIDEO_EXT.has(ext);
});

const plan = [];
for (const name of files) {
  const source = path.join(sourceDir, name);
  const date = await captureDate(source);
  const ext = path.extname(name).toLowerCase();
  const isVideo = VIDEO_EXT.has(ext);
  const day = date ? playaDay(date) : 'undated';
  const stem = path.basename(name, path.extname(name));
  const outName = stem + (isVideo ? '.mp4' : '.jpg');
  plan.push({
    name, source, date, day, isVideo,
    size: statSync(source).size,
    dest: path.join(annalsRoot, day, outName),
    // A jpg or png that is already small enough only needs copying.
    passthrough: !isVideo && (ext === '.jpg' || ext === '.jpeg')
  });
}

const byDay = {};
for (const item of plan) (byDay[item.day] = byDay[item.day] || []).push(item);
const mb = n => Math.round(n / 1024 ** 2);

console.log(`${files.length} files in ${sourceDir}`);
console.log(apply ? 'mode: APPLY\n' : 'mode: dry run — pass --apply to write\n');
for (const day of Object.keys(byDay).sort()) {
  const list = byDay[day];
  const outside = day < ANNALS_FIRST || day > ANNALS_LAST;
  const stills = list.filter(i => !i.isVideo).length;
  console.log(`  ${day}  ${String(list.length).padStart(3)} files (${stills} stills, ${list.length - stills} clips)`
    + `  ${String(mb(list.reduce((n, i) => n + i.size, 0))).padStart(4)} MB`
    + (outside ? '   <- outside the annals range, will not appear in an entry' : ''));
}

const missingDays = [];
for (let d = new Date(ANNALS_FIRST + 'T12:00:00Z'); playaDay(d) <= ANNALS_LAST; d.setUTCDate(d.getUTCDate() + 1)) {
  const day = d.toISOString().slice(0, 10);
  if (!byDay[day]) missingDays.push(day);
}
if (missingDays.length) console.log(`\n  days in the annals with no photographs: ${missingDays.join(', ')}`);

if (!apply) {
  const converts = plan.filter(i => !i.passthrough).length;
  console.log(`\n  would convert ${converts} files and copy ${plan.length - converts}`);
  process.exit(0);
}

// A still taken from the clip, so the annals can show a shoot without fetching video.
// One second in, because the first frame of a phone clip is often the lens settling.
// Kept out of the conversion branch so that clips converted by an earlier run still
// get one.
async function writePoster(item) {
  if (!item.isVideo) return false;
  const poster = item.dest.replace(/\.[^.]+$/, '') + '.poster.jpg';
  if (existsSync(poster)) return false;
  try {
    await execFileAsync('ffmpeg', ['-y', '-nostdin', '-loglevel', 'error', '-ss', '1', '-i', item.dest,
      '-frames:v', '1', '-vf', "scale='min(1200,iw)':-2", poster], { maxBuffer: 1 << 22 });
    return true;
  } catch {
    return false; // a clip shorter than a second simply has no poster
  }
}

let done = 0, skipped = 0, failed = 0, posters = 0, bytesIn = 0, bytesOut = 0;
for (const item of plan) {
  mkdirSync(path.dirname(item.dest), { recursive: true });
  if (existsSync(item.dest)) {
    skipped++;
    if (await writePoster(item)) posters++;
    continue;
  }
  const tmp = item.dest + '.partial' + path.extname(item.dest);
  try {
    if (item.passthrough) {
      copyFileSync(item.source, item.dest);
    } else if (item.isVideo) {
      // min() on each side caps without ever scaling a small clip up; decrease then
      // fits it inside the box with the aspect kept. Audio stays: unlike the loops,
      // these are records of a place and people are talking in them.
      await execFileAsync('ffmpeg', ['-y', '-nostdin', '-loglevel', 'error', '-i', item.source,
        '-vf', `scale='min(${VIDEO_MAX},iw)':'min(${VIDEO_MAX},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmp], { maxBuffer: 1 << 24 });
      renameSync(tmp, item.dest);
    } else {
      await execFileAsync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82',
        '--resampleHeightWidthMax', String(STILL_MAX), item.source, '--out', item.dest]);
    }
    if (await writePoster(item)) posters++;
    const out = statSync(item.dest);
    bytesIn += item.size;
    bytesOut += out.size;
    done++;
    console.log(`  [${done}] ${item.day}  ${mb(item.size)}MB -> ${mb(out.size)}MB  ${item.name}`);
  } catch (error) {
    failed++;
    if (existsSync(tmp)) { try { unlinkSync(tmp); } catch {} }
    console.log(`  FAILED ${item.name}: ${String(error.stderr || error.message).slice(0, 160)}`);
  }
}

console.log(`\n  wrote ${done}, skipped ${skipped} already present, ${failed} failed, ${posters} poster frames`);
console.log(`  ${(bytesIn / 1024 ** 3).toFixed(2)} GB -> ${(bytesOut / 1024 ** 3).toFixed(2)} GB`);
console.log('  next: npm run hermes:annals');
