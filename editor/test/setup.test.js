"use strict";
// setup.js is the one script in this codebase that writes a credential to disk. An untested
// writer that gets the path or the file mode wrong silently recreates the exact vulnerability
// fix round 3 existed to close (a Cloudinary secret reachable inside the served web root) — so
// every property that matters (where it lands, what mode it lands with, that content.js is
// rewritten through extractContent/replaceContent rather than string-patched, that blank input
// is refused) is asserted here, not just exercised.
//
// Every fixture is a disposable tmp directory standing in for $HOME and for content.js. This
// file never reads or writes the real $HOME/.msc-editor/secrets.json, and never touches
// anything under the repo's own editor/ directory — both are asserted explicitly below.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeCredentials } = require("../setup.js");
const { extractContent } = require("../lib/content-io.js");

function fixtureHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "msc-setup-home-"));
}

// A content.js stand-in with prose outside the CONTENT block on both sides, so a test can
// prove that prose survives byte-for-byte — replaceContent only ever touches the slice
// between the markers.
const HEAD = "// header comment, not part of the CONTENT block\n<script>\n";
const TAIL = "\nrest();\n</script>\n// trailing comment\n";
function fixtureContentJs() {
  const body = '/* CONTENT:BEGIN */\nconst CONTENT = {\n  "cloudName": "REPLACE_AFTER_SETUP",\n  "other": 1\n};\n/* CONTENT:END */';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-setup-content-"));
  const contentPath = path.join(dir, "content.js");
  const src = HEAD + body + TAIL;
  fs.writeFileSync(contentPath, src);
  return { contentPath, src };
}

// ---- lands in the right place, with exactly the right shape ----

test("writes secrets.json at <home>/.msc-editor/secrets.json with exactly the two expected keys", () => {
  const homedir = fixtureHome();
  const { contentPath } = fixtureContentJs();
  const { secretsPath } = writeCredentials({
    homedir, contentPath, cloudName: "demo-cloud", apiKey: "key123", apiSecret: "secret456",
  });
  assert.equal(secretsPath, path.join(homedir, ".msc-editor", "secrets.json"));
  const written = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  assert.deepEqual(Object.keys(written).sort(), ["cloudinaryApiKey", "cloudinaryApiSecret"]);
  assert.equal(written.cloudinaryApiKey, "key123");
  assert.equal(written.cloudinaryApiSecret, "secret456");
});

// ---- modes ----

test("secrets.json is written mode 0600 and .msc-editor mode 0700", () => {
  if (process.platform === "win32") return; // POSIX permission bits don't apply
  const homedir = fixtureHome();
  const { contentPath } = fixtureContentJs();
  const { secretsPath } = writeCredentials({
    homedir, contentPath, cloudName: "demo-cloud", apiKey: "key123", apiSecret: "secret456",
  });
  const dirMode = fs.statSync(path.join(homedir, ".msc-editor")).mode & 0o777;
  const fileMode = fs.statSync(secretsPath).mode & 0o777;
  assert.equal(dirMode, 0o700, "directory must be owner-only");
  assert.equal(fileMode, 0o600, "file must be owner-only");
});

test("mode is corrected even when .msc-editor already exists looser (mode does not just 'stick' from mkdir)", () => {
  if (process.platform === "win32") return;
  const homedir = fixtureHome();
  const { contentPath } = fixtureContentJs();
  const secretsDir = path.join(homedir, ".msc-editor");
  fs.mkdirSync(secretsDir, { mode: 0o755 }); // pre-existing, wide-open directory
  const { secretsPath } = writeCredentials({
    homedir, contentPath, cloudName: "demo-cloud", apiKey: "key123", apiSecret: "secret456",
  });
  assert.equal(fs.statSync(secretsDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(secretsPath).mode & 0o777, 0o600);
});

// ---- content.js is rewritten through extractContent/replaceContent, not string-patched ----

test("updates cloudName via extractContent/replaceContent and leaves the rest of content.js byte-for-byte", () => {
  const homedir = fixtureHome();
  const { contentPath, src } = fixtureContentJs();
  writeCredentials({ homedir, contentPath, cloudName: "acme-cloud", apiKey: "k", apiSecret: "s" });
  const out = fs.readFileSync(contentPath, "utf8");

  assert.ok(out.startsWith(HEAD), "text before the CONTENT:BEGIN marker must survive untouched");
  assert.ok(out.endsWith(TAIL), "text after the CONTENT:END marker must survive untouched");

  const { data } = extractContent(out);
  assert.equal(data.cloudName, "acme-cloud");
  assert.equal(data.other, 1, "keys other than cloudName must be preserved");

  // Prove the original placeholder is gone rather than merely appended alongside it —
  // a naive string-patch (e.g. a global find/replace of the old cloud name) could pass the
  // assertions above while leaving a stray second occurrence in a comment or elsewhere.
  assert.equal((out.match(/REPLACE_AFTER_SETUP/g) || []).length, 0);
  assert.deepEqual(extractContent(src).data, { cloudName: "REPLACE_AFTER_SETUP", other: 1 }, "sanity: original fixture had the placeholder");
});

// ---- validation: blank/whitespace input is refused, and refused BEFORE anything is written ----

for (const [label, values] of [
  ["empty cloudName", { cloudName: "", apiKey: "k", apiSecret: "s" }],
  ["whitespace-only cloudName", { cloudName: "   ", apiKey: "k", apiSecret: "s" }],
  ["empty apiKey", { cloudName: "c", apiKey: "", apiSecret: "s" }],
  ["whitespace-only apiSecret", { cloudName: "c", apiKey: "k", apiSecret: "\t\n " }],
  ["all missing", {}],
]) {
  test(`rejects ${label} without writing anything`, () => {
    const homedir = fixtureHome();
    const { contentPath, src } = fixtureContentJs();
    assert.throws(() => writeCredentials({ homedir, contentPath, ...values }), /required/);
    assert.equal(fs.existsSync(path.join(homedir, ".msc-editor")), false, "no directory must be created on rejected input");
    assert.equal(fs.readFileSync(contentPath, "utf8"), src, "content.js must be untouched on rejected input");
  });
}

test("trims surrounding whitespace from otherwise-valid values before writing", () => {
  const homedir = fixtureHome();
  const { contentPath } = fixtureContentJs();
  const { secretsPath } = writeCredentials({
    homedir, contentPath, cloudName: "  padded-cloud  ", apiKey: " key ", apiSecret: " secret ",
  });
  const written = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  assert.equal(written.cloudinaryApiKey, "key");
  assert.equal(written.cloudinaryApiSecret, "secret");
  assert.equal(extractContent(fs.readFileSync(contentPath, "utf8")).data.cloudName, "padded-cloud");
});

// ---- never touches the real repo's editor/ directory, or the real home ----

test("never writes under the repo's own editor/ directory (standing project constraint)", () => {
  const realEditorDir = path.join(__dirname, "..");
  const before = fs.existsSync(path.join(realEditorDir, "secrets.json"));
  assert.equal(before, false, "sanity: no stray secrets.json should exist in editor/ before this test runs");

  const homedir = fixtureHome();
  assert.notEqual(homedir, os.homedir(), "sanity: the fixture home must differ from the real one");
  const { contentPath } = fixtureContentJs();
  writeCredentials({ homedir, contentPath, cloudName: "demo-cloud", apiKey: "k", apiSecret: "s" });

  assert.equal(fs.existsSync(path.join(realEditorDir, "secrets.json")), false);
});
