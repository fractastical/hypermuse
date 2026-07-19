// Scans the media folders and writes video-manifest.json and
// audio-manifest.json at the repo root. The controller fetches them to
// offer every loop as live hypermoon window content / audio deck tracks.
// Rerun after adding clips: npm run manifest:videos
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SCAN_DIRS = ["loops", "artifacts", "assets", "audio", "external", "infinitestreams"];
// Chrome-playable containers only; ProRes .mov etc. would just black-screen.
const VIDEO_EXTS = new Set([".mp4", ".webm", ".m4v", ".ogv"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);

const videos = [], audio = [];
function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    const ext = extname(name).toLowerCase();
    const rel = relative(ROOT, full).split("\\").join("/");
    if (VIDEO_EXTS.has(ext) && st.size > 50_000) videos.push(rel);
    else if (AUDIO_EXTS.has(ext) && st.size > 10_000) audio.push(rel);
  }
}
for (const dir of SCAN_DIRS) walk(join(ROOT, dir));
videos.sort();
audio.sort();

function write(file, key, list) {
  writeFileSync(join(ROOT, file), JSON.stringify({
    generated: new Date().toISOString(),
    count: list.length,
    [key]: list
  }, null, 1));
  console.log(`${file}: ${list.length} ${key} from ${SCAN_DIRS.join(", ")}`);
}
write("video-manifest.json", "videos", videos);
write("audio-manifest.json", "audio", audio);
