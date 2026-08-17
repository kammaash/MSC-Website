"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkPaths, stripComments } = require("../check-paths.js");

// Fixtures live in a throwaway tmpdir — these tests never touch the real pages.
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-paths-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

const page = (body, markup = '<h1 data-edit="hero.title">x</h1>') =>
  `<html><body>${markup}
<script type="text/x-dc" data-dc-script>
/* CONTENT:BEGIN */
${body}
/* CONTENT:END */
</script></body></html>`;

const GOOD = page('const CONTENT = {"hero":{"title":"Help the child"}};');

test("clean page: no errors, and paths were actually checked", () => {
  const { errors, checked } = checkPaths(fixture({ "a.html": GOOD }), ["a.html"]);
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
});

test("unparseable CONTENT is a failure, not a silent skip", () => {
  // Trailing comma: still valid JS, so the page renders fine in a browser and
  // only this gate can catch that the editor's save path is broken.
  const broken = page('const CONTENT = {"hero":{"title":"Help the child"},};');
  const { errors, checked } = checkPaths(fixture({ "a.html": broken }), ["a.html"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^a\.html: CONTENT block is present but unparseable — /);
  assert.equal(checked, 0);
});

test("single-quoted values in CONTENT are a failure too", () => {
  const broken = page("const CONTENT = {'hero':{'title':'Help the child'}};");
  const { errors } = checkPaths(fixture({ "a.html": broken }), ["a.html"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unparseable/);
});

test("duplicate markers are a failure", () => {
  const dup = GOOD + "\n/* CONTENT:BEGIN */\n";
  const { errors } = checkPaths(fixture({ "a.html": dup }), ["a.html"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unparseable/);
});

test("a page with no CONTENT block at all is skipped without error", () => {
  const bare = '<html><body><h1 data-edit="hero.title">x</h1></body></html>';
  const { errors, checked } = checkPaths(fixture({ "a.html": bare }), ["a.html"]);
  assert.deepEqual(errors, []);
  assert.equal(checked, 0);
});

test("an unresolved path is reported", () => {
  const { errors } = checkPaths(
    fixture({ "a.html": page('const CONTENT = {"hero":{"sub":"x"}};') }),
    ["a.html"]
  );
  assert.deepEqual(errors, ["a.html: unresolved hero.title"]);
});

// "Resolves to something" was too weak. lib/patch.js's validateText rejects a non-string
// server-side, so a data-edit pointing at an object or an array is a field the editor
// offers for editing and then refuses to save — and the refusal surfaces at Publish,
// against a file the user has gone on editing, not at the click that caused it.
test("a data-edit path that resolves to a non-string is reported, even though it resolves", () => {
  const content = 'const CONTENT = {"hero":{"title":{"nested":"x"},"tags":["a"],"n":3}};';
  for (const [path, described] of [["hero.title", "an object"], ["hero.tags", "an array"], ["hero.n", "a number"]]) {
    const { errors } = checkPaths(
      fixture({ "a.html": page(content, `<h1 data-edit="${path}">x</h1>`) }),
      ["a.html"]
    );
    assert.equal(errors.length, 1, "expected exactly one error for " + path);
    assert.match(errors[0], new RegExp("^a\\.html: " + path.replace(".", "\\.") + " resolves to " + described + ", but data-edit must name a text value$"));
  }
});

test("data-list is exempt from the string rule — those paths resolve to arrays by definition", () => {
  const { errors, checked } = checkPaths(
    fixture({ "a.html": page('const CONTENT = {"news":[{"title":"x"}]};', '<div data-list="news"></div>') }),
    ["a.html"]
  );
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
});

test("a missing page is a reported failure, not a raw ENOENT throw", () => {
  const { errors } = checkPaths(fixture({ "a.html": GOOD }), ["a.html", "gone.html"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^gone\.html: cannot be read — /);
});

test("example paths inside comments are not validated", () => {
  const markup = [
    '<h1 data-edit="hero.title">x</h1>',
    '<!-- e.g. data-edit="nope.html.example" -->',
  ].join("\n");
  const withJsComment = page(
    'const CONTENT = {"hero":{"title":"Help the child"}};',
    markup
  ).replace("</script>", '// like data-edit="also.not.real"\n</script>');
  const { errors, checked } = checkPaths(fixture({ "a.html": withJsComment }), ["a.html"]);
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
});

test("{{ }} loop paths are skipped, literal siblings are not", () => {
  const markup = '<div data-edit="{{ s.p }}.n"></div><div data-edit="hero.title"></div>';
  const { errors, checked } = checkPaths(
    fixture({ "a.html": page('const CONTENT = {"hero":{"title":"x"}};', markup) }),
    ["a.html"]
  );
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
});

test("shared: paths report why content.js was unusable", () => {
  const markup = '<span data-edit="shared:contact.phone"></span>';
  const { errors } = checkPaths(
    fixture({ "a.html": page('const CONTENT = {"hero":{"title":"x"}};', markup) }),
    ["a.html"]
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /content\.js not found/);
});

test("stripComments leaves ordinary markup alone", () => {
  assert.equal(stripComments('<a href="https://x.test/a//b">k</a>'), '<a href="https://x.test/a//b">k</a>');
});

test("a data-media-slot path that resolves to a string passes; an unresolved one fails", () => {
  const root = fixture({ "index.html": page('const CONTENT = { "hero": { "photo": "" } };', '<img data-media-slot="hero.photo">') });
  assert.deepEqual(checkPaths(root, ["index.html"]).errors, []);

  const bad = fixture({ "index.html": page('const CONTENT = { "hero": { "photo": "" } };', '<img data-media-slot="hero.photoo">') });
  assert.equal(checkPaths(bad, ["index.html"]).errors.length, 1);
  assert.match(checkPaths(bad, ["index.html"]).errors[0], /hero\.photoo/);
});

test("a data-media-slot path resolving to a non-string is an error (same discipline as data-edit)", () => {
  const root = fixture({ "index.html": page('const CONTENT = { "hero": { "photo": "" } };', '<img data-media-slot="hero">') });
  const { errors } = checkPaths(root, ["index.html"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must name a text value/);
});

test("an interpolated data-media-slot (gallery items) is skipped, like data-edit", () => {
  const root = fixture({ "index.html": page('const CONTENT = { "hero": { "photo": "" } };', '<img data-media-slot="{{ ph.p }}.src">') });
  assert.deepEqual(checkPaths(root, ["index.html"]).errors, []);
});

test("retired data-media-poster attributes are not part of the path contract", () => {
  const root = fixture({
    "index.html": page('const CONTENT = { "hero": { "title": "x" } };',
      '<div data-edit="hero.title" data-media-poster="retired.missing"></div>'),
  });
  const { errors, checked } = checkPaths(root, ["index.html"]);
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
});

// ---- data-edit-attr (attribute-backed text) ----
// data-edit-attr names the same kind of thing data-edit does — a content path
// holding a string — but wraps it in an attribute:path pair, so it needs its own
// resolution pass or every placeholder and alt binding on the site would ship
// unvalidated.

test("a resolving data-edit-attr path is checked like a data-edit one", () => {
  const dir = fixture({
    "a.html": page(
      'const CONTENT = {"hero":{"title":"t","hint":"Parent / student name"}};',
      '<h1 data-edit="hero.title">x</h1><input data-edit-attr="placeholder:hero.hint">'
    ),
  });
  const { errors, checked } = checkPaths(dir, ["a.html"]);
  assert.deepEqual(errors, []);
  assert.equal(checked, 2, "both the data-edit and the data-edit-attr path must be counted");
});

test("an unresolved data-edit-attr path is reported, naming the attribute", () => {
  const dir = fixture({
    "a.html": page(
      'const CONTENT = {"hero":{"title":"t"}};',
      '<input data-edit-attr="placeholder:hero.nope">'
    ),
  });
  const { errors } = checkPaths(dir, ["a.html"]);
  assert.deepEqual(errors, ["a.html: unresolved hero.nope (placeholder)"]);
});

test("every pair in a multi-pair data-edit-attr is resolved, not just the first", () => {
  const dir = fixture({
    "a.html": page(
      'const CONTENT = {"hero":{"a":"x"}};',
      '<img data-edit-attr="alt:hero.a;title:hero.b">'
    ),
  });
  const { errors, checked } = checkPaths(dir, ["a.html"]);
  assert.deepEqual(errors, ["a.html: unresolved hero.b (title)"]);
  assert.equal(checked, 2);
});

test("a data-edit-attr path resolving to a non-string is reported", () => {
  const dir = fixture({
    "a.html": page(
      'const CONTENT = {"hero":{"list":["a"]}};',
      '<input data-edit-attr="placeholder:hero.list">'
    ),
  });
  const { errors } = checkPaths(dir, ["a.html"]);
  assert.deepEqual(errors, [
    "a.html: hero.list resolves to an array, but data-edit-attr must name a text value",
  ]);
});

test("a data-edit-attr naming a non-text attribute fails the build", () => {
  // The allowlist in lib/attr-spec.js is only worth having if the build enforces
  // it — this is the gate that stops `src`/`href` binding from ever shipping.
  const dir = fixture({
    "a.html": page(
      'const CONTENT = {"hero":{"photo":"a.png"}};',
      '<img data-edit-attr="src:hero.photo">'
    ),
  });
  const { errors } = checkPaths(dir, ["a.html"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^a\.html: data-edit-attr="src:hero\.photo" — "src" is not an editable attribute/);
});

test("a malformed data-edit-attr spec fails the build", () => {
  const dir = fixture({
    "a.html": page('const CONTENT = {"hero":{"a":"x"}};', '<input data-edit-attr="placeholder">'),
  });
  const { errors } = checkPaths(dir, ["a.html"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /data-edit-attr="placeholder" — /);
});

test("a shared: data-edit-attr path is resolved against content.js", () => {
  const dir = fixture({
    "content.js": '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"site":{"groupName":"Montessori Schools"}};\n/* CONTENT:END */',
    "a.html": page(
      'const CONTENT = {"hero":{"title":"t"}};',
      '<h1 data-edit="hero.title">x</h1><img data-edit-attr="alt:shared:site.groupName">'
    ),
  });
  const { errors, checked } = checkPaths(dir, ["a.html"]);
  assert.deepEqual(errors, []);
  assert.equal(checked, 2);
});

test("an interpolated data-edit-attr is left to the renderer, like an interpolated data-edit", () => {
  // "{{ … }}" values are built per-item inside an sc-for and cannot be resolved
  // statically. The existing data-edit scan skips them the same way.
  const dir = fixture({
    "a.html": page(
      'const CONTENT = {"hero":{"title":"t"}};',
      '<h1 data-edit="hero.title">x</h1><img data-edit-attr="alt:{{ ph.p }}.caption">'
    ),
  });
  const { errors, checked } = checkPaths(dir, ["a.html"]);
  assert.deepEqual(errors, []);
  // 1, not 2: the scan ran (the data-edit was resolved) and skipped the interpolated pair.
  assert.equal(checked, 1);
});
