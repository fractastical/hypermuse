import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const PROJECT_ROOT = process.cwd();
const bgPath = path.join(PROJECT_ROOT, process.env.WORDCLOUD_BG_VIDEO || "artifacts/set-cells1-main-16x9.mp4");
const logoPath = path.join(PROJECT_ROOT, process.env.WORDCLOUD_LOGO || "assets/synbiobeta-logo.png");
const outputPath = path.join(PROJECT_ROOT, process.env.WORDCLOUD_OUTPUT || "artifacts/synbiobeta-wordcloud-cells1.mp4");

if (!ffmpegPath) throw new Error("ffmpeg-static binary not available");

const width = Number.parseInt(process.env.WORDCLOUD_WIDTH || "1920", 10);
const height = Number.parseInt(process.env.WORDCLOUD_HEIGHT || "1080", 10);
const fps = Number.parseInt(process.env.WORDCLOUD_FPS || "30", 10);
const duration = Math.max(15, Number.parseInt(process.env.WORDCLOUD_DURATION_SEC || "60", 10));
const seg = duration / 3;

const setA = [
  "Synthetic Biology",
  "Genetic Circuits",
  "Biomanufacturing",
  "Cell Programming",
  "CRISPR",
  "Bio Design",
  "Computational Biology",
  "Engineered Cells",
  "DNA Tools",
  "Metabolic Pathways",
  "Protein Design",
  "Biotech Futures"
];
const setB = [
  "Bioelectric Code",
  "Morphogenesis",
  "Pattern Memory",
  "Collective Intelligence",
  "Gap Junctions",
  "Ion Channels",
  "Vmem",
  "Anatomical Homeostasis",
  "Basal Cognition",
  "Morphospace",
  "Electroceuticals",
  "Regeneration"
];
const setC = [
  "Systems Biology",
  "Dynamic Spatial Models",
  "Future of Biology",
  "Gene Regulatory Networks",
  "Pattern Formation",
  "Planarian Regeneration",
  "Synthetic Morphology",
  "Automated Model Discovery",
  "In Silico Experiments",
  "Machine Learning Inference",
  "Universal Embeddings",
  "Biological Relativity"
];

function drawWord(text, idx, start, end, color, size) {
  const baseAmpX = 230 + (idx % 5) * 52;
  const baseAmpY = 120 + (idx % 4) * 38;
  const offsetX = ((idx % 4) - 1.5) * 185;
  const offsetY = (Math.floor(idx / 4) - 1) * 125;
  const xExpr = `(w-text_w)/2+${offsetX}+${baseAmpX}*cos((t+${idx})/${6 + (idx % 6)})`;
  const yExpr = `(h-text_h)/2+${offsetY}+${baseAmpY}*sin((t+${idx})/${5 + (idx % 5)})`;
  return `drawtext=text='${text.replace(/:/g, "\\:")}':fontcolor=${color}:fontsize=${size}:x=${xExpr}:y=${yExpr}:shadowcolor=black@0.6:shadowx=2:shadowy=2:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`;
}

const colors = ["0x9efcce", "0xfff184", "0x96c7ff", "0xff9ad1", "0xbdfc9e", "0xd2b4ff", "0xffd2a3", "0x90fff2"];

function drawSet(chainIn, setWords, start, end, chainPrefix) {
  const lines = [];
  let current = chainIn;
  for (let i = 0; i < setWords.length; i++) {
    const next = `${chainPrefix}${i + 1}`;
    const fontSize = i < 3 ? 48 : (i < 8 ? 40 : 34);
    lines.push(`[${current}]${drawWord(setWords[i], i, start, end, colors[i % colors.length], fontSize)}[${next}]`);
    current = next;
  }
  return { lines, out: current };
}

const filters = [
  `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps}[bg]`,
  "[1:v]scale=560:-1,format=rgba,colorchannelmixer=aa=0.94[logo]",
  "[bg][logo]overlay=(W-w)/2:(H-h)/2[base]"
];

const first = drawSet("base", setA, 0, seg, "a");
const second = drawSet(first.out, setB, seg, 2 * seg, "b");
const third = drawSet(second.out, setC, 2 * seg, duration, "c");
const filterComplex = filters
  .concat(first.lines, second.lines, third.lines, [`[${third.out}]format=yuv420p[vout]`])
  .join(";");

const args = [
  "-y",
  "-stream_loop", "-1",
  "-i", bgPath,
  "-loop", "1",
  "-i", logoPath,
  "-filter_complex", filterComplex,
  "-map", "[vout]",
  "-map", "0:a?",
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "20",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  "-b:a", "192k",
  "-movflags", "+faststart",
  "-t", String(duration),
  outputPath
];

const result = spawnSync(ffmpegPath, args, { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status || 1);
console.log(`\n[wordcloud] Wrote: ${outputPath}`);
