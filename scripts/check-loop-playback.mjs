#!/usr/bin/env node
// Reports what will make a set's clips slow to start in a browser.
//
// Two things dominate. An mp4 whose moov atom sits after mdat cannot be played
// progressively: the browser has to fetch the entire file before the first frame,
// so a 400 MB clip is a 400 MB download during the fade. And a codec Chrome cannot
// decode at all (ProRes, most notably) simply never appears.
//
// The atom order is read directly rather than through ffprobe, because walking the
// top-level boxes is a handful of seeks per file and ffprobe on hundreds of clips is
// slow enough that it looks hung.

import { open, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const manifestPath = process.argv[2] || 'sets/set-live-default-all-loops.json';
const root = process.cwd();

/** Top-level box types in order, for containers that use them. */
async function readTopLevelBoxes(file, size) {
  const handle = await open(file, 'r');
  try {
    const boxes = [];
    let offset = 0;
    const header = Buffer.alloc(16);
    while (offset < size && boxes.length < 24) {
      const { bytesRead } = await handle.read(header, 0, 16, offset);
      if (bytesRead < 8) break;
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      let headerLength = 8;
      if (boxSize === 1) { // 64-bit extended size
        boxSize = Number(header.readBigUInt64BE(8));
        headerLength = 16;
      } else if (boxSize === 0) {
        boxSize = size - offset; // box runs to end of file
      }
      if (boxSize < headerLength) break;
      boxes.push(type);
      offset += boxSize;
    }
    return boxes;
  } finally {
    await handle.close();
  }
}

async function probe(file) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt',
    '-of', 'json', file
  ], { maxBuffer: 1 << 22 });
  const s = JSON.parse(stdout).streams?.[0] || {};
  return { codec: s.codec_name || '?', width: s.width || 0, height: s.height || 0, pixFmt: s.pix_fmt || '?' };
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const loops = manifest.loops || [];
console.log(`set: ${manifest.setName || manifestPath} — ${loops.length} entries\n`);

const missing = [];
const rows = [];

for (const loop of loops) {
  const rel = decodeURIComponent(String(loop.url || ''));
  const file = path.join(root, rel);
  let info;
  try { info = await stat(file); } catch { missing.push(rel); continue; }

  const ext = path.extname(rel).toLowerCase();
  let faststart = null; // null = not an mp4-family container, so not applicable
  if (ext === '.mp4' || ext === '.mov' || ext === '.m4v') {
    try {
      const boxes = await readTopLevelBoxes(file, info.size);
      const moov = boxes.indexOf('moov');
      const mdat = boxes.indexOf('mdat');
      faststart = moov !== -1 && (mdat === -1 || moov < mdat);
    } catch { faststart = null; }
  }
  rows.push({ rel, size: info.size, ext, faststart });
}

// Probe only what matters: anything that cannot stream, plus anything big enough to
// hurt even when it can. Probing all 472 is what made this feel like a hang before.
const needsProbe = rows.filter(r => r.faststart === false || r.size > 200 * 1024 * 1024);
for (const row of needsProbe) {
  try { Object.assign(row, await probe(path.join(root, row.rel))); } catch { row.codec = 'probe failed'; }
}

const gb = n => (n / 1024 ** 3).toFixed(2) + ' GB';
const mb = n => Math.round(n / 1024 ** 2) + ' MB';
const total = rows.reduce((n, r) => n + r.size, 0);
const slow = rows.filter(r => r.faststart === false);
const slowBytes = slow.reduce((n, r) => n + r.size, 0);

console.log(`present: ${rows.length}   missing (404 on load): ${missing.length}`);
console.log(`total on disk: ${gb(total)}`);
console.log(`\nNOT faststart (browser must download the whole file first): ${slow.length} clips, ${gb(slowBytes)}`);
console.log(`faststart (streams progressively): ${rows.filter(r => r.faststart === true).length}`);
console.log(`other containers (webm etc, not applicable): ${rows.filter(r => r.faststart === null).length}`);

const undecodable = rows.filter(r => r.codec && /prores|dnxhd|mjpeg|rawvideo/i.test(r.codec));
if (undecodable.length) {
  console.log(`\nCodecs Chrome cannot decode — these never show a frame: ${undecodable.length}`);
  for (const r of undecodable.slice(0, 12)) {
    console.log(`   ${mb(r.size).padStart(7)}  ${r.codec} ${r.width}x${r.height} ${r.pixFmt}  ${r.rel}`);
  }
}

const huge = rows.filter(r => r.height >= 2160).sort((a, b) => b.size - a.size);
if (huge.length) {
  console.log(`\n4K or larger: ${huge.length}`);
  for (const r of huge.slice(0, 10)) {
    console.log(`   ${mb(r.size).padStart(7)}  ${r.codec} ${r.width}x${r.height}  ${r.rel}`);
  }
}

console.log('\nWorst offenders by size among the non-faststart clips:');
for (const r of slow.sort((a, b) => b.size - a.size).slice(0, 12)) {
  console.log(`   ${mb(r.size).padStart(7)}  ${r.codec || '?'} ${r.width || '?'}x${r.height || '?'}  ${r.rel}`);
}

if (missing.length) {
  console.log(`\nMissing files (${missing.length}) — each is a failed request mid-set:`);
  for (const m of missing.slice(0, 10)) console.log(`   ${m}`);
  if (missing.length > 10) console.log(`   ... and ${missing.length - 10} more`);
}
