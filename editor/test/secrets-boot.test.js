"use strict";
// Fix round 4, Fix 2: `loadSecrets` and `staleSecretsWarning` (server.js) are the pure
// functions extracted out of `if (require.main === module)`, which no unit test could
// previously reach. Reverting `secretsPath` back to `path.join(__dirname, "secrets.json")`,
// or deleting the stale-secrets warning, both left the full 71/71-passing suite untouched —
// that's the vacuity this file exists to close.
//
// Every fixture here is a DISPOSABLE tmp directory standing in for $HOME or editor/. This
// file never reads or writes the real $HOME/.msc-editor/secrets.json or the real
// editor/secrets.json — both must stay absent, a standing project constraint.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadSecrets, secretsPathFor, staleSecretsWarning, hasValidCloudinarySecrets } = require("../server.js");

function fixtureHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "msc-home-"));
}

function withSilencedWarn(fn) {
  const orig = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args.join(" "));
  try { return { result: fn(), calls }; }
  finally { console.warn = orig; }
}

// ---- secretsPathFor ----

test("secretsPathFor joins homedir + .msc-editor/secrets.json for an absolute homedir", () => {
  const home = fixtureHome();
  assert.equal(secretsPathFor(home), path.join(home, ".msc-editor", "secrets.json"));
});

test("secretsPathFor returns null for a non-absolute or missing homedir (never resolves relative to CWD)", () => {
  assert.equal(secretsPathFor(""), null);
  assert.equal(secretsPathFor("relative/dir"), null);
  assert.equal(secretsPathFor(undefined), null);
  assert.equal(secretsPathFor(null), null);
  assert.equal(secretsPathFor(42), null);
});

// ---- loadSecrets: the happy path and the "nothing configured" path ----

test("loadSecrets reads and parses <home>/.msc-editor/secrets.json", () => {
  const home = fixtureHome();
  fs.mkdirSync(path.join(home, ".msc-editor"));
  const secrets = { cloudinaryApiKey: "k-" + crypto.randomUUID(), cloudinaryApiSecret: "s-" + crypto.randomUUID() };
  fs.writeFileSync(path.join(home, ".msc-editor", "secrets.json"), JSON.stringify(secrets));
  assert.deepEqual(loadSecrets(home), secrets);
});

test("loadSecrets returns null (silently, no warning) when nothing is configured yet — ENOENT is the expected fresh-checkout state", () => {
  const home = fixtureHome(); // empty — no .msc-editor at all
  const { result, calls } = withSilencedWarn(() => loadSecrets(home));
  assert.equal(result, null);
  assert.deepEqual(calls, [], "ENOENT must not produce a misconfiguration warning");
});

// ---- loadSecrets: the 11 hostile HOME scenarios must never crash, always fall back to null ----

test("loadSecrets never throws across hostile HOME scenarios: unset, nonexistent, symlink, .msc-editor as a file, secrets.json as a directory, mode 000, malformed JSON, JSON null, bare number", () => {
  const scenarios = [];

  // 1. undefined / unset
  scenarios.push(["undefined homedir", undefined]);
  // 2. empty string (HOME="")
  scenarios.push(["empty-string homedir", ""]);
  // 3. nonexistent absolute path
  scenarios.push(["nonexistent homedir", path.join(os.tmpdir(), "msc-nope-" + crypto.randomUUID())]);

  // 4. homedir is itself a symlink to a real dir with a valid secrets file
  {
    const real = fixtureHome();
    fs.mkdirSync(path.join(real, ".msc-editor"));
    fs.writeFileSync(path.join(real, ".msc-editor", "secrets.json"),
      JSON.stringify({ cloudinaryApiKey: "k", cloudinaryApiSecret: "s" }));
    const link = path.join(os.tmpdir(), "msc-home-link-" + crypto.randomUUID());
    fs.symlinkSync(real, link, "dir");
    scenarios.push(["symlinked homedir (valid secrets)", link, { cloudinaryApiKey: "k", cloudinaryApiSecret: "s" }]);
  }

  // 5. .msc-editor exists as a FILE, not a directory
  {
    const home = fixtureHome();
    fs.writeFileSync(path.join(home, ".msc-editor"), "not a directory");
    scenarios.push([".msc-editor is a file", home]);
  }

  // 6. secrets.json exists as a DIRECTORY
  {
    const home = fixtureHome();
    fs.mkdirSync(path.join(home, ".msc-editor", "secrets.json"), { recursive: true });
    scenarios.push(["secrets.json is a directory", home]);
  }

  // 7. secrets.json mode 000 (skipped meaningfully under root, which ignores perm bits)
  {
    const home = fixtureHome();
    fs.mkdirSync(path.join(home, ".msc-editor"));
    const p = path.join(home, ".msc-editor", "secrets.json");
    fs.writeFileSync(p, JSON.stringify({ cloudinaryApiKey: "k", cloudinaryApiSecret: "s" }));
    fs.chmodSync(p, 0o000);
    scenarios.push(["secrets.json mode 000", home, undefined, () => fs.chmodSync(p, 0o644)]);
  }

  // 8. malformed JSON
  {
    const home = fixtureHome();
    fs.mkdirSync(path.join(home, ".msc-editor"));
    fs.writeFileSync(path.join(home, ".msc-editor", "secrets.json"), "{ not valid json");
    scenarios.push(["malformed JSON", home]);
  }

  // 9. JSON literal null
  {
    const home = fixtureHome();
    fs.mkdirSync(path.join(home, ".msc-editor"));
    fs.writeFileSync(path.join(home, ".msc-editor", "secrets.json"), "null");
    scenarios.push(["JSON null", home, null]);
  }

  // 10. bare number (parses fine, but is not a valid secrets shape — that's Fix 3's job,
  //     downstream of loadSecrets; loadSecrets itself must just not crash and must return
  //     the parsed value)
  {
    const home = fixtureHome();
    fs.mkdirSync(path.join(home, ".msc-editor"));
    fs.writeFileSync(path.join(home, ".msc-editor", "secrets.json"), "42");
    scenarios.push(["bare number", home, 42]);
  }

  const isRoot = process.getuid && process.getuid() === 0;
  for (const [name, home, expected, cleanup] of scenarios) {
    if (name === "secrets.json mode 000" && isRoot) { if (cleanup) cleanup(); continue; }
    let result;
    assert.doesNotThrow(() => { result = loadSecrets(home); }, `loadSecrets must not throw for: ${name}`);
    if (expected !== undefined) {
      assert.deepEqual(result, expected, `unexpected result for: ${name}`);
    } else if (!isRoot) {
      assert.equal(result, null, `expected null (uploads disabled) for: ${name}`);
    }
    if (cleanup) cleanup();
  }
});

// ---- Fix 2 fold-in: silent-disable must not mask a real misconfiguration ----

test("loadSecrets warns distinctly (does not stay silent) when the file exists but is unreadable — still returns null, never crashes", () => {
  if (process.getuid && process.getuid() === 0) return; // root ignores permission bits
  const home = fixtureHome();
  fs.mkdirSync(path.join(home, ".msc-editor"));
  const p = path.join(home, ".msc-editor", "secrets.json");
  fs.writeFileSync(p, JSON.stringify({ cloudinaryApiKey: "k", cloudinaryApiSecret: "s" }));
  fs.chmodSync(p, 0o000);
  try {
    const { result, calls } = withSilencedWarn(() => loadSecrets(home));
    assert.equal(result, null);
    assert.ok(calls.length > 0, "an EACCES must produce a warning, unlike plain ENOENT");
    assert.ok(calls.some((c) => c.includes(p)), "the warning should name the path that failed");
  } finally {
    fs.chmodSync(p, 0o644);
  }
});

test("loadSecrets warns distinctly when the file exists but is not valid JSON", () => {
  const home = fixtureHome();
  fs.mkdirSync(path.join(home, ".msc-editor"));
  fs.writeFileSync(path.join(home, ".msc-editor", "secrets.json"), "{ not valid json");
  const { result, calls } = withSilencedWarn(() => loadSecrets(home));
  assert.equal(result, null);
  assert.ok(calls.length > 0, "malformed JSON must produce a warning, unlike plain ENOENT");
});

// ---- Fix 2 fold-in: HOME="" (or any non-absolute homedir) must not resolve relative to CWD ----

test("loadSecrets treats a non-absolute homedir as unconfigured, with a distinct warning — never resolves relative to the server's CWD", () => {
  const { result, calls } = withSilencedWarn(() => loadSecrets(""));
  assert.equal(result, null);
  assert.ok(calls.length > 0, "a non-absolute/unusable homedir should warn distinctly, not stay silent like plain ENOENT");
  // The failure mode this guards against: joining "" with .msc-editor/secrets.json would
  // resolve to a path INSIDE the current working directory (which, for this project, is
  // inside the served repository) rather than correctly reporting "no home directory".
  assert.ok(!fs.existsSync(path.join(process.cwd(), ".msc-editor", "secrets.json")),
    "must never have resolved into (or created a real read of) a CWD-relative path");
});

// ---- staleSecretsWarning ----

test("staleSecretsWarning returns null when no leftover editor/secrets.json exists at the given editorDir", () => {
  const fixtureEditorDir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-editordir-"));
  assert.equal(staleSecretsWarning(fixtureEditorDir), null);
});

test("staleSecretsWarning names the stale path when a leftover secrets.json exists (fixture editor dir, never the real one)", () => {
  const fixtureEditorDir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-editordir-"));
  const stalePath = path.join(fixtureEditorDir, "secrets.json");
  fs.writeFileSync(stalePath, JSON.stringify({ cloudinaryApiSecret: "whatever" }));
  const warning = staleSecretsWarning(fixtureEditorDir);
  assert.ok(typeof warning === "string" && warning.length > 0);
  assert.ok(warning.includes(stalePath), "warning should name the exact stale path");
});

test("the real editor/secrets.json is absent (standing project constraint) — sanity check for every test above", () => {
  const realEditorDir = path.join(__dirname, "..");
  assert.equal(fs.existsSync(path.join(realEditorDir, "secrets.json")), false);
  assert.equal(fs.existsSync(path.join(os.homedir(), ".msc-editor", "secrets.json")), false);
});

// ---- hasValidCloudinarySecrets (used by Fix 3 at /api/sign; unit-level here) ----

test("hasValidCloudinarySecrets requires both keys to be non-empty strings", () => {
  assert.equal(hasValidCloudinarySecrets(null), false);
  assert.equal(hasValidCloudinarySecrets(undefined), false);
  assert.equal(hasValidCloudinarySecrets(42), false);
  assert.equal(hasValidCloudinarySecrets([]), false);
  assert.equal(hasValidCloudinarySecrets("x"), false);
  assert.equal(hasValidCloudinarySecrets({}), false);
  assert.equal(hasValidCloudinarySecrets({ cloudinaryApiKey: "k" }), false);
  assert.equal(hasValidCloudinarySecrets({ cloudinaryApiSecret: "s" }), false);
  assert.equal(hasValidCloudinarySecrets({ cloudinaryApiKey: "", cloudinaryApiSecret: "s" }), false);
  assert.equal(hasValidCloudinarySecrets({ cloudinaryApiKey: "k", cloudinaryApiSecret: "" }), false);
  assert.equal(hasValidCloudinarySecrets({ cloudinaryApiKey: 1, cloudinaryApiSecret: "s" }), false);
  assert.equal(hasValidCloudinarySecrets({ cloudinaryApiKey: "k", cloudinaryApiSecret: "s" }), true);
});
