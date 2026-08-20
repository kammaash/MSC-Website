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

// ---- every list the pages render is declared, resolvable, and stamped ----
// check-paths.js skips interpolated {{ }} paths by construction, so a wrong binding
// inside an sc-for is invisible to it. This pass instantiates every list path each
// route would render — the same arithmetic as the normalisers — and proves each one
// (a) resolves to an array in CONTENT and (b) is accepted by the server's
// requireCollection against the real collections.json. (b) is the half that catches
// a declared-key typo: without it Add works locally and Publish 400s.
const { requireCollection } = require("../lib/patch.js");
const templates = require("../collections.json");
// collections-client.test.js's EXPECTED_BINDINGS table only covers LITERAL data-list
// strings (the ones a plain grep over the markup can find) and says so: interpolated
// ({{ }}) bindings — every blocks/list/gallery path on a subpage route, since the
// path is built from the route's own key — are "covered instead by the route-walking
// tests in page-list-invariants.test.js". This loop is that coverage: for every path
// this file already instantiates from real CONTENT, also classify it and check the
// chrome it would actually get. As a side effect, since `label`/`blocksPath` are built
// from the SAME route keys collections.js's regexes anchor on, a route slug containing
// a "." (which would desync the two) fails here instead of only mattering in theory.
const C = require("../client/collections.js");

for (const f of SUBPAGES) {
  test(`${f}: every instantiated blocks/list/gallery path resolves AND is a declared collection`, () => {
    const data = extractContent(read(f)).data;
    let lists = 0;
    for (const [label, blocksPath] of routes(data)) {
      assert.ok(requireCollection(templates, blocksPath), blocksPath + " must be declared");
      assert.equal(C.family(blocksPath), "blocks", blocksPath + " must classify as blocks");
      assert.equal(C.addLabel(blocksPath), "+ Add section", blocksPath);
      assert.equal(C.floorFor(blocksPath), 1, blocksPath);
      const blocks = getPath(data, blocksPath);
      assert.ok(Array.isArray(blocks), label + ": " + blocksPath);
      blocks.forEach((b, i) => {
        for (const kindKey of ["list", "gallery"]) {
          if (kindKey in b) {
            lists++;
            const p = blocksPath + "." + i + "." + kindKey;
            assert.ok(Array.isArray(getPath(data, p)), p + " must be an array");
            assert.ok(requireCollection(templates, p), p + " must be declared");
            const wantFamily = kindKey === "list" ? "rows" : "blockGallery";
            const wantLabel = kindKey === "list" ? "+ Add row" : "+ Add photo";
            assert.equal(C.family(p), wantFamily, p + " must classify as " + wantFamily);
            assert.equal(C.addLabel(p), wantLabel, p);
            assert.equal(C.floorFor(p), 1, p);
          }
        }
      });
    }
    assert.ok(lists > 0, f + ": expected at least one nested list");
  });

  test(`${f}: the markup stamps the containers and items the chrome hangs on`, () => {
    const src = read(f);
    assert.match(src, /data-list="\{\{ blocksPath \}\}"/, "blocks wrapper");
    assert.match(src, /<div key="\{\{ b\.key \}\}" data-item="" style="position:relative">/, "block item root");
    assert.match(src, /data-list="\{\{ b\.p \}\}\.list"/, "rows container");
    // BOTH gallery branches carry the list, so a school with zero photos still gets
    // "+ Add photo" — the state all eleven Vidyanagar grids ship in.
    assert.equal((src.match(/data-list="\{\{ b\.p \}\}\.gallery"/g) || []).length, 2, "both gallery grids");
    assert.match(src, /blocksPath: base \+ "\.blocks"/, "normaliser exposes blocksPath");
  });
}

test("montessori-acamp.html: gallery categories are an addable list with item chrome", () => {
  const src = read("montessori-acamp.html");
  assert.match(src, /data-list="galleryGroups"/);
  // The group root and the photo tile each carry data-item; the tile is also a media
  // slot, which is why decorate() shifts its menu top-left (ed-menu-slot).
  assert.match(src, /<div style="margin-top:42px;position:relative" data-item="">/);
  assert.match(src, /class="flip" data-item="" data-media-slot="\{\{ ph\.p \}\}\.src"/);
});
