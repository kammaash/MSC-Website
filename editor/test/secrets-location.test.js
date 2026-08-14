"use strict";
// Round 3: the Cloudinary secret must live OUTSIDE the served tree entirely
// (~/.msc-editor/secrets.json), because every route into a file INSIDE editor/ turned out
// to be just a different bypass of the same badly-placed file — case-varied URLs (round 2),
// then five more via symlinks/hard-links (this round). These tests prove each of the five
// proven leak vectors is closed, using a PRODUCTION-SHAPED fixture (a copied `site/editor/`
// tree, so `root === path.dirname(editorDir)` holds exactly as it does in production) — a
// plain tmp-dir root cannot reproduce most of these, because the symlinks/hardlinks below
// need to be rooted at a real repo layout and point at a real editor/ directory by
// construction.
//
// Pre-merge fix round: this file used to build that production shape by writing directly
// into the REAL repository — a uniquely-named canary under the real editor/, symlinks at
// the real repo root, and a real editor/lib/evil.js — cleaned up in a `finally` block. A
// SIGKILL mid-run (the reviewer's own repro) skipped every `finally` and left all of that
// behind in the actual working tree, including a `pub -> editor/` directory symlink: with
// must-fix 1 (the whole-index publish commit) unpatched, a habitual `git add -A` plus one
// Publish click would have put a directory symlink into `editor/` on the LIVE site. Every
// fixture below now lives inside a disposable `mkdtemp` copy instead — see buildFixture() —
// so nothing here ever touches the real repository, SIGKILL or not; only the leftover tmp
// directory itself can survive a SIGKILL, same residual risk every other fixture in this
// suite (e.g. symlinked-editor-dir.test.js) already accepts.
//
// This file previously also refused to run at all (assertNoRealSecretsPresent(), throwing
// if ~/.msc-editor/secrets.json existed) even though none of these tests read or write that
// path — the normal end state of `npm run setup` made this suite's OWN security coverage
// silently unreachable, masked by an unrelated thrown error. Removed; see
// secrets-boot.test.js's own fix for the same class of problem (the textual-property test
// near the bottom of that file) for the pattern this follows: assert what's actually true —
// nothing here touches the real ~/.msc-editor/secrets.json — rather than requiring a
// particular machine state to even start.
//
// CAUTION (own round-2 notes): os.tmpdir() is itself a symlink on macOS (/var ->
// /private/var). That does not matter for the fixtures here (everything under a fixture is
// resolved relative to that fixture's own mkdtemp'd root), but it is why every containment
// check in server.js realpaths both sides before comparing — see server.js's comments.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createServer } = require("../server.js");

const EDITOR_DIR = path.join(__dirname, "..");
const REPO_ROOT = path.dirname(EDITOR_DIR);
const LIB_FILES = ["content-io.js", "patch.js", "cloudinary.js", "media-db.js", "paths.js", "media-urls.js", "youtube.js"];

// Builds a disposable, production-shaped COPY of the served tree: <tmp>/site/editor/{
// server.js, lib/*.js[, client/*.js]}, with "site" playing the role of REPO_ROOT (editor's
// parent) exactly as in production. Every fixture a test plants (canaries, symlinks, extra
// client files) goes inside this copy — never inside the real repository.
//
// requireServer() loads THIS COPY's server.js — a distinct file path from the real
// editor/server.js, so Node's require cache never conflates the two — which means
// `createServer`'s own `__dirname` (server.js's `editorDir`) resolves to the fixture's
// copied editor/, not the real one. That is what lets these tests exercise the real
// containment logic against fixture-only files, and it always tests whatever server.js
// CURRENTLY contains (this run's code), not a frozen snapshot.
function buildFixture({ withClient } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "msc-secloc-"));
  const repoRoot = path.join(tmp, "site");
  const editorDir = path.join(repoRoot, "editor");
  const libDir = path.join(editorDir, "lib");
  fs.mkdirSync(libDir, { recursive: true });
  // Minimal but real: the static handler needs an actual "/" to serve for the
  // positive-controls test, and the injection point (`</body>`) must be present.
  fs.writeFileSync(path.join(repoRoot, "index.html"), "<html><body>fixture</body></html>");

  fs.copyFileSync(path.join(EDITOR_DIR, "server.js"), path.join(editorDir, "server.js"));
  for (const f of LIB_FILES) fs.copyFileSync(path.join(EDITOR_DIR, "lib", f), path.join(libDir, f));

  if (withClient) fs.mkdirSync(path.join(editorDir, "client"), { recursive: true });

  return {
    repoRoot, editorDir, libDir,
    requireServer: () => require(path.join(editorDir, "server.js")),
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

async function bootFixture(fixture) {
  const token = crypto.randomUUID();
  const srv = fixture.requireServer().createServer({
    root: fixture.repoRoot, config: { push: false }, templates: {}, secrets: null, token,
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, base: "http://127.0.0.1:" + srv.address().port, token };
}

// ---- The five proven leak vectors, plus case variants ----

test("five leak vectors are all closed: root file symlink, root directory symlink, and an in-editor/lib symlink — plus case variants", async () => {
  const fixture = buildFixture();
  let srv;
  try {
    // A uniquely-named canary under the FIXTURE's editor/ — NOT literally "secrets.json".
    // The property under test ("no symlink trick reaches an unlisted file inside editor/")
    // is general, not specific to that one filename.
    const canaryName = "_round3_canary_" + crypto.randomUUID() + ".json";
    const canaryPath = path.join(fixture.editorDir, canaryName);
    const canaryMarker = "SECRET-MARKER-" + crypto.randomUUID();
    fs.writeFileSync(canaryPath, JSON.stringify({ cloudinaryApiSecret: canaryMarker }));

    const leakAbs = path.join(fixture.repoRoot, "leak.json"); // vector 1: absolute symlink -> editor/<canary>
    const leakRel = path.join(fixture.repoRoot, "relleak.json"); // vector 2: relative-target symlink, same file
    const pubDir = path.join(fixture.repoRoot, "pub"); // vector 3: directory symlink -> editor/
    const evilJs = path.join(fixture.libDir, "evil.js"); // vector 4: in-lib symlink -> ../<canary>

    fs.symlinkSync(canaryPath, leakAbs);
    fs.symlinkSync("editor/" + canaryName, leakRel, "file"); // relative target, resolved from repoRoot
    fs.symlinkSync(fixture.editorDir, pubDir, "dir");
    fs.symlinkSync("../" + canaryName, evilJs, "file"); // a name that itself passes the allowlist

    const boot = await bootFixture(fixture);
    srv = boot.srv;
    const base = boot.base;

    const requests = [
      "/leak.json", // vector 1
      "/relleak.json", // vector 2 (relative-target symlink)
      "/LEAK.json", // case variant of vector 1
      "/pub/" + canaryName, // vector 3
      "/PUB/" + canaryName, // case variant of vector 3
      "/editor/lib/evil.js", // vector 4 (passes the allowlist by NAME alone)
      "/EDITOR/lib/EVIL.js", // case variant of vector 4
    ];
    for (const p of requests) {
      const r = await fetch(base + p);
      assert.ok(r.status === 403 || r.status === 404, `expected 403 or 404 for ${p}, got ${r.status}`);
      const text = await r.text();
      assert.ok(!text.includes(canaryMarker), `${p} response must not contain the canary marker`);
    }

    // Positive control through the SAME production-shaped server: the fix must not
    // over-block legitimate allowlisted files.
    const ok1 = await fetch(base + "/editor/lib/paths.js");
    assert.equal(ok1.status, 200);
  } finally {
    if (srv) await new Promise((r) => srv.close(r));
    fixture.cleanup();
  }
});

// ---- Hard link: no path-based check can catch this. Assert what's reachable, not realpath behaviour. ----

test("Fix 1: the real secrets file lives outside both served directories (necessary, but NOT sufficient against hard links — see below)", async () => {
  // fs.realpathSync cannot distinguish a hard-linked file from any other ordinary file in
  // its directory (by design — a hard link IS the file, not a pointer to it), so no
  // path-based guard in server.js can ever detect or block one. Round 4 PROVED that moving
  // the secret to ~/.msc-editor/secrets.json does NOT close the hard-link vector: `ln
  // ~/.msc-editor/secrets.json <repo>/harmless.txt` then `GET /harmless.txt` still serves
  // it. What this test actually establishes is narrower and still true: the secret's
  // real, canonical location is outside both served directories, so at minimum no URL
  // alone (no path trick, no case variant, no symlink) can reach it — reaching it now
  // requires an attacker who can already create a hard link inside the served tree, i.e.
  // one who already has local filesystem write access and could just read
  // ~/.msc-editor/secrets.json directly. See server.js's AUTHORITY part 2 comment for the
  // full reasoning. This test reads only path STRINGS (never the real file's contents,
  // and never requires it to exist or not) — it is safe to run on any machine.
  const realSecretsPath = path.join(os.homedir(), ".msc-editor", "secrets.json");

  // The real secrets location must not be textually inside either directory this server
  // ever serves from.
  assert.ok(
    realSecretsPath !== REPO_ROOT && !realSecretsPath.startsWith(REPO_ROOT + path.sep),
    "the real secrets path must not lie inside the served site root",
  );
  assert.ok(
    realSecretsPath !== EDITOR_DIR && !realSecretsPath.startsWith(EDITOR_DIR + path.sep),
    "the real secrets path must not lie inside the editor directory",
  );

  // And the old, in-tree location must not currently hold a real file — this is the one
  // guarantee this file ever needed to assert about the REAL repository, and it holds
  // regardless of whether ~/.msc-editor/secrets.json (the correct, current location) has
  // been set up on this machine or not.
  assert.equal(fs.existsSync(path.join(EDITOR_DIR, "secrets.json")), false);
});

test("demonstration only (not a code guard): a hard link INTO a test fixture is indistinguishable from an ordinary file — no path-based check, in server.js or anywhere else, can close this", async () => {
  // This test is NOT asserting a security property server.js enforces — there is none to
  // enforce here, by design (see the coordinator's note: realpath cannot resolve hard
  // links). It exists only to make the architectural limit concrete: within our OWN
  // disposable tmp fixture (never touching the real secret), a hard link to a "canary" file
  // is served exactly like any other file, because it genuinely IS just another file. This
  // is accepted, not fixed: creating the hard link in the first place requires local
  // filesystem write access to the served tree, at which point the real secrets file is
  // directly readable anyway — the hard link gains an attacker nothing new.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-hardlink-demo-"));
  const root = path.join(dir, "site");
  fs.mkdirSync(root);
  const canaryPath = path.join(dir, "canary-outside-root.txt");
  const canaryMarker = "HARDLINK-DEMO-" + crypto.randomUUID();
  fs.writeFileSync(canaryPath, canaryMarker);
  const hardLinkPath = path.join(root, "hardlink.txt");
  fs.linkSync(canaryPath, hardLinkPath); // same inode, same filesystem, new name inside root

  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const r = await fetch("http://127.0.0.1:" + srv.address().port + "/hardlink.txt");
    const text = await r.text();
    // Documented, expected, and unavoidable: this genuinely is 200 with the content,
    // because from the filesystem's point of view hardlink.txt is an ordinary file with
    // its own directory entry inside root, indistinguishable from one you'd create with a
    // text editor. No path-based server logic can or should try to stop this.
    assert.equal(r.status, 200);
    assert.equal(text, canaryMarker);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

// ---- /api/sign with no secrets file present ----

test("/api/sign returns 503 mentioning npm run setup when no secrets are configured", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-sec-nosecrets-"));
  const token = crypto.randomUUID();
  const srv = createServer({ root: dir, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const r = await fetch("http://127.0.0.1:" + srv.address().port + "/api/sign", {
      method: "POST",
      headers: { "content-type": "application/json", "x-editor-token": token },
      body: JSON.stringify({ paramsToSign: {} }),
    });
    assert.equal(r.status, 503);
    const text = await r.text();
    assert.match(text, /npm run setup/);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

// ---- Fix 3: relaxed client-file allowlist (dots permitted, nesting/".." still rejected) ----

test("Fix 3: a dotted client filename (e.g. a minified bundle) is servable; nested paths and traversal are not", async () => {
  const fixture = buildFixture({ withClient: true });
  let srv;
  try {
    fs.writeFileSync(path.join(fixture.editorDir, "client", "editor-client.min.js"), "/* fixture */");

    const boot = await bootFixture(fixture);
    srv = boot.srv;
    const base = boot.base;

    const ok = await fetch(base + "/editor/client/editor-client.min.js");
    assert.equal(ok.status, 200);

    // The literal ".." segment is blocked by the outer dot-segment check on the raw URL,
    // before any allowlist logic runs at all — no fixture file is needed for this to 403.
    const traversal = await fetch(base + "/editor/client/../secrets.json");
    assert.equal(traversal.status, 403);

    // Blocked by the pre-existence allowlist check regardless of whether config.json
    // actually exists in the fixture (it doesn't here) — same reasoning.
    const configJson = await fetch(base + "/editor/config.json");
    assert.equal(configJson.status, 403);
  } finally {
    if (srv) await new Promise((r) => srv.close(r));
    fixture.cleanup();
  }
});

// ---- Positive controls that must still pass ----

test("positive controls: /editor/lib/paths.js and /editor/client/draft.js are 200; page HTML still carries the token and six script tags", async () => {
  const fixture = buildFixture({ withClient: true });
  let srv;
  try {
    fs.writeFileSync(path.join(fixture.editorDir, "client", "draft.js"), "/* fixture: real draft.js lands in a later task */");

    const boot = await bootFixture(fixture);
    srv = boot.srv;
    const base = boot.base;

    const libOk = await fetch(base + "/editor/lib/paths.js");
    assert.equal(libOk.status, 200);

    const clientOk = await fetch(base + "/editor/client/draft.js");
    assert.equal(clientOk.status, 200);

    const page = await fetch(base + "/");
    const html = await page.text();
    assert.match(html, /window\.__EDITOR_TOKEN="[^"]+";<\/script><script src="\/editor\/lib\/paths\.js"><\/script><script src="\/editor\/lib\/media-urls\.js"><\/script><script src="\/editor\/client\/draft\.js"><\/script><script src="\/editor\/client\/editor-client\.js"><\/script><script src="\/editor\/client\/media\.js"><\/script><script src="\/editor\/client\/media-slots\.js"><\/script><\/body>/);
  } finally {
    if (srv) await new Promise((r) => srv.close(r));
    fixture.cleanup();
  }
});
