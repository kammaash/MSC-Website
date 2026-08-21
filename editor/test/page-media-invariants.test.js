"use strict";
// Source-level checks for the page-level invariants this branch depends on that
// check-paths.js does not cover. check-paths.js proves a data-media-slot PATH
// resolves; it says nothing about whether the element also carries a
// data-media-kind (applyToSlot in editor/client/media-slots.js compares
// record.kind against it and alerts on every placement attempt if it is
// missing), and it never touches renderVals()'s JS, which is where the empty
// sentinels for photo/video slots actually live — four separate bodies across
// three files, and the branch's most fragile cross-file contract. A browser
// smoke test could not exercise the video <iframe> either, so this stays a
// plain string check, same house style as editor-client.test.js/media-client.test.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { extractContent } = require("../lib/content-io.js");

const ROOT = path.join(__dirname, "..", "..");
const PAGES = ["index.html", "montessori-acamp.html", "montessori-vidyanagar.html"];

function readPage(name) {
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

// Opening tags only — comments (`<!-- ... -->`) never start with `<letter`, so a
// data-media-slot mentioned in comment prose (e.g. this branch's own doc passages)
// can never be mistaken for a real element here.
function openingTags(src) {
  return src.match(/<[a-zA-Z][^>]*>/g) || [];
}

for (const page of PAGES) {
  test(`${page}: every data-media-slot carries a data-media-kind on the same element`, () => {
    const src = readPage(page);
    const tags = openingTags(src).filter((t) => /data-media-slot=/.test(t));
    assert.ok(tags.length > 0, "expected at least one data-media-slot element in " + page);
    for (const tag of tags) {
      assert.match(tag, /data-media-kind="[^"]+"/,
        "element carries data-media-slot but no data-media-kind — applyToSlot would alert on every placement: " + tag);
    }
  });

  test(`${page}: media slots are containers that can host contextual actions`, () => {
    const tags = openingTags(readPage(page)).filter((t) => /data-media-slot=/.test(t));
    for (const tag of tags) {
      assert.doesNotMatch(tag, /^<(?:img|iframe|video)\b/i,
        "media slot must wrap, not be, a void/browsing media element: " + tag);
    }
  });
}

test("both school pages map the empty video sentinel to about:blank exactly", () => {
  for (const page of ["montessori-acamp.html", "montessori-vidyanagar.html"]) {
    const src = readPage(page);
    assert.match(
      src,
      /showcaseVideoSrc:\s*CONTENT\.showcase\.video\s*\|\|\s*"about:blank"/,
      page + ": showcaseVideoSrc must map CONTENT.showcase.video's \"\" sentinel to about:blank " +
        "(anything else either loads this very page recursively or renders a broken iframe)"
    );
  }
});

test("video slots use wrappers so iframe browsing contexts cannot swallow editor events", () => {
  // An <iframe> is its own browsing context: pointer and drag events landing on it never
  // reach this document, so a slot that IS the iframe can be neither clicked nor dropped
  // on. Every video slot therefore has to be a wrapper around one. This once asserted a
  // count of exactly one per page, which was only ever true of the moment it was written
  // — Vidyanagar's shared-gallery videos are slots now too. The property is about shape,
  // so it is asserted of every video slot rather than of a census.
  for (const page of ["montessori-acamp.html", "montessori-vidyanagar.html"]) {
    const src = readPage(page);
    const tags = openingTags(src).filter((t) => /data-media-kind="video"/.test(t));
    assert.ok(tags.length >= 1, page + ": expected at least one video slot");
    for (const tag of tags) {
      assert.match(tag, /^<div\b/, page + ": video slot must be a wrapper, not the iframe: " + tag);
    }
  }
});

test("every page maps the empty hero-photo sentinel to the 1x1 transparent GIF", () => {
  const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  for (const page of PAGES) {
    const src = readPage(page);
    assert.match(src, page === "montessori-acamp.html"
      ? /heroPhotoSrc:\s*CONTENT\.hero\.photo\s*\|\|\s*EMPTY_IMAGE/
      : /heroPhotoSrc:\s*CONTENT\.hero\.photo\s*\|\|\s*"data:image\/gif;base64,[A-Za-z0-9+/=]+"/,
    page + ": heroPhotoSrc must fall back to a 1x1 transparent GIF when CONTENT.hero.photo is \"\"");
    assert.ok(src.includes(GIF), page + ": expected the 1x1 transparent GIF placeholder data URI");
  }
});

test("A-Camp founder and gallery photos use safe empty-image fallbacks", () => {
  const src = readPage("montessori-acamp.html");
  assert.match(src, /founderPhotoSrc:\s*CONTENT\.founder\.photo\s*\|\|\s*EMPTY_IMAGE/);
  assert.match(src, /src:\s*ph\.src\s*\|\|\s*EMPTY_IMAGE/);
});

test("A-Camp gallery groups expose their photo arrays to the editor", () => {
  const src = readPage("montessori-acamp.html");
  assert.match(src, /data-list="\{\{ grp\.p \}\}\.photos"/);
  assert.match(src, /data-media-slot="\{\{ ph\.p \}\}\.src"/);
});

test("Vidyanagar shared gallery images are replaceable without changing ID storage", () => {
  const src = readPage("montessori-vidyanagar.html");
  assert.match(src, /data-media-slot="\{\{ ga\.p \}\}\.id"/);
  assert.match(src, /data-media-kind="image"/);
  assert.match(src, /data-media-value="id"/);
  assert.match(src, /it\.id\s*\?\s*cdn[^:]+:\s*EMPTY_IMAGE/);
});

test("Vidyanagar gallery videos always receive a non-empty iframe title", () => {
  const src = readPage("montessori-vidyanagar.html");
  assert.match(src, /videoTitle:\s*it\.caption\s*\|\|\s*"School gallery video"/);
  assert.match(src, /<iframe[^>]*title="\{\{ ga\.videoTitle \}\}"/);
});

// ---- subpage block media (Task: subpage media slots) ----
// The two subpages had no slots at all: across 70 routes, not one grid photo, portrait
// or video embed could be clicked, dragged onto or replaced. These assertions cover the
// three element types and the two empty sentinels they need — and, because the subpages
// are byte-identical twins, run against both files.
const SUBPAGES = ["acamp-subpage.html", "vidyanagar-subpage.html"];

for (const page of SUBPAGES) {
  test(`${page}: the three block media types are slots, correctly typed`, () => {
    const src = readPage(page);
    const tags = openingTags(src).filter((t) => /data-media-slot=/.test(t));
    assert.equal(tags.length, 3, "expected exactly three slots: grid photo, portrait, video embed");
    for (const tag of tags) {
      assert.match(tag, /data-media-kind="(image|video)"/, "every slot needs a kind: " + tag);
      assert.doesNotMatch(tag, /^<(?:img|iframe|video)\b/i, "a slot must wrap media, not be it: " + tag);
    }
    assert.match(src, /data-media-slot="\{\{ im\.p \}\}\.0"[^>]*data-media-kind="image"/);
    assert.match(src, /data-media-slot="\{\{ b\.p \}\}\.person\.src"[^>]*data-media-kind="image"/);
    assert.match(src, /data-media-slot="\{\{ b\.p \}\}\.embed\.src"[^>]*data-media-kind="video"/);
  });

  test(`${page}: a grid photo tile is required — it can be replaced but never blanked`, () => {
    const src = readPage(page);
    const gridTag = openingTags(src).find((t) => /data-media-slot="\{\{ im\.p \}\}\.0"/.test(t));
    assert.ok(gridTag, "grid photo slot not found");
    assert.match(gridTag, /data-media-required/,
      "a blanked tile is exactly the empty photo tile a grid must never have");
    // The other two may legitimately sit empty, so they must NOT carry the flag.
    for (const sel of ['\\{\\{ b\\.p \\}\\}\\.person\\.src', '\\{\\{ b\\.p \\}\\}\\.embed\\.src']) {
      const tag = openingTags(src).find((t) => new RegExp('data-media-slot="' + sel + '"').test(t));
      assert.doesNotMatch(tag, /data-media-required/, "only the grid tile is required: " + tag);
    }
  });

  test(`${page}: an emptied portrait and an emptied embed have somewhere safe to land`, () => {
    const src = readPage(page);
    // Without these, blanking a portrait paints a broken-image icon and blanking an
    // embed gives an <iframe src=""> — which loads this very page into itself.
    assert.match(src, /person:\s*\{[^}]*src:\s*b\.person\.src\s*\|\|\s*EMPTY_IMAGE/);
    assert.match(src, /embed:\s*\{[^}]*src:\s*b\.embed\.src\s*\|\|\s*"about:blank"/);
    assert.match(src, /const EMPTY_IMAGE = "data:image\/gif;base64,/);
  });
}

test("Vidyanagar's shared-gallery VIDEO entries are slots too, like the images beside them", () => {
  // The image branch has been a slot since the media work landed; the video branch on the
  // very next line was left a bare iframe, so a gallery video was the one media item on
  // that page nobody could replace. Both entries are the same collection, stored the same
  // way (kind + id + caption), so they get the same treatment.
  const src = readPage("montessori-vidyanagar.html");
  const tags = openingTags(src).filter((t) => /data-media-slot="\{\{ ga\.p \}\}\.id"/.test(t));
  assert.equal(tags.length, 2, "expected a slot on both the image and the video branch");
  const kinds = tags.map((t) => (t.match(/data-media-kind="([^"]+)"/) || [])[1]).sort();
  assert.deepEqual(kinds, ["image", "video"]);
  for (const tag of tags) {
    // data-media-value="id" is what stores the record's id rather than a delivery URL —
    // the shared gallery keeps {kind, id, caption}, not a baked URL.
    assert.match(tag, /data-media-value="id"/, tag);
    assert.doesNotMatch(tag, /^<(?:img|iframe|video)\b/i, "a slot must wrap media, not be it: " + tag);
  }
});
