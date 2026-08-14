"use strict";
// media-slots.js only runs in a browser; source-level checks, same approach as
// editor-client.test.js / media-client.test.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const FILE = path.join(__dirname, "..", "client", "media-slots.js");
const SRC = fs.readFileSync(FILE, "utf8");

test("media-slots.js is syntactically valid", () => {
  execFileSync(process.execPath, ["--check", FILE]);
});

test("bails without EditorUI, EditorMedia, and EditorMediaUrls", () => {
  assert.match(SRC, /if \(!window\.EditorUI \|\| !window\.EditorMedia \|\| !window\.EditorMediaUrls\) return;/);
});

test("no network calls at all — placement is a pure content write", () => {
  assert.deepEqual(SRC.match(/[^a-zA-Z.]fetch\(/g) || [], []);
  assert.deepEqual(SRC.match(/apiFetch/g) || [], []);
});

test("apply-before-record: applyLocal runs inside try, draft.set only after", () => {
  const apply = SRC.slice(SRC.indexOf("function applyToSlot"));
  const applyLocalIdx = apply.indexOf("UI.applyLocal(");
  const draftSetIdx = apply.indexOf("UI.draft.set(");
  assert.ok(applyLocalIdx !== -1 && draftSetIdx !== -1 && applyLocalIdx < draftSetIdx,
    "applyLocal must run (and be able to throw) before draft.set records the op");
});

test("kind mismatch is refused before any mutation", () => {
  assert.match(SRC, /record\.kind !== kind/);
});

test("media uploads count as publishable disk state via markSavedToDisk — never here; placement is a draft op", () => {
  // Placement goes through draft.set (a pending op), NOT markSavedToDisk (which is
  // for server-side writes like the upload itself). Guard against confusing the two.
  assert.ok(!/markSavedToDisk/.test(SRC), "media-slots must not touch markSavedToDisk");
});

test("editing gate: pointer handlers check EditorUI.isEditing()", () => {
  assert.match(SRC, /UI\.isEditing\(\)/);
});

test("record data never reaches innerHTML", () => {
  for (const m of SRC.match(/\.innerHTML\s*=\s*[^;]+;/g) || []) {
    assert.ok(!/\$\{/.test(m) && !/\brec\b|\brecord\b/.test(m), "innerHTML with data: " + m);
  }
});

test("click handler guards against swallowing interactive controls inside slots", () => {
  // Media slots may wrap list items whose own interactive chrome (buttons, etc.)
  // lives inside them. The capture-phase click listener must not claim clicks
  // targeting those controls, or stopPropagation() will prevent them from firing.
  assert.match(SRC, /e\.target\.closest.*button.*a.*input.*textarea.*select.*\.ed-menu/);
  assert.match(SRC, /if \(interactive && el\.contains\(interactive\)\) return;/);
});

test("restore-on-throw is best-effort — restore errors do not mask the original error", () => {
  // If posterPath doesn't resolve in content, restoring it throws again. That throw
  // must not escape uncaught (which would skip the alert); instead, it must be
  // swallowed so the ORIGINAL error message reaches the user. Check that the restore
  // calls are wrapped in their own try/catch to swallow restore errors.
  assert.ok(SRC.includes("try { UI.applyLocal(path, priorValue); } catch (e) { /* swallow restore error */ }"),
    "primary path restore must be wrapped to swallow errors");
  assert.ok(SRC.includes("try { UI.applyLocal(posterPath, priorPosterValue); } catch (e) { /* swallow restore error */ }"),
    "poster path restore must be wrapped to swallow errors");
});
