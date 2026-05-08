import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "@playwright/test";

const PROJECT_ROOT = process.cwd();
const BASE_URL = process.env.CELL_LIBRARY_URL || "https://www.cellimagelibrary.org/home";
const OUTPUT_DIR = path.join(PROJECT_ROOT, process.env.CELL_LIBRARY_OUTPUT_DIR || "assets/cell-image-library/raw");
const MANIFEST_PATH = path.join(PROJECT_ROOT, process.env.CELL_LIBRARY_MANIFEST || "assets/cell-image-library/manifest.json");
const MAX_IMAGES = Math.max(1, Number.parseInt(process.env.CELL_LIBRARY_MAX_IMAGES || "80", 10));
const SCROLL_STEPS = Math.max(1, Number.parseInt(process.env.CELL_LIBRARY_SCROLL_STEPS || "20", 10));
const SCROLL_DELAY_MS = Math.max(100, Number.parseInt(process.env.CELL_LIBRARY_SCROLL_DELAY_MS || "300", 10));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toAbsoluteUrl(candidate, pageUrl) {
  if (!candidate) return null;
  try {
    return new URL(candidate, pageUrl).toString();
  } catch {
    return null;
  }
}

function guessExtensionFromUrl(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  const ext = path.extname(pathname);
  if (ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".webp" || ext === ".gif") {
    return ext === ".jpeg" ? ".jpg" : ext;
  }
  return ".jpg";
}

async function downloadImage(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const mime = response.headers.get("content-type") || "";
  if (!mime.startsWith("image/")) {
    throw new Error(`Not an image: ${mime}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
  return mime;
}

async function collectImageUrls(page) {
  const found = new Set();
  for (let step = 0; step < SCROLL_STEPS; step++) {
    const urls = await page.evaluate(() => {
      const out = [];
      const images = Array.from(document.querySelectorAll("img"));
      for (const img of images) {
        const cands = [img.currentSrc, img.src, img.getAttribute("src"), img.getAttribute("data-src"), img.getAttribute("data-original")];
        for (const c of cands) {
          if (c && typeof c === "string") out.push(c);
        }
      }
      return out;
    });
    const pageUrl = page.url();
    for (const raw of urls) {
      const abs = toAbsoluteUrl(raw, pageUrl);
      if (!abs) continue;
      if (!/^https?:\/\//i.test(abs)) continue;
      if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(abs)) continue;
      found.add(abs);
    }
    if (found.size >= MAX_IMAGES * 2) {
      break;
    }
    await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.9)));
    await page.waitForTimeout(SCROLL_DELAY_MS);
  }
  return Array.from(found);
}

function stableName(url) {
  const digest = crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
  const ext = guessExtensionFromUrl(url);
  return `${digest}${ext}`;
}

async function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(path.dirname(MANIFEST_PATH));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1200 }
  });

  const page = await context.newPage();
  await page.goto(BASE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForTimeout(1200);

  const discoveredUrls = await collectImageUrls(page);
  const picked = discoveredUrls.slice(0, MAX_IMAGES);

  const downloaded = [];
  const failed = [];
  for (const url of picked) {
    const fileName = stableName(url);
    const outputPath = path.join(OUTPUT_DIR, fileName);
    try {
      const mime = await downloadImage(url, outputPath);
      downloaded.push({
        sourceUrl: url,
        localPath: path.relative(PROJECT_ROOT, outputPath),
        mimeType: mime
      });
    } catch (error) {
      failed.push({
        sourceUrl: url,
        error: error?.message || String(error)
      });
    }
  }

  await context.close();
  await browser.close();

  const manifest = {
    sourcePage: BASE_URL,
    generatedAt: new Date().toISOString(),
    totalDiscovered: discoveredUrls.length,
    downloadedCount: downloaded.length,
    failedCount: failed.length,
    items: downloaded,
    failed
  };

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    manifest: path.relative(PROJECT_ROOT, MANIFEST_PATH),
    outputDir: path.relative(PROJECT_ROOT, OUTPUT_DIR),
    downloaded: downloaded.length,
    failed: failed.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
