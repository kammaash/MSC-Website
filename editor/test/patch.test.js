"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyPatch, validateText, validateShape } = require("../lib/patch.js");
const templates = require("../collections.json");

const fix = () => ({
  hero: { title: "Old" },
  stats: [{ n: "2", label: "Branches" }],
  news: { acamp: [], vidyanagar: [] },
  galleries: { acamp: [], vidyanagar: [] },
  galleryGroups: [{ photos: [] }],
});

test("wildcard collection templates validate nested gallery photo lists", () => {
  const d = applyPatch(fix(), {
    ops: [{ type: "add", path: "galleryGroups.0.photos", item: { src: "https://example.test/photo.jpg", caption: "" } }],
  }, templates);
  assert.equal(d.galleryGroups[0].photos.length, 1);
  assert.throws(() => applyPatch(fix(), {
    ops: [{ type: "add", path: "galleryGroups.0.photos", item: { id: "wrong-shape" } }],
  }, templates), /exactly/);
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

// ---- validateShape: the recursive item contract (Task: repeated-widget add buttons) ----
// Templates recurse ON THE TEMPLATE, so a hostile payload can never drive the
// recursion deeper than a declaration we authored. Every rejection names the failing
// field path — a seven-way oneOf failing as "item did not match" is undebuggable.

const BLOCK_ONEOF = { oneOf: [
  { p: "" }, { h: "" }, { note: "", sub: "" },
  { list: [["", ""]] }, { gallery: [["", ""]] },
  { person: { src: "", name: "", title: "" } },
  { embed: { src: "", title: "" } },
] };

test("validateShape: tuple template accepts exactly-shaped rows and nothing else", () => {
  validateShape(["Empathy", "understanding others"], ["", ""], ""); // no throw
  assert.throws(() => validateShape(["only one"], ["", ""], ""), /exactly 2/);
  assert.throws(() => validateShape(["a", "b", "c"], ["", ""], ""), /exactly 2/);
  assert.throws(() => validateShape(["a", 2], ["", ""], ""), /must be a string/);
  assert.throws(() => validateShape("not an array", ["", ""], ""), /array/);
});

test("validateShape: nested object template recurses and names the failing path", () => {
  validateShape({ person: { src: "x.jpg", name: "N", title: "T" } },
    { person: { src: "", name: "", title: "" } }, "");
  assert.throws(() => validateShape({ person: { src: "x.jpg", name: "N" } },
    { person: { src: "", name: "", title: "" } }, ""), /person keys must be exactly: name,src,title/);
  assert.throws(() => validateShape({ list: [["a", 2]] }, { list: [["", ""]] }, ""),
    /list\.0\.1/);
});

test("validateShape: oneOf selects the alternative by key set", () => {
  validateShape({ p: "hello" }, BLOCK_ONEOF, "");
  validateShape({ note: "N", sub: "S" }, BLOCK_ONEOF, "");
  validateShape({ embed: { src: "https://www.youtube.com/embed/dQw4w9WgXcQ", title: "T" } }, BLOCK_ONEOF, "");
  // No alternative has these keys — the error lists what WOULD be accepted.
  assert.throws(() => validateShape({ p: "x", h: "y" }, BLOCK_ONEOF, ""), /one of/);
  assert.throws(() => validateShape("just text", BLOCK_ONEOF, ""), /object/);
  // The matched alternative's INNER failure keeps its field path.
  assert.throws(() => validateShape({ person: { src: 3, name: "N", title: "T" } }, BLOCK_ONEOF, ""),
    /person\.src/);
});

test("validateShape: validateText still guards every nested leaf", () => {
  assert.throws(() => validateShape({ list: [["a", "</script><script>alert(1)"]] },
    { list: [["", ""]] }, ""), /script/);
});

test("validateShape: value nesting deeper than the template is rejected, not recursed", () => {
  assert.throws(() => validateShape({ p: { deep: { deeper: "x" } } }, { p: "" }, ""),
    /must be a string/);
});

test("leaf rule: embed.src accepts only the canonical YouTube embed form", () => {
  const good = { embed: { src: "https://www.youtube.com/embed/dQw4w9WgXcQ", title: "T" } };
  validateShape(good, BLOCK_ONEOF, "");
  const bad = (src) => assert.throws(
    () => validateShape({ embed: { src, title: "T" } }, BLOCK_ONEOF, ""), /embed\.src/);
  bad("https://vimeo.com/1");
  bad("javascript:alert(1)");
  bad("dQw4w9WgXcQ");
  bad("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  bad("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  bad("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0");
});

test("leaf rule: the galleries kind check survives the validateItem replacement", () => {
  validateShape({ kind: "image", id: "x", caption: "" }, templates["galleries.acamp"], "");
  assert.throws(() => validateShape({ kind: "iframe", id: "x", caption: "" },
    templates["galleries.acamp"], ""), /kind must be image or video/);
});

// ---- requireCollection: segment-wise wildcards (Task: repeated-widget add buttons) ----
const { requireCollection } = require("../lib/patch.js");

test("wildcards in the DECLARED key match any one segment; the shape of the path stays fixed", () => {
  const t = { "pages.*.blocks.*.list": ["", ""] };
  assert.deepEqual(requireCollection(t, "pages.awards.blocks.1.list"), ["", ""]);
  assert.deepEqual(requireCollection(t, "pages.events-news.blocks.0.list"), ["", ""]);
  // Wrong number of segments never matches.
  assert.throws(() => requireCollection(t, "pages.awards.blocks"), /Unknown collection/);
  assert.throws(() => requireCollection(t, "pages.awards.blocks.1.list.0"), /Unknown collection/);
  // The literal segments stay literal.
  assert.throws(() => requireCollection(t, "nav.awards.blocks.1.list"), /Unknown collection/);
});

test("an exact declaration beats a wildcard one", () => {
  const t = { "a.*.c": "wild", "a.b.c": "exact" };
  assert.equal(requireCollection(t, "a.b.c"), "exact");
  assert.equal(requireCollection(t, "a.z.c"), "wild");
});

test("the numeric-substitution behaviour is a strict subset: galleryGroups.*.photos still matches", () => {
  assert.ok(requireCollection(templates, "galleryGroups.0.photos"));
  assert.throws(() => requireCollection(templates, "galleryGroups.0.nope"), /Unknown collection/);
});
