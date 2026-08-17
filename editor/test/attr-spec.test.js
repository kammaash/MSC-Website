"use strict";
// data-edit-attr is the only editable-string hook whose SHAPE is non-trivial: a
// data-edit value is just a path, but a data-edit-attr value has to name the
// attribute as well, and it has to say "no" to attributes that are not text a
// visitor reads. Everything downstream (check-paths.js's build-time validation,
// the attribute popover in editor-client.js) is driven by this parser, so it is the
// one piece of the feature worth testing directly rather than through a source scan.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseAttrSpec, EDITABLE_ATTRS, planCommit, labelFor } = require("../lib/attr-spec.js");

test("parses a single attribute:path pair", () => {
  assert.deepEqual(parseAttrSpec("placeholder:admissionsSection.namePlaceholder"), [
    { attr: "placeholder", path: "admissionsSection.namePlaceholder" },
  ]);
});

test("parses several pairs separated by semicolons, in source order", () => {
  assert.deepEqual(parseAttrSpec("alt:footer.logoAlt;title:footer.logoTitle"), [
    { attr: "alt", path: "footer.logoAlt" },
    { attr: "title", path: "footer.logoTitle" },
  ]);
});

test("tolerates surrounding and inter-pair whitespace", () => {
  assert.deepEqual(parseAttrSpec("  placeholder : hero.hint ; alt : hero.alt  "), [
    { attr: "placeholder", path: "hero.hint" },
    { attr: "alt", path: "hero.alt" },
  ]);
});

test("keeps a shared: prefix on the path intact", () => {
  // The shared:/page routing decision belongs to draft.js's route(); this parser
  // must hand the path through untouched or shared strings would be written into
  // the page's own CONTENT block instead of content.js.
  assert.deepEqual(parseAttrSpec("alt:shared:site.groupName"), [
    { attr: "alt", path: "shared:site.groupName" },
  ]);
});

test("ignores a trailing semicolon rather than emitting an empty pair", () => {
  assert.deepEqual(parseAttrSpec("placeholder:hero.hint;"), [
    { attr: "placeholder", path: "hero.hint" },
  ]);
});

test("rejects an attribute that is not visitor-readable text", () => {
  // This is the whole point of the allowlist. src/href/style/on* carry behaviour or
  // resources, not words: binding one would turn a content edit into a way to point
  // the page at an arbitrary URL or script, and validateText (which only refuses
  // <script> and the CONTENT markers) would not stop it.
  for (const attr of ["src", "href", "style", "onclick", "class", "id", "srcset"]) {
    assert.throws(
      () => parseAttrSpec(attr + ":some.path"),
      /not an editable attribute/,
      attr + " must be refused"
    );
  }
});

test("the allowlist is exactly the four text attributes", () => {
  assert.deepEqual([...EDITABLE_ATTRS].sort(), ["alt", "aria-label", "placeholder", "title"]);
});

test("rejects a pair with no colon", () => {
  assert.throws(() => parseAttrSpec("placeholder"), /must be "attribute:path"/);
});

test("rejects an empty path", () => {
  assert.throws(() => parseAttrSpec("placeholder:"), /must be "attribute:path"/);
});

test("rejects an empty spec", () => {
  assert.throws(() => parseAttrSpec(""), /must be "attribute:path"/);
  assert.throws(() => parseAttrSpec("   "), /must be "attribute:path"/);
});

test("rejects a non-string spec", () => {
  assert.throws(() => parseAttrSpec(null), /must be "attribute:path"/);
});

test("attribute matching is case-insensitive, and normalises to lower case", () => {
  // HTML attribute names are case-insensitive, and the pages are hand-authored —
  // "Placeholder" should bind, not silently fail the allowlist.
  assert.deepEqual(parseAttrSpec("Placeholder:hero.hint"), [
    { attr: "placeholder", path: "hero.hint" },
  ]);
});

// ---- planCommit: what the attribute panel's Save actually does ----
// The panel commits SEVERAL fields at once, which is the one thing it does that the
// single-field blur handler in editor-client.js does not, and it is where an
// all-or-nothing rule has to hold. planCommit lives here, apart from the DOM code in
// editor-client.js, so it can be exercised directly rather than through a browser.
const rejectText = require("../client/draft.js").rejectText;
// `content` is what getLocal would read out of window.__CONTENT.
const lookup = (content) => (p) => {
  let cur = content;
  for (const part of p.split(".")) {
    if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
};
const CONTENT = {
  admissionsSection: { namePlaceholder: "Parent / student name", phonePlaceholder: "Phone number", optionUnsure: "Not sure yet" },
  footer: { logoAlt: "Montessori" },
};
const deps = () => ({ rejectText, getLocal: lookup(CONTENT) });

const row = (p, value, orig, label) => ({ path: p, value, orig, label: label || p });

test("an unchanged field produces no op", () => {
  const { ops, error } = planCommit([row("footer.logoAlt", "Montessori", "Montessori")], deps());
  assert.equal(error, null);
  assert.deepEqual(ops, []);
});

test("a changed field produces one set op", () => {
  const { ops, error } = planCommit(
    [row("footer.logoAlt", "Montessori School crest", "Montessori")],
    deps()
  );
  assert.equal(error, null);
  assert.deepEqual(ops, [{ path: "footer.logoAlt", value: "Montessori School crest" }]);
});

test("several changed fields produce ops in row order, and unchanged ones are dropped", () => {
  const { ops, error } = planCommit([
    row("admissionsSection.namePlaceholder", "Child's name", "Parent / student name"),
    row("admissionsSection.phonePlaceholder", "Phone number", "Phone number"),
    row("admissionsSection.optionUnsure", "Still deciding", "Not sure yet"),
  ], deps());
  assert.equal(error, null);
  assert.deepEqual(ops, [
    { path: "admissionsSection.namePlaceholder", value: "Child's name" },
    { path: "admissionsSection.optionUnsure", value: "Still deciding" },
  ]);
});

test("one rejected field cancels the whole panel — nothing is half-applied", () => {
  // This is the reason planCommit exists as a separate step. The blur handler in
  // editor-client.js commits ONE field, so "validate, then apply" is the same
  // instant. A panel holding four fields is not: applying the first two and then
  // discovering the third is illegal would leave the draft log describing an edit
  // the user never agreed to, with no way to see it except at Publish.
  const { ops, error } = planCommit([
    row("admissionsSection.namePlaceholder", "Child's name", "Parent / student name"),
    row("footer.logoAlt", "<script>x</script>", "Montessori", "Photo description"),
  ], deps());
  assert.deepEqual(ops, null);
  assert.match(error, /Photo description/);
  assert.match(error, /script tags/);
});

test("a CONTENT marker is refused, exactly as the server would refuse it", () => {
  const { ops, error } = planCommit(
    [row("footer.logoAlt", "CONTENT:BEGIN", "Montessori")],
    deps()
  );
  assert.equal(ops, null);
  assert.match(error, /CONTENT:BEGIN/);
});

test("a path that does not resolve to a string is refused before anything is recorded", () => {
  // A stale binding (an element left over from an old render, or a shared: path
  // when content.js never loaded) must fail here rather than at applyLocal — an op
  // that never applied has nothing to retire it from the draft log later.
  const { ops, error } = planCommit(
    [row("admissionsSection.nope", "x", "", "Hint text")],
    deps()
  );
  assert.equal(ops, null);
  assert.match(error, /Hint text/);
  assert.match(error, /admissionsSection\.nope/);
});

test("a path resolving to an object is refused too, not just a missing one", () => {
  const { ops, error } = planCommit([row("admissionsSection", "x", "", "Hint text")], deps());
  assert.equal(ops, null);
  assert.match(error, /admissionsSection/);
});

test("two rows editing the same path to different values is refused, not last-wins", () => {
  // Two <option>s bound to one content path is an authoring mistake, but a silent
  // last-wins would show the user one value in the panel and save the other.
  const { ops, error } = planCommit([
    row("footer.logoAlt", "Crest", "Montessori", "Choice 1"),
    row("footer.logoAlt", "Badge", "Montessori", "Choice 2"),
  ], deps());
  assert.equal(ops, null);
  assert.match(error, /same/i);
});

test("two rows on one path agreeing on the value collapse to a single op", () => {
  const { ops, error } = planCommit([
    row("footer.logoAlt", "Crest", "Montessori"),
    row("footer.logoAlt", "Crest", "Montessori"),
  ], deps());
  assert.equal(error, null);
  assert.deepEqual(ops, [{ path: "footer.logoAlt", value: "Crest" }]);
});

test("values are trimmed before comparison and before saving", () => {
  // Same reasoning as the blur handler's trim-at-capture (see editor-client.js):
  // untrimmed round trips let padding compound.
  const same = planCommit([row("footer.logoAlt", "  Montessori  ", "Montessori")], deps());
  assert.deepEqual(same.ops, []);
  const changed = planCommit([row("footer.logoAlt", "  Crest  ", "Montessori")], deps());
  assert.deepEqual(changed.ops, [{ path: "footer.logoAlt", value: "Crest" }]);
});

test("an empty value is refused — a blank placeholder or alt is almost always a mistake", () => {
  const { ops, error } = planCommit([row("footer.logoAlt", "   ", "Montessori", "Photo description")], deps());
  assert.equal(ops, null);
  assert.match(error, /Photo description/);
});

test("every allowlisted attribute has a label written for a non-technical editor", () => {
  for (const attr of EDITABLE_ATTRS) {
    const label = labelFor(attr);
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0, attr + " has no label");
    assert.ok(!label.includes(attr) || attr === "title", "label for " + attr + " should be plain English, not the attribute name");
  }
});

