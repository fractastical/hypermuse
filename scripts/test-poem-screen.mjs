// Checks the poem screen answers the controller, and that the terminal's older
// jobs - the moon's CRT window and the baked export - are unchanged by it.
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const PORT = 8254;
const BASE = `http://127.0.0.1:${PORT}`;
let failed = 0;
const ok = (name, pass, detail = "") => {
  console.log((pass ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!pass) failed++;
};

const server = spawn("npx", ["http-server", "-c-1", "-p", String(PORT), "--silent", "."], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-gl=angle"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const stats = (p) => p.evaluate(() => JSON.parse(JSON.stringify({
  poem: window.__hyperstitionStats.poem,
  color: window.__hyperstitionStats.color,
  fx: window.__hyperstitionStats.fx,
  group: window.__hyperstitionStats.group,
  align: window.__hyperstitionStats.align,
  shape: window.__hyperstitionStats.shape,
  scale: window.__hyperstitionStats.scale,
  cps: window.__hyperstitionStats.cps,
  paused: window.__hyperstitionStats.paused,
  frame: window.__hyperstitionStats.frame,
  frames: window.__hyperstitionStats.frames,
  fontPx: window.__hyperstitionStats.fontPx,
  lines: window.__hyperstitionStats.lines
})));

console.log("\nthe terminal's existing jobs still behave");
{
  // No new parameters: what the moon's window and `npm run export:crt` load.
  const p = await context.newPage();
  await p.goto(`${BASE}/crt-terminal.html`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  const s = await stats(p);
  ok("default script loads", s.frames === 5, `${s.frames} screens`);
  ok("stays left aligned", s.align === "left");
  ok("stays green", s.color === "green");
  ok("phosphor fx stay on", s.fx === true);
  ok("no grouping unless asked", s.group === 0);
  await p.close();
}
{
  const p = await context.newPage();
  await p.goto(`${BASE}/crt-terminal.html?text=ONE|TWO~THREE&color=amber&fx=0`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1000);
  const s = await stats(p);
  ok("?text= still splits on ~ and |", s.frames === 2 && s.lines === "ONE / TWO", s.lines);
  ok("?color= still applies", s.color === "amber");
  await p.close();
}

console.log("\nthe poem screen");
const poem = await context.newPage();
await poem.goto(`${BASE}/crt-terminal.html?poem=trinitypoem.txt&group=3&align=center&vcenter=1` +
  `&color=white&fx=0&safe=0.06&fit=0.97&cps=400&hold=90&live=1`, { waitUntil: "domcontentloaded" });
await poem.waitForFunction(() => window.__hyperstitionStats.frames > 50, { timeout: 15000 });
await poem.waitForTimeout(800);
{
  const s = await stats(poem);
  ok("poem loads and groups into threes", s.frames === 82, `${s.frames} screens`);
  ok("opens centred", s.align === "center");
  ok("first screen is the first stanza", s.lines.startsWith("The critical thought"), s.lines);
  ok("type is fitted large", s.fontPx > 80, `${s.fontPx.toFixed(0)}px`);
}

// The controller is a separate page on the same origin, as it is in a show.
const ctrl = await context.newPage();
await ctrl.goto(`${BASE}/stream-view.html`, { waitUntil: "domcontentloaded" });
const cue = (set) => ctrl.evaluate((s) => {
  new BroadcastChannel("hypermoon").postMessage({ type: "poemConfig", set: s });
}, set);

await cue({ step: 1 });
await poem.waitForTimeout(400);
ok("forward advances a screen", (await stats(poem)).frame === 1);
await cue({ step: -1 });
await poem.waitForTimeout(400);
ok("back returns", (await stats(poem)).frame === 0);
await cue({ color: "green", fx: 1 });
await poem.waitForTimeout(400);
{
  const s = await stats(poem);
  ok("switches to the transmission look", s.color === "green" && s.fx === true);
}
await cue({ group: 9 });
await poem.waitForTimeout(600);
{
  // 25 stanzas are exactly nine lines, one is eight, one is ten - so nine at a
  // time leaves all but the long one whole, and halves that into 5 and 5.
  const s = await stats(poem);
  ok("nine at a time splits only the long stanza", s.frames === 28, `${s.frames} screens`);
  ok("and the type shrinks to fit", s.fontPx < 45, `${s.fontPx.toFixed(0)}px`);
}
await cue({ group: 0 });
await poem.waitForTimeout(600);
ok("group 0 keeps every stanza whole", (await stats(poem)).frames === 27);
await cue({ group: 3 });
await poem.waitForTimeout(600);
ok("regroups back", (await stats(poem)).frames === 82);
await cue({ paused: 1 });
const before = (await stats(poem)).frame;
await poem.waitForTimeout(1500);
{
  const s = await stats(poem);
  ok("pause holds the screen", s.paused === true && s.frame === before);
}
await cue({ paused: 0, restart: 1 });
await poem.waitForTimeout(400);
ok("restart returns to the top", (await stats(poem)).frame === 0);

// The controller listens for state coming back the other way.
const heard = await ctrl.evaluate(() => new Promise((resolve) => {
  const ch = new BroadcastChannel("hypermoon");
  const timer = setTimeout(() => resolve(null), 4000);
  ch.addEventListener("message", (e) => {
    if (e.data && e.data.type === "poemState") { clearTimeout(timer); resolve(e.data.state); }
  });
  ch.postMessage({ type: "poemRequestState" });
}));
ok("reports its state to the controller", !!heard && heard.frames === 82);
ok("reports the type size for the readout", !!heard && heard.fontPx > 80 && heard.viewH === 720,
  heard ? `${heard.fontPx.toFixed(0)}px in ${heard.viewH}` : "");

// A terminal inside the moon's window shares the channel and must stay deaf.
console.log("\nthe moon's embedded terminal ignores poem cues");
const embedded = await context.newPage();
await embedded.goto(`${BASE}/crt-terminal.html`, { waitUntil: "domcontentloaded" });
await embedded.waitForTimeout(800);
await cue({ color: "purple", group: 2 });
await embedded.waitForTimeout(600);
{
  const s = await stats(embedded);
  ok("without live=1 it does not listen", s.color === "green" && s.group === 0);
}

// The path a show actually takes: the controller's own buttons and sliders,
// driving a window it opened itself. The hand-made window above has to go
// first - the panel follows whatever poem window is reporting, and a show only
// ever has one (the open button reuses a named window).
await poem.close();

console.log("\nthe controller panel drives it");
{
  const panel = await context.newPage();
  const errors = [];
  panel.on("pageerror", (e) => errors.push(String(e)));
  await panel.goto(`${BASE}/controller.html`, { waitUntil: "domcontentloaded" });
  await panel.waitForTimeout(1500);

  const opened = context.waitForEvent("page");
  await panel.click("#poemOpenButton");
  const out = await opened;
  await out.waitForLoadState("domcontentloaded");
  await out.waitForFunction(() => window.__hyperstitionStats
    && window.__hyperstitionStats.frames > 50, { timeout: 15000 });
  ok("the button opens a loaded poem window", (await stats(out)).frames === 82);

  const set = (sel, value) => panel.evaluate(([s, v]) => {
    const el = document.querySelector(s);
    el.value = v;
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }, [sel, value]);

  await set("#poemColorSelect", "green");
  await out.waitForTimeout(500);
  ok("the look dropdown reaches the window", (await stats(out)).color === "green");

  await panel.click("#poemPauseButton");
  await out.waitForTimeout(400);
  ok("pause reaches the window", (await stats(out)).paused === true);

  const at = (await stats(out)).frame;
  await panel.click("#poemNextButton");
  await out.waitForTimeout(400);
  ok("forward reaches the window", (await stats(out)).frame === at + 1);

  await set("#poemGroupSlider", "10");
  await out.waitForTimeout(700);
  ok("the top of the slider means whole stanzas", (await stats(out)).frames === 27);
  ok("and the panel says so", /whole stanzas/.test(
    await panel.textContent("#poemReadout")), await panel.textContent("#poemReadout"));

  await set("#poemGroupSlider", "3");
  await out.waitForTimeout(700);
  const readout = await panel.textContent("#poemReadout");
  ok("the readout counts screens", /screen \d+ of 82/.test(readout), readout);
  // The preview window is not 16:9, so this is only right if it is quoted for
  // the projector rather than measured in the window.
  const cm = parseFloat((readout.match(/([\d.]+) cm capitals/) || [])[1]);
  ok("the readout quotes the projector, not the preview window",
    cm > 18 && cm < 20, `${cm} cm`);

  await set("#poemShapeSelect", "triangle");
  await out.waitForTimeout(500);
  ok("the shape dropdown reaches the window", (await stats(out)).shape === "triangle");
  ok("the panel reveals the triangle controls",
    await panel.evaluate(() => getComputedStyle(document.querySelector('#poemTriRow')).display !== 'none'));
  ok("the readout says triangle", /triangle/.test(await panel.textContent("#poemReadout")));

  // Keys pressed on the panel, with the poem window in another tab.
  await panel.click("#poemPanel");
  const cps0 = (await stats(out)).cps;
  await panel.keyboard.press("t");
  await out.waitForTimeout(400);
  ok("keys on the panel reach the window", (await stats(out)).cps === cps0 + 1,
    `${(await stats(out)).cps} cps`);
  await panel.waitForTimeout(1200);
  ok("and the panel's own slider follows",
    (await panel.inputValue("#poemCpsSlider")) === String(cps0 + 1),
    await panel.inputValue("#poemCpsSlider"));

  // The panel is full of text fields; typing a letter into one must not be
  // read as a cue.
  await panel.click("#poemSrcInput");
  await panel.keyboard.press("t");
  await out.waitForTimeout(400);
  ok("but not while typing in a field", (await stats(out)).cps === cps0 + 1);

  ok("no console errors", errors.length === 0, errors.join("; "));
  await out.close();
  await panel.close();
}

// Pace from the keyboard, and pace held to a tapped beat.
console.log("\ntempo");
{
  const p = await context.newPage();
  await p.goto(`${BASE}/crt-terminal.html?poem=trinitypoem.txt&group=3&cps=13&hold=3.2&live=1`,
    { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__hyperstitionStats.frames > 50, { timeout: 15000 });
  const pace = () => p.evaluate(() => {
    const s = window.__hyperstitionStats;
    return { cps: s.cps, hold: s.hold, beat: s.beat, beats: s.beats, live: s.pace, paused: s.paused };
  });

  await p.keyboard.press("t");
  await p.keyboard.press("t");
  ok("t types faster", (await pace()).cps === 15, `${(await pace()).cps} cps`);
  await p.keyboard.press("Shift+R");
  ok("shift takes a bigger step", (await pace()).cps === 10, `${(await pace()).cps} cps`);
  await p.keyboard.press("7");
  ok("a number is a speed straight off", (await pace()).cps === 22, `${(await pace()).cps} cps`);
  await p.keyboard.press("=");
  ok("= holds longer", Math.abs((await pace()).hold - 3.4) < 0.001, `${(await pace()).hold}s`);
  await p.keyboard.press("0");
  {
    const s = await pace();
    ok("0 puts the pace back", s.cps === 13 && Math.abs(s.hold - 3.2) < 0.001 && s.beat === 0);
  }
  await p.keyboard.press(" ");
  ok("space pauses", (await pace()).paused === true);
  await p.keyboard.press(" ");
  ok("and lets go again", (await pace()).paused === false);

  // Four taps half a second apart is 120 bpm.
  for (let i = 0; i < 4; i++) { await p.keyboard.press("b"); await p.waitForTimeout(500); }
  {
    const s = await pace();
    ok("tapping sets the beat", Math.abs(60 / s.beat - 120) < 12, `${(60 / s.beat).toFixed(0)} bpm`);
    ok("and it starts at 8 beats a screen", s.beats === 8);
  }
  await p.keyboard.press(",");
  ok(", takes a beat off the screen", (await pace()).beats === 7);

  // Locked, a screen takes its beats however long its lines are. Four beats at
  // 120 bpm is two seconds, which is faster than 13 cps can type 50 characters,
  // so the typing has to be hurried - and the lock still has to hold.
  await p.evaluate(() => new BroadcastChannel("hypermoon")
    .postMessage({ type: "poemConfig", set: { beat: 0.5, beats: 4, frame: 0 } }));
  await p.waitForTimeout(300);
  ok("a tight lock hurries the typing", (await pace()).live > 20, `${(await pace()).live.toFixed(0)} cps`);
  const at = await p.evaluate(() => window.__hyperstitionStats.frame);
  await p.waitForTimeout(6100); // three screens of two seconds, plus slack
  const moved = (await p.evaluate(() => window.__hyperstitionStats.frame)) - at;
  ok("and screens land on the beat", moved === 3, `${moved} screens in 6s of 2s screens`);

  await p.keyboard.press("Shift+B");
  ok("shift+b drops the lock", (await pace()).beat === 0);
  await p.close();
}
{
  // Walking the poem along by hand: paused, only the arrows move it, and they
  // move it a word at a time.
  const p = await context.newPage();
  await p.goto(`${BASE}/crt-terminal.html?poem=trinitypoem.txt&group=3&cps=13&live=1`,
    { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__hyperstitionStats.frames > 50, { timeout: 15000 });
  const seen = () => p.evaluate(() => window.__hyperstitionStats.written);
  const at = () => p.evaluate(() => window.__hyperstitionStats.frame);

  await p.keyboard.press(" ");            // pause
  await p.evaluate(() => new BroadcastChannel("hypermoon")
    .postMessage({ type: "poemConfig", set: { restart: 1 } }));
  await p.waitForTimeout(300);
  ok("paused, nothing writes itself", (await seen()) === "", `"${await seen()}"`);

  await p.keyboard.press("ArrowRight");
  ok("right writes a word", (await seen()) === "The", `"${await seen()}"`);
  await p.keyboard.press("ArrowRight");
  ok("and then the next", (await seen()) === "The critical", `"${await seen()}"`);
  await p.waitForTimeout(900);
  ok("and no more than that while paused", (await seen()) === "The critical", `"${await seen()}"`);
  await p.keyboard.press("ArrowLeft");
  ok("left takes one back", (await seen()) === "The", `"${await seen()}"`);

  // Off the end of a screen and off the top of one.
  for (let i = 0; i < 12; i++) await p.keyboard.press("ArrowRight");
  ok("running off the end rolls to the next screen", (await at()) === 1, `screen ${await at()}`);
  await p.keyboard.press("ArrowLeft");
  {
    const s = await seen();
    ok("and back off the top returns to the one before, written out",
      (await at()) === 0 && s.startsWith("The critical") && s.includes("Of course"), `"${s}"`);
  }
  await p.close();
}
{
  // The moon's embedded terminal must not answer the keyboard either.
  const p = await context.newPage();
  await p.goto(`${BASE}/crt-terminal.html`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(600);
  const before = await p.evaluate(() => window.__hyperstitionStats.cps);
  await p.keyboard.press("]");
  await p.keyboard.press("]");
  ok("without live=1 it ignores keys too",
    (await p.evaluate(() => window.__hyperstitionStats.cps)) === before);
  await p.close();
}

// A triangle in a 16:9 frame is height-bound, so it buys the shape at a real
// cost in type - worth asserting so it cannot regress unnoticed.
console.log("\nthe triangle");
{
  const tri = await context.newPage();
  const q = "poem=trinitypoem.txt&group=3&color=white&fx=0&cps=400&hold=900&safe=0.06&fit=0.97";
  await tri.goto(`${BASE}/crt-terminal.html?${q}&layout=triangle&triline=0.25`, { waitUntil: "domcontentloaded" });
  await tri.waitForFunction(() => window.__hyperstitionStats.frames > 50, { timeout: 15000 });
  await tri.waitForTimeout(900);
  const s = await stats(tri);
  ok("still three lines to a screen", s.frames === 82 && s.lines.split(" / ").length === 3, s.lines);
  ok("laid out as a triangle", s.shape === "triangle");

  // The drawn triangle should sit inside the safe box, apex included: the
  // centroid is not the middle of the bounding box and getting that wrong put
  // the apex off the top of the frame.
  const box = await tri.evaluate(() => {
    const c = document.getElementById("c");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, x1 = -1, y0 = c.height, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4] > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return { x0, x1, y0, y1, W: c.width, H: c.height };
  });
  ok("the apex is in frame", box.y0 > 4, `top at ${box.y0}`);
  ok("the base is in frame", box.y1 < box.H - 4, `bottom at ${box.y1} of ${box.H}`);
  ok("it fills the height", (box.y1 - box.y0) / box.H > 0.86,
    `${(((box.y1 - box.y0) / box.H) * 100).toFixed(0)}% of the frame`);
  ok("and is horizontally centred",
    Math.abs((box.x0 + box.x1) / 2 - box.W / 2) < 6,
    `centre off by ${Math.abs((box.x0 + box.x1) / 2 - box.W / 2).toFixed(0)}px`);
  await tri.close();
}
{
  // The turn that keeps the line being written along the bottom. It has to
  // come to rest square every time, and it has to cost nothing at rest -
  // that is the whole reason for turning a third at a time rather than freely.
  const foll = await context.newPage();
  const q = "poem=trinitypoem.txt&group=3&color=white&fx=0&cps=13&hold=2&safe=0.06&fit=0.97&layout=triangle";
  await foll.goto(`${BASE}/crt-terminal.html?${q}`, { waitUntil: "domcontentloaded" });
  await foll.waitForFunction(() => window.__hyperstitionStats.frames > 50, { timeout: 15000 });
  await foll.waitForTimeout(400);

  let square = 0, turning = 0, sweep = 0, offBase = 0;
  let worstEdge = -Infinity, minFs = Infinity, maxFs = 0;
  for (let i = 0; i < 90; i++) {
    const s = await foll.evaluate(() => {
      const st = window.__hyperstitionStats;
      const c = document.getElementById("c");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let y0 = c.height, y1 = -1, x0 = c.width, x1 = -1;
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
        if (d[(y * c.width + x) * 4] > 40) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      return { live: st.triLive, fs: st.fontPx, x0, x1, y0, y1, W: c.width, H: c.height };
    });
    // Zero is the base, reading left to right. Every rest has to be there -
    // one third of them being there is exactly the old bug.
    if (Math.abs(s.live) < 0.5) { square++; minFs = Math.min(minFs, s.fs); }
    else { turning++; sweep = Math.max(sweep, Math.abs(s.live)); if (Math.abs(s.live) > 121) offBase++; }
    maxFs = Math.max(maxFs, s.fs);
    if (s.x1 > 0) {
      worstEdge = Math.max(worstEdge, -s.x0, s.x1 - (s.W - 1), -s.y0, s.y1 - (s.H - 1));
    }
    await foll.waitForTimeout(120);
  }
  ok("the line being written always rests along the base", square > 0 && offBase === 0,
    `${square} rests, none off the base`);
  ok("and it got there by turning a third", turning > 0 && sweep > 60,
    `swept ${sweep.toFixed(0)}deg`);
  ok("and spends most of its time at rest", square > turning * 2, `${square} still, ${turning} turning`);
  ok("never touches the frame edge while turning", worstEdge < 0,
    `${(-worstEdge).toFixed(0)}px of clearance at the tightest`);
  // Same fit as a triangle that never moves: the three resting orientations of
  // an equilateral triangle occupy the same box.
  ok("costs nothing in type size at rest", Math.abs(minFs - maxFs) < 0.5,
    `${minFs.toFixed(1)}px at rest, ${maxFs.toFixed(1)}px peak`);
  await foll.close();
}
{
  // The turn exists to put the line being written along the bottom, so no
  // character may go down while the triangle is still moving - otherwise the
  // opening of every line is written off-square, and the slower and more
  // legible the turn, the more of the line it spoils.
  const p = await context.newPage();
  await p.goto(`${BASE}/crt-terminal.html?poem=trinitypoem.txt&group=3&color=white&fx=0` +
    `&cps=13&hold=1.5&safe=0.06&fit=0.97&layout=triangle&triease=0.9`,
    { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__hyperstitionStats.frames > 50, { timeout: 15000 });
  await p.waitForTimeout(500);

  let turning = 0, wroteWhileTurning = 0, wroteAtRest = 0;
  let was = null;
  for (let i = 0; i < 220; i++) {
    const s = await p.evaluate(() => ({
      a: window.__hyperstitionStats.triLive,
      w: window.__hyperstitionStats.written,
      f: window.__hyperstitionStats.frame
    }));
    if (was && was.f === s.f) {
      const grew = s.w.length !== was.w.length;
      if (Math.abs(s.a) > 1) { turning++; if (grew) wroteWhileTurning++; }
      else if (grew) wroteAtRest++;
    }
    was = s;
    await p.waitForTimeout(60);
  }
  ok("the turn was caught in the act", turning > 20, `${turning} samples mid-turn`);
  ok("nothing is written while it turns", wroteWhileTurning === 0,
    `${wroteWhileTurning} of ${turning} wrote mid-turn`);
  ok("and it writes the rest of the time", wroteAtRest > 20, `${wroteAtRest} wrote at rest`);
  await p.close();
}
{
  // The claim in pixels rather than in numbers. Nothing on screen moves at rest
  // except the characters being written and the cursor after them, so whatever
  // changes between two resting frames IS the live line. It has to come out a
  // wide flat band across the base every time. If a line were left up one of
  // the other two sides - the old fault, which happened to two lines in three -
  // the changes would run diagonally and this box would blow out.
  const p = await context.newPage();
  await p.goto(`${BASE}/crt-terminal.html?poem=trinitypoem.txt&group=3&color=white&fx=0` +
    `&cps=13&hold=1.5&safe=0.06&fit=0.97&layout=triangle`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__hyperstitionStats.frames > 50, { timeout: 15000 });
  await p.waitForTimeout(500);
  await p.evaluate(() => { window.__prev = null; });

  const grab = () => p.evaluate(() => {
    const st = window.__hyperstitionStats;
    const c = document.getElementById("c");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const prev = window.__prev;
    window.__prev = d;
    let out = null;
    if (prev && prev.length === d.length) {
      let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0;
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        if (Math.abs(d[i] - prev[i]) > 40) {
          n++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (n > 6) out = { x0, x1, y0, y1, n };
    }
    return { live: st.triLive, settled: st.triSettled, frame: st.frame, w: st.triWhere, changed: out };
  });

  let seen = 0, strays = 0, stray = [];
  let U = { x0: 1e9, x1: -1, y0: 1e9, y1: -1 }, where = null;
  let was = await grab();
  for (let i = 0; i < 150; i++) {
    await p.waitForTimeout(70);
    const s = await grab();
    const rest = s.settled && was.settled && s.frame === was.frame;
    if (rest && s.changed) {
      const b = s.changed, R = s.w.R;
      where = s.w;
      seen++;
      U = { x0: Math.min(U.x0, b.x0), x1: Math.max(U.x1, b.x1), y0: Math.min(U.y0, b.y0), y1: Math.max(U.y1, b.y1) };
      // The baseline of the base line sits one inradius - half of R - below
      // centre, with the capitals above it.
      if (b.y0 < s.w.y + R * 0.22 || b.y1 > s.w.y + R * 0.62) {
        strays++;
        if (stray.length < 4) stray.push(
          `y ${((b.y0 - s.w.y) / R).toFixed(2)}..${((b.y1 - s.w.y) / R).toFixed(2)}R` +
          ` x ${((b.x0 - s.w.x) / R).toFixed(2)}..${((b.x1 - s.w.x) / R).toFixed(2)}R` +
          ` n=${b.n}`);
      }
    }
    was = s;
  }
  ok("the writing was caught in the act", seen > 25, `${seen} samples of it writing`);
  ok("every character written lands on the base", strays === 0,
    `${strays} of ${seen} landed elsewhere${stray.length ? " - " + stray.join("; ") : ""}`);
  const wide = (U.x1 - U.x0) / Math.max(1, U.y1 - U.y0);
  ok("and the writing is a flat band, not a diagonal", wide > 3,
    `${(U.x1 - U.x0)}x${U.y1 - U.y0}px, ${wide.toFixed(1)}:1`);
  ok("centred on the base", where && Math.abs((U.x0 + U.x1) / 2 - where.x) < where.R * 0.12,
    where ? `off centre by ${Math.abs((U.x0 + U.x1) / 2 - where.x).toFixed(0)}px` : "no frame");
  await p.close();
}
{
  // Lines are not cut when their screen ends: they keep turning and sink into
  // the middle. The triangle should therefore be full of words a few screens
  // in, with more ink than the same thing without a tail, and still no bigger.
  const q = "poem=trinitypoem.txt&group=3&color=white&fx=0&cps=60&hold=0.3&safe=0.06&fit=0.97&layout=triangle";
  const look = async (extra) => {
    const p = await context.newPage();
    await p.goto(`${BASE}/crt-terminal.html?${q}${extra}`, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.__hyperstitionStats.frames > 50, { timeout: 15000 });
    await p.waitForTimeout(11000); // several screens, so the tail is full
    const r = await p.evaluate(() => {
      const c = document.getElementById("c");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const w = window.__hyperstitionStats.triWhere;
      // The three live lines rest on the sides and grow inward only as far as
      // one line of type, so a disc of 0.35 of the circumradius around the
      // centroid is empty unless something has receded into it.
      const hole = w.R * 0.35;
      let ink = 0, inner = 0, x0 = c.width, x1 = -1, y0 = c.height, y1 = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4] > 40) {
          ink++;
          if (Math.hypot(x - w.x, y - w.y) < hole) inner++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      return { ink, inner, x0, x1, y0, y1, W: c.width, H: c.height,
        ghosts: window.__hyperstitionStats.triGhosts, fs: window.__hyperstitionStats.fontPx };
    });
    await p.close();
    return r;
  };
  const tail = await look("");
  const bare = await look("&trighost=0");
  ok("older lines are kept behind the three", tail.ghosts === 6, `${tail.ghosts} kept`);
  ok("trighost=0 keeps none", bare.ghosts === 0);
  ok("they recede into the middle of the seal", tail.inner > 400 && bare.inner === 0,
    `${tail.inner} lit inside the hole, ${bare.inner} without a tail`);
  ok("and costs the live line nothing", Math.abs(tail.fs - bare.fs) < 0.5,
    `${tail.fs.toFixed(1)}px against ${bare.fs.toFixed(1)}px`);
  // Receding means inward, so the tail must not grow the picture at all.
  ok("the tail stays inside the triangle",
    tail.x0 >= bare.x0 - 2 && tail.x1 <= bare.x1 + 2 &&
    tail.y0 >= bare.y0 - 2 && tail.y1 <= bare.y1 + 2,
    `${tail.x0},${tail.y0}-${tail.x1},${tail.y1} against ${bare.x0},${bare.y0}-${bare.x1},${bare.y1}`);
}
{
  // Turning it has to stay inside the circumcircle, so it gives up more size.
  const spun = await context.newPage();
  await spun.goto(`${BASE}/crt-terminal.html?poem=trinitypoem.txt&group=3&layout=triangle&trispin=90&safe=0.06&fit=0.97&cps=400&hold=900`, { waitUntil: "domcontentloaded" });
  await spun.waitForFunction(() => window.__hyperstitionStats.frames > 50, { timeout: 15000 });
  let clipped = false;
  for (let i = 0; i < 6; i++) {
    await spun.waitForTimeout(260);
    clipped = clipped || await spun.evaluate(() => {
      const c = document.getElementById("c");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const lit = (x, y) => d[(y * c.width + x) * 4] > 40;
      for (let x = 0; x < c.width; x++) if (lit(x, 0) || lit(x, c.height - 1)) return true;
      for (let y = 0; y < c.height; y++) if (lit(0, y) || lit(c.width - 1, y)) return true;
      return false;
    });
  }
  ok("a turning triangle never touches the frame edge", !clipped);
  await spun.close();
}

await browser.close();
server.kill();
console.log(failed ? `\n${failed} failed\n` : "\nall good\n");
process.exit(failed ? 1 : 0);
