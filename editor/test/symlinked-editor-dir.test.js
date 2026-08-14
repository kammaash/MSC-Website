"use strict";
// Fix round 5, Fix A: server.js computes `edLower` (the value the whole post-realpath editor
// allowlist is checked against — AUTHORITY part 2, "isForbiddenEditorPath(realLower, edLower)")
// as `fs.realpathSync(editorDir)`, not `path.resolve(editorDir)`. Round 4 made that change but
// left it untested: reverting it to `path.resolve(editorDir)` leaves the full suite green,
// because every existing fixture reaches editorDir (== __dirname, computed once at module
// scope) through the test files' own ordinary `require("../server.js")`, which is never itself
// a symlink. `edLower` and `path.resolve(editorDir)` are therefore byte-identical in every
// other test in this repo — the mutation is invisible to them by construction.
//
// The scenario that DOES distinguish the two: editorDir reached via a symlink (the server.js
// comment's own example — "under node --preserve-symlinks with a symlinked repo checkout").
// Reproducing that requires __dirname, computed by Node's module loader at the moment server.js
// is loaded, to itself be an unresolved symlink path rather than its realpath. Two Node
// behaviours make that reachable without touching the real repo or `createServer`'s signature:
//   1. `require()`, given a path that is itself (or passes through) a symlink, ordinarily
//      realpaths it before setting that module's __filename/__dirname — silently defeating the
//      whole scenario. `node --preserve-symlinks` turns that off for every `require()` call
//      made by the process (not just the entry module), so a module required via a symlinked
//      path keeps that literal path as its own __dirname.
//   2. That flag is a `node` CLI flag, fixed for a whole process at startup — it cannot be
//      toggled after this test file's own process has already started. So the module under
//      test must be loaded in a genuine CHILD `node --preserve-symlinks` process, not required
//      in-process here.
//
// Fixture shape (see buildFixture() below): a single top-level symlink (symlinkRepo ->
// realFixtureRepo) stands in for "a symlinked repo checkout" — everything below that one hop is
// real, non-symlinked files, so this exercises exactly the scenario the server.js comment
// names, not a different (already-covered) symlink shape. `realFixtureRepo/editor/` holds
// verbatim COPIES of server.js and the three lib/*.js files it requires — never symlinks to the
// real repo — so this file touches nothing under the live editor/ directory at all, and always
// tests whatever server.js currently contains (this run's fix, or the reverted line during the
// mutation check below). A canary file sits directly inside `editor/` (unreachable through the
// lib/*.js or client/*.js allowlist), and `leak.json` at the fixture repo's root symlinks
// straight to it — the exact "root-level symlink pointing into editor/" vector rounds 2-3 closed
// for the NON-symlinked-editorDir case; this test is the symlinked-editorDir case.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const REAL_EDITOR_DIR = path.join(__dirname, "..");
const REAL_LIB_FILES = ["content-io.js", "patch.js", "cloudinary.js", "media-db.js", "paths.js", "media-urls.js"];

const RUNNER_SRC = `
"use strict";
const path = require("node:path");
const symlinkRepo = process.argv[2];
const { createServer } = require(path.join(symlinkRepo, "editor", "server.js"));
const srv = createServer({
  root: symlinkRepo,
  config: { push: false },
  templates: {},
  secrets: null,
  token: "fixture-token",
});
srv.listen(0, "127.0.0.1", () => { console.log("PORT:" + srv.address().port); });
`;

// Builds: <tmp>/realFixtureRepo/editor/{server.js, lib/*.js, _canary.json}, plus
// <tmp>/realFixtureRepo/leak.json (symlink -> the canary) and <tmp>/symlinkRepo (symlink ->
// realFixtureRepo, the one hop under test). Returns the absolute symlinkRepo path, the canary
// marker to assert against, and a cleanup function.
function buildFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "msc-symlink-editordir-"));
  const realRepo = path.join(tmp, "realFixtureRepo");
  const editorDir = path.join(realRepo, "editor");
  const libDir = path.join(editorDir, "lib");
  fs.mkdirSync(libDir, { recursive: true });

  fs.copyFileSync(path.join(REAL_EDITOR_DIR, "server.js"), path.join(editorDir, "server.js"));
  for (const f of REAL_LIB_FILES) {
    fs.copyFileSync(path.join(REAL_EDITOR_DIR, "lib", f), path.join(libDir, f));
  }

  const marker = "SYMLINK-EDITORDIR-LEAK-" + crypto.randomUUID();
  const canaryPath = path.join(editorDir, "_canary.json");
  fs.writeFileSync(canaryPath, JSON.stringify({ marker }));
  fs.symlinkSync(canaryPath, path.join(realRepo, "leak.json"), "file");

  const symlinkRepo = path.join(tmp, "symlinkRepo");
  fs.symlinkSync(realRepo, symlinkRepo, "dir");

  const runnerPath = path.join(tmp, "runner.js");
  fs.writeFileSync(runnerPath, RUNNER_SRC);

  return {
    symlinkRepo, runnerPath, marker,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

// Spawns `node --preserve-symlinks runner.js <symlinkRepo>` and resolves once it has printed
// the port it bound (or rejects on early exit/timeout). The server is real HTTP, reachable over
// 127.0.0.1 exactly like every other fixture in this suite — only how its module was LOADED
// differs.
function bootChild(runnerPath, symlinkRepo) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--preserve-symlinks", runnerPath, symlinkRepo], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("timed out waiting for child to report a port. stderr: " + err));
    }, 10000);
    child.stdout.on("data", (c) => {
      out += c.toString();
      const m = out.match(/PORT:(\d+)/);
      if (m) { clearTimeout(timer); resolve({ child, port: Number(m[1]) }); }
    });
    child.stderr.on("data", (c) => { err += c.toString(); });
    child.on("exit", (code) => {
      if (out.indexOf("PORT:") === -1) {
        clearTimeout(timer);
        reject(new Error("child exited (code " + code + ") before reporting a port. stderr: " + err));
      }
    });
  });
}

test("editorDir reached via a symlink: a root-level symlink into editor/ is still 403 (the fix this test exists to guard)", async () => {
  const fixture = buildFixture();
  let child;
  try {
    const boot = await bootChild(fixture.runnerPath, fixture.symlinkRepo);
    child = boot.child;
    const base = "http://127.0.0.1:" + boot.port;

    const r = await fetch(base + "/leak.json");
    assert.equal(r.status, 403, "a root-level symlink into a symlinked editor/ must still 403");
    const text = await r.text();
    assert.ok(!text.includes(fixture.marker), "response must not contain the canary marker");

    // Positive control through the SAME symlinked-editorDir server: the allowlisted file must
    // still be reachable — the fix must not over-block once editorDir itself is a symlink.
    const ok = await fetch(base + "/editor/lib/paths.js");
    assert.equal(ok.status, 200, "the allowlisted lib/*.js file must still be servable");
  } finally {
    if (child) child.kill();
    fixture.cleanup();
  }
});
