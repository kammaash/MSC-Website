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

test("showcase video slots use wrappers so iframe browsing contexts cannot swallow editor events", () => {
  for (const page of ["montessori-acamp.html", "montessori-vidyanagar.html"]) {
    const src = readPage(page);
    const tags = openingTags(src).filter((t) => /data-media-kind="video"/.test(t));
    assert.equal(tags.length, 1, page + ": expected one showcase video slot");
    assert.match(tags[0], /^<div\b/, page + ": video slot must be a wrapper, not the iframe");
    assert.doesNotMatch(tags[0], /^<iframe\b/);
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
