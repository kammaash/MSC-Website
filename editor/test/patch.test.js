"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyPatch, validateText } = require("../lib/patch.js");
const templates = require("../collections.json");

const fix = () => ({
  hero: { title: "Old" },
  stats: [{ n: "2", label: "Branches" }],
  news: { acamp: [], vidyanagar: [] },
  galleries: { acamp: [], vidyanagar: [] },
});

test("set writes an existing string path", () => {
  const d = applyPatch(fix(), { ops: [{ type: "set", path: "hero.title", value: "New" }] }, templates);
  assert.equal(d.hero.title, "New");
});

test("set rejects unknown and non-string paths", () => {
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "set", path: "hero.nope", value: "x" }] }, templates), /Unknown or non-text/);
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "set", path: "stats", value: "x" }] }, templates), /Unknown or non-text/);
});

test("validateText blocks script tags and non-strings", () => {
  assert.throws(() => validateText("</script><script>alert(1)"), /script/);
  assert.throws(() => validateText("< / ScRiPt >"), /script/);
  assert.throws(() => validateText(42), /string/);
  validateText("plain text with <b> is stored inert"); // no throw
});

test("add validates item shape against template", () => {
  const ops = [{ type: "add", path: "news.acamp", item: { date: "2026-08-14", title: "T", body: "B" } }];
  const d = applyPatch(fix(), { ops }, templates);
  assert.equal(d.news.acamp.length, 1);
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "add", path: "news.acamp", item: { title: "only" } }] }, templates), /exactly/);
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "add", path: "stats", item: {} }] }, templates), /Unknown collection/);
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "add", path: "galleries.acamp", item: { kind: "iframe", id: "x", caption: "" } }] }, templates), /kind/);
});

test("ordered replay: set on an item added earlier in the same patch", () => {
  const ops = [
    { type: "add", path: "news.acamp", item: { date: "", title: "New post", body: "" } },
    { type: "set", path: "news.acamp.0.title", value: "Sports Day" },
    { type: "move", path: "news.acamp", from: 0, to: 0 },
  ];
  const d = applyPatch(fix(), { ops }, templates);
  assert.equal(d.news.acamp[0].title, "Sports Day");
});

test("remove and unknown op types", () => {
  const base = fix();
  base.news.acamp.push({ date: "", title: "x", body: "" });
  const d = applyPatch(base, { ops: [{ type: "remove", path: "news.acamp", index: 0 }] }, templates);
  assert.equal(d.news.acamp.length, 0);
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "explode" }] }, templates), /Unknown op/);
});
