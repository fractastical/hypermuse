#!/usr/bin/env node
/** Moon-only color cubes → artifacts/moon-cube-index.json */
import { spawnSync } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const script = path.join(PROJECT_ROOT, "scripts/build-color-cube-index.mjs");

const result = spawnSync(
  process.execPath,
  [script],
  {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      COLOR_CUBE_LOOPS_DIR: "loops/Moon and Astronauts",
      COLOR_CUBE_INDEX: "moon-cube-index.json",
      COLOR_CUBE_MAX_PER_FAMILY: process.env.COLOR_CUBE_MAX_PER_FAMILY || "80",
      COLOR_CUBE_MAX_VIDEOS: process.env.COLOR_CUBE_MAX_VIDEOS || "0"
    }
  }
);

process.exit(result.status ?? 1);
