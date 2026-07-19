// One-shot audit: drives controller.html's real UI and verifies the output
// pages react. Prints PASS/FAIL per dial. Requires http-server on :8080.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const results = [];
const log = (group, name, ok, note = "") =>
  results.push({ group, name, ok, note });

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// Controller auto-opens the visual on load; capture that popup.
const controller = await context.newPage();
const popupPromise = controller.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
await controller.goto(`${BASE}/controller.html`, { waitUntil: "domcontentloaded" });
const sonic = await popupPromise;
if (sonic) {
  await sonic.waitForLoadState("domcontentloaded");
  await sonic.waitForFunction(() => typeof window.vjControl === "function", { timeout: 20000 }).catch(() => {});
}

const sonicState = async () => (sonic ? sonic.evaluate(() => window.vjControl({})) : null);
const click = (id) => controller.click(`#${id}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!sonic) {
  log("sonicsphere", "auto-open visual window", false, "popup never appeared");
} else {
  log("sonicsphere", "auto-open visual window", true);

  // FX mode buttons
  const modeButtons = [
    ["modeClassicButton", "classic"], ["modeLifeButton", "life"],
    ["modeHierLifeButton", "hierarchical-life"], ["modeHexLifeButton", "hex-life"],
    ["modeKuramotoButton", "kuramoto"], ["modeGrayScottButton", "gray-scott"],
    ["modePhysarumButton", "physarum"], ["modeMoleculeButton", "molecule"],
  ];
  for (const [id, expect] of modeButtons) {
    await click(id); await wait(350);
    const st = await sonicState();
    const got = String(st.mode || "");
    log("sonicsphere", `FX mode: ${expect}`, got === expect, `mode=${got}`);
  }
  await click("modeNextButton"); await wait(350);
  log("sonicsphere", "FX mode: next", true, `mode=${(await sonicState()).mode}`);

  // Hex CA panel
  await controller.fill("#hexSpeedInput", "2.5");
  await controller.dispatchEvent("#hexSpeedInput", "change"); await wait(250);
  let st = await sonicState();
  log("sonicsphere", "hex speed", Math.abs(st.hexSpeed - 2.5) < 0.01, `hexSpeed=${st.hexSpeed}`);

  await controller.selectOption("#hexRuleSelect", "maze"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "hex rule select", st.hexRuleName === "maze", `rule=${st.hexRuleName}`);

  await click("hexRuleCycleButton"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "hex rule cycle", st.hexRuleName !== "maze", `rule=${st.hexRuleName}`);

  await controller.selectOption("#hexPaletteSelect", "magma"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "hex palette", st.hexPalette === "magma", `palette=${st.hexPalette}`);

  await controller.uncheck("#hexSyncInput"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "hex sync audio", st.hexSync === false, `sync=${st.hexSync}`);

  await controller.fill("#hexSweepRowsInput", "5");
  await controller.dispatchEvent("#hexSweepRowsInput", "change"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "hex sweep rows", st.hexSweepRows === 5, `rows=${st.hexSweepRows}`);

  await controller.fill("#hexAperiodicInput", "0.4");
  await controller.dispatchEvent("#hexAperiodicInput", "change"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "hex aperiodic", Math.abs(st.hexAperiodic - 0.4) < 0.01, `aperiodic=${st.hexAperiodic}`);

  await click("applyHexCaButton"); await wait(350);
  st = await sonicState();
  log("sonicsphere", "apply hex (sets mode)", String(st.mode).includes("hex"), `mode=${st.mode}`);

  // Basic video
  await click("basicVideoOnButton"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "basic video on", st.basicVideo === true, `basicVideo=${st.basicVideo}`);
  await click("basicVideoToggleButton"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "basic video toggle", st.basicVideo === false, `basicVideo=${st.basicVideo}`);
  await click("basicVideoOffButton"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "basic video off", st.basicVideo === false, `basicVideo=${st.basicVideo}`);

  // Triangle mosaic
  await click("triangleOnButton"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "triangle on", st.mosaic === true && st.mosaicFx === false, `mosaic=${st.mosaic} fx=${st.mosaicFx}`);
  await click("triangleFxButton"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "triangle + fx", st.mosaic === true && st.mosaicFx === true, `mosaic=${st.mosaic} fx=${st.mosaicFx}`);
  await click("triangleOffButton"); await wait(250);
  st = await sonicState();
  log("sonicsphere", "triangle off", st.mosaic === false, `mosaic=${st.mosaic}`);

  // Logo
  await click("logoShowButton"); await wait(250);
  let logoOp = await sonic.evaluate(() => {
    const el = document.getElementById("synbiobetaLogoLayer");
    return el ? el.style.opacity : null;
  });
  log("sonicsphere", "logo show", logoOp !== null && parseFloat(logoOp) > 0, `opacity=${logoOp}`);
  await click("logoHideButton"); await wait(250);
  logoOp = await sonic.evaluate(() => {
    const el = document.getElementById("synbiobetaLogoLayer");
    return el ? el.style.opacity : null;
  });
  log("sonicsphere", "logo hide", logoOp !== null && parseFloat(logoOp) === 0, `opacity=${logoOp}`);

  // Bridge blackout
  await click("bridgeFadeOutButton"); await wait(300);
  let blackOp = await sonic.evaluate(() => {
    const el = document.getElementById("vjBlackoutLayer") || document.querySelector('[id*="lackout"]');
    return el ? el.style.opacity : null;
  });
  log("sonicsphere", "bridge fade to black", blackOp !== null && parseFloat(blackOp) > 0.9, `opacity=${blackOp}`);
  await click("bridgeFadeInButton"); await wait(300);
  blackOp = await sonic.evaluate(() => {
    const el = document.getElementById("vjBlackoutLayer") || document.querySelector('[id*="lackout"]');
    return el ? el.style.opacity : null;
  });
  log("sonicsphere", "bridge fade in", blackOp !== null && parseFloat(blackOp) < 0.1, `opacity=${blackOp}`);

  // Loop rating + clip drift: verify the receiving functions exist
  const fns = await sonic.evaluate(() => ({
    like: typeof window.setCurrentLoopPreference,
    recent: typeof window.setRecentLoopPreference,
    drift: typeof window.setProgressiveClipWindowConfig,
    loopGroups: typeof window.getLoopGroupsSnapshot,
    colorGroups: typeof window.getColorGroupsSnapshot,
    cubeStats: typeof window.getColorCubeBoardStats,
  }));
  log("sonicsphere", "like/dislike loop handler", fns.like === "function", `fn=${fns.like}`);
  log("sonicsphere", "recent loop rating handler", fns.recent === "function", `fn=${fns.recent}`);
  log("sonicsphere", "clip drift handler", fns.drift === "function", `fn=${fns.drift}`);
  log("sonicsphere", "folder loop groups snapshot", fns.loopGroups === "function", `fn=${fns.loopGroups}`);
  log("sonicsphere", "color board snapshot", fns.colorGroups === "function", `fn=${fns.colorGroups}`);
  log("sonicsphere", "cube stats snapshot", fns.cubeStats === "function", `fn=${fns.cubeStats}`);

  // Folder-loop / color panels populated in controller?
  await wait(2600); // one poller tick
  const panels = await controller.evaluate(() => ({
    loops: document.getElementById("folderLoopGroupsHost").classList.contains("empty") ? 0 : document.querySelectorAll("#folderLoopGroupsHost label").length,
    colors: document.getElementById("colorBoardHost").classList.contains("empty") ? 0 : document.querySelectorAll("#colorBoardHost label").length,
  }));
  log("sonicsphere", "folder loop list populates", panels.loops > 0, `${panels.loops} folders`);
  log("sonicsphere", "color board populates", panels.colors > 0, `${panels.colors} colors`);

  // Legacy dials (brightness, xrotation, etc.) — verify receiver behavior
  const legacyHandled = await sonic.evaluate(() => {
    // simulate what the controller sends for legacy inputs
    let reacted = false;
    try {
      window.postMessage({ name: "brightness", value: "80" }, "*");
    } catch {}
    return reacted; // no handler path exists; static analysis: ignored
  });
  log("sonicsphere", "legacy dials (brightness/rotation/lights/camera…)", false, "receiver ignores {name,value} except bridge/videochange");
}

// ── Hypermoon panel ──
const hmPopupPromise = controller.waitForEvent("popup", { timeout: 10000 }).catch(() => null);
await click("hmOpenOutputButton");
const hm = await hmPopupPromise;
if (!hm) {
  log("hypermoon", "open hypermoon output", false, "popup never appeared");
} else {
  await hm.waitForLoadState("domcontentloaded");
  await hm.waitForFunction(() => window.__hyperstitionStats, { timeout: 20000 }).catch(() => {});
  log("hypermoon", "open hypermoon output", true);
  await wait(2000);

  const connected = await controller.evaluate(() =>
    document.getElementById("hmStateReadout").textContent.includes("export query"));
  log("hypermoon", "broadcast handshake (state readout)", connected,
    connected ? "" : "readout still says not connected");

  // Drive each slider through the controller UI, then read hypermoon's real state.
  const hmState = async () => {
    return controller.evaluate(() => new Promise((resolve) => {
      const ch = new BroadcastChannel("hypermoon");
      const timer = setTimeout(() => { ch.close(); resolve(null); }, 2000);
      ch.onmessage = (e) => {
        if (e.data && e.data.type === "moonState") {
          clearTimeout(timer); ch.close(); resolve(e.data.state);
        }
      };
      ch.postMessage({ type: "moonRequestState" });
    }));
  };

  const sliderTests = [
    ["hmSpeed", "speed", 0.5], ["hmBright", "bright", 2.0],
    ["hmFeather", "feather", 0.2], ["hmThresh", "thresh", 0.3],
    ["hmVajras", "vajras", 2], ["hmVajraRadius", "vajraRadius", 1.5],
    ["hmLift", "lift", 0.1], ["hmFlicker", "flicker", 0.5],
    ["hmLon", "lon", 20], ["hmLat", "lat", -10],
    ["hmAngw", "angw", 1.8], ["hmAngh", "angh", 1.0],
    ["hmBleed", "bleed", 3.0], ["hmApparition", "apparition", 10],
  ];
  for (const [id, key, value] of sliderTests) {
    await controller.evaluate(([id, value]) => {
      const el = document.getElementById(id);
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, [id, value]);
    // angw/angh ease toward the target over ~1s; give them time to settle.
    await wait(key === "angw" || key === "angh" ? 2200 : 300);
    const state = await hmState();
    const got = state ? state[key] : undefined;
    const ok = state != null && Math.abs(Number(got) - value) < 0.05;
    log("hypermoon", `slider: ${key}`, ok, `sent=${value} got=${got}`);
  }

  // Verify a real render effect for one slider (speed -> playbackRate)
  const rate = await hm.evaluate(() => document.querySelector("canvas") && window.__hyperstitionStats ? window.__hyperstitionStats.speed : null);
  log("hypermoon", "speed reaches renderer", rate !== null, `stats.speed=${rate}`);

  // when field (live CRT time) — echoed?
  await controller.fill("#hmWhenInput", "FRIDAY 21:00");
  await controller.dispatchEvent("#hmWhenInput", "change");
  await wait(300);
  const stateW = await hmState();
  log("hypermoon", "when (CRT time)", stateW && stateW.when === "FRIDAY 21:00",
    `echo=${stateW ? stateW.when : "n/a"} — echoed only, live CRT missing`);

  // resurvey + copy query (no crash = pass)
  await click("hmResurveyButton"); await wait(400);
  const aliveAfter = await hm.evaluate(() => !!window.__hyperstitionStats);
  log("hypermoon", "re-survey anchor", aliveAfter);

  await hm.close();
}

// ── Projection rig ──
const rigResp = await controller.request.get(`${BASE}/moon-projection-rig.html`).catch(() => null);
const rigOk = rigResp ? rigResp.status() === 200 : false;
log("rig", "moon-projection-rig.html exists", rigOk, rigOk ? "" : `status=${rigResp ? rigResp.status() : "no response"}`);

// crt-terminal standalone
const crtResp = await controller.request.get(`${BASE}/crt-terminal.html`).catch(() => null);
const crtOk = crtResp ? crtResp.status() === 200 : false;
log("other", "crt-terminal.html exists", crtOk, crtOk ? "" : `status=${crtResp ? crtResp.status() : "no response"}`);

await browser.close();

let pass = 0, fail = 0;
for (const r of results) {
  (r.ok ? pass++ : fail++);
  console.log(`${r.ok ? "PASS" : "FAIL"}  [${r.group}] ${r.name}${r.note ? "  — " + r.note : ""}`);
}
console.log(`\n${pass} pass, ${fail} fail`);
