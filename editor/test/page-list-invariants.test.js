"use strict";
// `gallery` used to hold EITHER an array of [src, caption] pairs OR the literal
// `true` ("draw the coming-soon placeholder"). `true` is not a list: getList throws
// "Not a list", so "+ Add photo" would fail on every such block — including every
// grid on Vidyanagar. `[]` renders identically (still truthy for the dispatch,
// hasImages stays false, the placeholder grid still draws) but is growable.
// These checks walk the real CONTENT blocks, so they need no hand-maintained counts.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { extractContent } = require("../lib/content-io.js");
const { getPath } = require("../lib/paths.js");

const ROOT = path.join(__dirname, "..", "..");
const SUBPAGES = ["acamp-subpage.html", "vidyanagar-subpage.html"];
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// Every route in a subpage CONTENT block, as [label, blocksPath] pairs — the same
// paths renderVals() computes (base = page ? "pages." + route : "fallback").
function routes(data) {
  const out = Object.keys(data.pages).map((r) => [r, "pages." + r + ".blocks"]);
  out.push(["fallback", "fallback.blocks"]);
  return out;
}

for (const f of SUBPAGES) {
  test(`${f}: every gallery value on every route is an array (the true sentinel is gone)`, () => {
    const src = read(f);
    assert.ok(!/"gallery":\s*true/.test(src), f + ' still contains a "gallery": true sentinel');
    const data = extractContent(src).data;
    let galleries = 0;
    for (const [label, blocksPath] of routes(data)) {
      const blocks = getPath(data, blocksPath);
      assert.ok(Array.isArray(blocks), label + ": " + blocksPath + " must be an array");
      blocks.forEach((b, i) => {
        if ("gallery" in b) {
          galleries++;
          assert.ok(Array.isArray(b.gallery), blocksPath + "." + i + ".gallery must be an array");
        }
      });
    }
    assert.ok(galleries > 0, f + ": expected at least one gallery block");
  });
}
