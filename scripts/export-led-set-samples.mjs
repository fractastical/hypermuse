import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

const PROJECT_ROOT = process.cwd();
const ARTIFACTS_SAMPLES = path.join(PROJECT_ROOT, "artifacts", "led-samples");
const CAPTURE_MS = String(process.env.CAPTURE_MS || process.env.LED_SAMPLE_CAPTURE_MS || "180000");
const PORT = Number.parseInt(process.env.SAMPLE_SERVER_PORT || process.env.SERVER_PORT || "8080", 10);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function waitForServer(url, timeoutMs = 25000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1500, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function startHttpServer(port) {
  return spawn("npx", ["http-server", "-c-1", "-p", String(port), "."], {
    cwd: PROJECT_ROOT,
    stdio: "ignore"
  });
}

function runSampleExport(label, envExtra) {
  console.log(`\n[led-samples] Starting: ${label}`);
  const env = {
    ...process.env,
    CAPTURE_MS,
    SAMPLE_SERVER_PORT: String(PORT),
    SERVER_PORT: String(PORT),
    EXPORT_VIDEO_REEL: "1",
    ...envExtra
  };
  const result = spawnSync("node", ["scripts/generate-sample-video.mjs"], {
    cwd: PROJECT_ROOT,
    env,
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`Export failed: ${label} (exit ${result.status})`);
  }
}

async function main() {
  ensureDir(ARTIFACTS_SAMPLES);

  const baseUrl = `http://127.0.0.1:${PORT}/sonicsphere.html`;
  let server = null;
  const serverUp = await waitForServer(baseUrl, 2000);
  if (serverUp) {
    console.log(`[led-samples] Using existing HTTP server on port ${PORT}`);
  } else {
    console.log(`[led-samples] Starting http-server on port ${PORT} …`);
    server = startHttpServer(PORT);
    const ready = await waitForServer(baseUrl, 30000);
    if (!ready) {
      if (server && !server.killed) server.kill("SIGTERM");
      throw new Error(
        `Could not reach ${baseUrl}. Start the app with: npm start (or free port ${PORT}).`
      );
    }
  }

  try {
    runSampleExport("LED main bar 16:9 (1920×1080 MP4)", {
      EXPORT_PROFILE: "led_main_bar",
      OUTPUT_VIDEO: path.join("artifacts", "led-samples", "sample-main-bar-16x9.mp4")
    });
    runSampleExport("LED DJ screen 13:9 (1872×1296 MP4)", {
      EXPORT_PROFILE: "led_dj",
      OUTPUT_VIDEO: path.join("artifacts", "led-samples", "sample-dj-screen-13x9.mp4")
    });
  } finally {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  }

  const outMain = path.join(ARTIFACTS_SAMPLES, "sample-main-bar-16x9.mp4");
  const outDj = path.join(ARTIFACTS_SAMPLES, "sample-dj-screen-13x9.mp4");
  console.log("\n[led-samples] Done.");
  console.log(JSON.stringify({
    captureMs: Number.parseInt(CAPTURE_MS, 10),
    outputs: [
      path.relative(PROJECT_ROOT, outMain),
      path.relative(PROJECT_ROOT, outDj)
    ],
    hint: "Use these paths in set manifests (url field). Re-run with CAPTURE_MS=300000 for 5 min clips."
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
