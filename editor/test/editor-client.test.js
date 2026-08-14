"use strict";
// editor-client.js (and draft.js, when loaded as a plain <script> rather than required)
// only ever run in a browser — there is no DOM here to load and exercise them against.
// These tests instead check source-level properties that matter and are checkable
// without a DOM: every request is tokenised (a missing token silently 403s the whole
// editor — the one regression that would ship broken with everything else looking
// fine), the fix-round-2 review findings (trim-before-compare, validate-then-catch-
// before-recording, honest Discard, the contenteditable value check, the
// beforeunload/Exit cleanup) are actually present and in the right order, and the
// files are at least syntactically valid, since nothing else ever parses them.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CLIENT_DIR = path.join(__dirname, "..", "client");
const EDITOR_CLIENT = path.join(CLIENT_DIR, "editor-client.js");
const DRAFT = path.join(CLIENT_DIR, "draft.js");
const SRC = fs.readFileSync(EDITOR_CLIENT, "utf8");

// Extracts the brace-balanced block that starts at (or after) the first "{" following
// `marker`, e.g. extractBlockAfter(src, "function apiFetch(") returns the whole function
// body, and extractBlockAfter(src, '#ed-discard").onclick') returns the whole handler —
// arrow-function callbacks don't have a name a simpler "find the function" search could
// key on. This replaces a fixed-length slice, which would silently stop covering a
// growing function without ever failing.
function extractBlockAfter(src, marker) {
  const markerIdx = src.indexOf(marker);
  assert.notEqual(markerIdx, -1, "marker not found: " + marker);
  const braceOpen = src.indexOf("{", markerIdx);
  let depth = 0;
  for (let i = braceOpen; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(markerIdx, i + 1);
    }
  }
  throw new Error("unbalanced braces scanning from marker: " + marker);
}

test("every /api/ fetch in editor-client.js is tokenised via apiFetch", () => {
  // apiFetch is the one place the x-editor-token header gets attached (from
  // window.__EDITOR_TOKEN, which the server injects per boot — see server.js's
  // TOKEN_SCRIPT). Every call that hits /api/ must go through it.
  const apiFetchCalls = SRC.match(/apiFetch\(\s*["'`](\/api\/[^"'`]+)["'`]/g) || [];
  assert.equal(apiFetchCalls.length, 2, "expected exactly 2 apiFetch(...) call sites targeting /api/ (save, publish)");

  // Because the wrapper is named with a capital F ("apiFetch"), a case-sensitive search
  // for the literal substring "fetch(" (lowercase f) can never match "apiFetch(" —
  // it only matches genuine bare fetch() calls. There must be exactly one: apiFetch's
  // own body, which is where the real, global fetch() gets invoked. If this count ever
  // rises above 1, a new call site has bypassed apiFetch and skipped the token header.
  const bareFetchCount = (SRC.match(/fetch\(/g) || []).length;
  assert.equal(bareFetchCount, 1, "found a bare fetch( call outside apiFetch's own body — it would skip the x-editor-token header");

  const apiFetchBody = extractBlockAfter(SRC, "function apiFetch(");
  assert.match(apiFetchBody, /"x-editor-token":\s*window\.__EDITOR_TOKEN/);
});

test("M2: apiFetch defaults content-type to application/json but a caller can still override it", () => {
  const apiFetchBody = extractBlockAfter(SRC, "function apiFetch(");
  // The default must be the FIRST argument to Object.assign (lowest precedence) so that
  // opts.headers — merged in second — can override it, with the token merged in last so
  // it can never be overridden.
  assert.match(
    apiFetchBody,
    /Object\.assign\(\s*\{\s*"content-type":\s*"application\/json"\s*\}\s*,\s*opts\s*&&\s*opts\.headers\s*,\s*\{\s*"x-editor-token":\s*window\.__EDITOR_TOKEN\s*\}\s*\)/
  );
});

test("M1: the contenteditable guard checks the actual value, not truthiness", () => {
  // getAttribute("contenteditable") is truthy for the string "false" too; a plain
  // truthiness check would refuse to ever open an element authored contenteditable="false".
  const fn = extractBlockAfter(SRC, "function isEditableNow(");
  assert.match(fn, /===\s*"plaintext-only"/);
  assert.match(fn, /===\s*"true"/);
  assert.doesNotMatch(fn, /return\s+v\s*;/, "must compare against specific values, not just return the raw attribute");

  // And it must actually be used to guard entry/exit, not bypassed with a raw getAttribute check.
  const usages = (SRC.match(/isEditableNow\(/g) || []).length;
  assert.ok(usages >= 4, "expected isEditableNow used in click/keydown/blur guards and Exit's cleanup, found " + usages);
});

test("I1: text is trimmed at capture time and at commit time, so padding from a {{ }} hole's surrounding markup can't compound", () => {
  const clickBlock = extractBlockAfter(SRC, 'addEventListener("click"');
  assert.match(clickBlock, /el\.__edOrig\s*=\s*el\.textContent\.trim\(\)/);

  const blurBlock = extractBlockAfter(SRC, 'addEventListener("blur"');
  assert.match(blurBlock, /const value = el\.textContent\.trim\(\)/);
});

test("I2: a stale/unknown path throws from applyLocal BEFORE the op is recorded, restores the text, and never reaches draft.set", () => {
  const blurBlock = extractBlockAfter(SRC, 'addEventListener("blur"');
  const tryIdx = blurBlock.indexOf("try {");
  const applyIdx = blurBlock.indexOf("applyLocal(path, value)");
  const catchIdx = blurBlock.indexOf("catch (err)");
  const draftSetIdx = blurBlock.indexOf("draft.set(path, value)");
  assert.ok(tryIdx !== -1 && applyIdx !== -1 && catchIdx !== -1 && draftSetIdx !== -1, "expected try/applyLocal/catch/draft.set all present");
  assert.ok(tryIdx < applyIdx, "applyLocal must be inside the try block");
  assert.ok(applyIdx < catchIdx, "catch must come after the applyLocal call");
  assert.ok(catchIdx < draftSetIdx, "draft.set must come after the try/catch, i.e. only run on success");

  // The catch handler must restore the original text and tell the user, same as the
  // rejectText short-circuit above it — both failure paths leave the element showing
  // exactly what it showed before the edit.
  const restoreCount = (blurBlock.match(/el\.textContent = el\.__edOrig/g) || []).length;
  assert.ok(restoreCount >= 2, "expected the original text restored on both the rejectText path and the applyLocal-throws path");
});

test("I3(a): a client-side validation rejection also restores text and returns before recording anything", () => {
  const blurBlock = extractBlockAfter(SRC, 'addEventListener("blur"');
  assert.match(blurBlock, /EditorDraft\.rejectText\(value\)/);
  const rejectIdx = blurBlock.indexOf("EditorDraft.rejectText(value)");
  const draftSetIdx = blurBlock.indexOf("draft.set(path, value)");
  assert.ok(rejectIdx < draftSetIdx, "rejectText check must run before the op is recorded");
});

test("I3(b): saveAll marks the session as saved on the first successful write, and Discard warns honestly when that's true", () => {
  const saveAllBlock = extractBlockAfter(SRC, "function saveAll(");
  assert.match(saveAllBlock, /savedThisSession = true/);

  const discardBlock = extractBlockAfter(SRC, '#ed-discard").onclick');
  assert.match(discardBlock, /savedThisSession/);
  assert.match(discardBlock, /not undo/i);
  // The plain "nothing saved yet" path must still exist and still be reachable
  // (it stays the everyday case — most sessions publish without a partial failure).
  assert.match(discardBlock, /draft\.count\(\)\s*&&\s*!confirm/);

  // Publishing clears the flag — once saved changes are committed, Discard no longer
  // needs to warn about anything left dangling.
  const publishBlock = extractBlockAfter(SRC, '#ed-publish").onclick');
  assert.match(publishBlock, /savedThisSession = false/);
});

test("M3: beforeunload is suppressed for Discard's own reload, not for any other way of leaving", () => {
  const discardBlock = extractBlockAfter(SRC, '#ed-discard").onclick');
  const discardingSetIdx = discardBlock.indexOf("discarding = true");
  const reloadIdx = discardBlock.indexOf("location.reload()");
  assert.ok(discardingSetIdx !== -1 && reloadIdx !== -1, "expected discarding flag set and a reload in the Discard handler");
  assert.ok(discardingSetIdx < reloadIdx, "the flag must be set BEFORE reload() fires beforeunload");

  assert.match(SRC, /addEventListener\("beforeunload",\s*\(e\)\s*=>\s*\{\s*if\s*\(!discarding\s*&&\s*draft\.count\(\)\)/);
});

test("M4: leaving edit mode clears hover outlines and takes any mid-edit element out of contenteditable", () => {
  const exitBlock = extractBlockAfter(SRC, '#ed-exit").onclick');
  assert.match(exitBlock, /classList\.remove\("ed-hover"\)/);
  assert.match(exitBlock, /isEditableNow\(active\)/);
  assert.match(exitBlock, /active\.blur\(\)/);
  // Must be gated on actually leaving edit mode (editing just went false), not run
  // unconditionally on every Exit/Resume toggle.
  assert.match(exitBlock, /if\s*\(!editing\)\s*\{[\s\S]*classList\.remove\("ed-hover"\)/);
});

test("node --check passes for draft.js and editor-client.js", () => {
  // These files are never require()'d by the browser-only path (editor-client.js isn't
  // require()'d at all; draft.js is required by draft.test.js), so a syntax error
  // introduced outside that one code path would otherwise ship straight to the browser
  // unnoticed until someone opened the console.
  execFileSync(process.execPath, ["--check", DRAFT]);
  execFileSync(process.execPath, ["--check", EDITOR_CLIENT]);
});
