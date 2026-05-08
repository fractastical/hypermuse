import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

const PROJECT_ROOT = process.cwd();
const OUT_DIR = path.join(PROJECT_ROOT, "artifacts", "set-exports");
const CAPTURE_MS = String(process.env.SET_EXPORT_CAPTURE_MS || process.env.CAPTURE_MS || "180000");
const PORT = Number.parseInt(process.env.SAMPLE_SERVER_PORT || process.env.SERVER_PORT || "8080", 10);
const EXPORT_DJ = process.env.SET_EXPORT_DJ !== "0";

const DEFAULT_MANIFESTS = [
  "sets/set-infinitestreams-journey.json",
  "sets/set-color-red-diffusion-roundtrip.json",
  "sets/set-color-purple-teal-arc.json",
  "sets/set-color-warm-spectrum.json",
  "sets/set-color-forest-cyan.json",
  "sets/set-color-monochrome-film.json",
  "sets/set-sample-morpholib-clarafi.json",
  "sets/set-sample-reactions-lab.json"
];

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

function runExport(label, envExtra) {
  console.log(`\n[set-export] ${label}`);
  const env = {
    ...process.env,
    CAPTURE_MS,
    SAMPLE_SERVER_PORT: String(PORT),
    SERVER_PORT: String(PORT),
    AUTO_BUILD_SET_MANIFEST: "0",
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
    throw new Error(`Export failed (${label}) exit ${result.status}`);
  }
}

async function main() {
  const rawList = process.env.SET_MANIFESTS || DEFAULT_MANIFESTS.join(",");
  const manifests = rawList.split(",").map((s) => s.trim()).filter(Boolean);

  ensureDir(OUT_DIR);

  const baseUrl = `http://127.0.0.1:${PORT}/sonicsphere.html`;
  let server = null;
  const serverUp = await waitForServer(baseUrl, 2000);
  if (serverUp) {
    console.log(`[set-export] Using HTTP server on port ${PORT}`);
  } else {
    console.log(`[set-export] Starting http-server on ${PORT} …`);
    server = startHttpServer(PORT);
    const ready = await waitForServer(baseUrl, 30000);
    if (!ready) {
      if (server && !server.killed) server.kill("SIGTERM");
      throw new Error(`Could not reach ${baseUrl}. Run npm start first or free port ${PORT}.`);
    }
  }

  const written = [];

  try {
    for (const manifest of manifests) {
      const resolved = path.isAbsolute(manifest) ? manifest : path.join(PROJECT_ROOT, manifest);
      if (!fs.existsSync(resolved)) {
        console.warn(`[set-export] Skip missing manifest: ${manifest}`);
        continue;
      }
      const relManifest = path.relative(PROJECT_ROOT, resolved).split(path.sep).join("/");
      const slug = path.basename(resolved, ".json");

      runExport(`${slug} — LED main bar 16:9`, {
        VJ_SET_MANIFEST: relManifest,
        OUTPUT_VIDEO: path.join("artifacts", "set-exports", `${slug}-main-16x9.mp4`),
        EXPORT_PROFILE: "led_main_bar"
      });
      written.push(`${slug}-main-16x9.mp4`);

      if (EXPORT_DJ) {
        runExport(`${slug} — LED DJ 13:9`, {
          VJ_SET_MANIFEST: relManifest,
          OUTPUT_VIDEO: path.join("artifacts", "set-exports", `${slug}-dj-13x9.mp4`),
          EXPORT_PROFILE: "led_dj"
        });
        written.push(`${slug}-dj-13x9.mp4`);
      }
    }
  } finally {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
  }

  console.log("\n[set-export] Finished.");
  console.log(JSON.stringify({
    captureMs: Number.parseInt(CAPTURE_MS, 10),
    outputDir: path.relative(PROJECT_ROOT, OUT_DIR),
    files: written,
    hint: "Disable DJ resolution with SET_EXPORT_DJ=0. Longer clips: SET_EXPORT_CAPTURE_MS=300000."
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
