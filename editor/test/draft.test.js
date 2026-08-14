"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDraft } = require("../client/draft.js");

test("groups ops per file, stripping shared: prefix, preserving order", () => {
  const d = createDraft("index.html");
  d.set("hero.title", "A");
  d.listOp({ type: "add", path: "shared:news.acamp", item: { date: "", title: "", body: "" } });
  d.set("shared:news.acamp.0.title", "B");
  assert.equal(d.count(), 3);
  const p = d.toPatches();
  assert.deepEqual(Object.keys(p).sort(), ["content.js", "index.html"]);
  assert.deepEqual(p["index.html"].ops, [{ type: "set", path: "hero.title", value: "A" }]);
  assert.equal(p["content.js"].ops[0].type, "add");
  assert.deepEqual(p["content.js"].ops[1], { type: "set", path: "news.acamp.0.title", value: "B" });
  d.clear();
  assert.equal(d.count(), 0);
});
