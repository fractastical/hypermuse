import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const DATASET_PATH = path.join(PROJECT_ROOT, process.env.COLOR_DATASET_INPUT || "artifacts/color-dataset.json");
const OUTPUT_PATH = path.join(PROJECT_ROOT, process.env.COLOR_THEME_OUTPUT || "sets/color-theme-set.json");
const TAG_QUERY = String(process.env.COLOR_THEME_TAGS || "red").trim().toLowerCase();
const MIN_RATIO = Math.max(0, Math.min(1, Number.parseFloat(process.env.COLOR_THEME_MIN_RATIO || "0.15")));
const MAX_ITEMS = Math.max(1, Number.parseInt(process.env.COLOR_THEME_MAX_ITEMS || "120", 10));
const INCLUDE_EFFECTS = process.env.COLOR_THEME_INCLUDE_EFFECTS !== "0";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseWantedFamilies(raw) {
  return raw
    .split(/[,+\s]+/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function hasFamily(item, family) {
  return (item.topFamilies || []).some((entry) => entry.name === family && Number(entry.ratio || 0) >= MIN_RATIO);
}

function scoreItem(item, families) {
  let score = 0;
  for (const family of families) {
    const hit = (item.topFamilies || []).find((entry) => entry.name === family);
    if (hit) score += Number(hit.ratio || 0);
  }
  return score;
}

function main() {
  if (!fs.existsSync(DATASET_PATH)) {
    throw new Error(`Dataset not found: ${DATASET_PATH}`);
  }
  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, "utf8"));
  const wantedFamilies = parseWantedFamilies(TAG_QUERY);
  const items = Array.isArray(dataset.items) ? dataset.items : [];
  const filtered = items
    .filter((item) => {
      if (!INCLUDE_EFFECTS && item.type === "effect") return false;
      if (!wantedFamilies.every((family) => hasFamily(item, family))) return false;
      return item.type === "video" || item.type === "effect";
    })
    .map((item) => ({
      ...item,
      _score: scoreItem(item, wantedFamilies)
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, MAX_ITEMS);

  const videoEntries = filtered
    .filter((item) => item.type === "video" && item.path)
    .map((item) => ({
      url: item.path,
      label: `${item.tags?.join("/") || "theme"}`
    }));

  const result = {
    generatedAt: new Date().toISOString(),
    query: {
      tags: wantedFamilies,
      minRatio: MIN_RATIO,
      maxItems: MAX_ITEMS,
      includeEffects: INCLUDE_EFFECTS
    },
    counts: {
      matched: filtered.length,
      videos: filtered.filter((i) => i.type === "video").length,
      effects: filtered.filter((i) => i.type === "effect").length
    },
    matchedEffects: filtered
      .filter((item) => item.type === "effect")
      .map((item) => ({
        id: item.id,
        effect: item.effect,
        layout: item.layout,
        topFamilies: item.topFamilies
      })),
    entries: videoEntries
  };

  ensureDir(path.dirname(OUTPUT_PATH));
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    output: path.relative(PROJECT_ROOT, OUTPUT_PATH),
    query: result.query,
    counts: result.counts
  }, null, 2));
}

main();
