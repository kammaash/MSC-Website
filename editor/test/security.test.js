"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { createServer, readJson } = require("../server.js");

function tmpSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-sec-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body><h1>Hi</h1></body></html>");
  return dir;
}

async function boot(opts = {}) {
  const root = tmpSite();
  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, token, ...opts });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const base = "http://127.0.0.1:" + srv.address().port;
  return { root, srv, base, token };
}

// ---- Critical 2: editor/secrets.json and dotfiles must never be servable ----

test("GET /editor/secrets.json is 403, whether or not the file exists", async () => {
  const { base } = await boot();
  const r = await fetch(base + "/editor/secrets.json");
  assert.equal(r.status, 403);
});

test("GET /editor/config.json and /editor/collections.json are 403 (only lib/*.js and client/*.js are allowlisted)", async () => {
  const { base } = await boot();
  assert.equal((await fetch(base + "/editor/config.json")).status, 403);
  assert.equal((await fetch(base + "/editor/collections.json")).status, 403);
});

test("GET /.git/config is 403 (dot-segment block)", async () => {
  const { base } = await boot();
  assert.equal((await fetch(base + "/.git/config")).status, 403);
  assert.equal((await fetch(base + "/.git/HEAD")).status, 403);
});

test("GET /editor/lib/paths.js (allowlisted) still works", async () => {
  const { base } = await boot();
  const r = await fetch(base + "/editor/lib/paths.js");
  assert.equal(r.status, 200);
});

// ---- Critical 2, round 2: case-insensitive-filesystem bypass ----
//
// macOS APFS is case-INSENSITIVE. The old check was `rel.startsWith("editor/")`, which is
// case-SENSITIVE — a request for "/EDITOR/secrets.json" fails it and falls into the `root`
// branch. In PRODUCTION `root === path.dirname(editorDir)` (the repo root), so
// `path.resolve(root, "EDITOR/secrets.json")` resolves ON DISK, via case-insensitive
// lookup, to the exact same file as editor/secrets.json — and gets served.
//
// A tmp-dir-rooted fixture CANNOT reproduce this: fp would be tmpRoot/EDITOR/secrets.json,
// which genuinely doesn't exist, so it 404s either way and masks the bug. This test must
// use root === path.dirname(editorDir) — the real repo root — exactly like production.
//
// Fix round 4 (finding 6): this test used to plant the REAL editor/secrets.json (with a
// backup/restore of any real content) to exercise the case-insensitive path. That is exactly
// the file secrets-location.test.js asserts is ABSENT, and `node --test` runs test files in
// parallel processes — a race that mutation testing surfaced even though 8 clean runs never
// hit it. The property under test ("a case-varied URL cannot reach a non-allowlisted file
// inside editor/") is not specific to the filename "secrets.json"; use a uniquely-named
// per-run canary instead, exactly like secrets-location.test.js already does, so this file
// never creates the real secrets.json at all.
test("case-insensitive bypass: /EDITOR, /Editor, /eDiToR paths never leak real editor files (production-shaped root)", async () => {
  const EDITOR_DIR = path.join(__dirname, "..");
  const REPO_ROOT = path.dirname(EDITOR_DIR);
  const canaryName = "_r4_case_canary_" + crypto.randomUUID() + ".json";
  const canaryPath = path.join(EDITOR_DIR, canaryName);
  const secretMarker = "SECRET-MARKER-" + crypto.randomUUID();
  fs.writeFileSync(canaryPath, JSON.stringify({ cloudinaryApiSecret: secretMarker }));

  const token = crypto.randomUUID();
  const srv = createServer({ root: REPO_ROOT, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base = "http://127.0.0.1:" + srv.address().port;
    const variants = [
      "/EDITOR/" + canaryName, "/Editor/" + canaryName.toUpperCase(),
      "/EDITOR/config.json", "/eDiToR/check-paths.js",
    ];
    for (const p of variants) {
      const r = await fetch(base + p);
      assert.equal(r.status, 403, `expected 403 for ${p}, got ${r.status}`);
      const text = await r.text();
      assert.ok(!text.includes(secretMarker), `${p} response must not contain the secret marker`);
    }
    // Positive control through this same production-shaped server: the allowlisted file
    // must still be reachable — the fix must not over-block.
    const ok = await fetch(base + "/editor/lib/paths.js");
    assert.equal(ok.status, 200);
    // Same file, but requested with the SAME mixed casing as the attack paths above: the
    // allowlist decision must be case-insensitive in both directions. (Real browser
    // requests from the injected <script> tags are always exact-lowercase, so this is a
    // defence-in-depth case, not a path any legitimate request takes.)
    const okMixedCase = await fetch(base + "/EDITOR/lib/paths.js");
    assert.equal(okMixedCase.status, 200);
  } finally {
    await new Promise((r) => srv.close(r));
    fs.rmSync(canaryPath, { force: true });
  }
});

// ---- symlink escape (Critical 2 fold-in A) ----

test("a symlink under the served root pointing outside it is never followed — 403 or 404, not 200", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-sec-symlink-"));
  const root = path.join(dir, "site");
  fs.mkdirSync(root);
  const outsideFile = path.join(dir, "outside-secret.txt");
  fs.writeFileSync(outsideFile, "TOP-SECRET-OUTSIDE-CONTENT");
  fs.symlinkSync(outsideFile, path.join(root, "linked.js"));

  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const r = await fetch("http://127.0.0.1:" + srv.address().port + "/linked.js");
  assert.ok(r.status === 403 || r.status === 404, `expected 403 or 404, got ${r.status}`);
  const text = await r.text();
  assert.ok(!text.includes("TOP-SECRET-OUTSIDE-CONTENT"));
});

// ---- Fix round 4, Fix 1: the dot-segment rule must apply to the RESOLVED path too ----
//
// server.js blocked dot-prefixed segments (.git, .env, ...) only on `rel`, derived from the
// URL — i.e. PRE-resolution. A symlink whose own URL name has no dot segment, but which
// RESOLVES into a dotfile/dotdir, sailed straight through. This matters more than the
// accepted hard-link vector: a symlink can be committed to git and delivered to a
// collaborator by an ordinary `git pull`, which /api/publish runs automatically — a hard
// link cannot travel that way. Each case here plants a REAL .git-shaped or .env-shaped
// fixture with a canary marker and proves both the status code and that the marker never
// appears in the response body.
function tmpSiteWithDotfiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-sec-dotseg-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body><h1>Hi</h1></body></html>");
  const gitDir = path.join(dir, ".git");
  fs.mkdirSync(gitDir);
  const gitMarker = "GIT-CONFIG-MARKER-" + crypto.randomUUID();
  fs.writeFileSync(path.join(gitDir, "config"), gitMarker);
  const envMarker = "ENV-SECRET-MARKER-" + crypto.randomUUID();
  fs.writeFileSync(path.join(dir, ".env"), envMarker);
  return { dir, gitDir, gitMarker, envMarker };
}

test("Fix 1: a symlinked DIRECTORY pointing at .git is blocked, even though its own URL segment has no dot", async () => {
  const { dir, gitDir, gitMarker } = tmpSiteWithDotfiles();
  fs.symlinkSync(gitDir, path.join(dir, "gitdir"), "dir");
  const token = crypto.randomUUID();
  const srv = createServer({ root: dir, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base = "http://127.0.0.1:" + srv.address().port;
    const r = await fetch(base + "/gitdir/config");
    assert.equal(r.status, 403, `expected 403, got ${r.status}`);
    assert.ok(!(await r.text()).includes(gitMarker));
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

test("Fix 1: a CASE-VARIED request for a symlinked directory into .git is also blocked (production-shaped, case-insensitive fs)", async () => {
  const { dir, gitDir, gitMarker } = tmpSiteWithDotfiles();
  fs.symlinkSync(gitDir, path.join(dir, "gitdir"), "dir");
  const token = crypto.randomUUID();
  const srv = createServer({ root: dir, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base = "http://127.0.0.1:" + srv.address().port;
    const r = await fetch(base + "/GITDIR/config");
    assert.equal(r.status, 403, `expected 403, got ${r.status}`);
    assert.ok(!(await r.text()).includes(gitMarker));
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

test("Fix 1: an ABSOLUTE symlink straight at .git/config is blocked", async () => {
  const { dir, gitDir, gitMarker } = tmpSiteWithDotfiles();
  fs.symlinkSync(path.join(gitDir, "config"), path.join(dir, "abs-gitconfig.txt"), "file");
  const token = crypto.randomUUID();
  const srv = createServer({ root: dir, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base = "http://127.0.0.1:" + srv.address().port;
    const r = await fetch(base + "/abs-gitconfig.txt");
    assert.equal(r.status, 403, `expected 403, got ${r.status}`);
    assert.ok(!(await r.text()).includes(gitMarker));
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

test("Fix 1: a symlink to .env is blocked", async () => {
  const { dir, envMarker } = tmpSiteWithDotfiles();
  fs.symlinkSync(path.join(dir, ".env"), path.join(dir, "env.txt"), "file");
  const token = crypto.randomUUID();
  const srv = createServer({ root: dir, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base = "http://127.0.0.1:" + srv.address().port;
    const r = await fetch(base + "/env.txt");
    assert.equal(r.status, 403, `expected 403, got ${r.status}`);
    assert.ok(!(await r.text()).includes(envMarker));
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

test("Fix 1: direct (non-symlink) requests still work as before — /.git/config and /.env are 403", async () => {
  const { dir, gitMarker, envMarker } = tmpSiteWithDotfiles();
  const token = crypto.randomUUID();
  const srv = createServer({ root: dir, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base = "http://127.0.0.1:" + srv.address().port;
    for (const p of ["/.git/config", "/.env"]) {
      const r = await fetch(base + p);
      assert.equal(r.status, 403, `expected 403 for ${p}, got ${r.status}`);
      const text = await r.text();
      assert.ok(!text.includes(gitMarker) && !text.includes(envMarker));
    }
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

test("Fix 1: positive control — a symlink to a normal (non-dotted) file is still served, not over-blocked", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-sec-dotseg-ok-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body><h1>Hi</h1></body></html>");
  const marker = "OK-MARKER-" + crypto.randomUUID();
  fs.writeFileSync(path.join(dir, "real.txt"), marker);
  fs.symlinkSync(path.join(dir, "real.txt"), path.join(dir, "aliased.txt"), "file");
  const token = crypto.randomUUID();
  const srv = createServer({ root: dir, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base = "http://127.0.0.1:" + srv.address().port;
    const r = await fetch(base + "/aliased.txt");
    assert.equal(r.status, 200);
    assert.equal(await r.text(), marker);
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

// ---- Fix round 4, Fix 3: /api/sign must validate the SECRETS SHAPE, not just truthiness ----
//
// `!secrets` alone lets 42, [], "x", {} all reach signParams(params, undefined) — a 200
// with a signature computed over the literal string "undefined" and `apiKey` silently
// missing, which then fails on Cloudinary's side with an unrelated error.
test("Fix 3: /api/sign 503s (not 200-with-garbage) when secrets has the wrong shape", async () => {
  const shapes = [42, [], "x", {}, { cloudinaryApiKey: "k" }, { cloudinaryApiSecret: "s" },
    { cloudinaryApiKey: "", cloudinaryApiSecret: "s" }, { cloudinaryApiKey: "k", cloudinaryApiSecret: "" },
    { cloudinaryApiKey: 1, cloudinaryApiSecret: "s" }, null];
  for (const secrets of shapes) {
    const root = tmpSite();
    const token = crypto.randomUUID();
    const srv = createServer({ root, config: { push: false }, templates: {}, secrets, token });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    try {
      const r = await fetch("http://127.0.0.1:" + srv.address().port + "/api/sign", {
        method: "POST",
        headers: { "content-type": "application/json", "x-editor-token": token },
        body: JSON.stringify({ paramsToSign: { timestamp: Math.floor(Date.now() / 1000) } }),
      });
      assert.equal(r.status, 503, `expected 503 for secrets=${JSON.stringify(secrets)}, got ${r.status}`);
    } finally {
      await new Promise((res) => srv.close(res));
    }
  }
});

test("Fix 3: /api/sign still 200s with a correctly-shaped secrets object", async () => {
  const root = tmpSite();
  fs.writeFileSync(path.join(root, "content.js"),
    '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"cloudName": "demo"};\n/* CONTENT:END */');
  const token = crypto.randomUUID();
  const secrets = { cloudinaryApiKey: "key123", cloudinaryApiSecret: "secret123" };
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const r = await fetch("http://127.0.0.1:" + srv.address().port + "/api/sign", {
      method: "POST",
      headers: { "content-type": "application/json", "x-editor-token": token },
      body: JSON.stringify({ paramsToSign: { timestamp: Math.floor(Date.now() / 1000) } }),
    });
    assert.equal(r.status, 200);
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

// ---- Fix round 4, Fix 7: a literal `null` (or non-object) JSON body must not crash /api/sign ----

test("Fix 7: POST /api/sign with a literal `null` body 400s instead of raising a raw TypeError", async () => {
  const root = tmpSite();
  fs.writeFileSync(path.join(root, "content.js"),
    '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"cloudName": "demo"};\n/* CONTENT:END */');
  const token = crypto.randomUUID();
  const secrets = { cloudinaryApiKey: "key123", cloudinaryApiSecret: "secret123" };
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const r = await fetch("http://127.0.0.1:" + srv.address().port + "/api/sign", {
      method: "POST",
      headers: { "content-type": "application/json", "x-editor-token": token },
      body: "null",
    });
    assert.equal(r.status, 400);
    const text = await r.text();
    assert.ok(!/Cannot read propert/.test(text), "must not leak a raw TypeError message");
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

test("Fix 7: POST /api/sign with paramsToSign as a non-object (a string) 400s", async () => {
  const root = tmpSite();
  fs.writeFileSync(path.join(root, "content.js"),
    '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"cloudName": "demo"};\n/* CONTENT:END */');
  const token = crypto.randomUUID();
  const secrets = { cloudinaryApiKey: "key123", cloudinaryApiSecret: "secret123" };
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const r = await fetch("http://127.0.0.1:" + srv.address().port + "/api/sign", {
      method: "POST",
      headers: { "content-type": "application/json", "x-editor-token": token },
      body: JSON.stringify({ paramsToSign: "timestamp" }),
    });
    assert.equal(r.status, 400);
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

// ---- Fix round 4, Fix 7: a malformed /api/save patch (not { ops: [...] }) must 400, not silently no-op ----

test("Fix 7: /api/save rejects a patch that isn't { ops: [...] } — file untouched, not a silent 200 no-op", async () => {
  const root = tmpSite();
  const page = `<html><body><x-dc></x-dc><script type="text/x-dc" data-dc-script>
/* CONTENT:BEGIN */
const CONTENT = { "hero": { "title": "Old" } };
/* CONTENT:END */
class Component {}
</script></body></html>`;
  fs.writeFileSync(path.join(root, "index.html"), page);
  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const before = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const base = "http://127.0.0.1:" + srv.address().port;
    const badPatches = [{ ops: "not-an-array" }, "a string", null, 42, { notOps: [] }, []];
    for (const patch of badPatches) {
      const r = await fetch(base + "/api/save", {
        method: "POST",
        headers: { "content-type": "application/json", "x-editor-token": token },
        body: JSON.stringify({ file: "index.html", patch }),
      });
      assert.equal(r.status, 400, `expected 400 for patch=${JSON.stringify(patch)}, got ${r.status}`);
    }
    assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), before, "file must be byte-identical — no ops silently applied");
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

// ---- Fix round 4, Fix 4: unexpected fs-level exceptions must not leak absolute local paths ----

test("Fix 4: an unreadable file under root does not leak its absolute path to the client (error logged server-side instead)", async () => {
  const root = tmpSite();
  const lockedPath = path.join(root, "locked.txt");
  fs.writeFileSync(lockedPath, "shh");
  fs.chmodSync(lockedPath, 0o000);
  if (process.getuid && process.getuid() === 0) {
    // Running as root ignores file permission bits entirely — this guard cannot be
    // exercised under root and would otherwise false-fail on some CI/container setups.
    fs.chmodSync(lockedPath, 0o644);
    return;
  }
  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const origConsoleError = console.error;
  let loggedServerSide = false;
  console.error = (...args) => { loggedServerSide = true; };
  try {
    const r = await fetch("http://127.0.0.1:" + srv.address().port + "/locked.txt");
    assert.equal(r.status, 400);
    const text = await r.text();
    assert.ok(!text.includes(root), `response must not contain the absolute local path, got: ${text}`);
    assert.ok(!text.includes("EACCES"), `response must not contain the raw error code, got: ${text}`);
    assert.equal(loggedServerSide, true, "the real error must still be logged server-side for the collaborator running the server");
  } finally {
    console.error = origConsoleError;
    fs.chmodSync(lockedPath, 0o644);
    await new Promise((res) => srv.close(res));
  }
});

test("Fix 4: a validation error from applyPatch (not a raw fs error) still returns its specific, useful message — contrast case, must NOT be genericised", async () => {
  // Only unexpected fs/OS errors (identified by e.code) are genericised by Fix 4. Errors
  // thrown by our own validators — like applyPatch's "Unknown or non-text path" — carry no
  // `.code` and are deliberate, useful feedback that must keep flowing to the client as-is.
  const root = tmpSite();
  const page = `<html><body><x-dc></x-dc><script type="text/x-dc" data-dc-script>
/* CONTENT:BEGIN */
const CONTENT = { "hero": { "title": "Old" } };
/* CONTENT:END */
class Component {}
</script></body></html>`;
  fs.writeFileSync(path.join(root, "index.html"), page);
  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const r = await fetch("http://127.0.0.1:" + srv.address().port + "/api/save", {
      method: "POST",
      headers: { "content-type": "application/json", "x-editor-token": token },
      body: JSON.stringify({ file: "index.html", patch: { ops: [{ type: "set", path: "hero.nope", value: "x" }] } }),
    });
    assert.equal(r.status, 400);
    const text = await r.text();
    assert.match(text, /Unknown or non-text path/);
  } finally {
    await new Promise((res) => srv.close(res));
  }
});

// ---- content-type strictness (fold-in C) ----

test("api guard rejects a near-miss content-type like application/json-evil — 415", async () => {
  const { base, token } = await boot();
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json-evil", "x-editor-token": token },
    body: JSON.stringify({ message: "x" }),
  });
  assert.equal(r.status, 415);
});

test("api guard accepts application/json; charset=utf-8 (what real browsers send)", async () => {
  const { base, token } = await boot();
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", "x-editor-token": token },
    body: JSON.stringify({ message: "x" }),
  });
  assert.notEqual(r.status, 415);
});

// ---- Critical 1: token / content-type / origin guard on every /api/* route ----

test("api guard rejects missing token on /api/publish — 403", async () => {
  const { base } = await boot();
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "x" }),
  });
  assert.equal(r.status, 403);
});

test("api guard rejects wrong token on /api/publish — 403", async () => {
  const { base } = await boot();
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": "wrong" },
    body: JSON.stringify({ message: "x" }),
  });
  assert.equal(r.status, 403);
});

test("api guard rejects non-JSON content-type even with a valid token — 415 (CORS simple-request bypass)", async () => {
  const { base, token } = await boot();
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "text/plain", "x-editor-token": token },
    body: JSON.stringify({ message: "x" }),
  });
  assert.equal(r.status, 415);
});

test("api guard rejects a foreign Origin even with a valid token — 403", async () => {
  const { base, token } = await boot();
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token, origin: "http://evil.example" },
    body: JSON.stringify({ message: "x" }),
  });
  assert.equal(r.status, 403);
});

test("api guard accepts a matching localhost/127.0.0.1 Origin", async () => {
  const { base, token, srv } = await boot();
  const port = srv.address().port;
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token, origin: "http://127.0.0.1:" + port },
    body: JSON.stringify({ message: "x" }),
  });
  // Origin/token/content-type all pass; falls through to the real publish handler (this
  // fixture has no git repo, so it 400s inside the handler — the point is it is NOT 403/415).
  assert.notEqual(r.status, 403);
  assert.notEqual(r.status, 415);
});

// ---- Critical 3: /api/sign is not an open signing oracle ----

async function bootSign() {
  const root = tmpSite();
  fs.writeFileSync(path.join(root, "content.js"),
    '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"cloudName": "demo"};\n/* CONTENT:END */');
  const token = crypto.randomUUID();
  const secrets = { cloudinaryApiKey: "key123", cloudinaryApiSecret: "secret123" };
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const base = "http://127.0.0.1:" + srv.address().port;
  const sign = (paramsToSign) => fetch(base + "/api/sign", {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token },
    body: JSON.stringify({ paramsToSign }),
  });
  return { sign };
}

test("sign rejects a disallowed parameter (e.g. public_ids, a destroy/rename shaped payload)", async () => {
  const { sign } = await bootSign();
  const r = await sign({ timestamp: Math.floor(Date.now() / 1000), public_ids: ["a", "b"] });
  assert.equal(r.status, 400);
});

test("sign rejects a stale timestamp", async () => {
  const { sign } = await bootSign();
  const staleTs = Math.floor(Date.now() / 1000) - 1000; // > 120s skew
  const r = await sign({ timestamp: staleTs, folder: "news" });
  assert.equal(r.status, 400);
});

test("sign accepts an allowlisted, fresh request", async () => {
  const { sign } = await bootSign();
  const r = await sign({ timestamp: Math.floor(Date.now() / 1000), folder: "news" });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.apiKey, "key123");
  assert.equal(typeof body.signature, "string");
});

// ---- Important 4: CONTENT marker injection guard (patch.js) ----

test("a set value containing CONTENT:BEGIN is rejected too (not just CONTENT:END)", async () => {
  const { applyPatch } = require("../lib/patch.js");
  assert.throws(
    () => applyPatch({ hero: { title: "x" } }, { ops: [{ type: "set", path: "hero.title", value: "/* CONTENT:BEGIN */" }] }, {}),
    /CONTENT:BEGIN|CONTENT:END/,
  );
});

// ---- Important 6: readJson must not corrupt multi-byte UTF-8 split across chunks ----

test("readJson reassembles a multi-byte UTF-8 character split across a chunk boundary", async () => {
  const payload = JSON.stringify({ value: "A—B·C" }); // em dash (3 bytes) + middle dot (2 bytes)
  const buf = Buffer.from(payload, "utf8");
  const emDashStart = buf.indexOf(0xe2); // first byte of the UTF-8 em-dash sequence
  assert.ok(emDashStart > 0, "fixture must contain the em dash byte sequence");
  // Split INSIDE the multi-byte sequence: chunk1 ends one byte into the character.
  const chunk1 = buf.subarray(0, emDashStart + 1);
  const chunk2 = buf.subarray(emDashStart + 1);

  const fakeReq = new EventEmitter();
  const pending = readJson(fakeReq);
  fakeReq.emit("data", chunk1);
  fakeReq.emit("data", chunk2);
  fakeReq.emit("end");

  const result = await pending;
  assert.equal(result.value, "A—B·C");
});

test("readJson destroys the request and rejects once the 5MB guard is exceeded", async () => {
  const fakeReq = new EventEmitter();
  let destroyed = false;
  fakeReq.destroy = () => { destroyed = true; };
  const pending = readJson(fakeReq);
  fakeReq.emit("data", Buffer.alloc(6e6)); // over the 5MB cap
  await assert.rejects(pending);
  assert.equal(destroyed, true);
});
