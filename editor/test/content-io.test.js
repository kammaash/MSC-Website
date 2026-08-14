"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extractContent, replaceContent } = require("../lib/content-io.js");

const page = (body) => `<script>\n/* CONTENT:BEGIN */\n${body}\n/* CONTENT:END */\nrest();\n</script>`;

test("extracts const CONTENT JSON", () => {
  const src = page('const CONTENT = {\n  "a": [1, 2]\n};');
  assert.deepEqual(extractContent(src), { decl: "const CONTENT", data: { a: [1, 2] } });
});

test("extracts window.SHARED_CONTENT JSON", () => {
  const src = page('window.SHARED_CONTENT = {"x": "y"};');
  assert.equal(extractContent(src).decl, "window.SHARED_CONTENT");
});

test("round-trip preserves everything outside the block", () => {
  const src = page('const CONTENT = {"a": "old"};');
  const out = replaceContent(src, { a: "new" });
  assert.match(out, /"a": "new"/);
  assert.match(out, /rest\(\);/);
  assert.deepEqual(extractContent(out).data, { a: "new" });
});

test("throws on missing markers", () => {
  assert.throws(() => extractContent("<script>const CONTENT = {};</script>"), /markers/);
});

test("throws on duplicate markers", () => {
  const src = page('const CONTENT = {};') + "\n/* CONTENT:BEGIN */";
  assert.throws(() => extractContent(src), /Duplicate/);
});

test("throws on non-JSON body", () => {
  assert.throws(() => extractContent(page("const CONTENT = { a: fn() };")));
});
