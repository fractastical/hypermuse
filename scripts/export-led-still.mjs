import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { resolveLedExportSize } from "./led-screen-presets.mjs";

const PROJECT_ROOT = process.cwd();
const SERVER_PORT = Number.parseInt(process.env.SAMPLE_SERVER_PORT || process.env.SERVER_PORT || "8080", 10);

async function main() {
  const size = resolveLedExportSize();
  const defaultName = `led-still-${size.profile}.png`;
  const outRaw = process.env.OUTPUT_STILL || path.join("artifacts", defaultName);
  const outputPath = path.isAbsolute(outRaw) ? outRaw : path.join(PROJECT_ROOT, outRaw);
  ensureDir(path.dirname(outputPath));

  const ext = path.extname(outputPath).toLowerCase();
  const type = ext === ".jpg" || ext === ".jpeg" ? "jpeg" : "png";

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height }
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${SERVER_PORT}/sonicsphere.html?demo=1&hideoverlay=1`, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });
    await page.waitForTimeout(Number.parseInt(process.env.STILL_DELAY_MS || "4000", 10));
    await page.screenshot({
      path: outputPath,
      type,
      quality: type === "jpeg" ? 92 : undefined,
      fullPage: false
    });
    await context.close();
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    outputStill: path.relative(PROJECT_ROOT, outputPath),
    width: size.width,
    height: size.height,
    profile: size.profile,
    hint: `Requires http-server (e.g. npm start) on :${SERVER_PORT} or set SERVER_PORT.`
  }, null, 2));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
