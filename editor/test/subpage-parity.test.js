"use strict";
// The Vidyanagar subpage began life as a reduced copy of the A-Camp one and the gap
// grew silently — five render branches against nine. These assertions are what stop
// the twins drifting apart again: same sc-if branch names in the markup, same
// dispatch keys in the normaliser, and no resurrection of the dead mp4 video kind
// (YouTube embeds replaced it in 6dba997; no route in either CONTENT carries one).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const FILES = ["acamp-subpage.html", "vidyanagar-subpage.html"];
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const FLAGS = ["isHeading", "isPara", "isList", "isGallery", "isNote", "isPerson", "isEmbed", "isLink"].sort();
const KEYS = ["p", "h", "list", "gallery", "note", "person", "embed", "link"].sort();

function branchFlags(src) {
  const out = new Set();
  for (const m of src.matchAll(/sc-if value="\{\{ b\.(is\w+) \}\}"/g)) out.add(m[1]);
  return [...out].sort();
}
function dispatchKeys(src) {
  const out = new Set();
  for (const m of src.matchAll(/(?:else )?if \(b\.(\w+)\)/g)) out.add(m[1]);
  return [...out].sort();
}

for (const f of FILES) {
  test(`${f}: renders exactly the eight live block kinds`, () => {
    assert.deepEqual(branchFlags(read(f)), FLAGS);
    assert.deepEqual(dispatchKeys(read(f)), KEYS);
  });
  test(`${f}: the mp4 video block kind is gone`, () => {
    const src = read(f);
    assert.ok(!/b\.isVideo|b\.video|isVideo: true/.test(src), "dead video branch resurfaced in " + f);
    assert.ok(!/data-edit="video\.fallback"/.test(src), "orphaned video.fallback binding resurfaced in " + f);
  });
}

test("both subpages instantiate hasImages both ways (real grid + placeholder grid)", () => {
  for (const f of FILES) {
    const src = read(f);
    assert.match(src, /sc-if value="\{\{ b\.hasImages \}\}" hint-placeholder-val="\{\{ true \}\}"/);
    assert.match(src, /sc-if value="\{\{ b\.hasImages \}\}" hint-placeholder-val="\{\{ false \}\}"/);
  }
});
