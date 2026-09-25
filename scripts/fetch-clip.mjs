// Samples a video from anywhere yt-dlp can reach and cuts it down to something
// that can sit in the moon circle. scripts/fetch-xfeeefeee.mjs does the same
// job for one site that publishes its own release files; this one takes a URL.
//
// The sources live in assets/clips/sources.json rather than in this file. The
// media is far too big for git, so a list of where each clip came from is the
// only thing a fresh clone can be handed, and one run rebuilds the lot from it.
//
//   node scripts/fetch-clip.mjs                        # everything listed
//   node scripts/fetch-clip.mjs pranava                # one entry by name
//   node scripts/fetch-clip.mjs --url URL --name thing # record a source, fetch it
//   SIZE=1080 FORCE=1 node scripts/fetch-clip.mjs      # bigger, re-cut
//   REFETCH=1 node scripts/fetch-clip.mjs pranava      # pull the master again
//
// Masters are kept in assets/clips/masters so a re-cut does not re-download
// them; only the square clips and segments are what the show actually plays.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const OUT = "assets/clips";
const MASTERS = `${OUT}/masters`;
const CIRCLE = `${OUT}/circle`;
const SEGMENTS = `${OUT}/segments`;
const SPEC = `${OUT}/sources.json`;
const SIZE = Number.parseInt(process.env.SIZE || "720", 10);
const CRF = process.env.CRF || "26";
// Masters get pulled at 1440p like the xfeeefeee ones: the circle is a few
// hundred pixels across, but a generous master leaves room to re-cut bigger.
const HEIGHT = Number.parseInt(process.env.HEIGHT || "1440", 10);
const FORCE = process.env.FORCE === "1";
const REFETCH = process.env.REFETCH === "1";

// --key value pairs are options, anything bare is the name of a source to run.
const argv = process.argv.slice(2);
const opts = {};
const names = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) opts[argv[i].slice(2)] = argv[++i] || "";
  else names.push(argv[i]);
}
const opt = (name) => opts[name] || "";

if (!spawnSync("yt-dlp", ["--version"], { encoding: "utf8" }).stdout) {
  console.error("yt-dlp is not on PATH — brew install yt-dlp");
  process.exit(1);
}

const spec = existsSync(SPEC)
  ? JSON.parse(readFileSync(SPEC, "utf8"))
  : { note: "Videos sampled from the open web for the moon circle.", sources: [] };

// --url adds a source to the list before the run, so the fetch and the record
// of where it came from can never drift apart.
const addUrl = opt("url");
if (addUrl) {
  const name = opt("name");
  if (!name) {
    console.error("--url needs --name too: the name is the clip's file name");
    process.exit(1);
  }
  const existing = spec.sources.find((s) => s.name === name);
  if (existing) existing.url = addUrl;
  else spec.sources.push({ name, url: addUrl, title: opt("title") || "", note: "", segments: [] });
  writeFileSync(SPEC, JSON.stringify(spec, null, 2) + "\n");
  console.log(`recorded ${name} -> ${addUrl}`);
  names.push(name);
}

const wanted = names.length ? spec.sources.filter((s) => names.includes(s.name)) : spec.sources;
if (!wanted.length) {
  console.error(names.length ? `no source named ${names.join(", ")} in ${SPEC}` : `${SPEC} lists no sources`);
  process.exit(1);
}

for (const dir of [MASTERS, CIRCLE, SEGMENTS]) mkdirSync(dir, { recursive: true });

const mb = (n) => (n > 1 << 30 ? (n / (1 << 30)).toFixed(1) + " GB" : Math.round(n / (1 << 20)) + " MB");
const master = (name) => {
  const hit = readdirSync(MASTERS).find((f) => f.replace(/\.[^.]+$/, "") === name);
  return hit ? path.join(MASTERS, hit) : "";
};

const clips = [];
const cuts = [];

for (const src of wanted) {
  console.log(`\n${src.name}${src.title ? `  (${src.title})` : ""}`);

  // FORCE re-encodes; it deliberately does not re-download, since a master is
  // hundreds of megabytes and the reason to force is almost always the cut.
  let have = master(src.name);
  if (have && !REFETCH) {
    console.log(`  have   ${path.basename(have)} (${mb(statSync(have).size)})`);
  } else {
    // Video only: the backdrop plays muted, so pulling the audio track would
    // double the download for something the show throws away.
    console.log(`  fetch  ${src.url}`);
    const r = spawnSync("yt-dlp", [
      "--no-playlist", "--no-warnings", "--no-progress",
      "-f", `bv*[height<=${HEIGHT}]/b[height<=${HEIGHT}]/bv*/b`,
      "--remux-video", "mp4",
      "-o", path.join(MASTERS, `${src.name}.%(ext)s`),
      src.url
    ], { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) {
      console.error(`  download failed, skipping ${src.name}`);
      continue;
    }
    have = master(src.name);
    if (!have) {
      console.error(`  nothing landed in ${MASTERS}, skipping ${src.name}`);
      continue;
    }
    console.log(`  got    ${path.basename(have)} (${mb(statSync(have).size)})`);
  }

  // Square centre crop to the short edge, then down to SIZE. The moon circle
  // is inscribed in this square, so nothing outside it was ever going to show.
  const circle = `${CIRCLE}/${src.name}.mp4`;
  if (existsSync(circle) && !FORCE) {
    console.log(`  square already cut (FORCE=1 to redo)`);
  } else {
    execFileSync(ffmpegPath, [
      "-nostdin", "-v", "error", "-y", "-i", have,
      "-vf", `crop='min(iw,ih)':'min(iw,ih)',scale=${SIZE}:${SIZE}:flags=lanczos`,
      "-an",
      "-c:v", "libx264", "-crf", CRF, "-preset", "slow",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      circle
    ]);
    console.log(`  square ${circle}  ${mb(statSync(circle).size)}`);
  }
  clips.push({ name: src.name, src: circle, from: src.url, note: src.note || "" });

  // Stretches worth playing on their own, cut out of the square clip so a good
  // twenty seconds can take a backdrop slot instead of waiting for it to come
  // round inside nine minutes. Re-encoded, not copied: a stream copy can only
  // start on a keyframe and these have long GOPs.
  for (const seg of src.segments || []) {
    const dur = +(seg.out - seg.in).toFixed(3);
    const out = `${SEGMENTS}/${seg.name}.mp4`;
    if (dur <= 0) {
      console.error(`  ${seg.name}: out (${seg.out}) is not after in (${seg.in}), skipping`);
      continue;
    }
    if (existsSync(out) && !FORCE) {
      console.log(`  ${seg.name}: already cut (FORCE=1 to redo)`);
      cuts.push({ ...seg, out, seconds: dur, parent: src.name });
      continue;
    }
    execFileSync(ffmpegPath, [
      "-nostdin", "-v", "error", "-y",
      "-ss", String(seg.in), "-i", circle,
      "-t", String(dur), "-an",
      "-c:v", "libx264", "-crf", "18", "-preset", "slow",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      out
    ]);
    console.log(`  ${seg.name}: ${seg.in}s..${seg.out}s (${dur}s) -> ${out}  ${Math.round(statSync(out).size / 1024)} KB`);
    cuts.push({ ...seg, out, seconds: dur, parent: src.name });
  }
}

if (clips.length) {
  writeFileSync(`${CIRCLE}/manifest.json`, JSON.stringify({
    note: spec.note,
    clips: clips.map((c) => ({ name: c.name, src: c.src, from: c.from, note: c.note }))
  }, null, 2) + "\n");
}
if (cuts.length) {
  writeFileSync(`${SEGMENTS}/manifest.json`, JSON.stringify({
    note: "Stretches cut out of the square clips in assets/clips/circle.",
    segments: cuts.map((s) => ({
      name: s.name, src: s.out, seconds: s.seconds,
      from: `${s.parent} @ ${s.in}s`, note: s.note
    }))
  }, null, 2) + "\n");
}

console.log(`\n${clips.length} clip(s), ${cuts.length} segment(s). Backdrop list:\n  ` +
  [...clips.map((c) => c.src), ...cuts.map((s) => s.out)].join(","));
