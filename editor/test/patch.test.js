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

test("leaf rule: embed.src accepts the two forms this codebase produces, and nothing else", () => {
  const good = { embed: { src: "https://www.youtube.com/embed/dQw4w9WgXcQ", title: "T" } };
  validateShape(good, BLOCK_ONEOF, "");
  const bad = (src) => assert.throws(
    () => validateShape({ embed: { src, title: "T" } }, BLOCK_ONEOF, ""), /embed\.src/);
  bad("https://vimeo.com/1");
  bad("javascript:alert(1)");
  bad("dQw4w9WgXcQ");
  bad("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  // The nocookie form is what media-urls.js builds for a slot placement, and the ?rel=0
  // suffix comes with it — both were rejected until embed.src had to serve the slot path
  // as well as the chooser, which would have made the two routes disagree.
  validateShape({ embed: { src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0", title: "T" } }, BLOCK_ONEOF, "");
  bad("https://www.youtube.com/embed/dQw4w9WgXcQ&rel=0");
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

test("among wildcard keys that both match, the one with fewer wildcards wins", () => {
  const t = { "a.*.*": "two-wild", "a.*.c": "one-wild" };
  // Both keys match "a.b.c" segment-wise; "a.*.c" has fewer *s.
  assert.equal(requireCollection(t, "a.b.c"), "one-wild");
  // Declaration order in the object must not matter.
  const reversed = { "a.*.c": "one-wild", "a.*.*": "two-wild" };
  assert.equal(requireCollection(reversed, "a.b.c"), "one-wild");
});

test("the numeric-substitution behaviour is a strict subset: galleryGroups.*.photos still matches", () => {
  assert.ok(requireCollection(templates, "galleryGroups.0.photos"));
  assert.throws(() => requireCollection(templates, "galleryGroups.0.nope"), /Unknown collection/);
});

// ---- the real declarations end-to-end through applyPatch ----
const subpageFix = () => ({
  pages: { library: { blocks: [
    { p: "text" },
    { list: [["a", "b"]] },
    { gallery: [] },
  ] } },
  fallback: { blocks: [{ p: "text" }] },
});

test("every block kind the chooser offers is addable through the real templates", () => {
  const items = [
    { p: "Write this section here." },
    { h: "New heading" },
    { note: "Something to highlight", sub: "A supporting line." },
    { list: [["New item", "Describe it here."]] },
    { gallery: [["https://res.cloudinary.com/demo/image/upload/x.jpg", "New photo"]] },
    { person: { src: "https://res.cloudinary.com/demo/image/upload/x.jpg", name: "Name", title: "Role" } },
    { embed: { src: "https://www.youtube.com/embed/dQw4w9WgXcQ", title: "T" } },
  ];
  for (const item of items) {
    const d = applyPatch(subpageFix(), { ops: [{ type: "add", path: "pages.library.blocks", item }] }, templates);
    assert.equal(d.pages.library.blocks.length, 4);
  }
  // link is deliberately NOT addable: its href cannot be edited in the editor.
  assert.throws(() => applyPatch(subpageFix(), {
    ops: [{ type: "add", path: "pages.library.blocks", item: { link: { href: "x", label: "L", sub: "S" } } }],
  }, templates), /one of/);
});

test("rows and gallery photos are addable on any route through one declaration", () => {
  let d = applyPatch(subpageFix(), { ops: [{ type: "add", path: "pages.library.blocks.1.list", item: ["T", "D"] }] }, templates);
  assert.equal(d.pages.library.blocks[1].list.length, 2);
  d = applyPatch(subpageFix(), { ops: [{ type: "add", path: "pages.library.blocks.2.gallery", item: ["u.jpg", "C"] }] }, templates);
  assert.equal(d.pages.library.blocks[2].gallery.length, 1);
});

test("the fallback route is addable and its template cannot drift from pages.*.blocks", () => {
  assert.deepEqual(templates["fallback.blocks"], templates["pages.*.blocks"]);
  assert.deepEqual(templates["fallback.blocks.*.list"], templates["pages.*.blocks.*.list"]);
  assert.deepEqual(templates["fallback.blocks.*.gallery"], templates["pages.*.blocks.*.gallery"]);
  const d = applyPatch(subpageFix(), { ops: [{ type: "add", path: "fallback.blocks", item: { p: "x" } }] }, templates);
  assert.equal(d.fallback.blocks.length, 2);
});

test("a new gallery category arrives with exactly one photo, satisfying the floor from birth", () => {
  const d = applyPatch({ galleryGroups: [] }, { ops: [{ type: "add", path: "galleryGroups",
    item: { label: "New category", photos: [{ src: "u.jpg", caption: "" }] } }] }, templates);
  assert.equal(d.galleryGroups[0].photos.length, 1);
  assert.throws(() => applyPatch({ galleryGroups: [] }, { ops: [{ type: "add", path: "galleryGroups",
    item: { label: "New category", photos: [] } }] }, templates), /exactly 1/);
});

// ---- a section's own text may not be emptied (Task: empty-text block trap) ----
// The subpage normalisers dispatch on truthiness (`if (b.p) … else if (b.h) …`), so a
// block whose dispatch key is emptied matches no branch, renders NOTHING, and is
// therefore both un-editable and un-deletable — there is no element left to carry a
// data-edit or a ✕. The only way back is hand-editing the page, which is the pain this
// editor exists to remove. So emptying one of those three keys is refused.
const { requiresText } = require("../lib/patch.js");

const blockFix = () => ({
  pages: { library: { blocks: [
    { p: "text" },
    { h: "heading" },
    { note: "headline", sub: "supporting" },
    { list: [["term", "desc"]] },
    { gallery: [["u.jpg", "cap"]] },
  ] } },
  fallback: { blocks: [{ p: "text" }] },
  galleryGroups: [{ label: "L", photos: [{ src: "u.jpg", caption: "c" }] }],
  hero: { title: "T" },
});

test("emptying a block's dispatch key is refused on every route, including fallback", () => {
  for (const path of [
    "pages.library.blocks.0.p",
    "pages.library.blocks.1.h",
    "pages.library.blocks.2.note",
    "fallback.blocks.0.p",
  ]) {
    assert.throws(
      () => applyPatch(blockFix(), { ops: [{ type: "set", path, value: "" }] }, templates),
      /section needs some text/,
      path + " must refuse an empty value"
    );
    // Whitespace is not text either — validateText's trim rule already governs storage,
    // and " " would leave exactly the same invisible block.
    assert.throws(
      () => applyPatch(blockFix(), { ops: [{ type: "set", path, value: "   " }] }, templates),
      /section needs some text/,
      path + " must refuse whitespace"
    );
  }
});

test("the refusal names the way out, so the message is actionable", () => {
  assert.throws(
    () => applyPatch(blockFix(), { ops: [{ type: "set", path: "pages.library.blocks.0.p", value: "" }] }, templates),
    /✕/
  );
});

test("a dispatch key still accepts ordinary text", () => {
  const d = applyPatch(blockFix(), {
    ops: [{ type: "set", path: "pages.library.blocks.0.p", value: "New copy" }],
  }, templates);
  assert.equal(d.pages.library.blocks[0].p, "New copy");
});

test("every other editable string may still be emptied — only dispatch keys are guarded", () => {
  // Each of these sits inside a value that stays truthy when the string goes empty, so
  // emptying it hides a field, never the whole block. Guarding them would be a
  // restriction with no defect behind it.
  const cases = [
    ["pages.library.blocks.2.sub", (d) => d.pages.library.blocks[2].sub],
    ["pages.library.blocks.3.list.0.1", (d) => d.pages.library.blocks[3].list[0][1]],
    ["pages.library.blocks.4.gallery.0.1", (d) => d.pages.library.blocks[4].gallery[0][1]],
    ["galleryGroups.0.photos.0.caption", (d) => d.galleryGroups[0].photos[0].caption],
    ["hero.title", (d) => d.hero.title],
  ];
  for (const [path, read] of cases) {
    const d = applyPatch(blockFix(), { ops: [{ type: "set", path, value: "" }] }, templates);
    assert.equal(read(d), "", path + " must still accept an empty value");
  }
});

test("requiresText matches the three dispatch keys and nothing else", () => {
  for (const p of ["pages.x.blocks.0.p", "pages.a-b.blocks.12.h", "fallback.blocks.3.note"]) {
    assert.equal(requiresText(p), true, p);
  }
  for (const p of [
    "pages.x.blocks.0.sub",          // a note's supporting line — block survives without it
    "pages.x.blocks.0.person.name",  // inside an object that stays truthy
    "pages.x.blocks.0.list.0.0",     // inside an array that stays truthy
    "pages.x.blocks.0",              // the block itself, not a text path
    "pages.x.blocks.0.p.extra",      // deeper than a dispatch key
    "hero.p",                        // right key, wrong shape
    "fallback.p",
  ]) {
    assert.equal(requiresText(p), false, p);
  }
});

// ---- embed.src: same rule whichever way a video arrives (Task: subpage media slots) ----
// A video block added through the chooser gets its src from collections.js, which builds
// the canonical youtube.com/embed/<id>. A video DROPPED on the block's slot gets it from
// media-urls.js, which builds the privacy-enhanced youtube-nocookie.com/embed/<id>?rel=0.
// Both are produced by our own code from a positively-identified video id, so both must
// be acceptable — and the rule has to run on `set` too, since that is the op a slot uses.
const { isEmbedSrc } = require("../lib/patch.js");

test("isEmbedSrc accepts both forms this codebase produces, and nothing else", () => {
  for (const good of [
    "https://www.youtube.com/embed/dQw4w9WgXcQ",                     // collections.js
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",      // media-urls.js
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) assert.equal(isEmbedSrc(good), true, good);

  for (const bad of [
    "https://vimeo.com/1",
    "javascript:alert(1)",
    "dQw4w9WgXcQ",                                       // bare id
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",       // watch page, not embeddable
    "https://www.youtube.com/embed/short",               // not an 11-char id
    "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&evil",
    "",
  ]) assert.equal(isEmbedSrc(bad), false, bad);
});

test("a set op on a block's embed.src is held to the same rule as an add", () => {
  const fix = () => ({ pages: { library: { blocks: [{ embed: { src: "https://www.youtube.com/embed/dQw4w9WgXcQ", title: "T" } }] } } });
  const set = (value) => applyPatch(fix(), {
    ops: [{ type: "set", path: "pages.library.blocks.0.embed.src", value }],
  }, templates);

  // What a slot placement writes.
  assert.equal(set("https://www.youtube-nocookie.com/embed/aaaaaaaaaaa?rel=0")
    .pages.library.blocks[0].embed.src, "https://www.youtube-nocookie.com/embed/aaaaaaaaaaa?rel=0");
  // Blanking is how a video is removed from a non-required slot; the page maps "" to
  // about:blank, so it must stay allowed.
  assert.equal(set("").pages.library.blocks[0].embed.src, "");
  // Anything else must not reach an <iframe src> on a published page.
  assert.throws(() => set("https://vimeo.com/1"), /YouTube/);
  assert.throws(() => set("javascript:alert(1)"), /YouTube/);
});

test("the same guard does not apply to unrelated src-ish paths", () => {
  const d = applyPatch({ pages: { library: { blocks: [{ person: { src: "x.jpg", name: "N", title: "R" } }] } } }, {
    ops: [{ type: "set", path: "pages.library.blocks.0.person.src", value: "anything.jpg" }],
  }, templates);
  assert.equal(d.pages.library.blocks[0].person.src, "anything.jpg");
});
