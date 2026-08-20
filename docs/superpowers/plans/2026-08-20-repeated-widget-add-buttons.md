# Repeated-Widget Add Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every content collection that changes over time — subpage sections, their list rows and photo grids, and the A-Camp gallery categories — gains working `+ Add / ↑ / ↓ / ✕` chrome, with the Vidyanagar subpage brought to full render parity with A-Camp so the feature behaves identically on both.

**Architecture:** The server's flat item contract (`validateItem`) becomes a recursive `validateShape` driven by declared templates (with a `oneOf` marker for the block union and a small `LEAF_RULES` table for judgement calls like `embed.src`); `requireCollection` gains segment-wise `*` matching so one declaration covers all routes; the client gets a data-only lookup module (`editor/client/collections.js`) for blank items, labels and floors, guarded against drift by a node test that validates every client blank item with the server's own validator; `editor-client.js` grows a block-kind chooser popover and a floored, red-accented delete. The Vidyanagar subpage is ported to render all eight live block kinds, the dead mp4 `video` kind is deleted from both subpages, and the `gallery: true` sentinel is migrated to `[]` so every grid is a growable list.

**Tech Stack:** Plain Node.js (>= 22, zero npm dependencies), `node:test` + `node:assert/strict`, vanilla-JS browser IIFEs using the dual-environment module pattern of `editor/lib/paths.js`. No build step.

**Spec:** `docs/superpowers/specs/2026-08-17-repeated-widget-add-buttons-design.md`

**Base commit:** `472db02` per the spec; written against `6aeccfb` (working tree identical for all files this plan touches). Other sessions have worked on this branch concurrently before. **Before starting any task, run `git status --short && git log -1 --format=%h` — the tree must be clean. If HEAD is not `6aeccfb`, diff the files this plan touches against the snippets quoted here before proceeding, and stop if any quoted "current code" block no longer matches.**

## Global Constraints

- Node >= 22, **zero npm dependencies** — tests use only `node:test`; no puppeteer/jsdom. Page-level assertions are source-level + CONTENT-extraction checks, the established house style (see `editor/test/page-media-invariants.test.js`).
- `editor/collections.json` stays server-private: the HTTP server 403s it (`security.test.js` pins this). The client must never fetch it.
- `validateText` rules are unchanged and apply to every string leaf: no `<script`, no `CONTENT:BEGIN|END` markers, must be a string.
- Client files are IIFEs; anything shared with node tests uses the dual-env pattern: `(function (exports) { ... })(typeof module !== "undefined" ? module.exports : (window.EditorX = {}))`.
- Match the codebase's comment density: comments explain *why*, at the depth of the surrounding file.
- Every task ends with `npm test` **and** `node editor/check-paths.js` green. No task may leave either red at its commit.
- Error message phrases that existing tests pin must survive: `"keys must be exactly:"` (patch.test.js matches `/exactly/`), `"kind must be image or video"` (matched as `/kind/`), `"Unknown collection: "`.
- Commit messages follow the branch's `type(scope): summary` convention and end with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

## Plan deviations from the spec (deliberate, with reasons)

1. **`fallback.blocks` is declared too.** Both subpage normalisers compute `const base = page ? "pages." + route : "fallback"` — the fallback page renders the same blocks container and is already text-editable. Without declarations for `fallback.blocks`, `fallback.blocks.*.list`, `fallback.blocks.*.gallery`, the Add button on that route would 400 at Publish. A test pins that the fallback template deep-equals the `pages.*.blocks` one so the duplicate cannot drift.
2. **`decorate()` gets a nearest-list filter.** The spec says "no new concepts reach decorate()", but nesting does: a block `data-item` *contains* row/photo `data-item`s, and `listEl.querySelectorAll(":scope [data-item]")` is a descendant query. Without filtering to items whose nearest `[data-list]` ancestor is `listEl`, the blocks list would stamp menus with wrong indices onto nested rows. This is a correctness requirement, not a new concept for page authors.
3. **Sentinel counts are 5 (acamp) and 12 (vidyanagar)**, not the spec's 4/11. The migration and its test count nothing by hand — they assert *no* `gallery` value in either CONTENT block is a non-array.
4. **`galleryGroups` photo tiles get `data-item`.** They never had it, so group photos today have an Add button but no ↑/↓/✕ — yet the spec's §7 gives them the delete affordance and floor. The `.ed-menu` on these tiles is shifted top-left (class `ed-menu-slot`) because the media-slot hover actions already own the top-right corner.

## Files (created / modified)

| File | Role in this plan |
| --- | --- |
| `editor/lib/patch.js` | `validateShape` (replaces `validateItem`), `LEAF_RULES`, segment-wise `requireCollection`, new exports |
| `editor/collections.json` | all new collection declarations |
| `editor/client/collections.js` | **new** — blank items, labels, floors, families, block kinds |
| `editor/client/editor-client.js` | decorate labels + nearest-list filter, floored delete, chooser popover, `onAdd` dispatch |
| `editor/server.js` | one INJECT line for the new client module |
| `acamp-subpage.html` | delete `video` kind; sentinel migration; `data-list`/`data-item` stamping; `blocksPath` |
| `vidyanagar-subpage.html` | parity port (gallery/person/embed/link); sentinel migration; stamping; `blocksPath`; 8d line order |
| `montessori-acamp.html` | `data-list="galleryGroups"` wrapper; `data-item` on group + photo tile |
| `editor/test/patch.test.js` | validateShape, leaf-rule, wildcard, integration tests |
| `editor/test/collections-client.test.js` | **new** — drift guard + client module unit tests |
| `editor/test/subpage-parity.test.js` | **new** — the two subpages render the same block kinds |
| `editor/test/page-list-invariants.test.js` | **new** — sentinel migration + every instantiated list path resolves and is declared |
| `editor/test/editor-client.test.js` | updated pins for the moved/changed chrome code |
| `docs/EDITING.md` | collaborator documentation |

**Interfaces produced, used across tasks (exact):**

- `editor/lib/patch.js` exports `{ applyPatch, validateText, validateShape, requireCollection }`. `validateShape(value, template, fieldPath)` throws `Error` on mismatch, returns `undefined` on success; `fieldPath` is `""` for a top-level item. `requireCollection(templates, path)` returns the template or throws `Error("Unknown collection: " + path)`.
- `editor/client/collections.js` exports (window: `EditorCollections`) `{ family, addLabel, floorFor, mediaFor, blockKinds, blankItem }`:
  - `family(listPath)` → one of `"blocks" | "rows" | "blockGallery" | "galleryGroups" | "groupPhotos" | "sharedGallery" | "news"`
  - `addLabel(listPath)` → the button label string
  - `floorFor(listPath)` → `0` for news, `1` otherwise
  - `mediaFor(listPath)` → `"image"` or `null` — the picker kind an Add must open *before* an item can exist
  - `blockKinds()` → `[{kind, label, media}]`, 7 entries, `media ∈ {null, "image", "video"}`
  - `blankItem(listPath, kind, media)` → the item to add; `media` is `{id, url, title}` or `null`; for `kind === "video"` returns an **array of two items** `[headingBlock, embedBlock]`
- Subpage normalisers expose `blocksPath` (= `base + ".blocks"`) in the object returned by `renderVals()`.

---

### Task 1: `validateShape` — recursive templates + leaf rules in `editor/lib/patch.js`

**Files:**
- Modify: `editor/lib/patch.js`
- Test: `editor/test/patch.test.js`

**Interfaces:**
- Consumes: `validateText` (same file, unchanged), `parseVideoId` from `editor/lib/youtube.js`.
- Produces: `validateShape(value, template, fieldPath)` exported; `validateItem` deleted (grep first — it is referenced nowhere outside `patch.js` today, verify that is still true).

- [ ] **Step 1: Write the failing tests** — append to `editor/test/patch.test.js`:

```js
// ---- validateShape: the recursive item contract (Task: repeated-widget add buttons) ----
// Templates recurse ON THE TEMPLATE, so a hostile payload can never drive the
// recursion deeper than a declaration we authored. Every rejection names the failing
// field path — a seven-way oneOf failing as "item did not match" is undebuggable.
const { validateShape } = require("../lib/patch.js");

const BLOCK_ONEOF = { oneOf: [
  { p: "" }, { h: "" }, { note: "", sub: "" },
  { list: [["", ""]] }, { gallery: [["", ""]] },
  { person: { src: "", name: "", title: "" } },
  { embed: { src: "", title: "" } },
] };

test("validateShape: tuple template accepts exactly-shaped rows and nothing else", () => {
  validateShape(["Empathy", "understanding others"], ["", ""], ""); // no throw
  assert.throws(() => validateShape(["only one"], ["", ""], ""), /exactly 2/);
  assert.throws(() => validateShape(["a", "b", "c"], ["", ""], ""), /exactly 2/);
  assert.throws(() => validateShape(["a", 2], ["", ""], ""), /must be a string/);
  assert.throws(() => validateShape("not an array", ["", ""], ""), /array/);
});

test("validateShape: nested object template recurses and names the failing path", () => {
  validateShape({ person: { src: "x.jpg", name: "N", title: "T" } },
    { person: { src: "", name: "", title: "" } }, "");
  assert.throws(() => validateShape({ person: { src: "x.jpg", name: "N" } },
    { person: { src: "", name: "", title: "" } }, ""), /person keys must be exactly: name,src,title/);
  assert.throws(() => validateShape({ list: [["a", 2]] }, { list: [["", ""]] }, ""),
    /list\.0\.1/);
});

test("validateShape: oneOf selects the alternative by key set", () => {
  validateShape({ p: "hello" }, BLOCK_ONEOF, "");
  validateShape({ note: "N", sub: "S" }, BLOCK_ONEOF, "");
  validateShape({ embed: { src: "https://www.youtube.com/embed/dQw4w9WgXcQ", title: "T" } }, BLOCK_ONEOF, "");
  // No alternative has these keys — the error lists what WOULD be accepted.
  assert.throws(() => validateShape({ p: "x", h: "y" }, BLOCK_ONEOF, ""), /one of/);
  assert.throws(() => validateShape("just text", BLOCK_ONEOF, ""), /object/);
  // The matched alternative's INNER failure keeps its field path.
  assert.throws(() => validateShape({ person: { src: 3, name: "N", title: "T" } }, BLOCK_ONEOF, ""),
    /person\.src/);
});

test("validateShape: validateText still guards every nested leaf", () => {
  assert.throws(() => validateShape({ list: [["a", "</script><script>alert(1)"]] },
    { list: [["", ""]] }, ""), /script/);
});

test("validateShape: value nesting deeper than the template is rejected, not recursed", () => {
  assert.throws(() => validateShape({ p: { deep: { deeper: "x" } } }, { p: "" }, ""),
    /must be a string/);
});

test("leaf rule: embed.src accepts only the canonical YouTube embed form", () => {
  const good = { embed: { src: "https://www.youtube.com/embed/dQw4w9WgXcQ", title: "T" } };
  validateShape(good, BLOCK_ONEOF, "");
  const bad = (src) => assert.throws(
    () => validateShape({ embed: { src, title: "T" } }, BLOCK_ONEOF, ""), /embed\.src/);
  bad("https://vimeo.com/1");
  bad("javascript:alert(1)");
  bad("dQw4w9WgXcQ");
  bad("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  bad("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  bad("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0");
});

test("leaf rule: the galleries kind check survives the validateItem replacement", () => {
  validateShape({ kind: "image", id: "x", caption: "" }, templates["galleries.acamp"], "");
  assert.throws(() => validateShape({ kind: "iframe", id: "x", caption: "" },
    templates["galleries.acamp"], ""), /kind must be image or video/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test editor/test/patch.test.js`
Expected: FAIL — `validateShape is not a function`.

- [ ] **Step 3: Implement.** In `editor/lib/patch.js`, delete `validateItem` and add (between `validateText` and `requireCollection`):

```js
const { parseVideoId } = require("./youtube.js");

// Judgement calls a JSON shape template cannot express, keyed by the field path
// inside an item. Shape belongs in collections.json; these rules stay in code.
//   kind      — the shared-gallery item's provider tag; anything else would make
//               media-urls.js throw at render time on a published page.
//   embed.src — written verbatim into an <iframe src> on a published page.
//               validateText blocks <script, which is not the relevant threat here:
//               the rule requires the one canonical embed form and re-derives the ID
//               through lib/youtube.js, so nothing reaches the page that the YouTube
//               helper cannot positively identify.
const LEAF_RULES = {
  "kind": {
    ok: (v) => v === "image" || v === "video",
    why: "kind must be image or video",
  },
  "embed.src": {
    ok: (v) => /^https:\/\/www\.youtube\.com\/embed\/[A-Za-z0-9_-]{11}$/.test(v) && parseVideoId(v) !== null,
    why: "embed.src must be exactly https://www.youtube.com/embed/<11-character video id>",
  },
};

// Validates a newly added item against a declared template, recursing ON THE
// TEMPLATE — depth and breadth are bounded by declarations we author, so a hostile
// payload cannot drive the recursion. Four template forms:
//   ""            a string (then validateText, then any LEAF_RULES entry)
//   [a, b, ...]   an array of exactly that length, validated elementwise
//   {k: v, ...}   a plain object with exactly those keys, validated per key
//   {oneOf: [..]} a value matching one alternative, chosen BY KEY SET — every
//                 alternative in this content model has a distinct key set, so the
//                 choice is unambiguous and the matched alternative's inner failure
//                 keeps its precise field path.
// A template is only ever matched against a NEWLY ADDED item, never one the user
// has since grown — so exact array lengths are correct: every seeded collection
// starts with exactly one child.
function validateShape(value, template, fieldPath) {
  const at = fieldPath === "" ? "item" : fieldPath;
  if (typeof template === "string") {
    if (typeof value !== "string") throw new Error(at + " must be a string");
    validateText(value);
    const rule = LEAF_RULES[fieldPath];
    if (rule && !rule.ok(value)) throw new Error(rule.why);
    return;
  }
  if (Array.isArray(template)) {
    if (!Array.isArray(value) || value.length !== template.length) {
      throw new Error(at + " must be an array of exactly " + template.length + " entries");
    }
    template.forEach((t, i) => validateShape(value[i], t, fieldPath === "" ? String(i) : fieldPath + "." + i));
    return;
  }
  if (template !== null && typeof template === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(at + " must be an object");
    }
    const got = Object.keys(value).sort().join(",");
    // The oneOf marker is checked before the plain-object rule; no item shape in
    // this content model has oneOf as a key, so the marker cannot be shadowed.
    if (Array.isArray(template.oneOf)) {
      const alt = template.oneOf.find((t) =>
        t !== null && typeof t === "object" && !Array.isArray(t) &&
        Object.keys(t).sort().join(",") === got);
      if (!alt) {
        const kinds = template.oneOf.map((t) => "{" + Object.keys(t).sort().join(",") + "}").join(", ");
        throw new Error(at + " keys must match one of: " + kinds);
      }
      validateShape(value, alt, fieldPath);
      return;
    }
    const want = Object.keys(template).sort().join(",");
    if (want !== got) throw new Error(at + " keys must be exactly: " + want);
    for (const k of Object.keys(template)) {
      validateShape(value[k], template[k], fieldPath === "" ? k : fieldPath + "." + k);
    }
    return;
  }
  throw new Error("Bad collection template at " + at);
}
```

Change the `applyPatch` call site from `validateItem(op.item, requireCollection(templates, op.path))` to `validateShape(op.item, requireCollection(templates, op.path), "")`, and the export line to:

```js
module.exports = { applyPatch, validateText, validateShape, requireCollection };
```

(`requireCollection` is exported now because Tasks 6 and 8's tests call it; the wildcard rewrite lands in Task 2.)

- [ ] **Step 4: Verify nothing referenced `validateItem`**

Run: `grep -rn "validateItem" editor/ *.html`
Expected: zero hits.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green — the existing `add validates item shape against template` test passes because `"keys must be exactly:"` and `"kind must be image or video"` survive verbatim, and `templates["galleries.acamp"]`'s `"image"` string values are string templates.

- [ ] **Step 6: Commit**

```bash
git add editor/lib/patch.js editor/test/patch.test.js
git commit -m "feat(editor): recursive validateShape with oneOf and leaf rules replaces the flat item contract"
```

---

### Task 2: Segment-wise wildcard matching in `requireCollection`

**Files:**
- Modify: `editor/lib/patch.js`
- Test: `editor/test/patch.test.js`

**Interfaces:**
- Produces: `requireCollection(templates, path)` where a `*` **in the declared key** matches any one path segment; an exact key always wins; among wildcard keys the one with fewest `*`s wins.

- [ ] **Step 1: Write the failing tests** — append to `editor/test/patch.test.js`:

```js
// ---- requireCollection: segment-wise wildcards (Task: repeated-widget add buttons) ----
const { requireCollection } = require("../lib/patch.js");

test("wildcards in the DECLARED key match any one segment; the shape of the path stays fixed", () => {
  const t = { "pages.*.blocks.*.list": ["", ""] };
  assert.deepEqual(requireCollection(t, "pages.awards.blocks.1.list"), ["", ""]);
  assert.deepEqual(requireCollection(t, "pages.events-news.blocks.0.list"), ["", ""]);
  // Wrong number of segments never matches.
  assert.throws(() => requireCollection(t, "pages.awards.blocks"), /Unknown collection/);
  assert.throws(() => requireCollection(t, "pages.awards.blocks.1.list.0"), /Unknown collection/);
  // The literal segments stay literal.
  assert.throws(() => requireCollection(t, "nav.awards.blocks.1.list"), /Unknown collection/);
});

test("an exact declaration beats a wildcard one", () => {
  const t = { "a.*.c": "wild", "a.b.c": "exact" };
  assert.equal(requireCollection(t, "a.b.c"), "exact");
  assert.equal(requireCollection(t, "a.z.c"), "wild");
});

test("the numeric-substitution behaviour is a strict subset: galleryGroups.*.photos still matches", () => {
  assert.ok(requireCollection(templates, "galleryGroups.0.photos"));
  assert.throws(() => requireCollection(templates, "galleryGroups.0.nope"), /Unknown collection/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test editor/test/patch.test.js`
Expected: the two new wildcard tests FAIL (the old code only substitutes *numeric* path segments, so `pages.awards.blocks.1.list` collapses to `pages.awards.blocks.*.list`, which is not declared).

- [ ] **Step 3: Replace `requireCollection`** in `editor/lib/patch.js`:

```js
// True when `declared` (a collections.json key, where `*` matches any ONE segment)
// covers `path`. Segment-wise, same length only — the SHAPE of a path is fixed by
// its declaration; only the wildcarded segments (route names, indices) are free.
function collectionKeyMatches(declared, path) {
  const d = declared.split(".");
  const p = path.split(".");
  if (d.length !== p.length) return false;
  return d.every((seg, i) => seg === "*" || seg === p[i]);
}

// Resolves the template for a requested collection path. An exact key always wins,
// so a specific declaration can override a general one; among wildcard keys the one
// with the fewest wildcards wins (deterministic, and "most specific" by any reading).
// This does not weaken the allowlist: addItem still resolves the path through
// getList, so a fabricated route fails there even if its shape matches a wildcard.
function requireCollection(templates, path) {
  if (Object.prototype.hasOwnProperty.call(templates, path)) return templates[path];
  const keys = Object.keys(templates)
    .filter((k) => k.includes("*") && collectionKeyMatches(k, path))
    .sort((a, b) => a.split("*").length - b.split("*").length);
  if (keys.length === 0) throw new Error("Unknown collection: " + path);
  return templates[keys[0]];
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: green (the old numeric-substitution path `galleryGroups.0.photos` is covered by the new matcher).

- [ ] **Step 5: Commit**

```bash
git add editor/lib/patch.js editor/test/patch.test.js
git commit -m "feat(editor): requireCollection matches declared keys segment-wise, * matches any one segment"
```

---

### Task 3: Declare the new collections in `editor/collections.json`

**Files:**
- Modify: `editor/collections.json`
- Test: `editor/test/patch.test.js`

- [ ] **Step 1: Write the failing tests** — append to `editor/test/patch.test.js`:

```js
// ---- the real declarations end-to-end through applyPatch ----
const subpageFix = () => ({
  pages: { library: { blocks: [
    { p: "text" },
    { list: [["a", "b"]] },
    { gallery: [] },
  ] } },
  fallback: { blocks: [{ p: "text" }] },
});

test("every block kind the chooser offers is addable through the real templates", () => {
  const items = [
    { p: "Write this section here." },
    { h: "New heading" },
    { note: "Something to highlight", sub: "A supporting line." },
    { list: [["New item", "Describe it here."]] },
    { gallery: [["https://res.cloudinary.com/demo/image/upload/x.jpg", "New photo"]] },
    { person: { src: "https://res.cloudinary.com/demo/image/upload/x.jpg", name: "Name", title: "Role" } },
    { embed: { src: "https://www.youtube.com/embed/dQw4w9WgXcQ", title: "T" } },
  ];
  for (const item of items) {
    const d = applyPatch(subpageFix(), { ops: [{ type: "add", path: "pages.library.blocks", item }] }, templates);
    assert.equal(d.pages.library.blocks.length, 4);
  }
  // link is deliberately NOT addable: its href cannot be edited in the editor.
  assert.throws(() => applyPatch(subpageFix(), {
    ops: [{ type: "add", path: "pages.library.blocks", item: { link: { href: "x", label: "L", sub: "S" } } }],
  }, templates), /one of/);
});

test("rows and gallery photos are addable on any route through one declaration", () => {
  let d = applyPatch(subpageFix(), { ops: [{ type: "add", path: "pages.library.blocks.1.list", item: ["T", "D"] }] }, templates);
  assert.equal(d.pages.library.blocks[1].list.length, 2);
  d = applyPatch(subpageFix(), { ops: [{ type: "add", path: "pages.library.blocks.2.gallery", item: ["u.jpg", "C"] }] }, templates);
  assert.equal(d.pages.library.blocks[2].gallery.length, 1);
});

test("the fallback route is addable and its template cannot drift from pages.*.blocks", () => {
  assert.deepEqual(templates["fallback.blocks"], templates["pages.*.blocks"]);
  assert.deepEqual(templates["fallback.blocks.*.list"], templates["pages.*.blocks.*.list"]);
  assert.deepEqual(templates["fallback.blocks.*.gallery"], templates["pages.*.blocks.*.gallery"]);
  const d = applyPatch(subpageFix(), { ops: [{ type: "add", path: "fallback.blocks", item: { p: "x" } }] }, templates);
  assert.equal(d.fallback.blocks.length, 2);
});

test("a new gallery category arrives with exactly one photo, satisfying the floor from birth", () => {
  const d = applyPatch({ galleryGroups: [] }, { ops: [{ type: "add", path: "galleryGroups",
    item: { label: "New category", photos: [{ src: "u.jpg", caption: "" }] } }] }, templates);
  assert.equal(d.galleryGroups[0].photos.length, 1);
  assert.throws(() => applyPatch({ galleryGroups: [] }, { ops: [{ type: "add", path: "galleryGroups",
    item: { label: "New category", photos: [] } }] }, templates), /exactly 1/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test editor/test/patch.test.js`
Expected: FAIL with `Unknown collection: pages.library.blocks` etc.

- [ ] **Step 3: Write the new `editor/collections.json`** (full replacement — the block union appears twice by design; the deepEqual test above is the drift guard):

```json
{
  "news.acamp": { "date": "", "title": "", "body": "" },
  "news.vidyanagar": { "date": "", "title": "", "body": "" },
  "galleries.acamp": { "kind": "image", "id": "", "caption": "" },
  "galleries.vidyanagar": { "kind": "image", "id": "", "caption": "" },
  "galleryGroups": { "label": "", "photos": [{ "src": "", "caption": "" }] },
  "galleryGroups.*.photos": { "src": "", "caption": "" },
  "pages.*.blocks": { "oneOf": [
    { "p": "" },
    { "h": "" },
    { "note": "", "sub": "" },
    { "list": [["", ""]] },
    { "gallery": [["", ""]] },
    { "person": { "src": "", "name": "", "title": "" } },
    { "embed": { "src": "", "title": "" } }
  ] },
  "pages.*.blocks.*.list": ["", ""],
  "pages.*.blocks.*.gallery": ["", ""],
  "fallback.blocks": { "oneOf": [
    { "p": "" },
    { "h": "" },
    { "note": "", "sub": "" },
    { "list": [["", ""]] },
    { "gallery": [["", ""]] },
    { "person": { "src": "", "name": "", "title": "" } },
    { "embed": { "src": "", "title": "" } }
  ] },
  "fallback.blocks.*.list": ["", ""],
  "fallback.blocks.*.gallery": ["", ""]
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/collections.json editor/test/patch.test.js
git commit -m "feat(editor): declare subpage blocks, rows, galleries and gallery categories as collections"
```

---

### Task 4: Vidyanagar parity port + delete the dead `video` kind (spec §8a, §8b, §8d)

**Files:**
- Modify: `vidyanagar-subpage.html`, `acamp-subpage.html`
- Create: `editor/test/subpage-parity.test.js`

No editor chrome yet — this task only makes the two subpages render the same eight block kinds.

- [ ] **Step 1: Write the failing parity test** — create `editor/test/subpage-parity.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test editor/test/subpage-parity.test.js`
Expected: FAIL — vidyanagar has 5 branches, acamp still has `isVideo`.

- [ ] **Step 3: Port the render branches into `vidyanagar-subpage.html`.** In the CONTENT-body section (the `sc-for list="{{ blocks }}"` loop, currently ~lines 214–250):

  a. **Replace the whole `isGallery` sc-if** (the one that renders only the six decorative tiles and the `gallery.note` line) with A-Camp's two-branch version, copied verbatim from `acamp-subpage.html` (the block starting `<sc-if value="{{ b.isGallery }}"` through its matching `</sc-if>`, including the `hasImages` true branch with `data-edit="{{ im.p }}.1"` captions and the false branch with six decorative tiles + `data-edit="gallery.note"`). No hrefs or school names appear inside it — copy unchanged.

  b. **After the `isNote` sc-if**, insert A-Camp's `isPerson`, `isEmbed`, and `isLink` sc-if blocks, copied verbatim (they contain no school-specific strings — `b.link.href` etc. are all data-driven).

  c. Do **not** copy the `isVideo` block.

  d. Update the comment block above the section (the one reading "The five block types, all produced by the normaliser in renderVals(): …") to list the eight kinds: isHeading, isPara, isList, isGallery (real grid when the block has photos, placeholder grid + "photos coming soon" note when it doesn't), isNote, isPerson, isEmbed, isLink.

- [ ] **Step 4: Port the normaliser.** In `vidyanagar-subpage.html`'s `renderVals()` (currently ~line 837), replace:

```js
      else if (b.gallery) blocks.push({ key: "b" + (k++), isGallery: true, p });
      else if (b.note) blocks.push({ key: "b" + (k++), isNote: true, text: b.note, sub: b.sub || "", p });
```

with (matching A-Camp's branches exactly, minus `video`):

```js
      else if (b.list) blocks.push({ key: "b" + (k++), isList: true, p, items: b.list.map(([h, d], j) => ({ h, sep: " — ", d, p: p + ".list." + j })) });
      else if (b.gallery) {
        const imgs = Array.isArray(b.gallery) ? b.gallery.map(([src, caption], j) => ({ src, caption, p: p + ".gallery." + j })) : [];
        blocks.push({ key: "b" + (k++), isGallery: true, p, hasImages: imgs.length > 0, images: imgs });
      }
      else if (b.note) blocks.push({ key: "b" + (k++), isNote: true, p, text: b.note, sub: b.sub || "" });
      else if (b.person) blocks.push({ key: "b" + (k++), isPerson: true, p, person: b.person });
      else if (b.embed) blocks.push({ key: "b" + (k++), isEmbed: true, p, embed: b.embed });
      else if (b.link) blocks.push({ key: "b" + (k++), isLink: true, p, link: b.link });
```

(Keep vidyanagar's existing `b.list` line if it is already identical — diff against A-Camp's and make them byte-identical. Note the note-branch argument order becomes A-Camp's `{ ..., p, text, sub }`.)

- [ ] **Step 5: Delete the dead video kind from `acamp-subpage.html`:**
  - the `isVideo` sc-if block in the markup (`<sc-if value="{{ b.isVideo }}" ...>` through its `</sc-if>`, currently ~lines 270–277) — this also removes the `data-edit="video.fallback"` and `data-edit="video.fallbackLink"` bindings;
  - the normaliser line `else if (b.video) blocks.push({ key: "b" + (k++), isVideo: true, p, video: b.video });`
  - the `video: CONTENT.video,` line in the returned object;
  - the `"video": { "fallback": ..., "fallbackLink": ... },` key in the CONTENT block (~line 411);
  - any mention of the video kind in the block-type comment above the section (it currently says "Adding a sixth type" prose — recount to the final eight and drop the video row).

- [ ] **Step 6 (spec 8d): align the one differing nav line.** In `vidyanagar-subpage.html` (~line 782), reorder the menu-item mapping to match A-Camp's field order:

```js
        label: it.label,
        href: it.key.startsWith("#") ? MI + it.key : "#" + it.key,
        key: it.key,
        p: "shared:nav.menus." + i + ".items." + j,
```

- [ ] **Step 7: Verify**

Run: `npm test && node editor/check-paths.js`
Expected: green — `check-paths` matters here: deleting the `video` CONTENT key together with its `data-edit="video.fallback"` binding is what keeps it green; the parity test now passes.

Also run: `grep -c 'isVideo\|b\.video' acamp-subpage.html vidyanagar-subpage.html` — expected `0` for both.

- [ ] **Step 8: Commit**

```bash
git add acamp-subpage.html vidyanagar-subpage.html editor/test/subpage-parity.test.js
git commit -m "feat(content): port vidyanagar subpage to full block-kind parity; delete the dead mp4 video kind"
```

---

### Task 5: Migrate the `gallery: true` sentinel to `[]` (spec §8c)

**Files:**
- Modify: `acamp-subpage.html`, `vidyanagar-subpage.html`
- Create: `editor/test/page-list-invariants.test.js`

- [ ] **Step 1: Write the failing test** — create `editor/test/page-list-invariants.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test editor/test/page-list-invariants.test.js`
Expected: FAIL on both files (5 sentinels in acamp, 12 in vidyanagar).

- [ ] **Step 3: Migrate**

Run: `perl -pi -e 's/"gallery": true/"gallery": []/g' acamp-subpage.html vidyanagar-subpage.html`

Then: `grep -c '"gallery": true' acamp-subpage.html vidyanagar-subpage.html` — expected `0` for both, and `git diff --stat` shows only those substitutions.

- [ ] **Step 4: Run the full suite**

Run: `npm test && node editor/check-paths.js`
Expected: green — `[]` is truthy, so the `else if (b.gallery)` dispatch and the placeholder rendering are unchanged; `page-content-fidelity` runs against the real pages and stays green.

- [ ] **Step 5: Commit**

```bash
git add acamp-subpage.html vidyanagar-subpage.html editor/test/page-list-invariants.test.js
git commit -m "feat(content): migrate the gallery:true sentinel to [] so every grid is a growable list"
```

---

### Task 6: `editor/client/collections.js` — blank items, labels, floors + the drift guard

**Files:**
- Create: `editor/client/collections.js`
- Modify: `editor/server.js` (one INJECT line)
- Create: `editor/test/collections-client.test.js`

**Interfaces:**
- Consumes: nothing at load time (data-only; media values are passed IN by the caller).
- Produces: `window.EditorCollections` / `module.exports` = `{ family, addLabel, floorFor, mediaFor, blockKinds, blankItem }` exactly as specified in the header's interface block. `blankItem`'s `media` argument is `{ id, url, title }`.

- [ ] **Step 1: Write the failing tests** — create `editor/test/collections-client.test.js`:

```js
"use strict";
// collections.json is deliberately 403 to the browser (security.test.js pins it), so
// editor/client/collections.js carries its own copy of every blank item. Two sources
// of truth WILL drift without a guard; this file is the guard: every blank item the
// client can ever build must pass the server's validateShape against the template the
// server will actually enforce at Publish. Without this, Add succeeds locally and the
// whole Publish 400s — the feature's one silent failure mode.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateShape, requireCollection } = require("../lib/patch.js");
const templates = require("../collections.json");
const C = require("../client/collections.js");

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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test editor/test/collections-client.test.js`
Expected: FAIL — `Cannot find module '../client/collections.js'`.

- [ ] **Step 3: Create `editor/client/collections.js`:**

```js
(function (exports) {
  "use strict";
  // What each repeatable collection is, what its Add button says, what a brand-new
  // item looks like, and how many items must remain. This is the client's ONLY copy
  // of the blank-item shapes: collections.json is deliberately 403 to the browser
  // (security.test.js), so the server's templates cannot be fetched. Two sources of
  // truth WILL drift — editor/test/collections-client.test.js is the guard: every
  // shape built here must pass lib/patch.js's validateShape against the declared
  // template, or Add would succeed locally and the whole Publish would 400.
  //
  // Deliberately data-only: no DOM, no EditorMedia/EditorMediaUrls calls. Media
  // values are passed IN as {id, url, title} by the caller (editor-client.js), which
  // is what lets node tests require() this file with no browser at all.

  var BLOCKS_RE = /^(pages\.[^.]+|fallback)\.blocks$/;
  var ROWS_RE = /^(pages\.[^.]+|fallback)\.blocks\.\d+\.list$/;
  var BLOCK_GALLERY_RE = /^(pages\.[^.]+|fallback)\.blocks\.\d+\.gallery$/;
  var GROUP_PHOTOS_RE = /^galleryGroups\.\d+\.photos$/;

  function family(listPath) {
    if (BLOCKS_RE.test(listPath)) return "blocks";
    if (ROWS_RE.test(listPath)) return "rows";
    if (BLOCK_GALLERY_RE.test(listPath)) return "blockGallery";
    if (listPath === "galleryGroups") return "galleryGroups";
    if (GROUP_PHOTOS_RE.test(listPath)) return "groupPhotos";
    if (listPath.indexOf("galleries.") !== -1) return "sharedGallery";
    // The news lists, and the safe default for anything not recognised — exactly
    // the item onAdd built for every non-gallery list before this module existed.
    return "news";
  }

  var LABELS = {
    blocks: "+ Add section",
    rows: "+ Add row",
    blockGallery: "+ Add photo",
    galleryGroups: "+ Add category",
    groupPhotos: "+ Add photo",
    sharedGallery: "+ Add photo",
    news: "+ Add",
  };
  function addLabel(listPath) { return LABELS[family(listPath)]; }

  // The delete floor. 1 everywhere except news: both news lists ship empty and both
  // school pages render a designed newsSection.empty line at zero posts — a floor
  // there would make that line unreachable after the first post.
  function floorFor(listPath) { return family(listPath) === "news" ? 0 : 1; }

  // Which media the Add flow must pick BEFORE an item can exist. An empty
  // <img src=""> paints a broken image and an empty iframe a black rectangle, so
  // these families open the picker first and a cancelled pick records no op at all.
  var MEDIA_FIRST = { blockGallery: "image", galleryGroups: "image", groupPhotos: "image", sharedGallery: "image" };
  function mediaFor(listPath) { return MEDIA_FIRST[family(listPath)] || null; }

  // The block chooser's menu. Seven of the eight kinds both subpages render: link is
  // withheld because attr-spec.js (rightly) refuses href edits, so a link block added
  // here would have a permanently dead destination.
  function blockKinds() {
    return [
      { kind: "p", label: "Paragraph", media: null },
      { kind: "h", label: "Heading", media: null },
      { kind: "note", label: "Note", media: null },
      { kind: "list", label: "List", media: null },
      { kind: "gallery", label: "Photo grid", media: "image" },
      { kind: "person", label: "Person", media: "image" },
      { kind: "video", label: "Video", media: "video" },
    ];
  }

  // media = {id, url, title} from the picker, or null for text-only shapes.
  // Every seeded string is VISIBLE placeholder text on purpose: the subpage
  // normalisers dispatch on truthiness, so a block added as {p: ""} would match no
  // branch, produce no DOM, and be un-editable and un-deletable.
  function blankItem(listPath, kind, media) {
    switch (family(listPath)) {
      case "news": return { date: new Date().toISOString().slice(0, 10), title: "New post", body: "Write the announcement here." };
      case "sharedGallery": return { kind: "image", id: media.id, caption: "" };
      case "groupPhotos": return { src: media.url, caption: "" };
      case "galleryGroups": return { label: "New category", photos: [{ src: media.url, caption: "" }] };
      case "rows": return ["New item", "Describe it here."];
      case "blockGallery": return [media.url, "New photo"];
      case "blocks": break; // fall through to the kind switch below
    }
    switch (kind) {
      case "p": return { p: "Write this section here." };
      case "h": return { h: "New heading" };
      case "note": return { note: "Something to highlight", sub: "A supporting line." };
      case "list": return { list: [["New item", "Describe it here."]] };
      case "gallery": return { gallery: [[media.url, "New photo"]] };
      case "person": return { person: { src: media.url, name: "Name", title: "Role" } };
      case "video":
        // TWO blocks — a heading seeded from the video's title, then the player —
        // because that is how the videos routes are authored: every player sits
        // under its own heading. The src is the CANONICAL embed form lib/patch.js's
        // embed.src leaf rule demands (NOT media-urls' nocookie player URL, which is
        // for media SLOTS; the existing subpage embeds all use this form).
        return [
          { h: media.title || "New video" },
          { embed: { src: "https://www.youtube.com/embed/" + media.id, title: media.title || "YouTube video" } },
        ];
      default: throw new Error("No blank item for " + listPath + " kind " + kind);
    }
  }

  Object.assign(exports, { family, addLabel, floorFor, mediaFor, blockKinds, blankItem });
})(typeof module !== "undefined" ? module.exports : (window.EditorCollections = {}));
```

- [ ] **Step 4: Inject it.** In `editor/server.js`'s `INJECT` constant, add before the `draft.js` line:

```js
  '<script src="/editor/client/collections.js"></script>' + // data-only lookup tables; before editor-client.js, which reads them at boot
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: green (`security.test.js`'s single-segment client/*.js allowlist already serves the new file).

- [ ] **Step 6: Commit**

```bash
git add editor/client/collections.js editor/server.js editor/test/collections-client.test.js
git commit -m "feat(editor): client collections module — blank items, labels, floors — with a server-shape drift guard"
```

---

### Task 7: `editor-client.js` — nested-list-safe decorate, floored delete, block chooser, `onAdd` dispatch

**Files:**
- Modify: `editor/client/editor-client.js`
- Test: `editor/test/editor-client.test.js`

One task because the old test block ("gallery Add controls open the photo library and build the correct item shape") pins code that moves in pieces — splitting would leave the suite red between commits.

- [ ] **Step 1: Replace the stale test and add the new pins.** In `editor/test/editor-client.test.js`, **delete** the test `"gallery Add controls open the photo library and build the correct item shape"` (its item-shape assertions now live in `collections-client.test.js`, which validates them against the server's own templates — strictly stronger). **Add:**

```js
test("list chrome delegates labels, floors and blank items to EditorCollections (Task: add buttons)", () => {
  const dec = extractBlockAfter(SRC, "function decorate(");
  // Nested lists are real now (a block CONTAINS rows/photos), so "every data-item
  // under me" would stamp menus with wrong indices onto nested rows. Only items
  // whose NEAREST list ancestor is this list belong to it.
  assert.match(dec, /closest\("\[data-list\]"\) === listEl/);
  assert.match(dec, /EditorCollections\.addLabel\(listPath\)/);
  assert.ok(!/listPath\.includes\("galleries\."\)/.test(dec), "the hardcoded label test must be gone from decorate()");
  // Items that are ALSO media slots shift their menu top-left: the slot's hover
  // actions own the top-right corner.
  assert.match(dec, /ed-menu-slot/);
});

test("delete respects the floor: disabled-with-tooltip on the last item, never hidden", () => {
  const menu = extractBlockAfter(SRC, "function menuFor(");
  assert.match(menu, /EditorCollections\.floorFor\(listPath\)/);
  assert.match(menu, /length <= floor/);
  assert.match(menu, /At least one must remain — this is the last one/);
  assert.match(menu, /ed-del/);
});

test("onAdd dispatches through EditorCollections; media-first families pick before any op is recorded", () => {
  const onAdd = extractBlockAfter(SRC, "function onAdd(");
  assert.match(onAdd, /openBlockChooser\(listPath/);
  assert.match(onAdd, /EditorCollections\.mediaFor\(listPath\)/);
  assert.match(onAdd, /EditorCollections\.blankItem\(listPath, null/);
  const pick = extractBlockAfter(SRC, "function pickMediaThen(");
  assert.match(pick, /EditorMedia\.openPicker\(kind/);
  assert.match(pick, /deliveryUrl\(selectedCloudName, record\)/);
  assert.match(pick, /record\.name \|\| ""/);
});

test("the block chooser offers the seven kinds and adds video as heading+player, two ops in sequence", () => {
  const ch = extractBlockAfter(SRC, "function openBlockChooser(");
  assert.match(ch, /EditorCollections\.blockKinds\(\)/);
  // Two add ops, first the heading, then the embed; if the second fails the first
  // stays and the failure is reported — consistent with doOp's apply-then-record.
  assert.match(ch, /doOp\(\{ type: "add", path: listPath, item: items\[0\] \}\)/);
  assert.match(ch, /doOp\(\{ type: "add", path: listPath, item: items\[1\] \}\)/);
  assert.match(SRC, /#ed-block-chooser/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test editor/test/editor-client.test.js`
Expected: the four new tests FAIL; the deleted one is gone.

- [ ] **Step 3: Implement in `editor/client/editor-client.js`.**

  a. **`menuFor` — floored, red-accented delete.** Replace the whole function with:

```js
  function menuFor(listPath, index, length) {
    const m = document.createElement("span");
    m.className = "ed-menu";
    const mk = (label, title, fn, className, disabled) => {
      const b = document.createElement("button");
      b.textContent = label; b.title = title;
      if (className) b.className = className;
      if (disabled) b.disabled = true;
      else b.onclick = (e) => { e.stopPropagation(); e.preventDefault(); fn(); };
      m.appendChild(b);
    };
    if (index > 0) mk("↑", "Move up", () => doOp({ type: "move", path: listPath, from: index, to: index - 1 }));
    if (index < length - 1) mk("↓", "Move down", () => doOp({ type: "move", path: listPath, from: index, to: index + 1 }));
    // The floor forbids deleting the LAST item (news excepted — see collections.js).
    // At the floor the button renders disabled with a tooltip rather than hidden: a
    // control that silently fails to appear reads as a bug, and the user retries
    // instead of understanding.
    const floor = window.EditorCollections.floorFor(listPath);
    if (length <= floor) mk("✕", "At least one must remain — this is the last one", null, "ed-del", true);
    else mk("✕", "Delete", () => { if (confirm("Delete this item?")) doOp({ type: "remove", path: listPath, index }); }, "ed-del");
    return m;
  }
```

  b. **`decorate` — nearest-list filter + module labels.** Replace the `[data-list]` loop body with:

```js
    document.querySelectorAll("[data-list]").forEach((listEl) => {
      const listPath = listEl.getAttribute("data-list");
      // Lists nest now (a section block CONTAINS its rows/photos), and :scope
      // [data-item] is a DESCENDANT query — without this filter the outer list
      // would stamp a second menu, with its own indices, onto every nested row.
      const items = Array.from(listEl.querySelectorAll(":scope [data-item]"))
        .filter((it) => it.parentElement && it.parentElement.closest("[data-list]") === listEl);
      items.forEach((it, i) => {
        const menu = menuFor(listPath, i, items.length); // position:relative is already on this element in the page's own markup
        // A gallery photo is also a media slot, whose hover actions own the
        // top-right corner — shift this menu top-left so the two never overlap.
        if (it.hasAttribute("data-media-slot")) menu.classList.add("ed-menu-slot");
        it.appendChild(menu);
      });
      const add = document.createElement("button");
      add.className = "ed-add";
      add.textContent = window.EditorCollections.addLabel(listPath);
      add.onclick = (e) => onAdd(listPath, e.currentTarget);
      listEl.parentElement.insertBefore(add, listEl.nextSibling); // sibling, not child: React owns the list's children
    });
```

  c. **`onAdd` + `pickMediaThen` + chooser.** Replace `onAdd` with:

```js
  // One place that opens the drawer in pick mode and normalises what every Add flow
  // needs from a record: its id, its full-size delivery URL and a human name. The
  // picker opens BEFORE anything is recorded — a cancelled pick calls back nobody,
  // so no op ever exists to clean up.
  function pickMediaThen(kind, listPath, cb) {
    if (!window.EditorMedia || !window.EditorMediaUrls) {
      alert("The media library isn't ready yet. Close and reopen the editor, then try again.");
      return;
    }
    window.EditorMedia.openPicker(kind, (record, selectedCloudName) => {
      cb({ id: record.id, url: window.EditorMediaUrls.deliveryUrl(selectedCloudName, record), title: record.name || "" });
    }, null, listPath);
  }
  function onAdd(listPath, anchorEl) {
    if (window.EditorCollections.family(listPath) === "blocks") { openBlockChooser(listPath, anchorEl); return; }
    const mediaKind = window.EditorCollections.mediaFor(listPath);
    if (mediaKind) {
      pickMediaThen(mediaKind, listPath, (media) => {
        doOp({ type: "add", path: listPath, item: window.EditorCollections.blankItem(listPath, null, media) });
      });
      return;
    }
    doOp({ type: "add", path: listPath, item: window.EditorCollections.blankItem(listPath, null, null) });
  }
```

  and add the chooser (near `onAdd`):

```js
  // ---- the block chooser: which kind of section does "+ Add section" add? ----
  // A popover in #ed-attr-panel's visual language (same radius, shadow, type scale)
  // so it reads as the same editor rather than a third UI. Escape or any outside
  // click dismisses it without recording anything.
  function closeBlockChooser() {
    const el = document.getElementById("ed-block-chooser");
    if (el) { el.remove(); document.removeEventListener("pointerdown", onChooserOutside, true); document.removeEventListener("keydown", onChooserEscape, true); }
  }
  function onChooserOutside(e) { if (!e.target.closest("#ed-block-chooser")) closeBlockChooser(); }
  function onChooserEscape(e) { if (e.key === "Escape") { e.stopPropagation(); closeBlockChooser(); } }
  function openBlockChooser(listPath, anchorEl) {
    closeBlockChooser();
    const panel = document.createElement("div");
    panel.id = "ed-block-chooser";
    const h = document.createElement("h3");
    h.textContent = "Add a section";
    panel.appendChild(h);
    window.EditorCollections.blockKinds().forEach((k) => {
      const b = document.createElement("button");
      b.textContent = k.label;
      b.onclick = () => {
        closeBlockChooser();
        if (k.kind === "video") {
          // Two blocks — the heading seeded from the video's title, then the player.
          // Two ops in sequence; if the second fails the first is left in place and
          // the failure reported, consistent with doOp's apply-then-record rule.
          pickMediaThen("video", listPath, (media) => {
            const items = window.EditorCollections.blankItem(listPath, "video", media);
            doOp({ type: "add", path: listPath, item: items[0] });
            doOp({ type: "add", path: listPath, item: items[1] });
          });
        } else if (k.media) {
          pickMediaThen(k.media, listPath, (media) => {
            doOp({ type: "add", path: listPath, item: window.EditorCollections.blankItem(listPath, k.kind, media) });
          });
        } else {
          doOp({ type: "add", path: listPath, item: window.EditorCollections.blankItem(listPath, k.kind, null) });
        }
      };
      panel.appendChild(b);
    });
    document.body.appendChild(panel);
    // Fixed positioning beside the Add button, clamped to the viewport.
    const r = anchorEl.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8)) + "px";
    panel.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - panel.offsetHeight - 8)) + "px";
    document.addEventListener("pointerdown", onChooserOutside, true);
    document.addEventListener("keydown", onChooserEscape, true);
  }
```

  d. **Exit must close the chooser** like it closes the attr panel: in the Exit handler, next to `closeAttrPanel();`, add `closeBlockChooser();` (a dead popover on a page pretending to be the public site is the same bug the attr-panel comment there describes).

  e. **CSS.** In the `attrStyle` string (double-quoted segments, where `#ed-attr-panel` is styled), append:

```js
    // The block chooser reuses the attribute panel's visual language on purpose —
    // same radius, shadow and type scale — so it reads as the same editor.
    "#ed-block-chooser{position:fixed;z-index:2147483002;width:200px;background:#fff;color:#26201d;border-radius:12px;" +
    "border:1px solid rgba(38,32,29,.16);box-shadow:0 18px 44px rgba(0,0,0,.28);padding:10px;" +
    "font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
    "#ed-block-chooser h3{margin:2px 4px 8px;font:600 12px/1.3 inherit;color:#6b615b;text-transform:uppercase;letter-spacing:.06em}" +
    "#ed-block-chooser button{display:block;width:100%;text-align:left;font:inherit;padding:8px 10px;border-radius:7px;" +
    "border:0;cursor:pointer;background:transparent;color:#26201d}" +
    "#ed-block-chooser button:hover{background:#f6f1ed}" +
```

  and in the `bar.innerHTML` `<style>` block (single-quoted segments, after the existing `.ed-menu button` rule):

```js
    // ✕ matches the media overlay's remove action (#a51915 fill, white glyph) so the
    // editor's two destructive controls look like one idea. Disabled = at the floor.
    '.ed-menu button.ed-del{background:#a51915;border-radius:999px;border:2px solid rgba(255,255,255,.82)}' +
    '.ed-menu button.ed-del:disabled{opacity:.45;cursor:not-allowed}' +
    '.ed-menu.ed-menu-slot{right:auto;left:6px}' +
```

- [ ] **Step 4: Syntax-check and run the suite**

Run: `node --check editor/client/editor-client.js && npm test`
Expected: green. Note `media-slots.test.js`'s interactive-control pin (`.ed-menu` in the closest() selector) still passes untouched — slot clicks already yield to menu buttons.

- [ ] **Step 5: Commit**

```bash
git add editor/client/editor-client.js editor/test/editor-client.test.js
git commit -m "feat(editor): block chooser, floored red delete, nested-list-safe chrome via EditorCollections"
```

---

### Task 8: Stamp the markup — `data-list`/`data-item` on both subpages and the A-Camp gallery categories

**Files:**
- Modify: `acamp-subpage.html`, `vidyanagar-subpage.html`, `montessori-acamp.html`
- Test: `editor/test/page-list-invariants.test.js` (extend)

- [ ] **Step 1: Write the failing tests** — append to `editor/test/page-list-invariants.test.js`:

```js
// ---- every list the pages render is declared, resolvable, and stamped ----
// check-paths.js skips interpolated {{ }} paths by construction, so a wrong binding
// inside an sc-for is invisible to it. This pass instantiates every list path each
// route would render — the same arithmetic as the normalisers — and proves each one
// (a) resolves to an array in CONTENT and (b) is accepted by the server's
// requireCollection against the real collections.json. (b) is the half that catches
// a declared-key typo: without it Add works locally and Publish 400s.
const { requireCollection } = require("../lib/patch.js");
const templates = require("../collections.json");

for (const f of SUBPAGES) {
  test(`${f}: every instantiated blocks/list/gallery path resolves AND is a declared collection`, () => {
    const data = extractContent(read(f)).data;
    let lists = 0;
    for (const [label, blocksPath] of routes(data)) {
      assert.ok(requireCollection(templates, blocksPath), blocksPath + " must be declared");
      const blocks = getPath(data, blocksPath);
      assert.ok(Array.isArray(blocks), label + ": " + blocksPath);
      blocks.forEach((b, i) => {
        for (const kindKey of ["list", "gallery"]) {
          if (kindKey in b) {
            lists++;
            const p = blocksPath + "." + i + "." + kindKey;
            assert.ok(Array.isArray(getPath(data, p)), p + " must be an array");
            assert.ok(requireCollection(templates, p), p + " must be declared");
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test editor/test/page-list-invariants.test.js`
Expected: the new tests FAIL (markup not stamped yet; `blocksPath` not exposed).

- [ ] **Step 3: Stamp `acamp-subpage.html`** (five edits — `vidyanagar-subpage.html` gets the identical five in Step 4; after Task 4 the two files' block markup is byte-identical, so the same edits apply):

  a. Wrap the blocks loop in a list container and mark each block root (the wrapper is a plain div inside the one-column grid — same stacking, same margins, no visual change):

```html
  <div style="display:grid;grid-template-columns:1fr;gap:0;max-width:820px">
    <div data-list="{{ blocksPath }}">
    <sc-for list="{{ blocks }}" as="b" hint-placeholder-count="3">
      <div key="{{ b.key }}" data-item="" style="position:relative">
```

  and close the new `</div>` immediately after the loop's `</sc-for>` (before the CTA comment). The CTA block stays OUTSIDE the wrapper, so "+ Add section" lands between the last section and the CTA.

  b. List rows — container and row:

```html
          <div style="display:flex;flex-direction:column;gap:12px;margin:18px 0 0" data-list="{{ b.p }}.list">
            <sc-for list="{{ b.items }}" as="li" hint-placeholder-count="4">
              <div data-item="" style="position:relative;display:flex;gap:13px;align-items:flex-start;background:#fbf3f2;border:1px solid #f0e0dc;border-radius:12px;padding:16px 18px">
```

  c. Real gallery grid (the `hasImages` true branch) — container and tile:

```html
            <div class="g g-3" style="margin:20px 0 0" data-list="{{ b.p }}.gallery">
              <sc-for list="{{ b.images }}" as="im" hint-placeholder-count="6">
                <div data-item="" style="position:relative;aspect-ratio:4/3;border-radius:12px;overflow:hidden;border:1px solid #f0e0dc">
```

  d. Placeholder gallery grid (the `hasImages` false branch) — the SAME list on the decorative grid, so `decorate()` has something to hang "+ Add photo" on when the array is empty:

```html
            <div class="g g-3" style="margin:20px 0 0" data-list="{{ b.p }}.gallery">
```

  (the six decorative tile divs inside it are unchanged — they carry no `data-item`, so the item count is honestly zero).

  e. Normaliser: in the object `renderVals()` returns, next to `blocks,` add:

```js
      // Where this route's blocks array lives in CONTENT — the data-list container
      // binding, built here because {{ }} can only read a value, never join two.
      blocksPath: base + ".blocks",
```

- [ ] **Step 4: Stamp `vidyanagar-subpage.html`** — the identical five edits (a–e).

- [ ] **Step 5: Stamp `montessori-acamp.html`:**

  a. Wrap the category loop (a plain div directly around the sc-for, inside `.wrap`):

```html
    <div data-list="galleryGroups">
    <sc-for list="{{ galleryGroups }}" as="grp" hint-placeholder-count="2">
      <div style="margin-top:42px;position:relative" data-item="">
```

  closing `</div>` right after that loop's `</sc-for>`. "+ Add category" then lands at the bottom of the gallery section.

  b. Photo tile — add `data-item=""` (the flip tile already has slot attributes; keep them all):

```html
            <div tabindex="0" class="flip" data-item="" data-media-slot="{{ ph.p }}.src" data-media-kind="image" style="aspect-ratio:1;border-radius:12px">
```

- [ ] **Step 6: Verify**

Run: `npm test && node editor/check-paths.js`
Expected: green. `check-paths` resolves the new literal `data-list="galleryGroups"` (an array — data-list is exempt from the must-be-text rule) and skips the `{{ }}` ones, which the new test now covers instead. `page-media-invariants` still passes: the flip tile remains a container element.

- [ ] **Step 7: Commit**

```bash
git add acamp-subpage.html vidyanagar-subpage.html montessori-acamp.html editor/test/page-list-invariants.test.js
git commit -m "feat(content): stamp data-list/data-item chrome on subpage blocks, rows, grids and gallery categories"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/EDITING.md`

- [ ] **Step 1: Add a section** (place it beside the existing add/reorder/delete documentation, matching the file's voice). Content to convey, in the file's own style:

```markdown
## Adding, reordering and removing sections

Every repeating thing on the subpages — the sections themselves, the rows inside a
list, the photos in a grid — and the gallery categories on the A-Camp page now carry
the same `+ Add / ↑ / ↓ / ✕` controls the news cards have always had.

**+ Add section** opens a chooser with seven kinds:

- **Paragraph**, **Heading**, **Note** — plain text, added with placeholder copy you
  click and overwrite.
- **List** — a row of bold-term-plus-description cards; each row is separately
  editable, and "+ Add row" under the list adds more.
- **Photo grid** — opens the media library first; the grid arrives with the photo
  you pick. "+ Add photo" under the grid adds more.
- **Person** — opens the media library for the portrait, then click the name and
  role to edit them.
- **Video** — opens the media library's Videos tab. A video is added as TWO blocks:
  a heading (seeded from the video's title) and the player under it, because that is
  how the video pages are laid out. Delete both if you remove one.

Cancelling the media picker adds nothing.

**Deleting the last one.** Every widget keeps at least one item: on the last item the
✕ is greyed out with "At least one must remain — this is the last one". To empty a
photo grid entirely, delete the whole gallery *section* (its own ✕) and add a fresh
one later. News is the one exception — a school may clear its news section back to
the designed "no announcements" state.
```

- [ ] **Step 2: Verify and commit**

Run: `npm test` (docs don't affect it — this is the checkpoint discipline).

```bash
git add docs/EDITING.md
git commit -m "docs(editor): document the block chooser, per-widget add buttons and the delete floor"
```

---

### Task 10: Full verification + live smoke test

**Files:** none (verification only). The YouTube/Cloudinary steps need network + a configured setup; where unconfigured, the text-only flows still verify.

- [ ] **Step 1: Full suite, twice-checked**

Run: `npm test && node editor/check-paths.js`
Expected: green, with the new test files all listed in the output (`collections-client`, `subpage-parity`, `page-list-invariants`).

Run: `grep -c '"gallery": true' acamp-subpage.html vidyanagar-subpage.html` → `0` and `0`.

- [ ] **Step 2: Boot** — `npm run edit` (restart any running instance — server.js's INJECT changed).

- [ ] **Step 3: Subpage flows** — on `http://localhost:8899/acamp-subpage.html#library` (and spot-check one Vidyanagar route):
  1. Every section shows ↑/↓/✕ on hover-height; "+ Add section" sits after the last section, above the CTA buttons.
  2. "+ Add section" → chooser popover in the editor's visual style; Escape and outside-click dismiss it recording nothing (change counter unmoved).
  3. Add a Paragraph → visible placeholder text appears immediately and is click-editable; the counter increments by 1; ✕ on it works.
  4. Add a List → one row appears; "+ Add row" adds another; the LAST row's ✕ is greyed with the floor tooltip; the section's own ✕ still deletes the whole block.
  5. On a route whose grid shipped empty (any Vidyanagar route): the placeholder tiles show AND "+ Add photo" appears; clicking it opens the picker; cancelling records nothing.
  6. Add a Video (needs a video in the library) → a heading with the video's title plus a player appear; counter increments by 2.
  7. Rows/photos inside a section show their OWN menus with correct indices, and the section menu doesn't double-stamp them (the nested-list filter).
- [ ] **Step 4: A-Camp gallery categories** — on `http://localhost:8899/montessori-acamp.html#gallery`: "+ Add category" opens the picker first; the new category arrives with a label and one photo; each photo tile's ✕ sits top-LEFT (clear of the slot's hover actions); the last photo in a category is floor-blocked; news section ✕ still allows emptying.
- [ ] **Step 5: Publish round-trip** — publish the accumulated test edits; expect 200; the page CONTENT block shows the added items; then delete the test additions and publish again to leave content clean. If any add 400s at Publish, that is a drift-guard escape — stop and fix before proceeding.
- [ ] **Step 6: Report** — summarize what was verified, including which steps were skipped for missing network/Cloudinary config.

---

## Self-review checklist (already run against the spec)

- §1 recursive templates → Task 1; §2 wildcards → Task 2; declarations → Task 3; §3 leaf rules → Task 1; §4 client module + drift guard → Task 6; §5 chooser (7 kinds, media-first, video-as-two-blocks, gallery-category seeding) → Tasks 6–7; §6 markup + blocksPath + empty-grid Add → Task 8; §7 floor + red delete → Task 7; §8a–8d parity port, video deletion, sentinel migration, nav line → Tasks 4–5; testing section → each task's tests + Task 10; docs → Task 9.
- Known limitation (person/grid/embed not swappable in place) is spec'd as out of scope — not planned, only documented in the spec.
- Type consistency: `blankItem(listPath, kind, media)` / `media = {id, url, title}` / `family()` names are identical in Tasks 6, 7 and their tests; `validateShape(value, template, fieldPath)` identical in Tasks 1, 3, 6, 8.
