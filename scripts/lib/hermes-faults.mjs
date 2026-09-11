// What was not working, and when.
//
// The server already says when something goes wrong — there are a dozen
// `console.error` calls for a track that will not write, a database that will
// not connect, a phone feed that will not parse. The trouble is that saying it
// is all they do. On this laptop the output goes to whatever terminal started
// the process, or to /tmp if it was started with nohup, and on Railway it goes
// into a rolling buffer that ages out. So every one of those messages is
// written for an audience that is usually not there, and by the time anyone
// asks "when did it stop working" the answer has already scrolled away.
//
// This keeps them. console.error is wrapped rather than the call sites changed,
// because the messages are already written and already in the right places, and
// a wrapper cannot fall out of step with them the way a parallel set of calls
// would.
//
// Two things it records that no console.error ever fires for:
//
// A fault can be a silence. The worst failure found so far was a deployed
// server reporting `art: 0 pieces` — no error, no crash, just a feature quietly
// absent because a data file had never been committed. Those are logged as
// faults at startup precisely because nothing else complains about them.
//
// A crash is a fault too, and the crash is the one message that never gets
// written down, because the process is gone before anyone reads it.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

// Big enough to hold a festival's worth of complaints, small enough that
// reading the file is instant. Past it the log rolls over to .1 and starts
// again, so the disk cannot be filled by something failing in a tight loop.
const MAX_BYTES = 2 * 1024 * 1024;

export function startFaultLog({ path, keep = 300, stderr = true } = {}) {
  const recent = [];
  let writing = false;

  function roll() {
    try {
      if (!existsSync(path)) return;
      if (statSync(path).size < MAX_BYTES) return;
      renameSync(path, `${path}.1`);
    } catch {
      // A log that cannot be rotated is not a reason to stop logging.
    }
  }

  function write(entry) {
    recent.push(entry);
    if (recent.length > keep) recent.splice(0, recent.length - keep);
    if (!path) return;
    // Guard against the recursion where writing a fault fails, the failure is
    // reported through the wrapped console.error, and that tries to write too.
    if (writing) return;
    writing = true;
    try {
      mkdirSync(dirname(path), { recursive: true });
      roll();
      appendFileSync(path, JSON.stringify(entry) + "\n");
    } catch {
      // Nowhere left to put it. The in-memory list still has it, which is what
      // /api/hermes/faults reads, so the fault is not lost while this runs.
    } finally {
      writing = false;
    }
  }

  function note(kind, message, extra = {}) {
    const entry = {
      at: new Date().toISOString(),
      kind: String(kind || "fault"),
      message: String(message == null ? "" : message).slice(0, 2000),
      ...extra
    };
    write(entry);
    return entry;
  }

  const realError = console.error.bind(console);
  if (stderr) {
    console.error = (...args) => {
      realError(...args);
      try {
        const text = args
          .map((a) => (a instanceof Error ? `${a.message}` : typeof a === "string" ? a : safeJson(a)))
          .join(" ");
        // Only the server's own complaints. Anything else on stderr is a library
        // being chatty and logging it would bury the entries that matter.
        if (text.includes("[hermes]")) write({
          at: new Date().toISOString(),
          kind: "error",
          message: text.replace(/^\[hermes\]\s*/, "").slice(0, 2000)
        });
      } catch {
        // Never let logging a fault become one.
      }
    };
  }

  // The two that end the process. Recorded before rethrowing so the last thing
  // the log holds is the reason it stopped, which is the entry someone will
  // actually come looking for.
  process.on("uncaughtException", (err) => {
    note("crash", `uncaught: ${String((err && err.message) || err)}`, {
      stack: String((err && err.stack) || "").split("\n").slice(0, 6).join("\n")
    });
    realError(err);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    note("crash", `unhandled rejection: ${String((reason && reason.message) || reason)}`, {
      stack: String((reason && reason.stack) || "").split("\n").slice(0, 6).join("\n")
    });
  });

  return {
    note,
    recent: (limit = 50) => recent.slice(-Math.max(1, limit)).reverse(),
    count: () => recent.length,
    path,
    // Read back across restarts, because the interesting question is almost
    // always about a run that has already ended.
    history(limit = 100) {
      if (!path || !existsSync(path)) return [];
      try {
        const rows = [];
        for (const line of readFileSync(path, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try { rows.push(JSON.parse(line)); } catch { continue; }
        }
        return rows.slice(-Math.max(1, limit)).reverse();
      } catch {
        return [];
      }
    }
  };
}

function safeJson(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

// The failures that announce themselves as nothing at all. Each of these has
// already happened at least once, and none of them printed an error when it did.
export function noteStartupFaults(faults, checks) {
  const found = [];
  const claim = (ok, kind, message, extra) => {
    if (ok) return;
    found.push(faults.note(kind, message, { degraded: true, ...extra }));
  };

  claim(checks.artPieces > 0, "degraded",
    "art listing missing — nothing will be ranked as nearby art", { artPath: checks.artPath || null });
  claim(checks.cityIntersections > 0, "degraded",
    "city geometry missing — places cannot be named", { gisDir: checks.gisDir || null });
  claim(!checks.databaseUrlSet || checks.databaseConnected, "degraded",
    "DATABASE_URL is set but Postgres did not connect — writes are going to disk only, which is lost on redeploy");
  claim(checks.trackWritable, "degraded",
    "the track log is not writable — positions will be served but not kept", { trackPath: checks.trackPath || null });

  return found;
}
