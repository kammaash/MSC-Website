"use strict";
// collections.json is deliberately 403 to the browser (security.test.js pins it), so
// editor/client/collections.js carries its own copy of every blank item. Two sources
// of truth WILL drift without a guard; this file is the guard: every blank item the
// client can ever build must pass the server's validateShape against the template the
// server will actually enforce at Publish. Without this, Add succeeds locally and the
// whole Publish 400s — the feature's one silent failure mode.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateShape, requireCollection } = require("../lib/patch.js");
const templates = require("../collections.json");
const { PAGES } = require("../check-paths.js");
const C = require("../client/collections.js");

const ROOT = path.join(__dirname, "..", "..");

const MEDIA = {
  image: { id: "gallery/campus 1", url: "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_1600/gallery/campus%201", title: "Campus" },
  video: { id: "dQw4w9WgXcQ", url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0", title: "School tour" },
};

// family / label / floor / media-first, per collection the pages actually declare.
const TABLE = [
  // listPath (as the DOM carries it)      family          label             floor  media
  ["pages.awards.blocks",                  "blocks",        "+ Add section",  1,     null],
  ["fallback.blocks",                      "blocks",        "+ Add section",  1,     null],
  ["pages.awards.blocks.1.list",           "rows",          "+ Add row",      1,     null],
  ["pages.awards.blocks.2.gallery",        "blockGallery",  "+ Add photo",    1,     "image"],
  ["galleryGroups",                        "galleryGroups", "+ Add category", 1,     "image"],
  ["galleryGroups.0.photos",               "groupPhotos",   "+ Add photo",    1,     "image"],
  ["shared:galleries.vidyanagar",          "sharedGallery", "+ Add photo",    1,     "image"],
  ["shared:news.acamp",                    "news",          "+ Add",          0,     null],
  ["shared:news.vidyanagar",               "news",          "+ Add",          0,     null],
];
for (const [listPath, fam, label, floor, media] of TABLE) {
  test(`lookup table: ${listPath}`, () => {
    assert.equal(C.family(listPath), fam);
    assert.equal(C.addLabel(listPath), label);
    assert.equal(C.floorFor(listPath), floor);
    assert.equal(C.mediaFor(listPath), media);
  });
}

// The drift guard proper: [client listPath, server path, media]. The server path is
// what draft.js's route() actually sends (shared: stripped → content.js).
const DRIFT = [
  ["shared:news.acamp", "news.acamp", null],
  ["shared:galleries.vidyanagar", "galleries.vidyanagar", MEDIA.image],
  ["galleryGroups", "galleryGroups", MEDIA.image],
  ["galleryGroups.0.photos", "galleryGroups.0.photos", MEDIA.image],
  ["pages.awards.blocks.1.list", "pages.awards.blocks.1.list", null],
  ["pages.awards.blocks.2.gallery", "pages.awards.blocks.2.gallery", MEDIA.image],
];
for (const [listPath, serverPath, media] of DRIFT) {
  test(`drift guard: blankItem(${listPath}) passes the server's validateShape`, () => {
    validateShape(C.blankItem(listPath, null, media), requireCollection(templates, serverPath), "");
  });
}

for (const k of C.blockKinds()) {
  for (const base of ["pages.awards.blocks", "fallback.blocks"]) {
    test(`drift guard: block kind "${k.kind}" against ${base}`, () => {
      const item = C.blankItem(base, k.kind, k.media ? MEDIA[k.media] : null);
      const t = requireCollection(templates, base);
      if (k.kind === "video") {
        // Video adds TWO blocks — a heading seeded from the video's title, then the
        // player — because that is how the videos route is authored.
        assert.ok(Array.isArray(item) && item.length === 2);
        assert.deepEqual(item[0], { h: "School tour" });
        assert.equal(item[1].embed.src, "https://www.youtube.com/embed/dQw4w9WgXcQ");
        for (const it of item) validateShape(it, t, "");
      } else {
        validateShape(item, t, "");
      }
    });
  }
}

test("the chooser offers seven kinds; link is withheld (its href cannot be edited)", () => {
  const kinds = C.blockKinds().map((k) => k.kind);
  assert.deepEqual(kinds, ["p", "h", "note", "list", "gallery", "person", "video"]);
});

test("item shapes that carry provenance keep it: shared galleries store the record id, grids store the URL", () => {
  assert.equal(C.blankItem("shared:galleries.acamp", null, MEDIA.image).id, MEDIA.image.id);
  assert.equal(C.blankItem("galleryGroups.0.photos", null, MEDIA.image).src, MEDIA.image.url);
  assert.equal(C.blankItem("galleryGroups", null, MEDIA.image).photos[0].src, MEDIA.image.url);
  assert.equal(C.blankItem("pages.x.blocks.0.gallery", null, MEDIA.image)[0], MEDIA.image.url);
});

test("every seeded string is visible placeholder text — a blank block matches no dispatch branch and renders as NOTHING", () => {
  // {p: ""} is falsy for `if (b.p)`: it would produce no DOM, be un-editable and
  // un-deletable. The seeds below are the guard against that authoring trap.
  assert.notEqual(C.blankItem("pages.x.blocks", "p", null).p, "");
  assert.notEqual(C.blankItem("pages.x.blocks", "h", null).h, "");
  assert.notEqual(C.blankItem("pages.x.blocks", "note", null).note, "");
  assert.notEqual(C.blankItem("galleryGroups", null, MEDIA.image).label, "");
});

// family() stays total (decorate() in editor-client.js calls it, via addLabel()/floorFor(),
// for every [data-list] element on every chrome rebuild — a throw there would abort the
// whole loop and take down all editor chrome). Its safety net is here instead: every
// LITERAL data-list binding the pages actually carry must map to an explicit, expected
// family, and every expected binding must still be present — so an unrecognised binding
// (silently defaulted to "news" by family()) fails this test instead of failing quietly
// until Publish 400s. Interpolated ({{ }}) bindings are Task 8's markup and don't exist in
// the pages yet, so they're out of scope here; they'll need the same treatment once landed.
const EXPECTED_BINDINGS = {
  "shared:news.acamp": "news",
  "shared:news.vidyanagar": "news",
  "shared:galleries.vidyanagar": "sharedGallery",
};
test("every literal data-list binding in the pages is classified by an explicit rule", () => {
  const found = new Set();
  for (const page of PAGES) {
    const src = fs.readFileSync(path.join(ROOT, page), "utf8");
    for (const m of src.matchAll(/data-list="([^"{]+)"/g)) found.add(m[1]);
  }
  assert.deepEqual(
    [...found].sort(),
    Object.keys(EXPECTED_BINDINGS).sort(),
    "a data-list binding exists with no entry here — add it to collections.js AND to EXPECTED_BINDINGS"
  );
  for (const [listPath, fam] of Object.entries(EXPECTED_BINDINGS)) {
    assert.equal(C.family(listPath), fam);
  }
});
