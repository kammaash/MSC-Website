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

// Only index.html and montessori-vidyanagar.html sentinel an empty photo to the 1x1
// transparent GIF placeholder — montessori-acamp.html's hero.photo and founder.photo
// hold real paths and bind directly ({{ hero.photo }}, {{ founder.photo }}), which is
// fine, so no sentinel assertion is made for acamp here.
test("index.html and montessori-vidyanagar.html map the empty hero-photo sentinel to the 1x1 transparent GIF", () => {
  const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  for (const page of ["index.html", "montessori-vidyanagar.html"]) {
    const src = readPage(page);
    assert.match(
      src,
      /heroPhotoSrc:\s*CONTENT\.hero\.photo\s*\|\|\s*\n\s*"data:image\/gif;base64,[A-Za-z0-9+/=]+"/,
      page + ": heroPhotoSrc must fall back to a 1x1 transparent GIF data URI when CONTENT.hero.photo is \"\""
    );
    assert.ok(src.includes(GIF), page + ": expected the 1x1 transparent GIF placeholder data URI");
  }
});
