#!/usr/bin/env node
// Makes a set's clips actually playable in a browser, writing web-ready copies
// alongside the originals and emitting a manifest that points at them.
//
// Four problems, established by scripts/check-loop-playback.mjs and by loading the
// files in real Chrome:
//
//   1. ProRes and MJPEG do not decode at all. Chrome answers every one of them with
//      DEMUXER_ERROR_NO_SUPPORTED_STREAMS, so those clips are silent gaps in the set
//      rather than slow ones.
//   2. mp4/mov files with moov after mdat cannot start until the whole file has been
//      read, which for a 1.6 GB clip is the stall you see during the fade.
//   3. Several clips are 4K or 8K. Nothing needs that: each one is a texture on a
//      polygon slice or a mosaic tile for about eight seconds.
//   4. Some manifest entries have no file behind them and 404 on every pass.
//
// Originals are never modified. Clips that are already fine are left where they are
// and referenced in place, so this only writes what it has to.

import { stat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const manifestPath = args.find(a => a.endsWith('.json')) || 'sets/set-live-default-all-loops.json';
const outRoot = 'loops-web';
const MAX_HEIGHT = 1080;
const jobs = Number((args.find(a => a.startsWith('--jobs=')) || '').split('=')[1]) || Math.max(2, Math.min(6, os.cpus().length - 2));
const limit = Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;

const UNDECODABLE = /^(prores|mjpeg|dnxhd|rawvideo|v210|hap|cineform)$/i;
const SAFE_CODECS = /^(h264|vp8|vp9|av1)$/i;

async function topLevelBoxes(file, size) {
  const handle = await open(file, 'r');
  try {
    const boxes = [];
    const header = Buffer.alloc(16);
    let offset = 0;
    while (offset < size && boxes.length < 24) {
      const { bytesRead } = await handle.read(header, 0, 16, offset);
      if (bytesRead < 8) break;
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      let headerLength = 8;
      if (boxSize === 1) { boxSize = Number(header.readBigUInt64BE(8)); headerLength = 16; }
      else if (boxSize === 0) { boxSize = size - offset; }
      if (boxSize < headerLength) break;
      boxes.push(type);
      offset += boxSize;
    }
    return boxes;
  } finally { await handle.close(); }
}

async function probe(file) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt',
    '-of', 'json', file
  ], { maxBuffer: 1 << 22 });
  const s = JSON.parse(stdout).streams?.[0] || {};
  return { codec: (s.codec_name || '?').toLowerCase(), width: s.width || 0, height: s.height || 0, pixFmt: s.pix_fmt || '?' };
}

/** What has to happen to this clip, and why. */
function planFor(info) {
  if (UNDECODABLE.test(info.codec)) return { action: 'transcode', reason: `${info.codec} does not decode in Chrome` };
  if (info.height > MAX_HEIGHT) return { action: 'transcode', reason: `${info.width}x${info.height} is larger than needed` };
  if (!SAFE_CODECS.test(info.codec)) return { action: 'transcode', reason: `${info.codec} is not a safe web codec` };
  if (info.faststart === false) return { action: 'remux', reason: 'moov after mdat, so it cannot start streaming' };
  return { action: 'keep', reason: '' };
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const loops = manifest.loops || [];
console.log(`${manifest.setName || manifestPath}: ${loops.length} entries`);
console.log(apply ? `mode: APPLY (writing to ${outRoot}/, ${jobs} parallel jobs)` : 'mode: dry run — pass --apply to do the work\n');

const work = [];
const missing = [];
const kept = [];

for (const loop of loops) {
  const rel = decodeURIComponent(String(loop.url || ''));
  const file = path.join(process.cwd(), rel);
  let st;
  try { st = await stat(file); } catch { missing.push(loop); continue; }

  const info = await probe(file).catch(() => ({ codec: 'probe failed', width: 0, height: 0 }));
  const ext = path.extname(rel).toLowerCase();
  if (['.mp4', '.mov', '.m4v'].includes(ext)) {
    const boxes = await topLevelBoxes(file, st.size).catch(() => []);
    const moov = boxes.indexOf('moov');
    const mdat = boxes.indexOf('mdat');
    info.faststart = moov !== -1 && (mdat === -1 || moov < mdat);
  }
  const plan = planFor(info);
  if (plan.action === 'keep') { kept.push(loop); continue; }
  work.push({ loop, rel, size: st.size, info, ...plan });
}

const mb = n => Math.round(n / 1024 ** 2);
const gb = n => (n / 1024 ** 3).toFixed(2);
const transcodes = work.filter(w => w.action === 'transcode');
const remuxes = work.filter(w => w.action === 'remux');

console.log(`  already web-ready, left untouched: ${kept.length}`);
console.log(`  remux (lossless, fast — just moves moov to the front): ${remuxes.length}, ${gb(remuxes.reduce((n, w) => n + w.size, 0))} GB`);
console.log(`  transcode (re-encode to h264 ${MAX_HEIGHT}p): ${transcodes.length}, ${gb(transcodes.reduce((n, w) => n + w.size, 0))} GB`);
console.log(`  manifest entries with no file, will be dropped: ${missing.length}`);

if (!apply) {
  const byReason = {};
  for (const w of work) byReason[w.reason] = (byReason[w.reason] || 0) + 1;
  console.log('\n  reasons:');
  for (const [reason, count] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${String(count).padStart(4)}  ${reason}`);
  }
  console.log('\n  largest jobs:');
  for (const w of [...work].sort((a, b) => b.size - a.size).slice(0, 8)) {
    console.log(`     ${String(mb(w.size)).padStart(5)} MB  ${w.action.padEnd(9)} ${w.info.codec} ${w.info.width}x${w.info.height}  ${path.basename(w.rel)}`);
  }
  process.exit(0);
}

function outPathFor(rel) {
  const parsed = path.parse(rel);
  return path.join(outRoot, parsed.dir, parsed.name + '.mp4');
}

async function runJob(w) {
  const out = outPathFor(w.rel);
  await mkdir(path.dirname(out), { recursive: true });
  const tmp = out + '.partial.mp4';
  // -an because every video element in the app is muted; keeping audio only adds bytes.
  const common = ['-y', '-nostdin', '-loglevel', 'error', '-i', w.rel, '-an', '-movflags', '+faststart'];
  const cmd = w.action === 'remux'
    ? [...common, '-c', 'copy', tmp]
    : [...common,
       '-vf', `scale=-2:'min(${MAX_HEIGHT},ih)':flags=lanczos`,
       '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
       '-profile:v', 'high', '-level', '4.1', tmp];
  try {
    await execFileAsync('ffmpeg', cmd, { maxBuffer: 1 << 24 });
    const st = await stat(tmp);
    // Downscaling usually shrinks a file by orders of magnitude, but a long clip in an
    // efficient codec can come out larger — a 6 minute VP9 4K beat this encode. When
    // the source already plays and streams, a bigger replacement is a step backwards,
    // so keep the original and say nothing was gained.
    const sourceAlreadyFine = SAFE_CODECS.test(w.info.codec) && w.info.faststart !== false;
    if (st.size > w.size && sourceAlreadyFine) {
      await unlink(tmp).catch(() => {});
      return { ok: true, keepOriginal: true, size: w.size };
    }
    await rename(tmp, out);
    return { ok: true, out, size: st.size };
  } catch (error) {
    await unlink(tmp).catch(() => {});
    // A remux can fail when the source is not really mp4-shaped; fall back to encoding.
    if (w.action === 'remux') {
      return runJob({ ...w, action: 'transcode', reason: w.reason + ' (copy failed, re-encoded)' });
    }
    return { ok: false, error: String(error.stderr || error.message).slice(0, 200) };
  }
}

const queue = work.slice(0, limit === Infinity ? work.length : limit);
const results = new Map();
let done = 0;
let savedFrom = 0;
let savedTo = 0;

async function worker() {
  while (queue.length) {
    const w = queue.shift();
    const res = await runJob(w);
    done++;
    if (res.keepOriginal) {
      console.log(`  [${done}] kept original, the re-encode came out larger  ${path.basename(w.rel)}`);
    } else if (res.ok) {
      results.set(w.loop, res.out);
      savedFrom += w.size;
      savedTo += res.size;
      console.log(`  [${done}] ${w.action} ${mb(w.size)}MB -> ${mb(res.size)}MB  ${path.basename(w.rel)}`);
    } else {
      console.log(`  [${done}] FAILED ${path.basename(w.rel)}: ${res.error}`);
    }
  }
}

await Promise.all(Array.from({ length: jobs }, worker));

const optimizedLoops = [];
for (const loop of loops) {
  if (missing.includes(loop)) continue;
  const replacement = results.get(loop);
  optimizedLoops.push(replacement
    ? { ...loop, url: replacement.split(path.sep).join('/') }
    : loop);
}

const outManifest = manifestPath.replace(/\.json$/, '-web.json');
writeFileSync(outManifest, JSON.stringify({
  ...manifest,
  setName: (manifest.setName || 'set') + ' (web)',
  count: optimizedLoops.length,
  generatedAt: new Date().toISOString(),
  loops: optimizedLoops
}, null, 2));

console.log(`\n  converted ${results.size} clips: ${gb(savedFrom)} GB -> ${gb(savedTo)} GB`);
console.log(`  dropped ${missing.length} entries with no file`);
console.log(`  wrote ${outManifest} (${optimizedLoops.length} entries)`);
