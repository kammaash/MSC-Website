# Click-on-Page Editor (CMS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let 2–5 collaborators run a local editor (`npm run edit`) that opens the real MSC site in a browser with click-to-edit text, add/remove/reorder news posts and gallery items, and Cloudinary photo/video upload — publishing via git.

**Architecture:** Editable content moves out of page markup into a delimited `CONTENT` JSON block inside each page's dc-script (plus a shared `content.js` for cross-page facts and collections). A dependency-free local Node server serves the repo, injecting `editor.js` client scripts into HTML at serve time only — deployed files never reference the editor. Edits accumulate as an ordered op log in the browser, are applied server-side by parse → mutate → `JSON.stringify` (never string-patching), and publish is `git commit` (+ push, when enabled).

**Tech Stack:** Node 20+ built-ins only (`node:http`, `node:test`, `node:crypto`, `node:child_process`). No npm dependencies. Existing dc-runtime (`support.js`, generated — never edited).

**Spec:** No spec doc — design approved in chat 2026-08-14. The Design Summary below is the spec of record.

## Global Constraints

- **LOCAL COMMITS ONLY.** Never run `git push` from this repo during implementation — `main` deploys straight to production (msceducation.net via GitHub Pages). All work happens on a local branch `editor` created off `main`. Every manual run of the editor server uses `EDITOR_NO_PUSH=1`. Tests that exercise git do so in throwaway repos under `os.tmpdir()`, never this repo.
- Zero npm dependencies. Node 20+ built-ins and `node --test` only.
- Never modify `support.js` or `cursor.js` (generated vendor files).
- Deployed HTML must not reference any editor script. Editor client scripts reach the browser only via serve-time injection by the local server. (The `editor/` directory will be publicly served by GitHub Pages — that is acceptable: it contains no secrets; `editor/secrets.json` is gitignored.)
- `CONTENT` blocks are strict JSON between exact markers `/* CONTENT:BEGIN */` and `/* CONTENT:END */`, declared as `const CONTENT = {...};` (pages) or `window.SHARED_CONTENT = {...};` (content.js).
- Editable text is plain text. No HTML in values; values containing `</script` (any casing/spacing) are rejected.
- Out of scope: Instagram/Facebook integration (explicitly excluded by user), YouTube auto-upload beyond a flag-gated stub (blocked on Google compliance audit), editable images on school cards / facility icons (galleries only for v1), UMC/KNE-Website (port later, after Phase 1 is judged).

## Design Summary (spec of record)

- **Pages:** `index.html`, `montessori-acamp.html`, `montessori-vidyanagar.html`, `acamp-subpage.html`, `vidyanagar-subpage.html`. Each is a self-contained `<x-dc>` template + dc-script rendered client-side by `support.js`. `renderVals()` supplies every `{{ hole }}`.
- **Content model:** per-page `CONTENT` block at the top of the dc-script; shared `content.js` (loaded before `support.js` in every page) holds `contact` facts, `news.{acamp,vidyanagar}`, `galleries.{acamp,vidyanagar}`, and `cloudName`. `renderVals()` returns `{...content-derived values, ...behaviour}`; behaviour (refs, form setters) stays in code.
- **Click mapping:** every editable element carries `data-edit="<path>"`. Paths into the shared file are prefixed `shared:`. Inside `sc-for` loops, `renderVals()` precomputes each item's path as `p` (e.g. `"facilities.0"`) and templates write `data-edit="{{ f.p }}.title"`. Editability is opt-in: no `data-edit`, not editable.
- **Editor client:** top bar (Publish / Discard / Exit, unsaved count), dashed outline on hover, in-place `contenteditable` (plaintext), collections chrome (`+ Add` on `[data-list]` containers, ↑ ↓ ✕ on `[data-item]` elements). Draft = ordered op log `{type:"set"|"add"|"remove"|"move", ...}`, grouped per file at save time. Live update via mutating `window.__CONTENT` / `window.SHARED_CONTENT` and calling `window.__rerender()` (a `setState({})` hook each page exposes).
- **Server:** `npm run edit` → localhost:8899, opens browser (macOS `open`). Endpoints: `POST /api/save` (validate + apply patch + rewrite CONTENT block), `POST /api/publish` (git add/commit, then pull --rebase + push if `config.push && !EDITOR_NO_PUSH`), `POST /api/sign` (Cloudinary signed-upload signature; secrets stay local).
- **Media:** browser uploads directly to Cloudinary (`/auto/upload`) using the server-signed request; stored value is the public ID + kind. URLs are built in `renderVals()` with `f_auto,q_auto` transformations. Video renders as `<video preload="none" poster=...>`. YouTube upload exists only as `editor/lib/youtube.js` stub throwing until `config.youtube.enabled` (post-audit).
- **Safety:** patches validated against current content shape (set targets must be existing string paths; list items must exactly match `editor/collections.json` templates). Files are parsed and re-serialised, never string-patched; a failed patch writes nothing. Publish conflicts abort the rebase and report plainly.

## File Structure

```
package.json                    — scripts: edit, test, setup (new)
content.js                      — shared CONTENT (new, deployed)
editor/
  config.json                   — { "port": 8899, "push": true } (new)
  collections.json              — item templates per collection (new)
  secrets.json                  — Cloudinary key/secret (new, GITIGNORED)
  server.js                     — local server: static+inject, save, publish, sign (new)
  setup.js                      — one-time collaborator setup prompt (new)
  check-paths.js                — static data-edit/data-list path checker (new)
  lib/content-io.js             — extract/replace CONTENT blocks (new)
  lib/paths.js                  — get/set/list ops, UMD (node + browser) (new)
  lib/patch.js                  — ordered-op patch validation + apply (new)
  lib/cloudinary.js             — request signing (new)
  lib/youtube.js                — flag-gated stub (new)
  client/draft.js               — ordered op log, UMD (new)
  client/editor-client.js       — injected UI (new)
  test/*.test.js                — node:test suites (new)
docs/EDITING.md                 — collaborator guide (new)
index.html + 4 page files       — CONTENT extraction + data-edit attrs (modified)
.gitignore                      — add editor/secrets.json (modified)
```

---

### Task 1: Scaffolding + content-io

**Files:**
- Create: `package.json`, `editor/lib/content-io.js`, `editor/test/content-io.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `extractContent(source) → { decl: "const CONTENT"|"window.SHARED_CONTENT", data: object }` (throws on missing/duplicate/out-of-order markers or non-JSON body); `replaceContent(source, data) → string` (same source with the block's JSON replaced, declaration preserved); exported constants `BEGIN`, `END`.

- [ ] **Step 1: Create branch and scaffolding**

```bash
cd /Users/gayani/MSC-Website && (git checkout editor 2>/dev/null || git checkout -b editor)
```

(The `editor` branch may already exist holding this plan document — reuse it.)

`package.json`:
```json
{
  "name": "msc-website-editor",
  "private": true,
  "scripts": {
    "edit": "node editor/server.js",
    "test": "node --test editor/test/",
    "setup": "node editor/setup.js"
  }
}
```

Append to `.gitignore` (keep existing lines):
```
node_modules
editor/secrets.json
```

- [ ] **Step 2: Write the failing test** — `editor/test/content-io.test.js`

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extractContent, replaceContent } = require("../lib/content-io.js");

const page = (body) => `<script>\n/* CONTENT:BEGIN */\n${body}\n/* CONTENT:END */\nrest();\n</script>`;

test("extracts const CONTENT JSON", () => {
  const src = page('const CONTENT = {\n  "a": [1, 2]\n};');
  assert.deepEqual(extractContent(src), { decl: "const CONTENT", data: { a: [1, 2] } });
});

test("extracts window.SHARED_CONTENT JSON", () => {
  const src = page('window.SHARED_CONTENT = {"x": "y"};');
  assert.equal(extractContent(src).decl, "window.SHARED_CONTENT");
});

test("round-trip preserves everything outside the block", () => {
  const src = page('const CONTENT = {"a": "old"};');
  const out = replaceContent(src, { a: "new" });
  assert.match(out, /"a": "new"/);
  assert.match(out, /rest\(\);/);
  assert.deepEqual(extractContent(out).data, { a: "new" });
});

test("throws on missing markers", () => {
  assert.throws(() => extractContent("<script>const CONTENT = {};</script>"), /markers/);
});

test("throws on duplicate markers", () => {
  const src = page('const CONTENT = {};') + "\n/* CONTENT:BEGIN */";
  assert.throws(() => extractContent(src), /Duplicate/);
});

test("throws on non-JSON body", () => {
  assert.throws(() => extractContent(page("const CONTENT = { a: fn() };")));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../lib/content-io.js`

- [ ] **Step 4: Implement** — `editor/lib/content-io.js`

```js
"use strict";
const BEGIN = "/* CONTENT:BEGIN */";
const END = "/* CONTENT:END */";
const DECL_RE = /^\s*(const CONTENT|window\.SHARED_CONTENT)\s*=\s*([\s\S]*?);\s*$/;

function locate(source) {
  const b = source.indexOf(BEGIN);
  const e = source.indexOf(END);
  if (b === -1 || e === -1 || e < b) throw new Error("CONTENT markers missing or out of order");
  if (source.indexOf(BEGIN, b + BEGIN.length) !== -1) throw new Error("Duplicate CONTENT:BEGIN marker");
  if (source.indexOf(END, e + END.length) !== -1) throw new Error("Duplicate CONTENT:END marker");
  return { b: b + BEGIN.length, e };
}

function extractContent(source) {
  const { b, e } = locate(source);
  const m = DECL_RE.exec(source.slice(b, e));
  if (!m) throw new Error("CONTENT block must be `const CONTENT = {...};` or `window.SHARED_CONTENT = {...};`");
  return { decl: m[1], data: JSON.parse(m[2]) };
}

function replaceContent(source, data) {
  const { decl } = extractContent(source); // also validates markers
  const { b, e } = locate(source);
  return source.slice(0, b) + "\n" + decl + " = " + JSON.stringify(data, null, 2) + ";\n" + source.slice(e);
}

module.exports = { extractContent, replaceContent, BEGIN, END };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test` — Expected: all content-io tests PASS

- [ ] **Step 6: Commit (local only — never push)**

```bash
git add package.json .gitignore editor/
git commit -m "feat(editor): scaffolding and CONTENT block parser"
```

---

### Task 2: Path operations (paths.js, UMD)

**Files:**
- Create: `editor/lib/paths.js`, `editor/test/paths.test.js`

**Interfaces:**
- Produces (UMD — `module.exports` in node, `window.EditorPaths` in browser):
  `getPath(obj, "a.b.0") → value | undefined`;
  `setPath(obj, path, value)` (throws `Path not found` unless the full path already exists);
  `addItem(obj, listPath, item)`, `removeItem(obj, listPath, index)`, `moveItem(obj, listPath, from, to)` (throw on non-array path or out-of-range index).

- [ ] **Step 1: Write the failing test** — `editor/test/paths.test.js`

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../lib/paths.js");

const fix = () => ({ hero: { title: "T" }, list: [{ t: "a" }, { t: "b" }, { t: "c" }] });

test("getPath resolves nested and indexed paths", () => {
  assert.equal(P.getPath(fix(), "hero.title"), "T");
  assert.equal(P.getPath(fix(), "list.1.t"), "b");
  assert.equal(P.getPath(fix(), "list.9.t"), undefined);
  assert.equal(P.getPath(fix(), "nope.x"), undefined);
});

test("setPath writes only existing paths", () => {
  const o = fix();
  P.setPath(o, "hero.title", "New");
  assert.equal(o.hero.title, "New");
  assert.throws(() => P.setPath(o, "hero.missing", "x"), /Path not found/);
  assert.throws(() => P.setPath(o, "list.5.t", "x"), /Path not found/);
});

test("list ops add, remove, move with bounds checks", () => {
  const o = fix();
  P.addItem(o, "list", { t: "d" });
  assert.equal(o.list.length, 4);
  P.removeItem(o, "list", 0);
  assert.equal(o.list[0].t, "b");
  P.moveItem(o, "list", 2, 0);
  assert.equal(o.list[0].t, "d");
  assert.throws(() => P.removeItem(o, "list", 99), /Bad index/);
  assert.throws(() => P.addItem(o, "hero", {}), /Not a list/);
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (module not found)

- [ ] **Step 3: Implement** — `editor/lib/paths.js`

```js
(function (exports) {
  "use strict";
  function parts(path) {
    if (typeof path !== "string" || path === "") throw new Error("Bad path: " + path);
    return path.split(".");
  }
  function getPath(obj, path) {
    let cur = obj;
    for (const p of parts(path)) {
      if (cur === null || typeof cur !== "object" || !(p in cur)) return undefined;
      cur = cur[p];
    }
    return cur;
  }
  function setPath(obj, path, value) {
    const ps = parts(path);
    const last = ps.pop();
    const parent = ps.length ? getPath(obj, ps.join(".")) : obj;
    if (parent === undefined || parent === null || typeof parent !== "object" || !(last in parent))
      throw new Error("Path not found: " + path);
    parent[last] = value;
  }
  function getList(obj, path) {
    const list = getPath(obj, path);
    if (!Array.isArray(list)) throw new Error("Not a list: " + path);
    return list;
  }
  function addItem(obj, path, item) { getList(obj, path).push(item); }
  function removeItem(obj, path, index) {
    const list = getList(obj, path);
    if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new Error("Bad index: " + index);
    list.splice(index, 1);
  }
  function moveItem(obj, path, from, to) {
    const list = getList(obj, path);
    for (const i of [from, to])
      if (!Number.isInteger(i) || i < 0 || i >= list.length) throw new Error("Bad index: " + i);
    list.splice(to, 0, list.splice(from, 1)[0]);
  }
  Object.assign(exports, { getPath, setPath, addItem, removeItem, moveItem });
})(typeof module !== "undefined" ? module.exports : (window.EditorPaths = {}));
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS

- [ ] **Step 5: Commit (local only)**

```bash
git add editor/lib/paths.js editor/test/paths.test.js
git commit -m "feat(editor): path get/set and list operations"
```

---

### Task 3: Patch validation + apply (patch.js, collections.json)

**Files:**
- Create: `editor/lib/patch.js`, `editor/collections.json`, `editor/test/patch.test.js`

**Interfaces:**
- Consumes: `getPath/setPath/addItem/removeItem/moveItem` from `editor/lib/paths.js`.
- Produces: `applyPatch(data, patch, templates) → data` where `patch = { ops: [...] }` applied **in order**; op shapes:
  `{type:"set", path, value}` — path must resolve to an existing string; value validated by `validateText`.
  `{type:"add", path, item}` — `path` must be a key of `templates`; item keys must exactly equal template keys; all values strings; `kind` (if present) ∈ `image|video`.
  `{type:"remove", path, index}` / `{type:"move", path, from, to}` — `path` must be a key of `templates`.
  Also exports `validateText(value)` (throws on non-string or `</script` in any casing/spacing).
- Note: `applyPatch` mutates `data` as it goes; callers must apply to a freshly parsed copy and write nothing if it throws (server does exactly this in Task 8).

- [ ] **Step 1: Create `editor/collections.json`**

```json
{
  "news.acamp": { "date": "", "title": "", "body": "" },
  "news.vidyanagar": { "date": "", "title": "", "body": "" },
  "galleries.acamp": { "kind": "image", "id": "", "caption": "" },
  "galleries.vidyanagar": { "kind": "image", "id": "", "caption": "" }
}
```

- [ ] **Step 2: Write the failing test** — `editor/test/patch.test.js`

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyPatch, validateText } = require("../lib/patch.js");
const templates = require("../collections.json");

const fix = () => ({
  hero: { title: "Old" },
  stats: [{ n: "2", label: "Branches" }],
  news: { acamp: [], vidyanagar: [] },
  galleries: { acamp: [], vidyanagar: [] },
});

test("set writes an existing string path", () => {
  const d = applyPatch(fix(), { ops: [{ type: "set", path: "hero.title", value: "New" }] }, templates);
  assert.equal(d.hero.title, "New");
});

test("set rejects unknown and non-string paths", () => {
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "set", path: "hero.nope", value: "x" }] }, templates), /Unknown or non-text/);
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "set", path: "stats", value: "x" }] }, templates), /Unknown or non-text/);
});

test("validateText blocks script tags and non-strings", () => {
  assert.throws(() => validateText("</script><script>alert(1)"), /script/);
  assert.throws(() => validateText("< / ScRiPt >"), /script/);
  assert.throws(() => validateText(42), /string/);
  validateText("plain text with <b> is stored inert"); // no throw
});

test("add validates item shape against template", () => {
  const ops = [{ type: "add", path: "news.acamp", item: { date: "2026-08-14", title: "T", body: "B" } }];
  const d = applyPatch(fix(), { ops }, templates);
  assert.equal(d.news.acamp.length, 1);
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "add", path: "news.acamp", item: { title: "only" } }] }, templates), /exactly/);
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "add", path: "stats", item: {} }] }, templates), /Unknown collection/);
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "add", path: "galleries.acamp", item: { kind: "iframe", id: "x", caption: "" } }] }, templates), /kind/);
});

test("ordered replay: set on an item added earlier in the same patch", () => {
  const ops = [
    { type: "add", path: "news.acamp", item: { date: "", title: "New post", body: "" } },
    { type: "set", path: "news.acamp.0.title", value: "Sports Day" },
    { type: "move", path: "news.acamp", from: 0, to: 0 },
  ];
  const d = applyPatch(fix(), { ops }, templates);
  assert.equal(d.news.acamp[0].title, "Sports Day");
});

test("remove and unknown op types", () => {
  const base = fix();
  base.news.acamp.push({ date: "", title: "x", body: "" });
  const d = applyPatch(base, { ops: [{ type: "remove", path: "news.acamp", index: 0 }] }, templates);
  assert.equal(d.news.acamp.length, 0);
  assert.throws(() => applyPatch(fix(), { ops: [{ type: "explode" }] }, templates), /Unknown op/);
});
```

- [ ] **Step 3: Run to verify failure** — `npm test` → FAIL (module not found)

- [ ] **Step 4: Implement** — `editor/lib/patch.js`

```js
"use strict";
const { getPath, setPath, addItem, removeItem, moveItem } = require("./paths.js");

function validateText(value) {
  if (typeof value !== "string") throw new Error("Text value must be a string");
  if (/<\s*\/?\s*script/i.test(value)) throw new Error("Text may not contain script tags");
}

function validateItem(item, template) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error("Item must be an object");
  const want = Object.keys(template).sort().join(",");
  const got = Object.keys(item).sort().join(",");
  if (want !== got) throw new Error("Item keys must be exactly: " + want);
  for (const v of Object.values(item)) validateText(v);
  if ("kind" in template && !["image", "video"].includes(item.kind)) throw new Error("kind must be image or video");
}

function requireCollection(templates, path) {
  const t = templates[path];
  if (!t) throw new Error("Unknown collection: " + path);
  return t;
}

function applyPatch(data, patch, templates) {
  for (const op of (patch && patch.ops) || []) {
    if (op.type === "set") {
      validateText(op.value);
      if (typeof getPath(data, op.path) !== "string") throw new Error("Unknown or non-text path: " + op.path);
      setPath(data, op.path, op.value);
    } else if (op.type === "add") {
      validateItem(op.item, requireCollection(templates, op.path));
      addItem(data, op.path, op.item);
    } else if (op.type === "remove") {
      requireCollection(templates, op.path);
      removeItem(data, op.path, op.index);
    } else if (op.type === "move") {
      requireCollection(templates, op.path);
      moveItem(data, op.path, op.from, op.to);
    } else {
      throw new Error("Unknown op type: " + (op && op.type));
    }
  }
  return data;
}

module.exports = { applyPatch, validateText, validateItem };
```

Note the "Unknown or non-text path" check: `set` ops on collection item fields (e.g. `news.acamp.0.title`) pass because the item exists by the time the op replays — order matters, which is why the patch is an ordered log, not grouped sets/lists.

- [ ] **Step 5: Run to verify pass** — `npm test` → PASS

- [ ] **Step 6: Commit (local only)**

```bash
git add editor/lib/patch.js editor/collections.json editor/test/patch.test.js
git commit -m "feat(editor): ordered patch validation and apply"
```

---

### Task 4: Extract index.html content + check-paths.js

**Files:**
- Modify: `index.html` (dc-script starts ~line 427; `renderVals()` at ~line 631; template sections at lines ~217–350)
- Create: `editor/check-paths.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Produces: the page-side conventions every later task relies on:
  `const CONTENT = {...};` in markers at the top of the dc-script;
  `window.__CONTENT = CONTENT` and `window.__rerender = () => this.setState({})` set in `componentDidMount`;
  `withPaths(arr, base)` helper in `renderVals()` adding `p: base + "." + i` to each loop item;
  `data-edit="<path>"` attributes (static, or `data-edit="{{ x.p }}.field"` in loops).
- `editor/check-paths.js`: exits 1 listing any literal `data-edit`/`data-list` value (ones without `{{`) that does not resolve via `getPath` against the page's CONTENT (or shared content for `shared:` paths); skips pages with no CONTENT block yet.

- [ ] **Step 1: Insert the CONTENT block**

At the top of the dc-script (immediately after the `<script type="text/x-dc" data-dc-script>` line and its PAGE LOGIC comment), insert — values copied **verbatim** from the current `renderVals()` literals (`stats`, `timeline`, `schools`, `facilities`) plus the hero heading/standfirst text copied verbatim from the hero section markup (~lines 217–245), under keys `hero.title` and `hero.sub`:

```js
/* CONTENT:BEGIN */
const CONTENT = {
  "hero": {
    "title": "<verbatim current hero <h1> text>",
    "sub": "<verbatim current hero standfirst text>"
  },
  "stats": [
    { "n": "2", "label": "Branches in Kurnool" },
    { "n": "A-Camp", "label": "Branch one" },
    { "n": "Vidyanagar", "label": "Branch two" },
    { "n": "TBD", "label": "Details coming soon" }
  ],
  "timeline": [
    { "y": "Approach", "t": "Child-centred learning — every child works at their own pace in a prepared environment." },
    { "y": "Culture", "t": "Learning without fear, built on empathy, discipline and respect." },
    { "y": "Values", "t": "Values-first education that shapes character alongside academics." },
    { "y": "Consistency", "t": "Two branches, one standard — the same care and method at both campuses." }
  ],
  "schools": [
    { "tag": "01", "accent": "#a51915", "ink": "#fff", "ink2": "#a51915", "page": "montessori-acamp.html", "kicker": "Branch · Kurnool", "name": "Montessori School, A-Camp", "short": "A Montessori branch in Kurnool offering child-centred, value-based education. Full details coming soon.", "imgLabel": "a-camp campus — photo" },
    { "tag": "02", "accent": "#a51915", "ink": "#fff", "ink2": "#a51915", "page": "montessori-vidyanagar.html", "kicker": "Branch · Kurnool", "name": "Montessori School, Vidyanagar", "short": "A Montessori branch in Kurnool offering child-centred, value-based education. Full details coming soon.", "imgLabel": "vidyanagar campus — photo" }
  ],
  "facilities": [
    { "icon": "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "title": "Classrooms", "desc": "Child-centred classrooms designed for hands-on, self-paced learning." },
    { "icon": "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "title": "Library", "desc": "A quiet space for reading and independent exploration." },
    { "icon": "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "title": "Science Labs", "desc": "Hands-on spaces for practical, age-appropriate science activities." },
    { "icon": "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "title": "Sports & Play", "desc": "Dedicated play areas supporting healthy, active development." },
    { "icon": "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "title": "Arts & Music", "desc": "Creative outlets that build confidence and self-expression." },
    { "icon": "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "title": "Care & Well-being", "desc": "Attentive, supportive care for every child throughout the school day." }
  ]
};
/* CONTENT:END */
```

The two `<verbatim ...>` hero values are the only ones not printed here: copy the exact strings out of the hero markup — do not rewrite them. Preserve the existing explanatory comments above each array by moving them above the block.

- [ ] **Step 2: Rewrite `renderVals()` and `componentDidMount`**

`renderVals()` keeps all behaviour wiring unchanged and reads data from CONTENT:

```js
renderVals() {
  const set = (k) => (e) => this.setState({ form: { ...this.state.form, [k]: e.target.value } });
  const withPaths = (arr, base) => arr.map((it, i) => ({ ...it, p: base + "." + i }));
  return {
    navRef: (el) => { this._navEl = el; },
    hero: CONTENT.hero,
    stats: withPaths(CONTENT.stats, "stats"),
    timeline: withPaths(CONTENT.timeline, "timeline"),
    schools: withPaths(CONTENT.schools, "schools"),
    facilities: withPaths(CONTENT.facilities, "facilities"),
    form: this.state.form,
    onName: set("name"),
    onPhone: set("phone"),
    onSchool: set("school"),
    submitLabel: this.state.submitted ? "✓ Enquiry received" : "Send enquiry",
    submit: () => this.setState({ submitted: true }),
  };
}
```

At the top of `componentDidMount()` add:

```js
window.__CONTENT = CONTENT;
window.__rerender = () => this.setState({});
```

- [ ] **Step 3: Add holes + data-edit attributes in the template**

- Hero `<h1>`: replace its literal text with `{{ hero.title }}` and add `data-edit="hero.title"`. Same for the standfirst → `{{ hero.sub }}`, `data-edit="hero.sub"`.
- Stats loop (~line 245): on the element rendering `{{ s.n }}` add `data-edit="{{ s.p }}.n"`; on the label element add `data-edit="{{ s.p }}.label"`.
- Timeline loop (~line 276): `data-edit="{{ t.p }}.y"` and `data-edit="{{ t.p }}.t"` on the corresponding elements.
- Schools loop (~line 300): `data-edit="{{ sc.p }}.name"` on the name element, `data-edit="{{ sc.p }}.short"` on the description, `data-edit="{{ sc.p }}.kicker"` on the kicker badge.
- Facilities loop (~line 331): `data-edit="{{ f.p }}.title"` and `data-edit="{{ f.p }}.desc"`.
- Do NOT add data-edit to: nav, form labels/buttons, footer, anything whose value is behaviour-derived (`submitLabel`).

- [ ] **Step 4: Write `editor/check-paths.js`**

```js
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { extractContent } = require("./lib/content-io.js");
const { getPath } = require("./lib/paths.js");

const root = path.join(__dirname, "..");
const PAGES = ["index.html", "montessori-acamp.html", "montessori-vidyanagar.html", "acamp-subpage.html", "vidyanagar-subpage.html"];

let shared = null;
try { shared = extractContent(fs.readFileSync(path.join(root, "content.js"), "utf8")).data; } catch {}

let failures = 0;
for (const page of PAGES) {
  const src = fs.readFileSync(path.join(root, page), "utf8");
  let data = null;
  try { data = extractContent(src).data; } catch { continue; } // page not extracted yet
  for (const m of src.matchAll(/data-(?:edit|list)="([^"{]+)"/g)) {
    const raw = m[1];
    const isShared = raw.startsWith("shared:");
    const scope = isShared ? shared : data;
    const p = isShared ? raw.slice(7) : raw;
    if (scope === null) { console.error(`${page}: ${raw} — content.js missing or unparseable`); failures++; continue; }
    if (getPath(scope, p) === undefined) { console.error(`${page}: unresolved ${raw}`); failures++; }
  }
}
if (failures) { console.error(failures + " unresolved data-edit/data-list path(s)"); process.exit(1); }
console.log("check-paths: all static data-edit/data-list paths resolve");
```

Update `package.json`: `"test": "node --test editor/test/ && node editor/check-paths.js"`.

- [ ] **Step 5: Verify**

Run: `npm test` — Expected: PASS including `check-paths: all static data-edit/data-list paths resolve`.

Manual render check: `python3 -m http.server 8899` then open `http://localhost:8899` alongside `git stash`-free production (`https://msceducation.net`) — the page must render identically: hero text, 4 stats, 4 timeline rows, 2 school cards, 6 facility cards, working enquiry form and dropdown nav. Check the browser console for errors. Any difference is a bug in the extraction.

- [ ] **Step 6: Commit (local only)**

```bash
git add index.html editor/check-paths.js package.json
git commit -m "feat(content): extract index.html content into CONTENT block with data-edit paths"
```

---

### Task 5: Shared content.js + wire into index.html

**Files:**
- Create: `content.js` (repo root — this file deploys)
- Modify: `index.html` (head script tag; footer/admissions contact text; `renderVals()`)

**Interfaces:**
- Produces: `window.SHARED_CONTENT` global available before `support.js` boots, shape:
  `{ cloudName: string, contact: { phone, email, acampAddress, vidyanagarAddress }, news: { acamp: [], vidyanagar: [] }, galleries: { acamp: [], vidyanagar: [] } }`.
- Convention consumed by Tasks 6/10/11/12: `data-edit`/`data-list` paths into this file are prefixed `shared:`.

- [ ] **Step 1: Create `content.js`**

```js
/*
  SHARED CONTENT — facts that appear on more than one page, plus the growing
  collections (news, galleries). Loaded before support.js on every page.
  Edited by the local editor (npm run edit); hand-edits must keep valid JSON.
*/
/* CONTENT:BEGIN */
window.SHARED_CONTENT = {
  "cloudName": "REPLACE_AFTER_SETUP",
  "contact": {
    "phone": "+91 XXXXX XXXXX",
    "email": "info@msceducation.net",
    "acampAddress": "full address to be added",
    "vidyanagarAddress": "full address to be added"
  },
  "news": { "acamp": [], "vidyanagar": [] },
  "galleries": { "acamp": [], "vidyanagar": [] }
};
/* CONTENT:END */
```

(The placeholder strings are copied from the current pages — the README documents them as deliberately blank. `cloudName` is public once set; secrets never go here.)

- [ ] **Step 2: Load it in `index.html`**

In `<head>`, immediately BEFORE the `<script src="./support.js"></script>` line:

```html
<script src="./content.js"></script>
```

- [ ] **Step 3: Wire contact facts**

Run `grep -n 'XXXXX\|info@msceducation' index.html`. For each hit **inside the `<x-dc>` template**: replace the literal with `{{ contact.phone }}` / `{{ contact.email }}` and add `data-edit="shared:contact.phone"` / `data-edit="shared:contact.email"` on the containing element. Leave hits in comments or `<head>` meta alone. Add to `renderVals()`:

```js
contact: window.SHARED_CONTENT.contact,
```

- [ ] **Step 4: Verify**

`npm test` → PASS (check-paths now validates the `shared:` paths against content.js). Manual: reload `http://localhost:8899` — contact line renders identically; console clean.

- [ ] **Step 5: Commit (local only)**

```bash
git add content.js index.html
git commit -m "feat(content): shared content.js for contact facts and collections"
```

---

### Task 6: Extract the four remaining pages

**Files:**
- Modify: `montessori-acamp.html`, `montessori-vidyanagar.html` (renderVals near the bottom of each; templates throughout)
- Modify: `acamp-subpage.html`, `vidyanagar-subpage.html` (`renderVals()` at ~line 286; the `pages` content map)

**Interfaces:**
- Consumes: conventions from Tasks 4–5 (`CONTENT` block, `withPaths`, `window.__CONTENT`, `window.__rerender`, `shared:` prefix).
- Produces: all five pages fully extracted; every page loads `content.js` before `support.js`.

Apply this recipe to each of the four files (it is the same transformation Task 4 performed on index.html — restated here in full so this task stands alone):

- [ ] **Step 1: Branch pages — identify and move literals**

In each branch page's `renderVals()`, identify every JSON-serialisable literal (arrays/objects/strings of pure data — academics lists, campus/facility cards, hero text, section headings that collaborators should edit). Move them verbatim into a `/* CONTENT:BEGIN */ const CONTENT = {...}; /* CONTENT:END */` block at the top of that page's dc-script, converted to strict JSON (double-quoted keys/strings). **Stays in code:** anything containing functions or handlers (menu `open` callbacks, form setters, colour computations), and the nav `rawMenus` structure (navigation is deliberately not editable).

- [ ] **Step 2: Branch pages — rewrite renderVals + hooks**

- Each moved value is read from `CONTENT`; every array that feeds an `sc-for` whose fields get `data-edit` goes through `const withPaths = (arr, base) => arr.map((it, i) => ({ ...it, p: base + "." + i }));`.
- Add to the top of `componentDidMount()`: `window.__CONTENT = CONTENT; window.__rerender = () => this.setState({});`
- Add `contact: window.SHARED_CONTENT.contact` and wire the page's phone/email/address placeholders exactly as Task 5 Step 3 did (addresses use `data-edit="shared:contact.acampAddress"` / `...vidyanagarAddress"` per branch).
- Add `<script src="./content.js"></script>` before `support.js` in `<head>`.

- [ ] **Step 3: Branch pages — data-edit attributes**

On each element rendering a moved text value: static values get `data-edit="<key>"`; loop fields get `data-edit="{{ <var>.p }}.<field>"`. Do not annotate nav, buttons, or behaviour-derived values.

- [ ] **Step 4: Subpages — extract the `pages` map**

In `acamp-subpage.html` / `vidyanagar-subpage.html`, the `P()` helper builds a `pages` map of `{ parent, parentKey, title, intro, blocks }` — pure data. Expand it into the CONTENT block as `"pages": { "<routeKey>": { ... }, ... }` (apply `P()`'s defaults literally; blocks arrays copy verbatim as JSON). `renderVals()` reads `CONTENT.pages[route]`; the block normaliser and menus stay in code. Add the same `componentDidMount` hooks and the `content.js` script tag. Add `data-edit` on the rendered title (`data-edit="{{ current.titlePath }}"` where the normaliser sets `titlePath = "pages." + route + ".title"`), intro (same pattern), and paragraph/heading block text (normaliser sets each block's `p` to `"pages." + route + ".blocks." + i` and the template uses `data-edit="{{ b.p }}.p"` / `"{{ b.p }}.h"` on the matching block types). List-item and gallery blocks get no data-edit in v1.

- [ ] **Step 5: Verify each page**

After EACH file: `npm test` (check-paths picks the page up automatically once its CONTENT block parses), then load it via `python3 -m http.server 8899` next to production and compare — identical render, working nav dropdowns, subpage hash routes (`#core-values`, `#library`, `#transport`) all resolve, console clean.

- [ ] **Step 6: Commit per page (local only)** — four commits:

```bash
git add <file> && git commit -m "feat(content): extract <file> content into CONTENT block"
```

---

### Task 7: Local server — static serving + editor injection

**Files:**
- Create: `editor/server.js`, `editor/config.json`, `editor/test/server.test.js`

**Interfaces:**
- Produces: `createServer({ root, config, templates, secrets }) → http.Server` (exported; `require.main === module` block boots it from `editor/config.json` + `editor/collections.json` + optional `editor/secrets.json`, prints the URL, and on darwin runs `open <url>`).
- Serving rules consumed by all client tasks: any `.html` response gets `<script src="/editor/lib/paths.js"></script><script src="/editor/client/draft.js"></script><script src="/editor/client/editor-client.js"></script>` injected before `</body>`; other files byte-identical; traversal outside root → 403; unknown path → 404.

- [ ] **Step 1: Create `editor/config.json`**

```json
{ "port": 8899, "push": true }
```

- [ ] **Step 2: Write the failing test** — `editor/test/server.test.js`

```js
"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server.js");

function tmpSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-ed-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body><h1>Hi</h1></body></html>");
  fs.writeFileSync(path.join(dir, "plain.js"), "var x = 1;");
  return dir;
}

async function boot(opts = {}) {
  const root = tmpSite();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, ...opts });
  await new Promise((r) => srv.listen(0, r));
  const base = "http://127.0.0.1:" + srv.address().port;
  return { root, srv, base };
}

test("serves html with editor scripts injected before </body>", async () => {
  const { srv, base } = await boot();
  after(() => srv.close());
  const text = await (await fetch(base + "/")).text();
  assert.match(text, /editor-client\.js"><\/script><\/body>/);
  assert.match(text, /<h1>Hi<\/h1>/);
});

test("serves non-html files byte-identical", async () => {
  const { srv, base } = await boot();
  after(() => srv.close());
  assert.equal(await (await fetch(base + "/plain.js")).text(), "var x = 1;");
});

test("404 on unknown path, 403 on traversal", async () => {
  const { srv, base } = await boot();
  after(() => srv.close());
  assert.equal((await fetch(base + "/nope.html")).status, 404);
  assert.equal((await fetch(base + "/..%2f..%2fetc%2fpasswd")).status, 403);
});
```

- [ ] **Step 3: Run to verify failure** — `npm test` → FAIL (module not found)

- [ ] **Step 4: Implement** — `editor/server.js`

```js
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, execFile } = require("node:child_process");
const { extractContent, replaceContent } = require("./lib/content-io.js");
const { applyPatch } = require("./lib/patch.js");
const { signParams } = require("./lib/cloudinary.js");

const CONTENT_FILES = [
  "index.html", "montessori-acamp.html", "montessori-vidyanagar.html",
  "acamp-subpage.html", "vidyanagar-subpage.html", "content.js",
];
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".css": "text/css", ".png": "image/png",
  ".gif": "image/gif", ".md": "text/plain; charset=utf-8",
};
const INJECT = '<script src="/editor/lib/paths.js"></script>' +
  '<script src="/editor/client/draft.js"></script>' +
  '<script src="/editor/client/editor-client.js"></script>';

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type || "text/plain; charset=utf-8" });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => { buf += c; if (buf.length > 5e6) reject(new Error("Body too large")); });
    req.on("end", () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function createServer({ root, config, templates, secrets }) {
  // paths.js lives in the repo's editor/ dir, not the (possibly tmp) site root under test.
  const editorDir = __dirname;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "POST" && url.pathname === "/api/save") {
        const body = await readJson(req);
        if (!CONTENT_FILES.includes(body.file)) return send(res, 400, "Unknown file: " + body.file);
        const fp = path.join(root, body.file);
        const src = fs.readFileSync(fp, "utf8");
        const { data } = extractContent(src);
        applyPatch(data, body.patch, templates); // throws => nothing written
        fs.writeFileSync(fp, replaceContent(src, data));
        return send(res, 200, JSON.stringify({ ok: true }), "application/json");
      }

      if (req.method === "POST" && url.pathname === "/api/publish") {
        const body = await readJson(req).catch(() => ({}));
        const msg = (body.message || "content: update via editor").slice(0, 200);
        const existing = CONTENT_FILES.filter((f) => fs.existsSync(path.join(root, f)));
        git(root, ["add", "--", ...existing]);
        try { git(root, ["commit", "-m", msg]); }
        catch { return send(res, 409, "Nothing to publish (no changes)."); }
        if (config.push === true && process.env.EDITOR_NO_PUSH !== "1") {
          try { git(root, ["pull", "--rebase"]); git(root, ["push"]); }
          catch (e) {
            try { git(root, ["rebase", "--abort"]); } catch {}
            return send(res, 409, "Published locally, but sync failed: " +
              (e.stderr || e.message) + "\nYour changes are committed; ask the site admin to resolve.");
          }
        }
        return send(res, 200, JSON.stringify({ ok: true }), "application/json");
      }

      if (req.method === "POST" && url.pathname === "/api/sign") {
        if (!secrets) return send(res, 503, "Uploads not configured — run: npm run setup");
        const body = await readJson(req);
        const params = body.paramsToSign || {};
        const shared = extractContent(fs.readFileSync(path.join(root, "content.js"), "utf8")).data;
        return send(res, 200, JSON.stringify({
          signature: signParams(params, secrets.cloudinaryApiSecret),
          apiKey: secrets.cloudinaryApiKey,
          cloudName: shared.cloudName,
        }), "application/json");
      }

      // ---- static ----
      const raw = decodeURIComponent(url.pathname);
      const rel = raw === "/" ? "index.html" : raw.replace(/^\//, "");
      const base = rel.startsWith("editor/") ? path.dirname(editorDir) : root;
      const fp = path.resolve(base, rel);
      if (fp !== path.resolve(base) && !fp.startsWith(path.resolve(base) + path.sep)) return send(res, 403, "Forbidden");
      if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return send(res, 404, "Not found");
      const ext = path.extname(fp).toLowerCase();
      let body = fs.readFileSync(fp);
      if (ext === ".html") body = Buffer.from(body.toString("utf8").replace("</body>", INJECT + "</body>"));
      return send(res, 200, body, MIME[ext] || "application/octet-stream");
    } catch (e) {
      return send(res, 400, String(e.message || e));
    }
  });
}

module.exports = { createServer, CONTENT_FILES };

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  const templates = JSON.parse(fs.readFileSync(path.join(__dirname, "collections.json"), "utf8"));
  let secrets = null;
  try { secrets = JSON.parse(fs.readFileSync(path.join(__dirname, "secrets.json"), "utf8")); } catch {}
  const srv = createServer({ root, config, templates, secrets });
  srv.listen(config.port, () => {
    const url = "http://localhost:" + config.port + "/";
    console.log("Editor running at " + url);
    if (!secrets) console.log("(uploads disabled — no editor/secrets.json; run: npm run setup)");
    if (process.env.EDITOR_NO_PUSH === "1") console.log("(EDITOR_NO_PUSH=1 — publish will commit but NOT push)");
    if (process.platform === "darwin") execFile("open", [url]);
  });
}
```

Note `editor/*` requests are served from the real `editor/` directory beside `server.js` (so injected client scripts work even when `root` is a temp fixture), while everything else serves from `root`.

- [ ] **Step 5: Run to verify pass** — `npm test` → PASS

- [ ] **Step 6: Manual smoke test (no push)**

Run: `EDITOR_NO_PUSH=1 npm run edit` — browser opens `http://localhost:8899/`, site renders, view-source shows the three injected script tags (404s in console for the not-yet-written client files are expected). Ctrl-C the server.

- [ ] **Step 7: Commit (local only)**

```bash
git add editor/server.js editor/config.json editor/test/server.test.js
git commit -m "feat(editor): local server with static serving and editor injection"
```

Note: Step 4 requires `editor/lib/cloudinary.js` to exist for the require. Create it now as part of this task (it is tested in Task 13):

```js
"use strict";
const crypto = require("node:crypto");
function signParams(params, apiSecret) {
  const toSign = Object.keys(params).sort().map((k) => k + "=" + params[k]).join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}
module.exports = { signParams };
```
Include it in the same commit: `git add editor/lib/cloudinary.js`.

---

### Task 8: /api/save endpoint tests

Task 7 shipped the save handler; this task locks its contract down with tests (write them, watch them pass, and fix the handler if any fail — a failing case here is a bug, not a broken test).

**Files:**
- Create: `editor/test/save.test.js`

**Interfaces:**
- Consumes: `createServer` from Task 7; patch format from Task 3.
- Produces: verified contract — `POST /api/save {file, patch}` → 200 + file rewritten; 400 + file untouched on unknown file, bad path, bad item, or malformed CONTENT block.

- [ ] **Step 1: Write the tests** — `editor/test/save.test.js`

```js
"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server.js");

const PAGE = `<html><body><x-dc></x-dc><script type="text/x-dc" data-dc-script>
/* CONTENT:BEGIN */
const CONTENT = {
  "hero": { "title": "Old" }
};
/* CONTENT:END */
class Component {}
</script></body></html>`;

const SHARED = `/* CONTENT:BEGIN */
window.SHARED_CONTENT = {
  "news": { "acamp": [] }
};
/* CONTENT:END */`;

async function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "msc-save-"));
  fs.writeFileSync(path.join(root, "index.html"), PAGE);
  fs.writeFileSync(path.join(root, "content.js"), SHARED);
  const templates = { "news.acamp": { date: "", title: "", body: "" } };
  const srv = createServer({ root, config: { push: false }, templates, secrets: null });
  await new Promise((r) => srv.listen(0, r));
  after(() => srv.close());
  const post = (p, body) => fetch("http://127.0.0.1:" + srv.address().port + p, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { root, post };
}

test("save rewrites a page CONTENT block", async () => {
  const { root, post } = await boot();
  const r = await post("/api/save", { file: "index.html", patch: { ops: [{ type: "set", path: "hero.title", value: "New" }] } });
  assert.equal(r.status, 200);
  const out = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(out, /"title": "New"/);
  assert.match(out, /class Component/); // logic untouched
});

test("save applies ordered ops to content.js collections", async () => {
  const { root, post } = await boot();
  const ops = [
    { type: "add", path: "news.acamp", item: { date: "d", title: "t", body: "b" } },
    { type: "set", path: "news.acamp.0.title", value: "Sports Day" },
  ];
  const r = await post("/api/save", { file: "content.js", patch: { ops } });
  assert.equal(r.status, 200);
  assert.match(fs.readFileSync(path.join(root, "content.js"), "utf8"), /Sports Day/);
});

test("rejects unknown file, bad path, bad item — file untouched", async () => {
  const { root, post } = await boot();
  const before = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.equal((await post("/api/save", { file: "support.js", patch: { ops: [] } })).status, 400);
  assert.equal((await post("/api/save", { file: "index.html", patch: { ops: [{ type: "set", path: "hero.nope", value: "x" }] } })).status, 400);
  assert.equal((await post("/api/save", { file: "index.html", patch: { ops: [{ type: "set", path: "hero.title", value: "</script>" }] } })).status, 400);
  assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), before);
});
```

- [ ] **Step 2: Run** — `npm test` → all PASS (fix `server.js` if not; do not weaken assertions)

- [ ] **Step 3: Commit (local only)**

```bash
git add editor/test/save.test.js
git commit -m "test(editor): /api/save contract"
```

---

### Task 9: /api/publish endpoint tests (throwaway git repos)

**Files:**
- Create: `editor/test/publish.test.js`

**Interfaces:**
- Consumes: `createServer`; git behaviour from Task 7's publish handler.
- Produces: verified contract — commit created in the site repo; push happens only when `config.push === true` AND `EDITOR_NO_PUSH !== "1"`; pushes go only to the test's own local bare repo; "nothing to publish" → 409.

**These tests never touch the real repo:** each creates `git init` repos under `os.tmpdir()` with a local bare "remote".

- [ ] **Step 1: Write the tests** — `editor/test/publish.test.js`

```js
"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createServer } = require("../server.js");

const g = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

async function boot(config, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-pub-"));
  const bare = path.join(dir, "remote.git");
  const root = path.join(dir, "site");
  execFileSync("git", ["init", "--bare", bare]);
  fs.mkdirSync(root);
  g(root, "init", "-b", "main");
  g(root, "config", "user.email", "t@t"); g(root, "config", "user.name", "t");
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "1"};\n/* CONTENT:END */');
  g(root, "add", "-A"); g(root, "commit", "-m", "init");
  g(root, "remote", "add", "origin", bare);
  g(root, "push", "-u", "origin", "main"); // local bare only — never the real repo
  const srv = createServer({ root, config, templates: {}, secrets: null });
  await new Promise((r) => srv.listen(0, r));
  after(() => srv.close());
  const oldEnv = process.env.EDITOR_NO_PUSH;
  if (env !== undefined) process.env.EDITOR_NO_PUSH = env; else delete process.env.EDITOR_NO_PUSH;
  after(() => { if (oldEnv === undefined) delete process.env.EDITOR_NO_PUSH; else process.env.EDITOR_NO_PUSH = oldEnv; });
  const publish = () => fetch("http://127.0.0.1:" + srv.address().port + "/api/publish", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "content: test" }),
  });
  return { root, bare, publish };
}

test("publish commits and pushes when enabled", async () => {
  const { root, bare, publish } = await boot({ push: true });
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "2"};\n/* CONTENT:END */');
  assert.equal((await publish()).status, 200);
  assert.match(g(root, "log", "-1", "--format=%s"), /content: test/);
  assert.match(g(bare, "log", "-1", "--format=%s"), /content: test/); // reached the (local bare) remote
});

test("EDITOR_NO_PUSH=1 commits but does not push", async () => {
  const { root, bare, publish } = await boot({ push: true }, "1");
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "3"};\n/* CONTENT:END */');
  assert.equal((await publish()).status, 200);
  assert.match(g(root, "log", "-1", "--format=%s"), /content: test/);
  assert.match(g(bare, "log", "-1", "--format=%s"), /init/); // remote untouched
});

test("no changes → 409", async () => {
  const { publish } = await boot({ push: false });
  assert.equal((await publish()).status, 409);
});
```

- [ ] **Step 2: Run** — `npm test` → all PASS

- [ ] **Step 3: Commit (local only)**

```bash
git add editor/test/publish.test.js
git commit -m "test(editor): /api/publish commits locally, push gated"
```

---

### Task 10: Editor client — draft log, edit bar, text editing

**Files:**
- Create: `editor/client/draft.js`, `editor/client/editor-client.js`, `editor/test/draft.test.js`

**Interfaces:**
- Consumes: `window.EditorPaths` (Task 2 UMD); page hooks `window.__CONTENT` / `window.SHARED_CONTENT` / `window.__rerender` (Tasks 4–6); `/api/save`, `/api/publish` (Tasks 7–9).
- Produces: `window.EditorDraft.createDraft(pageFile)` → `{ set(path, value), listOp(op), count(), toPatches() → { [file]: {ops:[...]} }, clear() }` — ordered log preserved per file; `shared:` prefix routes ops to `content.js` and is stripped from the stored path. `editor-client.js` also exposes `window.EditorUI = { applyLocal, rerender, decorate }` for Task 12 to hook into.

- [ ] **Step 1: Write the failing test** — `editor/test/draft.test.js`

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDraft } = require("../client/draft.js");

test("groups ops per file, stripping shared: prefix, preserving order", () => {
  const d = createDraft("index.html");
  d.set("hero.title", "A");
  d.listOp({ type: "add", path: "shared:news.acamp", item: { date: "", title: "", body: "" } });
  d.set("shared:news.acamp.0.title", "B");
  assert.equal(d.count(), 3);
  const p = d.toPatches();
  assert.deepEqual(Object.keys(p).sort(), ["content.js", "index.html"]);
  assert.deepEqual(p["index.html"].ops, [{ type: "set", path: "hero.title", value: "A" }]);
  assert.equal(p["content.js"].ops[0].type, "add");
  assert.deepEqual(p["content.js"].ops[1], { type: "set", path: "news.acamp.0.title", value: "B" });
  d.clear();
  assert.equal(d.count(), 0);
});
```

- [ ] **Step 2: Run to verify failure**, then implement — `editor/client/draft.js`

```js
(function (exports) {
  "use strict";
  function createDraft(pageFile) {
    let ops = [];
    const route = (p) => (p.startsWith("shared:") ? ["content.js", p.slice(7)] : [pageFile, p]);
    return {
      set(path, value) { ops.push({ type: "set", path, value }); },
      listOp(op) { ops.push(op); },
      count() { return ops.length; },
      toPatches() {
        const byFile = {};
        for (const op of ops) {
          const [file, path] = route(op.path);
          (byFile[file] = byFile[file] || { ops: [] }).ops.push({ ...op, path });
        }
        return byFile;
      },
      clear() { ops = []; },
    };
  }
  exports.createDraft = createDraft;
})(typeof module !== "undefined" ? module.exports : (window.EditorDraft = {}));
```

Run: `npm test` → PASS.

- [ ] **Step 3: Implement the injected UI** — `editor/client/editor-client.js`

```js
(function () {
  "use strict";
  if (window.__EDITOR_BOOTED) return;
  window.__EDITOR_BOOTED = true;
  const P = window.EditorPaths;
  const pageFile = location.pathname.replace(/^\//, "") || "index.html";
  const draft = window.EditorDraft.createDraft(pageFile);
  let editing = true;

  // ---- helpers shared with collections chrome (Task 12) ----
  function targetFor(path) {
    return path.startsWith("shared:") ? [window.SHARED_CONTENT, path.slice(7)] : [window.__CONTENT, path];
  }
  function applyLocal(path, valueOrFn) {
    const [obj, p] = targetFor(path);
    if (typeof valueOrFn === "function") valueOrFn(P.getPath(obj, p)); // list mutation
    else P.setPath(obj, p, valueOrFn);
  }
  function rerender() { if (window.__rerender) window.__rerender(); }

  // ---- top bar ----
  const bar = document.createElement("div");
  bar.id = "ed-bar";
  bar.innerHTML =
    '<style>' +
    '#ed-bar{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;gap:10px;align-items:center;' +
    'background:#26201d;color:#fff;font:13px/1.4 -apple-system,sans-serif;padding:8px 14px;box-shadow:0 1px 6px rgba(0,0,0,.3)}' +
    '#ed-bar button{font:inherit;padding:4px 12px;border-radius:6px;border:0;cursor:pointer;background:#4a423c;color:#fff}' +
    '#ed-bar #ed-publish{background:#e8541b;font-weight:600}' +
    '.ed-hover{outline:2px dashed #e8541b !important;outline-offset:2px;cursor:text}' +
    '.ed-add{font:600 13px sans-serif;margin:10px 0;padding:8px 16px;border:2px dashed #e8541b;border-radius:8px;' +
    'background:#fff;color:#e8541b;cursor:pointer}' +
    '.ed-menu{position:absolute;top:6px;right:6px;display:flex;gap:4px;z-index:9999}' +
    '.ed-menu button{font:12px sans-serif;width:26px;height:26px;border-radius:6px;border:0;cursor:pointer;' +
    'background:#26201d;color:#fff}' +
    '</style>' +
    '<strong>✏️ Editing</strong><span id="ed-count">0 changes</span><span style="flex:1"></span>' +
    '<button id="ed-publish">Publish</button><button id="ed-discard">Discard</button><button id="ed-exit">Exit</button>';
  document.body.appendChild(bar);

  const countEl = bar.querySelector("#ed-count");
  function update() { countEl.textContent = draft.count() + " change" + (draft.count() === 1 ? "" : "s"); }

  // ---- text editing ----
  document.body.addEventListener("mouseover", (e) => {
    if (!editing) return;
    const el = e.target.closest && e.target.closest("[data-edit]");
    if (el) el.classList.add("ed-hover");
  });
  document.body.addEventListener("mouseout", (e) => {
    const el = e.target.closest && e.target.closest("[data-edit]");
    if (el) el.classList.remove("ed-hover");
  });
  document.body.addEventListener("click", (e) => {
    if (!editing) return;
    const el = e.target.closest && e.target.closest("[data-edit]");
    if (!el) return;
    e.preventDefault(); e.stopPropagation(); // block link navigation while editing
    if (el.getAttribute("contenteditable")) return; // already editing it
    el.__edOrig = el.textContent;
    try { el.contentEditable = "plaintext-only"; } catch { el.contentEditable = "true"; }
    el.focus();
  }, true);
  document.body.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.getAttribute("contenteditable")) return;
    if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    if (e.key === "Escape") { el.textContent = el.__edOrig; el.blur(); }
  }, true);
  document.body.addEventListener("blur", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.hasAttribute || !el.hasAttribute("data-edit")) return;
    if (!el.getAttribute("contenteditable")) return;
    el.removeAttribute("contenteditable");
    const path = el.getAttribute("data-edit");
    const value = el.textContent;
    if (value === el.__edOrig) return;
    draft.set(path, value);
    applyLocal(path, value); // keep in-memory content in sync so rerenders don't revert
    update();
  }, true);

  // ---- publish / discard / exit ----
  async function saveAll() {
    const byFile = draft.toPatches();
    for (const [file, patch] of Object.entries(byFile)) {
      const r = await fetch("/api/save", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ file, patch }),
      });
      if (!r.ok) throw new Error(await r.text());
    }
  }
  bar.querySelector("#ed-publish").onclick = async () => {
    if (draft.count() === 0) return alert("No changes to publish.");
    try {
      await saveAll();
      const r = await fetch("/api/publish", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "content: update via editor" }),
      });
      if (!r.ok) throw new Error(await r.text());
      draft.clear(); update();
      alert("Published ✓ — the live site updates in about a minute.");
    } catch (err) { alert("Publish failed:\n" + err.message); }
  };
  bar.querySelector("#ed-discard").onclick = () => {
    if (draft.count() && !confirm("Throw away " + draft.count() + " unsaved change(s)?")) return;
    location.reload();
  };
  bar.querySelector("#ed-exit").onclick = () => {
    editing = !editing;
    bar.querySelector("#ed-exit").textContent = editing ? "Exit" : "Resume";
    document.querySelectorAll(".ed-add,.ed-menu").forEach((n) => (n.style.display = editing ? "" : "none"));
  };
  window.addEventListener("beforeunload", (e) => { if (draft.count()) e.preventDefault(); });

  window.EditorUI = { draft, applyLocal, rerender, update, isEditing: () => editing };
  update();
})();
```

- [ ] **Step 4: Manual test (no push)**

`EDITOR_NO_PUSH=1 npm run edit` →
1. Hover the hero title — dashed outline. Click, type a change, press Enter — bar shows "1 change".
2. Edit a facility card title (loop path). Open a nav dropdown afterwards — the edit must survive the rerender.
3. Escape restores original text. Discard reloads clean.
4. Publish → alert ✓; `git log -1` shows `content: update via editor`; `git diff HEAD~1` shows only the JSON value change.
5. Revert the test commit (tree must be clean first): `git reset --hard HEAD~1`.

- [ ] **Step 5: Commit (local only)**

```bash
git add editor/client/ editor/test/draft.test.js
git commit -m "feat(editor): injected client — draft log, edit bar, in-place text editing"
```

---

### Task 11: News + gallery sections on the branch pages

**Files:**
- Modify: `montessori-acamp.html`, `montessori-vidyanagar.html` (the existing `#news` and `#gallery` sections — currently striped placeholder tiles; and `renderVals()`)

**Interfaces:**
- Consumes: `window.SHARED_CONTENT.news/galleries` (Task 5), `withPaths` convention, `shared:` prefix.
- Produces: `[data-list]` containers and `[data-item]` elements that Task 12's chrome attaches to; rendered values `news`, `noNews`, `gallery`, `noGallery` per branch page.

- [ ] **Step 1: renderVals additions (A-Camp shown; Vidyanagar swaps `acamp` → `vidyanagar`)**

```js
// ---- shared collections (news + gallery) ----
// Cloudinary URLs are built here because {{ }} cannot concatenate. Stored
// values are public IDs, so every rendered image gets f_auto,q_auto for free.
const S = window.SHARED_CONTENT;
const cdn = "https://res.cloudinary.com/" + S.cloudName;
const news = S.news.acamp.map((it, i) => ({ ...it, p: "shared:news.acamp." + i }));
const gallery = S.galleries.acamp.map((it, i) => ({
  ...it,
  p: "shared:galleries.acamp." + i,
  isImage: it.kind === "image",
  isVideo: it.kind === "video",
  url: it.kind === "image"
    ? cdn + "/image/upload/f_auto,q_auto,w_800/" + it.id
    : cdn + "/video/upload/q_auto/" + it.id + ".mp4",
  poster: cdn + "/video/upload/so_0,f_jpg,q_auto,w_800/" + it.id + ".jpg",
}));
```

and in the returned object:

```js
news, noNews: news.length === 0,
gallery, noGallery: gallery.length === 0,
```

- [ ] **Step 2: Replace the `#news` section's placeholder grid** (keep the section's existing heading/kicker markup and fonts; this replaces only the tile grid — match font-family/colours to the neighbouring cards on that page):

```html
<sc-if value="{{ noNews }}"><p style="color:#6b615b;font-size:14.5px">News and announcements coming soon.</p></sc-if>
<div class="g g-3" data-list="shared:news.acamp">
  <sc-for list="{{ news }}" as="n" hint-placeholder-count="3">
    <article data-item="" style="position:relative;border:1px solid rgba(38,32,29,.12);border-radius:14px;background:#fff;padding:22px">
      <div data-edit="{{ n.p }}.date" style="font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.08em;color:#a51915">{{ n.date }}</div>
      <h3 data-edit="{{ n.p }}.title" style="font-size:21px;margin:10px 0 8px;color:#26201d">{{ n.title }}</h3>
      <p data-edit="{{ n.p }}.body" style="font-size:14.5px;line-height:1.6;color:#4a423c;margin:0">{{ n.body }}</p>
    </article>
  </sc-for>
</div>
```

- [ ] **Step 3: Replace the `#gallery` section's placeholder grid**:

```html
<sc-if value="{{ noGallery }}"><p style="color:#6b615b;font-size:14.5px">Photos and videos coming soon.</p></sc-if>
<div class="g g-3" data-list="shared:galleries.acamp">
  <sc-for list="{{ gallery }}" as="ga" hint-placeholder-count="6">
    <figure data-item="" style="position:relative;margin:0;border-radius:12px;overflow:hidden;background:#faf5f1;border:1px solid rgba(38,32,29,.1)">
      <sc-if value="{{ ga.isImage }}"><img src="{{ ga.url }}" alt="{{ ga.caption }}" loading="lazy" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block"></sc-if>
      <sc-if value="{{ ga.isVideo }}"><video controls preload="none" src="{{ ga.url }}" poster="{{ ga.poster }}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#26201d"></video></sc-if>
      <figcaption data-edit="{{ ga.p }}.caption" style="padding:10px 12px;font-size:13px;color:#6b615b">{{ ga.caption }}</figcaption>
    </figure>
  </sc-for>
</div>
```

Vidyanagar page: identical markup with `shared:news.vidyanagar` / `shared:galleries.vidyanagar` and the matching renderVals keys.

- [ ] **Step 4: Verify**

`npm test` → PASS (data-list paths resolve). Manual: both branch pages show the two "coming soon" empty states (collections are empty) and render nothing broken; console clean. Temporarily hand-add one news item to `content.js`, reload — card renders; remove it again (or `git checkout -- content.js`).

- [ ] **Step 5: Commit (local only)**

```bash
git add montessori-acamp.html montessori-vidyanagar.html
git commit -m "feat(content): news and gallery sections driven by shared collections"
```

---

### Task 12: Collections chrome — Add / reorder / delete

**Files:**
- Modify: `editor/client/editor-client.js` (append the chrome block before the final `window.EditorUI` assignment; add `decorate` to the exported object)

**Interfaces:**
- Consumes: `window.EditorUI` internals from Task 10 (`draft`, `applyLocal`, `rerender`, `update`, `isEditing`), `[data-list]`/`[data-item]` markup from Task 11, `pickFile`/upload flow added in Task 13 (until Task 13 lands, gallery Add shows an alert — see Step 2).
- Produces: `decorate()` — strips and rebuilds all `.ed-add`/`.ed-menu` chrome (so indices are never stale); a debounced `MutationObserver` keeps chrome alive across dc-runtime rerenders.

- [ ] **Step 1: Append inside the IIFE of `editor-client.js`**

```js
  // ---- collections chrome ----
  function doOp(op, mutate) {
    draft.listOp(op);
    applyLocal(op.path, mutate);
    rerender(); update();
  }
  function onAdd(listPath) {
    if (listPath.includes("galleries.")) return window.__edUpload
      ? window.__edUpload(listPath)
      : alert("Uploads arrive in the next build step.");
    const item = { date: new Date().toISOString().slice(0, 10), title: "New post", body: "Write the announcement here." };
    doOp({ type: "add", path: listPath, item }, (l) => l.push({ ...item }));
  }
  function menuFor(item, listPath, index, length) {
    const m = document.createElement("span");
    m.className = "ed-menu";
    const mk = (label, title, fn) => {
      const b = document.createElement("button");
      b.textContent = label; b.title = title;
      b.onclick = (e) => { e.stopPropagation(); e.preventDefault(); fn(); };
      m.appendChild(b);
    };
    if (index > 0) mk("↑", "Move up", () => doOp({ type: "move", path: listPath, from: index, to: index - 1 }, (l) => l.splice(index - 1, 0, l.splice(index, 1)[0])));
    if (index < length - 1) mk("↓", "Move down", () => doOp({ type: "move", path: listPath, from: index, to: index + 1 }, (l) => l.splice(index + 1, 0, l.splice(index, 1)[0])));
    mk("✕", "Delete", () => { if (confirm("Delete this item?")) doOp({ type: "remove", path: listPath, index }, (l) => l.splice(index, 1)); });
    return m;
  }
  function decorate() {
    document.querySelectorAll(".ed-add,.ed-menu").forEach((n) => n.remove()); // rebuild fresh — never stale indices
    if (!editing) return;
    document.querySelectorAll("[data-list]").forEach((listEl) => {
      const listPath = listEl.getAttribute("data-list");
      const items = listEl.querySelectorAll(":scope [data-item]");
      items.forEach((it, i) => { it.style.position = "relative"; it.appendChild(menuFor(it, listPath, i, items.length)); });
      const add = document.createElement("button");
      add.className = "ed-add"; add.textContent = "+ Add";
      add.onclick = () => onAdd(listPath);
      listEl.parentElement.insertBefore(add, listEl.nextSibling); // sibling, not child: React owns the list's children
    });
  }
  let moT;
  const mo = new MutationObserver(() => {
    clearTimeout(moT);
    moT = setTimeout(() => { mo.disconnect(); decorate(); observe(); }, 120);
  });
  const observe = () => mo.observe(document.body, { childList: true, subtree: true });
  decorate(); observe();
```

Also extend the Exit handler from Task 10: after toggling `editing`, call `decorate()` (replacing the `style.display` loop). Add `decorate` to `window.EditorUI`.

Note the `.ed-add` button is inserted as a *sibling after* the `[data-list]` element and `.ed-menu` spans are appended inside items; the debounced rebuild-from-scratch tolerates the dc-runtime's React reconciler removing them on any rerender.

- [ ] **Step 2: Manual test (no push)**

`EDITOR_NO_PUSH=1 npm run edit` → open a branch page:
1. "+ Add" under News creates a card instantly; its title/body/date are click-editable; count rises.
2. Add two more; ↑/↓ reorder them live; ✕ with confirm deletes one.
3. Open a nav dropdown (forces rerender) — chrome reappears, indices still correct (top item has no ↑).
4. Publish → `git diff HEAD~1` shows only `content.js` news array changes, in the on-screen order. `git reset --hard HEAD~1` to revert the test commit (clean tree first).
5. Gallery "+ Add" shows the placeholder alert (Task 13 replaces it).

- [ ] **Step 3: Commit (local only)**

```bash
git add editor/client/editor-client.js
git commit -m "feat(editor): add/reorder/delete chrome for news and gallery collections"
```

---

### Task 13: Cloudinary uploads + YouTube stub

**Files:**
- Create: `editor/test/cloudinary.test.js`, `editor/lib/youtube.js`, `editor/test/youtube.test.js`
- Modify: `editor/client/editor-client.js` (upload flow), `editor/config.json` (youtube flag)

**Interfaces:**
- Consumes: `signParams` (created in Task 7), `/api/sign` endpoint, `doOp` from Task 12.
- Produces: `window.__edUpload(listPath)` — picks a file, signs, uploads direct to Cloudinary, appends `{kind, id, caption:""}`; `uploadVideo(config)` in `editor/lib/youtube.js` throwing until `config.youtube.enabled === true`.

- [ ] **Step 1: Write failing tests**

`editor/test/cloudinary.test.js`:
```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { signParams } = require("../lib/cloudinary.js");

test("signs sorted params per Cloudinary spec (sha1 of k=v&... + secret)", () => {
  const sig = signParams({ timestamp: 1723600000, folder: "msc" }, "shhh");
  const expected = crypto.createHash("sha1").update("folder=msc&timestamp=1723600000" + "shhh").digest("hex");
  assert.equal(sig, expected);
});
```

`editor/test/youtube.test.js`:
```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { uploadVideo } = require("../lib/youtube.js");

test("throws while disabled, mentioning the audit", () => {
  assert.throws(() => uploadVideo({}), /audit/i);
  assert.throws(() => uploadVideo({ youtube: { enabled: false } }), /audit/i);
});

test("enabled flag reaches the not-implemented path", () => {
  assert.throws(() => uploadVideo({ youtube: { enabled: true } }), /not implemented/i);
});
```

Run `npm test` → cloudinary test PASSes already (lib landed in Task 7 — this locks it); youtube FAILs (module missing).

- [ ] **Step 2: Implement `editor/lib/youtube.js`**

```js
"use strict";
/*
  YouTube auto-upload — INTENTIONALLY DISABLED.
  Google locks videos uploaded via videos.insert from unverified API projects
  to private, with no appeal (support.google.com/youtube/answer/7300965).
  Until the project passes Google's compliance audit, videos go to Cloudinary.
  When the audit passes: set { "youtube": { "enabled": true } } in
  editor/config.json and implement against videos.insert (quota: 100/day),
  uploading to each school's Brand Account channel.
*/
function uploadVideo(config) {
  if (!config || !config.youtube || config.youtube.enabled !== true)
    throw new Error("YouTube upload is disabled until the Google API compliance audit passes; videos upload to Cloudinary instead.");
  throw new Error("YouTube upload not implemented yet — implement videos.insert here once the audit passes.");
}
module.exports = { uploadVideo };
```

Update `editor/config.json` to `{ "port": 8899, "push": true, "youtube": { "enabled": false } }`.

- [ ] **Step 3: Run** — `npm test` → PASS

- [ ] **Step 4: Client upload flow** — append inside `editor-client.js` IIFE (before `decorate()` boot):

```js
  // ---- media upload (Cloudinary; signed by the local server) ----
  function pickFile(accept) {
    return new Promise((resolve) => {
      const i = document.createElement("input");
      i.type = "file"; i.accept = accept;
      i.onchange = () => resolve(i.files[0] || null);
      i.click();
    });
  }
  window.__edUpload = async function (listPath) {
    const file = await pickFile("image/*,video/*");
    if (!file) return;
    const busy = document.createElement("div");
    busy.textContent = "Uploading " + file.name + "…";
    busy.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483000;background:#26201d;color:#fff;padding:10px 16px;border-radius:8px;font:13px sans-serif";
    document.body.appendChild(busy);
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const signRes = await fetch("/api/sign", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ paramsToSign: { timestamp } }),
      });
      if (!signRes.ok) throw new Error(await signRes.text());
      const s = await signRes.json();
      const fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", s.apiKey);
      fd.append("timestamp", String(timestamp));
      fd.append("signature", s.signature);
      const up = await (await fetch("https://api.cloudinary.com/v1_1/" + s.cloudName + "/auto/upload", { method: "POST", body: fd })).json();
      if (up.error) throw new Error(up.error.message);
      const item = { kind: up.resource_type === "video" ? "video" : "image", id: up.public_id, caption: "" };
      doOp({ type: "add", path: listPath, item }, (l) => l.push({ ...item }));
    } catch (err) {
      alert("Upload failed:\n" + err.message);
    } finally {
      busy.remove();
    }
  };
```

- [ ] **Step 5: Manual test (no push; needs a free Cloudinary account)**

Create/borrow a Cloudinary account, run `npm run setup` once it exists (Task 14) — or for now hand-write `editor/secrets.json` `{"cloudinaryApiKey": "...", "cloudinaryApiSecret": "..."}` and set `cloudName` in `content.js`. Then `EDITOR_NO_PUSH=1 npm run edit`:
1. Gallery "+ Add" → pick a photo → tile appears with the Cloudinary-optimised image; caption click-editable.
2. Add a short phone video → tile renders `<video>` with poster; plays on click.
3. Publish → `content.js` diff shows `{kind, id, caption}` items only. Revert: `git reset --hard HEAD~1`.
4. Without secrets.json (rename it), gallery Add reports "Uploads not configured — run: npm run setup".

- [ ] **Step 6: Commit (local only)**

```bash
git add editor/lib/youtube.js editor/test/ editor/client/editor-client.js editor/config.json
git commit -m "feat(editor): signed Cloudinary uploads; flag-gated YouTube stub"
```

---

### Task 14: Onboarding — setup script, guide, final E2E

**Files:**
- Create: `editor/setup.js`, `docs/EDITING.md`

**Interfaces:**
- Consumes: `extractContent/replaceContent` (Task 1); `editor/secrets.json` shape `{ cloudinaryApiKey, cloudinaryApiSecret }` (Task 13); `cloudName` in `content.js` (Task 5).

- [ ] **Step 1: Implement `editor/setup.js`**

```js
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { extractContent, replaceContent } = require("./lib/content-io.js");
const { signParams } = require("./lib/cloudinary.js");

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("MSC editor setup — Cloudinary credentials (Dashboard → API Keys):");
  const cloudName = (await rl.question("Cloud name: ")).trim();
  const apiKey = (await rl.question("API key: ")).trim();
  const apiSecret = (await rl.question("API secret: ")).trim();
  rl.close();
  if (!cloudName || !apiKey || !apiSecret) { console.error("All three values are required."); process.exit(1); }
  signParams({ timestamp: 1 }, apiSecret); // sanity: signing works
  fs.writeFileSync(path.join(__dirname, "secrets.json"),
    JSON.stringify({ cloudinaryApiKey: apiKey, cloudinaryApiSecret: apiSecret }, null, 2));
  const cPath = path.join(__dirname, "..", "content.js");
  const src = fs.readFileSync(cPath, "utf8");
  const { data } = extractContent(src);
  data.cloudName = cloudName;
  fs.writeFileSync(cPath, replaceContent(src, data));
  console.log("✓ Wrote editor/secrets.json (gitignored) and set cloudName in content.js.");
  console.log("Next: npm run edit");
})();
```

- [ ] **Step 2: Write `docs/EDITING.md`** — the collaborator guide, in plain language:

```markdown
# Editing the MSC website

## One-time setup (ask the site admin to walk you through it)
1. Install [GitHub Desktop](https://desktop.github.com) (includes git) and [Node.js LTS](https://nodejs.org).
2. Get added as a collaborator on github.com/kammaash/MSC-Website; clone it with GitHub Desktop.
3. In Terminal, from the MSC-Website folder: `npm run setup` (the admin gives you the three Cloudinary values).

## Editing
1. In Terminal, from the MSC-Website folder: `npm run edit` — your browser opens the site in editing mode.
2. Click any outlined text to change it. Enter finishes, Escape cancels.
3. **News:** open a school page, use “+ Add” under News. **Photos/videos:** “+ Add” under Gallery, pick the file — it uploads and appears.
4. ↑ ↓ reorder items; ✕ deletes (asks first).
5. Press **Publish**. The live site updates in about a minute. **Discard** throws away unsaved changes.

## If something goes wrong
- “Publish failed … sync” — someone else edited at the same time. Ask the admin; nothing is lost.
- Made a mistake that’s live? Tell the admin — every publish can be undone with one click on GitHub.
- Videos currently upload to Cloudinary. YouTube publishing arrives once Google approves the API audit.
```

- [ ] **Step 3: Final E2E pass (no push)**

1. `npm test` → all suites + check-paths PASS.
2. Fresh-eyes run of docs/EDITING.md's Editing section end-to-end on `EDITOR_NO_PUSH=1 npm run edit`: text edit on every one of the five pages (including a subpage route like `acamp-subpage.html#core-values`), one news add+reorder, one photo upload, one video upload, Publish once → single commit touching only content files. Revert: `git reset --hard HEAD~1`.
3. Serve with `python3 -m http.server 8899` (no editor): pages render with all published content, zero editor scripts in view-source, console clean — confirms the deployed site is inert.
4. Mobile spot-check at 390px width (breakpoints doc'd in README): news/gallery grids collapse to one column via the reused `.g-3` class.

- [ ] **Step 4: Commit (local only)**

```bash
git add editor/setup.js docs/EDITING.md
git commit -m "feat(editor): collaborator setup script and editing guide"
```

---

## Deferred follow-ups (explicitly NOT in this plan)

- Pushing/merging the `editor` branch — the user decides when this goes live.
- YouTube `videos.insert` implementation + Brand Account setup (blocked on Google compliance audit; stub and docs in place).
- Editable images outside galleries (school-card photos, facility icons, hero image).
- Enquiry-form endpoint (README pre-existing TODO — unrelated to the editor).
- Port to KNE-Website (user will supply the repo; re-apply Tasks 4–6 conventions there after judging Phase 1 here).
