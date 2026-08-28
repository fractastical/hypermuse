// Cut the stretches listed in assets/xfeeefeee/segments.json out of the
// square clips, so a good fifteen seconds can be put on the moon by itself
// instead of waiting four minutes to come round inside its parent clip.
//
// The cuts are re-encoded rather than stream-copied: a copy can only start on
// a keyframe, and these clips are encoded with long GOPs, so a copy would
// either slip seconds off the mark or open on a smear of grey macroblocks.
// They are also short, so the encode costs nothing worth saving.
//
//   node scripts/cut-xfeeefeee-segments.mjs          # cut what is missing
//   FORCE=1 node scripts/cut-xfeeefeee-segments.mjs  # re-cut everything
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import ffmpegPath from "ffmpeg-static";

const SRC_DIR = "assets/xfeeefeee/circle";
const OUT_DIR = "assets/xfeeefeee/segments";
const SPEC = "assets/xfeeefeee/segments.json";
const FORCE = process.env.FORCE === "1";

const spec = JSON.parse(readFileSync(SPEC, "utf8"));
mkdirSync(OUT_DIR, { recursive: true });

const made = [];
for (const seg of spec.segments) {
  const src = `${SRC_DIR}/${seg.src}.mp4`;
  const out = `${OUT_DIR}/${seg.name}.mp4`;
  const dur = +(seg.out - seg.in).toFixed(3);
  if (!existsSync(src)) {
    console.error(`  missing source, skipping: ${src}`);
    continue;
  }
  if (dur <= 0) {
    console.error(`  ${seg.name}: out (${seg.out}) is not after in (${seg.in}), skipping`);
    continue;
  }
  if (existsSync(out) && !FORCE) {
    console.log(`  ${seg.name}: already cut (FORCE=1 to redo)`);
    made.push({ ...seg, out, seconds: dur });
    continue;
  }
  // -ss ahead of -i seeks cheaply, and the decoder still re-encodes from the
  // exact frame because the seek is followed by a full decode of the range.
  execFileSync(ffmpegPath, [
    "-nostdin", "-v", "error", "-y",
    "-ss", String(seg.in), "-i", src,
    "-t", String(dur),
    "-an",                              // these carry no audio anyway
    "-c:v", "libx264", "-crf", "18", "-preset", "slow",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    out
  ]);
  const kb = Math.round(statSync(out).size / 1024);
  console.log(`  ${seg.name}: ${seg.in}s..${seg.out}s (${dur}s) -> ${out}  ${kb} KB`);
  made.push({ ...seg, out, seconds: dur });
}

writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify({
  note: spec.note,
  segments: made.map((s) => ({
    name: s.name,
    src: s.out,
    seconds: s.seconds,
    from: `${s.src} @ ${s.in}s`,
    note: s.note
  }))
}, null, 2) + "\n");

console.log(`\n${made.length} segment(s). Backdrop list:\n  ` +
  made.map((s) => s.out).join(","));
