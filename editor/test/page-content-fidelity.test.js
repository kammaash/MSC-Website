"use strict";
// Two ways a page can render a value correctly today and lie the moment somebody edits
// it. Both were live on the deployed pages; both are cheap to keep fixed, and neither
// is visible in any other test — check-paths.js proves a data-edit path RESOLVES, not
// that the value it resolves to is the whole of what the reader sees.
//
//   I1  — the visible email came from CONTENT while the mailto: href beside it was a
//         hard-coded literal, so the first change to the school's email address would
//         have shown the new one and mailed the old one.
//   D3  — contact.acampAddress (and its Vidyanagar twin) held only the tail of the
//         address; the markup carried "A-Camp, Kurnool, Andhra Pradesh, India — " as a
//         literal prefix. Since the value is still the placeholder "full address to be
//         added", the first real edit would have rendered the locality twice.
//
// These assertions run against the real pages, not fixtures: the defect is in the
// shipped markup, so nothing else would catch it coming back.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { extractContent } = require("../lib/content-io.js");
const { PAGES } = require("../check-paths.js");

const ROOT = path.join(__dirname, "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const shared = extractContent(read("content.js")).data;

test("I1: no page hard-codes a mailto: address — every mailto href is computed from contact.email", () => {
  let anchors = 0;
  for (const page of PAGES) {
    const src = read(page);
    // A literal address in the href is the defect itself. `{{ }}` holes are the fix, so
    // only a literal (a character that is not the start of a hole) is rejected.
    assert.doesNotMatch(
      src,
      /href="mailto:/,
      page + ": mailto: href must be built from contact.email in renderVals(), not hard-coded"
    );
    for (const _ of src.matchAll(/href="\{\{ mailtoEmail \}\}"/g)) anchors++;
    if (/\{\{ mailtoEmail \}\}/.test(src)) {
      // …and the value it reads must be the same one the visible text renders from.
      assert.match(
        src,
        /mailtoEmail: "mailto:" \+ (window\.SHARED_CONTENT|S)\.contact\.email/,
        page + ": mailtoEmail must be derived from the shared contact.email, not a second copy"
      );
    }
  }
  assert.equal(anchors, 3, "expected the three footer email links (index + both branch pages)");
});

test("D3: the address value holds the whole address — no fragment of it is left in the markup", () => {
  const cases = [
    ["acampAddress", "montessori-acamp.html"],
    ["vidyanagarAddress", "montessori-vidyanagar.html"],
  ];
  for (const [key, page] of cases) {
    const value = shared.contact[key];
    assert.ok(typeof value === "string" && value.length > 0, key + " must be a non-empty string");

    const marker = 'data-edit="shared:contact.' + key + '"';
    const line = read(page).split("\n").find((l) => l.includes(marker));
    assert.ok(line, page + ": expected a markup line carrying " + marker);

    // Strip the editable span, then strip the remaining tags. Whatever text is left is
    // literal copy sitting beside the hole — copy the editor cannot reach and the value
    // therefore has to agree with by hand. Only the sentence-ending period may remain.
    const outside = line.replace(new RegExp("<span[^>]*" + marker + "[^>]*>[\\s\\S]*?</span>"), "");
    const literalText = outside.replace(/<[^>]*>/g, "").trim();
    assert.equal(
      literalText,
      ".",
      page + ": the only literal text beside the address hole may be the full stop; found " + JSON.stringify(literalText)
    );
  }
});
