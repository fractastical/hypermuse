import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const PROJECT_ROOT = process.cwd();
const logoPath = path.join(PROJECT_ROOT, "assets", "synbiobeta-logo.png");
const outputPath = path.join(PROJECT_ROOT, "artifacts", "synbiobeta-wordcloud.mp4");

if (!ffmpegPath) {
  throw new Error("ffmpeg-static binary not available");
}

const width = Number.parseInt(process.env.WORDCLOUD_WIDTH || "1920", 10);
const height = Number.parseInt(process.env.WORDCLOUD_HEIGHT || "1080", 10);
const fps = Number.parseInt(process.env.WORDCLOUD_FPS || "30", 10);
const duration = Number.parseInt(process.env.WORDCLOUD_DURATION_SEC || "60", 10);

const filter = [
  "[1:v]scale=560:-1[logo]",
  "[0:v][logo]overlay=(W-w)/2:(H-h)/2[bg]",
  "[bg]drawtext=text='Synthetic Biology':fontcolor=0x9efcce:fontsize=52:x=(w-text_w)/2+260*cos(t/7):y=(h-text_h)/2-250+34*sin(t/4):shadowcolor=black@0.55:shadowx=2:shadowy=2[b1]",
  "[b1]drawtext=text='Genetic Circuits':fontcolor=0xfff184:fontsize=44:x=(w-text_w)/2-360+42*sin(t/5):y=(h-text_h)/2-130+30*cos(t/6)[b2]",
  "[b2]drawtext=text='Cell Programming':fontcolor=0x96c7ff:fontsize=42:x=(w-text_w)/2+300*cos(t/6):y=(h-text_h)/2+120+34*sin(t/7)[b3]",
  "[b3]drawtext=text='CRISPR':fontcolor=0xff9ad1:fontsize=48:x=(w-text_w)/2-280+55*cos(t/8):y=(h-text_h)/2+230+22*sin(t/5)[b4]",
  "[b4]drawtext=text='Biomanufacturing':fontcolor=0xbdfc9e:fontsize=40:x=(w-text_w)/2+390*sin(t/9):y=(h-text_h)/2-30+46*cos(t/8)[b5]",
  "[b5]drawtext=text='Bio Design':fontcolor=0xd2b4ff:fontsize=38:x=(w-text_w)/2-130+33*sin(t/4):y=(h-text_h)/2-330+16*cos(t/7)[b6]",
  "[b6]drawtext=text='Future of Biology':fontcolor=0x90fff2:fontsize=36:x=(w-text_w)/2+110+40*cos(t/10):y=(h-text_h)/2+315+18*sin(t/6)"
].join(";");

const args = [
  "-y",
  "-f", "lavfi",
  "-i", `color=c=0x0d1022:s=${width}x${height}:r=${fps}:d=${duration}`,
  "-loop", "1",
  "-i", logoPath,
  "-filter_complex", filter,
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "20",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  "-t", String(duration),
  outputPath
];

const result = spawnSync(ffmpegPath, args, { stdio: "inherit" });
if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`\n[wordcloud] Wrote: ${outputPath}`);
