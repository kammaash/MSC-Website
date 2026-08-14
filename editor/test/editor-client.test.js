"use strict";
// editor-client.js (and draft.js, when loaded as a plain <script> rather than required)
// only ever run in a browser — there is no DOM here to load and exercise them against.
// These tests instead check the two properties that matter most and are checkable
// without a DOM: every request is tokenised (a missing token silently 403s the whole
// editor — the one regression that would ship broken with everything else looking fine),
// and the files are at least syntactically valid, since nothing else ever parses them.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CLIENT_DIR = path.join(__dirname, "..", "client");
const EDITOR_CLIENT = path.join(CLIENT_DIR, "editor-client.js");
const DRAFT = path.join(CLIENT_DIR, "draft.js");

test("every /api/ fetch in editor-client.js is tokenised via apiFetch", () => {
  const src = fs.readFileSync(EDITOR_CLIENT, "utf8");

  // apiFetch is the one place the x-editor-token header gets attached (from
  // window.__EDITOR_TOKEN, which the server injects per boot — see server.js's
  // TOKEN_SCRIPT). Every call that hits /api/ must go through it.
  const apiFetchCalls = src.match(/apiFetch\(\s*["'`](\/api\/[^"'`]+)["'`]/g) || [];
  assert.equal(apiFetchCalls.length, 2, "expected exactly 2 apiFetch(...) call sites targeting /api/ (save, publish)");

  // Because the wrapper is named with a capital F ("apiFetch"), a case-sensitive search
  // for the literal substring "fetch(" (lowercase f) can never match "apiFetch(" —
  // it only matches genuine bare fetch() calls. There must be exactly one: apiFetch's
  // own body, which is where the real, global fetch() gets invoked. If this count ever
  // rises above 1, a new call site has bypassed apiFetch and skipped the token header.
  const bareFetchCount = (src.match(/fetch\(/g) || []).length;
  assert.equal(bareFetchCount, 1, "found a bare fetch( call outside apiFetch's own body — it would skip the x-editor-token header");

  // And apiFetch itself must actually attach the header from window.__EDITOR_TOKEN.
  const defStart = src.indexOf("function apiFetch(");
  assert.notEqual(defStart, -1, "apiFetch wrapper not found");
  const apiFetchBody = src.slice(defStart, defStart + 400);
  assert.match(apiFetchBody, /"x-editor-token":\s*window\.__EDITOR_TOKEN/);
});

test("node --check passes for draft.js and editor-client.js", () => {
  // These files are never require()'d by the browser-only path (editor-client.js isn't
  // require()'d at all; draft.js is required only by draft.test.js's own createDraft
  // test), so a syntax error introduced outside that one code path would otherwise ship
  // straight to the browser unnoticed until someone opened the console.
  execFileSync(process.execPath, ["--check", DRAFT]);
  execFileSync(process.execPath, ["--check", EDITOR_CLIENT]);
});
