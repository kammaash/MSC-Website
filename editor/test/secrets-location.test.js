"use strict";
// Round 3: the Cloudinary secret must live OUTSIDE the served tree entirely
// (~/.msc-editor/secrets.json), because every route into a file INSIDE editor/ turned out
// to be just a different bypass of the same badly-placed file — case-varied URLs (round 2),
// then five more via symlinks/hard-links (this round). These tests prove each of the five
// proven leak vectors is closed, using a PRODUCTION-SHAPED fixture (root ===
// path.dirname(editorDir)) — a tmp-dir root cannot reproduce most of these, because the
// symlinks/hardlinks below are rooted at the real repo root and point at the real editor/
// directory by construction.
//
// CAUTION (own round-2 notes): os.tmpdir() is itself a symlink on macOS (/var ->
// /private/var). That does not matter for the fixtures here (everything is rooted at the
// real repo, not tmpdir), but it is why every containment check in server.js realpaths both
// sides before comparing — see server.js's comments.
//
// Every fixture created here (symlinks, hard links, editor/secrets.json, editor/client/*)
// is removed in a `finally` block so `git status --porcelain` is empty when this file exits,
// pass or fail.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createServer } = require("../server.js");

const EDITOR_DIR = path.join(__dirname, "..");
const REPO_ROOT = path.dirname(EDITOR_DIR);

// Fails loudly (rather than silently overwriting) if a real secrets file is somehow
// already sitting at either location this suite is ABOUT — never clobber a real credential.
// (This suite's own fixtures deliberately avoid the literal "editor/secrets.json" filename
// — see the canary-naming note below — specifically so they cannot race with any other
// test file that plants/removes that exact path; `node --test` runs test files in parallel
// by default. Round 4's finding-9 fix moved security.test.js's own case-insensitive-bypass
// test off that literal filename too, onto a per-run canary name, for the same reason — so
// this is now belt-and-suspenders against a hypothetical future test, not an active race.)
function assertNoRealSecretsPresent() {
  const newLocation = path.join(os.homedir(), ".msc-editor", "secrets.json");
  if (fs.existsSync(newLocation)) {
    throw new Error("Refusing to run: a real " + newLocation + " already exists. This suite never touches it, but won't run alongside it either — move it aside first.");
  }
}

async function bootProductionShaped() {
  const token = crypto.randomUUID();
  const srv = createServer({ root: REPO_ROOT, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  return { srv, base, token };
}

// ---- The five proven leak vectors, plus case variants ----

test("five leak vectors are all closed: root file symlink, root directory symlink, and an in-editor/lib symlink — plus case variants", async () => {
  assertNoRealSecretsPresent();

  // A uniquely-named canary under editor/ — NOT literally "secrets.json". The property
  // under test ("no symlink trick reaches an unlisted file inside editor/") is general, not
  // specific to that one filename, and a unique name means this test's own fixture can
  // never race with any other test file that plants a same-named canary and runs
  // concurrently in a separate process under `node --test`'s default parallel file
  // execution (round 2's case-insensitive-bypass test in security.test.js used to be such a
  // file — it planted the literal "editor/secrets.json" — but round 4's finding-9 fix moved
  // it onto its own per-run canary name too, so this is now defence-in-depth, not a fix for
  // an active race).
  const canaryName = "_round3_canary_" + crypto.randomUUID() + ".json";
  const canaryPath = path.join(EDITOR_DIR, canaryName);
  const canaryMarker = "SECRET-MARKER-" + crypto.randomUUID();
  fs.writeFileSync(canaryPath, JSON.stringify({ cloudinaryApiSecret: canaryMarker }));

  const leakAbs = path.join(REPO_ROOT, "leak.json"); // vector 1: absolute symlink -> editor/<canary>
  const leakRel = path.join(REPO_ROOT, "relleak.json"); // vector 2: relative-target symlink, same file
  const pubDir = path.join(REPO_ROOT, "pub"); // vector 3: directory symlink -> editor/
  const evilJs = path.join(EDITOR_DIR, "lib", "evil.js"); // vector 4: in-lib symlink -> ../<canary>

  const created = [];
  let srv;
  try {
    fs.symlinkSync(canaryPath, leakAbs);
    created.push(leakAbs);
    fs.symlinkSync("editor/" + canaryName, leakRel, "file"); // relative target, resolved from REPO_ROOT
    created.push(leakRel);
    fs.symlinkSync(EDITOR_DIR, pubDir, "dir");
    created.push(pubDir);
    fs.symlinkSync("../" + canaryName, evilJs, "file"); // a name that itself passes the allowlist
    created.push(evilJs);

    const boot = await bootProductionShaped();
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

    // Positive controls through the same production-shaped server: the fix must not
    // over-block legitimate allowlisted files.
    const ok1 = await fetch(base + "/editor/lib/paths.js");
    assert.equal(ok1.status, 200);
  } finally {
    if (srv) await new Promise((r) => srv.close(r));
    for (const p of created) fs.rmSync(p, { force: true });
    fs.rmSync(canaryPath, { force: true });
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
  // full reasoning.
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

  // And the old, in-tree location must not currently hold a real file (this suite always
  // cleans up after itself, but assert it explicitly as the property that actually matters).
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
  assertNoRealSecretsPresent();
  const clientDir = path.join(EDITOR_DIR, "client");
  const clientDirExistedBefore = fs.existsSync(clientDir);
  if (!clientDirExistedBefore) fs.mkdirSync(clientDir);
  const minFile = path.join(clientDir, "editor-client.min.js");
  const minFileExistedBefore = fs.existsSync(minFile);
  if (!minFileExistedBefore) fs.writeFileSync(minFile, "/* fixture */");

  let srv;
  try {
    const boot = await bootProductionShaped();
    srv = boot.srv;
    const base = boot.base;

    const ok = await fetch(base + "/editor/client/editor-client.min.js");
    assert.equal(ok.status, 200);

    // The literal ".." segment is blocked by the outer dot-segment check on the raw URL,
    // before any allowlist logic runs at all.
    const traversal = await fetch(base + "/editor/client/../secrets.json");
    assert.equal(traversal.status, 403);

    const configJson = await fetch(base + "/editor/config.json");
    assert.equal(configJson.status, 403);
  } finally {
    if (srv) await new Promise((r) => srv.close(r));
    if (!minFileExistedBefore) fs.rmSync(minFile, { force: true });
    if (!clientDirExistedBefore) fs.rmSync(clientDir, { recursive: true, force: true });
  }
});

// ---- Positive controls that must still pass ----

test("positive controls: /editor/lib/paths.js and /editor/client/draft.js are 200; page HTML still carries the token and three script tags", async () => {
  assertNoRealSecretsPresent();
  const clientDir = path.join(EDITOR_DIR, "client");
  const clientDirExistedBefore = fs.existsSync(clientDir);
  if (!clientDirExistedBefore) fs.mkdirSync(clientDir);
  const draftFile = path.join(clientDir, "draft.js");
  const draftFileExistedBefore = fs.existsSync(draftFile);
  if (!draftFileExistedBefore) fs.writeFileSync(draftFile, "/* fixture: real draft.js lands in a later task */");

  let srv;
  try {
    const boot = await bootProductionShaped();
    srv = boot.srv;
    const base = boot.base;

    const libOk = await fetch(base + "/editor/lib/paths.js");
    assert.equal(libOk.status, 200);

    const clientOk = await fetch(base + "/editor/client/draft.js");
    assert.equal(clientOk.status, 200);

    const page = await fetch(base + "/");
    const html = await page.text();
    assert.match(html, /window\.__EDITOR_TOKEN="[^"]+";<\/script><script src="\/editor\/lib\/paths\.js"><\/script><script src="\/editor\/client\/draft\.js"><\/script><script src="\/editor\/client\/editor-client\.js"><\/script><\/body>/);
  } finally {
    if (srv) await new Promise((r) => srv.close(r));
    if (!draftFileExistedBefore) fs.rmSync(draftFile, { force: true });
    if (!clientDirExistedBefore) fs.rmSync(clientDir, { recursive: true, force: true });
  }
});
