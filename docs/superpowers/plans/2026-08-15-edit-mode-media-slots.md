# Edit-Mode Media Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In edit mode, disable the site's custom cursor and make designated media components selectable — click or drag-and-drop from the media drawer to replace a photo/video, with media only ever landing in designated slots.

**Architecture:** Elements opt in with `data-media-slot="<content path>"`; the path names a plain string URL in the page's CONTENT block (or `shared:` content). Placing media writes that one string through the existing draft → /api/save pipeline, so structure/styling cannot change. A new UMD lib (`media-urls.js`) is the single authority for Cloudinary URLs; a new client file (`media-slots.js`) owns selection/drop chrome; `media.js` gains a pick mode and draggable tiles.

**Tech Stack:** Plain Node ≥22 (zero dependencies), vanilla JS client files injected by `editor/server.js`, `node --test` suites.

**Spec:** `docs/superpowers/specs/2026-08-15-edit-mode-media-slots-design.md`

## Global Constraints

- Zero npm dependencies; Node >= 22 (`package.json` engines).
- Every client `/api/*` call goes through `EditorUI.apiFetch` (token discipline); calls to Cloudinary must NEVER go through it.
- Record data (filenames, captions) reaches the DOM via `textContent`/`createElement`, never `innerHTML`.
- Apply-before-record invariant: mutate in-memory content first (throws → abort), only then `draft.set(...)` — an op must never enter the draft log if the local apply failed.
- All tests green after every task: `npm test` (206+ tests, plus `editor/check-paths.js`).
- Test style: server behavior via real HTTP against `createServer` on a tmp root; browser-only files via source-level assertions (see `editor/test/editor-client.test.js`).
- Editor scripts run before DOMContentLoaded (injected before `</body>`); cursor.js boots ON DOMContentLoaded and registered its listener earlier in parse order, so a listener registered by editor code fires after cursor.js's boot.

---

### Task 1: Native cursor in edit mode

**Files:**
- Modify: `editor/client/editor-client.js` (near `let editing = true;` at ~line 36, and the `#ed-exit` handler at ~line 303)
- Test: `editor/test/editor-client.test.js` (append)

**Interfaces:**
- Consumes: `window.MonteCursor` (`cursor.js`: `.apply(type)` switches without persisting, `.get()` reads the saved preference).
- Produces: `setEditingCursor(editingNow)` inside the editor-client IIFE (not exported; later tasks don't call it).

- [ ] **Step 1: Write the failing test** — append to `editor/test/editor-client.test.js`:

```js
test("edit mode hands back the native cursor; Exit/Resume toggles it (Task: media slots)", () => {
  // cursor.js hides the native pointer and draws a pen that yields only over its own
  // fixed selector list — data-edit/data-media-slot elements aren't in it, so while
  // editing it fights the editor. The editor must switch to "Native" via apply()
  // (NEVER set(), which would overwrite the visitor-facing localStorage preference).
  const block = extractBlockAfter(SRC, "function setEditingCursor(");
  assert.match(block, /if \(!window\.MonteCursor\) return/);
  assert.match(block, /MonteCursor\.apply\(/);
  assert.ok(!/MonteCursor\.set\(/.test(SRC), "must never call MonteCursor.set()");
  // cursor.js boots on DOMContentLoaded (its listener registered earlier in parse
  // order), so the editor registers its own DOMContentLoaded listener — which then
  // fires after the pen has booted, and the Native override lands last.
  assert.match(SRC, /addEventListener\("DOMContentLoaded", function \(\) \{ setEditingCursor\(/);
  const exit = extractBlockAfter(SRC, '#ed-exit").onclick');
  assert.match(exit, /setEditingCursor\(editing\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test editor/test/editor-client.test.js`
Expected: FAIL with "marker not found: function setEditingCursor("

- [ ] **Step 3: Write minimal implementation** — in `editor-client.js`, directly after `let editing = true;`:

```js
  // The site's custom cursor (cursor.js) hides the native pointer and draws a pen
  // that only yields over its own fixed selector list — editable elements aren't in
  // it, so while editing it actively fights the editor (no I-beam over fields, ink
  // strokes over drop targets). While editing, hand back the native cursor. apply(),
  // never set(): the visitor-facing preference in localStorage must survive editing.
  function setEditingCursor(editingNow) {
    if (!window.MonteCursor) return; // page without cursor.js
    window.MonteCursor.apply(editingNow ? "Native" : window.MonteCursor.get());
  }
  // cursor.js boots on DOMContentLoaded and its listener was registered earlier in
  // parse order (it loads in the page's own markup; this file is injected before
  // </body>), so this listener fires AFTER the pen boots — Native lands last. If the
  // document is somehow already parsed, MonteCursor exists now and is applied now.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setEditingCursor(editing); });
  } else {
    setEditingCursor(true);
  }
```

And in the `#ed-exit` onclick handler, after `bar.querySelector("#ed-exit").textContent = editing ? "Exit" : "Resume";` add:

```js
    setEditingCursor(editing); // Resume brings Native back; Exit restores the visitor's cursor
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test editor/test/editor-client.test.js`
Expected: PASS (all tests in the file — the existing bare-`fetch(`-count and apiFetch-count tests must still pass).

- [ ] **Step 5: Commit**

```bash
git add editor/client/editor-client.js editor/test/editor-client.test.js
git commit -m "feat(editor): hand back the native cursor while editing"
```

---

### Task 2: media-urls.js — one authority for Cloudinary URLs

**Files:**
- Create: `editor/lib/media-urls.js`
- Test: `editor/test/media-urls.test.js`

**Interfaces:**
- Produces: `deliveryUrl(cloudName, record)` and `posterUrl(cloudName, record)` — `record` is a media.json record (`{id, kind, ...}`). UMD: `module.exports` in node, `window.EditorMediaUrls` in the browser (exact pattern of `editor/lib/paths.js`). Tasks 4 and 5 call these.

- [ ] **Step 1: Write the failing tests** — create `editor/test/media-urls.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { deliveryUrl, posterUrl } = require("../lib/media-urls.js");

// The URL shapes are pinned to the convention the site already renders with —
// montessori-vidyanagar.html's gallery mapping (~line 815-824). If these change,
// change them there too.
test("deliveryUrl for an image uses f_auto,q_auto,w_1600 under /image/upload", () => {
  assert.equal(
    deliveryUrl("demo-cloud", { id: "msc/photo-1", kind: "image" }),
    "https://res.cloudinary.com/demo-cloud/image/upload/f_auto,q_auto,w_1600/msc/photo-1"
  );
});

test("deliveryUrl for a video uses q_auto under /video/upload with an .mp4 extension", () => {
  assert.equal(
    deliveryUrl("demo-cloud", { id: "msc/clip-1", kind: "video" }),
    "https://res.cloudinary.com/demo-cloud/video/upload/q_auto/msc/clip-1.mp4"
  );
});

test("posterUrl derives the first-frame jpg exactly like the vidyanagar gallery does", () => {
  assert.equal(
    posterUrl("demo-cloud", { id: "msc/clip-1", kind: "video" }),
    "https://res.cloudinary.com/demo-cloud/video/upload/so_0,f_jpg,q_auto,w_800/msc/clip-1.jpg"
  );
});

test("public_id slashes survive but URL-hostile characters are escaped", () => {
  // encodeURI keeps "/" (public_ids are folder-scoped) but escapes spaces etc.
  assert.match(deliveryUrl("c", { id: "a b/c", kind: "image" }), /\/a%20b\/c$/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test editor/test/media-urls.test.js`
Expected: FAIL with "Cannot find module '../lib/media-urls.js'"

- [ ] **Step 3: Write minimal implementation** — create `editor/lib/media-urls.js`:

```js
(function (exports) {
  "use strict";
  // The ONE place a Cloudinary delivery URL is derived from a media.json record.
  // Shapes are pinned to what the site already renders with (see the gallery
  // mapping in montessori-vidyanagar.html): change them together or not at all.
  // encodeURI, not encodeURIComponent: public_ids are folder-scoped ("msc/x") and
  // the slash must survive into the URL path.
  function deliveryUrl(cloudName, record) {
    var cdn = "https://res.cloudinary.com/" + cloudName;
    if (record.kind === "video") return cdn + "/video/upload/q_auto/" + encodeURI(record.id) + ".mp4";
    return cdn + "/image/upload/f_auto,q_auto,w_1600/" + encodeURI(record.id);
  }
  function posterUrl(cloudName, record) {
    return "https://res.cloudinary.com/" + cloudName + "/video/upload/so_0,f_jpg,q_auto,w_800/" + encodeURI(record.id) + ".jpg";
  }
  Object.assign(exports, { deliveryUrl, posterUrl });
})(typeof module !== "undefined" ? module.exports : (window.EditorMediaUrls = {}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test editor/test/media-urls.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add editor/lib/media-urls.js editor/test/media-urls.test.js
git commit -m "feat(editor): media-urls lib — one authority for Cloudinary delivery URLs"
```

---

### Task 3: check-paths validates media-slot paths

**Files:**
- Modify: `editor/check-paths.js` (the `matchAll` regex at ~line 73 and the string-type check at ~line 89)
- Test: `editor/test/check-paths.test.js` (append)

**Interfaces:**
- Consumes: nothing new. Produces: `checkPaths` now also validates static `data-media-slot`/`data-media-poster` attributes — Tasks 6–8 (page migrations) rely on it to catch typos.

- [ ] **Step 1: Read the existing test file** (`editor/test/check-paths.test.js`) to reuse its tmp-page fixture helper. Then append tests (adapt the fixture helper names to what's actually there):

```js
test("a data-media-slot path that resolves to a string passes; an unresolved one fails", () => {
  const root = tmpRootWithPage("index.html", `<img data-media-slot="hero.photo">
/* CONTENT:BEGIN */
const CONTENT = { "hero": { "photo": "" } };
/* CONTENT:END */`);
  assert.deepEqual(checkPaths(root, ["index.html"]).errors, []);

  const bad = tmpRootWithPage("index.html", `<img data-media-slot="hero.photoo">
/* CONTENT:BEGIN */
const CONTENT = { "hero": { "photo": "" } };
/* CONTENT:END */`);
  assert.equal(checkPaths(bad, ["index.html"]).errors.length, 1);
  assert.match(checkPaths(bad, ["index.html"]).errors[0], /hero\.photoo/);
});

test("a data-media-slot path resolving to a non-string is an error (same discipline as data-edit)", () => {
  const root = tmpRootWithPage("index.html", `<img data-media-slot="hero">
/* CONTENT:BEGIN */
const CONTENT = { "hero": { "photo": "" } };
/* CONTENT:END */`);
  const { errors } = checkPaths(root, ["index.html"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must name a text value/);
});

test("an interpolated data-media-slot (gallery items) is skipped, like data-edit", () => {
  const root = tmpRootWithPage("index.html", `<img data-media-slot="{{ ph.p }}.src">
/* CONTENT:BEGIN */
const CONTENT = { "hero": { "photo": "" } };
/* CONTENT:END */`);
  assert.deepEqual(checkPaths(root, ["index.html"]).errors, []);
});
```

If `check-paths.test.js` has no page-fixture helper, write one at the top of the appended block:

```js
function tmpRootWithPage(name, src) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "msc-cp-media-"));
  fs.writeFileSync(path.join(root, name), src);
  return root;
}
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test editor/test/check-paths.test.js`
Expected: the three new tests FAIL (the regex doesn't match `data-media-slot`, so `errors` is empty where a failure is expected / `checked` never increments).

- [ ] **Step 3: Implement** — in `editor/check-paths.js` change the loop:

```js
    for (const m of stripComments(src).matchAll(/data-(edit|list|media-slot|media-poster)="([^"{]+)"/g)) {
```

and extend the string-value rule (media paths name URL strings, exactly like data-edit names text):

```js
      if ((attr === "edit" || attr === "media-slot" || attr === "media-poster") && typeof value !== "string") {
        errors.push(`${page}: ${raw} resolves to ${describe(value)}, but data-${attr} must name a text value`);
      }
```

(This replaces the existing `if (attr === "edit" && ...)` block.)

- [ ] **Step 4: Run tests + the real checker**

Run: `node --test editor/test/check-paths.test.js && node editor/check-paths.js`
Expected: PASS, and the real run still reports all paths resolve (no pages annotated yet).

- [ ] **Step 5: Commit**

```bash
git add editor/check-paths.js editor/test/check-paths.test.js
git commit -m "feat(editor): check-paths validates data-media-slot/poster paths"
```

---

### Task 4: media.js — pick mode and draggable tiles

**Files:**
- Modify: `editor/client/media.js`
- Test: `editor/test/media-client.test.js` (append)

**Interfaces:**
- Consumes: existing internals of media.js (`records`, `cloudName`, `tab`, `render()`, `setOpen(v)`, `apiFetch`).
- Produces (Task 5 consumes): `window.EditorMedia = { openPicker(kind, onPick) }` — opens the drawer on the right tab in pick mode; when the user clicks a tile, calls `onPick(record, cloudName)` and exits pick mode. Tiles get `draggable=true`; dragstart sets dataTransfer type `"application/x-msc-media-" + record.kind` with payload `JSON.stringify({ record, cloudName })` and adds `ed-dragging-image`/`ed-dragging-video` to `document.body`; dragend removes it.

- [ ] **Step 1: Write the failing tests** — append to `editor/test/media-client.test.js`:

```js
test("media.js exposes EditorMedia.openPicker and exits pick mode on close", () => {
  assert.match(SRC, /window\.EditorMedia = \{ openPicker: openPicker \}/);
  const close = extractBlockAfter(SRC, "function setOpen(");
  assert.match(close, /pick = null/); // closing the drawer always cancels pick mode
});

test("tiles are draggable and the dataTransfer payload carries record + cloudName under a kind-scoped type", () => {
  assert.match(SRC, /tile\.draggable = true/);
  assert.match(SRC, /"application\/x-msc-media-" \+ rec\.kind/);
  assert.match(SRC, /JSON\.stringify\(\{ record: rec, cloudName: cloudName \}\)/);
  // dragstart advertises the drag kind on <body> so media-slots.js can light up
  // matching slots from CSS alone; dragend must always clean it up.
  assert.match(SRC, /body\.classList\.add\("ed-dragging-" \+ rec\.kind\)/);
  assert.match(SRC, /body\.classList\.remove\("ed-dragging-image", "ed-dragging-video"\)/);
});
```

Also update the top-of-file comment expectation if the apiFetch-count test needs it — pick mode adds NO new /api/ calls, so `expected exactly 4 apiFetch(...)` must still hold. Copy `extractBlockAfter` from `editor-client.test.js` into `media-client.test.js` if it isn't already there (it isn't — the file currently has no block extraction):

```js
function extractBlockAfter(src, marker) {
  const markerIdx = src.indexOf(marker);
  assert.notEqual(markerIdx, -1, "marker not found: " + marker);
  const braceOpen = src.indexOf("{", markerIdx);
  let depth = 0;
  for (let i = braceOpen; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(markerIdx, i + 1); }
  }
  throw new Error("unbalanced braces scanning from marker: " + marker);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test editor/test/media-client.test.js`
Expected: the two new tests FAIL ("marker not found" / regex mismatch); all previous ones PASS.

- [ ] **Step 3: Implement in `media.js`** —

3a. Add pick state next to the other state vars:

```js
  var pick = null; // { kind, onPick } while choosing media for a slot; null otherwise
```

3b. Add a pick banner element to the drawer's static innerHTML, after the `.ed-tools` div:

```html
'<div class="ed-pickbar" hidden>Click a tile to place it in the selected spot — or close to cancel.</div>' +
```

with CSS in the drawer's `<style>` block:

```css
#ed-media .ed-pickbar{margin:0 12px 10px;padding:8px 10px;border-radius:8px;background:#e8541b;font-weight:600}
```

3c. `openPicker` + export (place after `setOpen`; note `setOpen` must clear pick — see 3e):

```js
  function openPicker(kind, onPick) {
    pick = { kind: kind, onPick: onPick };
    tab = kind;
    drawer.querySelector(".ed-pickbar").hidden = false;
    if (!open) setOpenInner(true); else { render(); refresh(); }
  }
  window.EditorMedia = { openPicker: openPicker };
```

Where `setOpenInner` is the current `setOpen` body renamed, and the public `setOpen` wraps it:

```js
  function setOpen(v) {
    pick = null; // opening normally or closing always cancels pick mode
    drawer.querySelector(".ed-pickbar").hidden = true;
    setOpenInner(v);
  }
```

(`mediaBtn.onclick` and the ✕ button keep calling `setOpen`, so both cancel picking.)

3d. In `render()`'s tile loop, make tiles clickable-in-pick-mode and draggable — insert before `grid.appendChild(tile)`:

```js
      tile.draggable = true;
      tile.style.cursor = "grab";
      tile.ondragstart = function (e) {
        e.dataTransfer.setData("application/x-msc-media-" + rec.kind, JSON.stringify({ record: rec, cloudName: cloudName }));
        e.dataTransfer.effectAllowed = "copy";
        document.body.classList.add("ed-dragging-" + rec.kind);
      };
      tile.ondragend = function () {
        document.body.classList.remove("ed-dragging-image", "ed-dragging-video");
      };
      tile.onclick = function () {
        if (!pick) return;
        if (rec.kind !== pick.kind) return; // wrong tab clicked mid-pick; tabs already filter
        var cb = pick.onPick;
        setOpen(false); // clears pick + hides banner
        cb(rec, cloudName);
      };
```

3e. IMPORTANT rename detail: the existing `setOpen` references (`mediaBtn.onclick`, close button, and `refresh` inside it) — rename the existing function to `setOpenInner`, add the new wrapper `setOpen`, and leave every existing call site alone.

- [ ] **Step 4: Run the client tests**

Run: `node --test editor/test/media-client.test.js editor/test/editor-client.test.js`
Expected: ALL PASS (including the pinned "exactly 4 apiFetch call sites" and "exactly 1 bare fetch" tests — pick/drag adds no network calls).

- [ ] **Step 5: Commit**

```bash
git add editor/client/media.js editor/test/media-client.test.js
git commit -m "feat(editor): media drawer pick mode + draggable tiles"
```

---

### Task 5: media-slots.js — selection, empty marking, drop targets; inject it

**Files:**
- Create: `editor/client/media-slots.js`
- Modify: `editor/client/editor-client.js` (add `getLocal` to the EditorUI export)
- Modify: `editor/server.js` (INJECT: add media-urls.js after paths.js, media-slots.js last)
- Modify: `editor/test/server.test.js` (injection regex), `editor/test/secrets-location.test.js` (title + regex)
- Test: create `editor/test/media-slots.test.js`

**Interfaces:**
- Consumes: `EditorUI.{applyLocal, getLocal, draft, rerender, update, isEditing}`, `window.EditorMedia.openPicker(kind, onPick)` (Task 4), `window.EditorMediaUrls.{deliveryUrl, posterUrl}` (Task 2).
- Produces: behavior only (no API other tasks consume). Slot contract consumed by page markup (Tasks 6–8): `data-media-slot`, `data-media-kind`, optional `data-media-poster`.

- [ ] **Step 1: Write the failing tests** — create `editor/test/media-slots.test.js`:

```js
"use strict";
// media-slots.js only runs in a browser; source-level checks, same approach as
// editor-client.test.js / media-client.test.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const FILE = path.join(__dirname, "..", "client", "media-slots.js");
const SRC = fs.readFileSync(FILE, "utf8");

test("media-slots.js is syntactically valid", () => {
  execFileSync(process.execPath, ["--check", FILE]);
});

test("bails without EditorUI, EditorMedia, and EditorMediaUrls", () => {
  assert.match(SRC, /if \(!window\.EditorUI \|\| !window\.EditorMedia \|\| !window\.EditorMediaUrls\) return;/);
});

test("no network calls at all — placement is a pure content write", () => {
  assert.deepEqual(SRC.match(/[^a-zA-Z.]fetch\(/g) || [], []);
  assert.deepEqual(SRC.match(/apiFetch/g) || [], []);
});

test("apply-before-record: applyLocal runs inside try, draft.set only after", () => {
  const apply = SRC.slice(SRC.indexOf("function applyToSlot"));
  const applyLocalIdx = apply.indexOf("UI.applyLocal(");
  const draftSetIdx = apply.indexOf("UI.draft.set(");
  assert.ok(applyLocalIdx !== -1 && draftSetIdx !== -1 && applyLocalIdx < draftSetIdx,
    "applyLocal must run (and be able to throw) before draft.set records the op");
});

test("kind mismatch is refused before any mutation", () => {
  assert.match(SRC, /record\.kind !== kind/);
});

test("media uploads count as publishable disk state via markSavedToDisk — never here; placement is a draft op", () => {
  // Placement goes through draft.set (a pending op), NOT markSavedToDisk (which is
  // for server-side writes like the upload itself). Guard against confusing the two.
  assert.ok(!/markSavedToDisk/.test(SRC), "media-slots must not touch markSavedToDisk");
});

test("editing gate: pointer handlers check EditorUI.isEditing()", () => {
  assert.match(SRC, /UI\.isEditing\(\)/);
});

test("record data never reaches innerHTML", () => {
  for (const m of SRC.match(/\.innerHTML\s*=\s*[^;]+;/g) || []) {
    assert.ok(!/\$\{/.test(m) && !/\brec\b|\brecord\b/.test(m), "innerHTML with data: " + m);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test editor/test/media-slots.test.js`
Expected: FAIL — ENOENT reading media-slots.js.

- [ ] **Step 3: Create `editor/client/media-slots.js`:**

```js
(function () {
  "use strict";
  // Selection + drag-and-drop for media slots. A slot is an element carrying
  // data-media-slot="<content path>" (+ data-media-kind, optional data-media-poster).
  // Placing media ONLY writes URL strings at those paths through the same draft
  // pipeline as text edits — it can never create or move elements, which is the
  // whole "structure and styling stay intact" guarantee.
  if (!window.EditorUI || !window.EditorMedia || !window.EditorMediaUrls) return;
  var UI = window.EditorUI;
  var URLS = window.EditorMediaUrls;

  var style = document.createElement("style");
  style.textContent =
    ".ed-slot-hover{outline:2px dashed #e8541b!important;outline-offset:2px;cursor:pointer!important}" +
    ".ed-slot-selected{outline:3px solid #e8541b!important;outline-offset:2px}" +
    ".ed-media-empty{outline:2px dashed #c2410f!important;outline-offset:-2px}" +
    // While a tile of a given kind is dragged, every matching slot lights up: this
    // highlight IS the contract of where media may land.
    "body.ed-dragging-image [data-media-kind=image],body.ed-dragging-video [data-media-kind=video]" +
    "{outline:3px dashed #e8541b!important;outline-offset:2px}" +
    ".ed-slot-dragover{outline-style:solid!important}";
  document.head.appendChild(style);

  var selected = null;
  function clearSelection() {
    if (selected) selected.classList.remove("ed-slot-selected");
    selected = null;
  }

  function applyToSlot(slotEl, record, cloudName) {
    var path = slotEl.getAttribute("data-media-slot");
    var kind = slotEl.getAttribute("data-media-kind");
    if (record.kind !== kind) {
      alert("That spot takes a " + kind + ", not a " + record.kind + ".");
      return;
    }
    var url = URLS.deliveryUrl(cloudName, record);
    var posterPath = slotEl.getAttribute("data-media-poster");
    try {
      // Apply first, record only on success — the same invariant as every other
      // editor mutation (see editor-client.js's doOp): a failed apply must never
      // leave an op in the draft log.
      UI.applyLocal(path, url);
      if (posterPath) UI.applyLocal(posterPath, URLS.posterUrl(cloudName, record));
    } catch (err) {
      alert("Can't place media here:\n" + err.message);
      return;
    }
    UI.draft.set(path, url);
    if (posterPath) UI.draft.set(posterPath, URLS.posterUrl(cloudName, record));
    clearSelection();
    UI.rerender(); UI.update();
    // A <video> whose src attribute just changed keeps playing the old source until
    // load() is called; the element may be replaced by the rerender, so find it
    // fresh. rAF usually lands after React's commit; the marking observer below
    // converges the empty-state classes either way (same reasoning as doOp's rAF).
    requestAnimationFrame(function () {
      document.querySelectorAll('video[data-media-slot]').forEach(function (v) {
        if (v.getAttribute("data-media-slot") === path) v.load();
      });
      markEmpties();
    });
  }

  // Dashed marking for slots whose content value is currently "" — they read as
  // "drop media here" instead of invisible. Interpolated (per-item gallery) slots
  // always have a value, so unresolved getLocal is treated as non-empty.
  function markEmpties() {
    document.querySelectorAll("[data-media-slot]").forEach(function (el) {
      var v;
      try { v = UI.getLocal(el.getAttribute("data-media-slot")); } catch (e) { v = null; }
      el.classList.toggle("ed-media-empty", UI.isEditing() && v === "");
    });
  }

  // ---- hover + click select (delegated, editing-gated) ----
  document.body.addEventListener("mouseover", function (e) {
    if (!UI.isEditing()) return;
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    if (el) el.classList.add("ed-slot-hover");
  });
  document.body.addEventListener("mouseout", function (e) {
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    if (el) el.classList.remove("ed-slot-hover");
  });
  document.body.addEventListener("click", function (e) {
    if (!UI.isEditing()) return;
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    if (!el) { clearSelection(); return; }
    e.preventDefault(); e.stopPropagation();
    clearSelection();
    selected = el;
    el.classList.add("ed-slot-selected");
    var kind = el.getAttribute("data-media-kind");
    window.EditorMedia.openPicker(kind, function (record, cloudName) {
      // The rerender inside applyToSlot may replace the element; re-find it by path
      // so the write targets the slot as it exists NOW.
      var path = el.getAttribute("data-media-slot");
      var live = document.querySelector('[data-media-slot="' + path.replace(/"/g, '\\"') + '"]') || el;
      applyToSlot(live, record, cloudName);
    });
  }, true);

  // ---- drag and drop ----
  function dragPayload(e) {
    var kinds = ["image", "video"];
    for (var i = 0; i < kinds.length; i++) {
      if (Array.prototype.indexOf.call(e.dataTransfer.types, "application/x-msc-media-" + kinds[i]) !== -1) return kinds[i];
    }
    return null;
  }
  document.body.addEventListener("dragover", function (e) {
    if (!UI.isEditing()) return;
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    var kind = dragPayload(e);
    if (!el || !kind || el.getAttribute("data-media-kind") !== kind) return;
    e.preventDefault(); // this is what makes the slot a legal drop target — nothing else is
    e.dataTransfer.dropEffect = "copy";
    el.classList.add("ed-slot-dragover");
  });
  document.body.addEventListener("dragleave", function (e) {
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    if (el) el.classList.remove("ed-slot-dragover");
  });
  document.body.addEventListener("drop", function (e) {
    if (!UI.isEditing()) return;
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    var kind = dragPayload(e);
    if (!el || !kind || el.getAttribute("data-media-kind") !== kind) return;
    e.preventDefault();
    el.classList.remove("ed-slot-dragover");
    var payload;
    try { payload = JSON.parse(e.dataTransfer.getData("application/x-msc-media-" + kind)); } catch (err) { payload = null; }
    if (!payload || !payload.record) return;
    applyToSlot(el, payload.record, payload.cloudName);
  });

  // Keep empty-marking honest across rerenders and Exit/Resume: piggyback on DOM
  // mutations the same way editor-client.js's observer does, debounced.
  var moT;
  new MutationObserver(function () {
    clearTimeout(moT);
    moT = setTimeout(markEmpties, 150);
  }).observe(document.body, { childList: true, subtree: true });
  markEmpties();
})();
```

- [ ] **Step 4: Add `getLocal` to editor-client.js** — extend the helpers next to `applyLocal`:

```js
  function getLocal(path) {
    const [obj, p] = targetFor(path);
    return P.getPath(obj, p);
  }
```

and add `getLocal` to the `window.EditorUI = { ... }` export line.

- [ ] **Step 5: Inject the two new files** — in `editor/server.js` replace the INJECT constant:

```js
const INJECT = '<script src="/editor/lib/paths.js"></script>' +
  '<script src="/editor/lib/media-urls.js"></script>' +
  '<script src="/editor/client/draft.js"></script>' +
  '<script src="/editor/client/editor-client.js"></script>' +
  '<script src="/editor/client/media.js"></script>' + // after editor-client.js — needs window.EditorUI
  '<script src="/editor/client/media-slots.js"></script>'; // last — needs EditorUI, EditorMedia, EditorMediaUrls
```

- [ ] **Step 6: Update the two injected-page assertions**
  - `editor/test/server.test.js` (~line 28): the regex becomes

    ```js
    assert.match(text, /editor-client\.js"><\/script><script src="\/editor\/client\/media\.js"><\/script><script src="\/editor\/client\/media-slots\.js"><\/script><\/body>/);
    ```

    and (~line 31) the token/paths regex becomes

    ```js
    assert.match(text, /window\.__EDITOR_TOKEN=".+?";<\/script><script src="\/editor\/lib\/paths\.js"><\/script><script src="\/editor\/lib\/media-urls\.js">/);
    ```

  - `editor/test/secrets-location.test.js` (~line 287): title says "six script tags", regex becomes

    ```js
    assert.match(html, /window\.__EDITOR_TOKEN="[^"]+";<\/script><script src="\/editor\/lib\/paths\.js"><\/script><script src="\/editor\/lib\/media-urls\.js"><\/script><script src="\/editor\/client\/draft\.js"><\/script><script src="\/editor\/client\/editor-client\.js"><\/script><script src="\/editor\/client\/media\.js"><\/script><script src="\/editor\/client\/media-slots\.js"><\/script><\/body>/);
    ```

  - `editor/test/media-client.test.js`: the injection-order test's expectations still hold (media.js after editor-client.js) — no change needed.
  - Fixture lib lists: add `"media-urls.js"` to `REAL_LIB_FILES` in `editor/test/symlinked-editor-dir.test.js` and `editor/test/secrets-boot-message.test.js`, and to `LIB_FILES` in `editor/test/secrets-location.test.js` — these fixtures copy the lib files server.js's tree needs into tmp checkouts, and the media-db.js precedent (added there when Task "media library" shipped) is the pattern to follow. server.js does not `require()` media-urls.js, so a missed list won't crash boot — but the secrets-location positive control fetches injected pages whose script tags now name it, so keep all three lists complete.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: ALL PASS (media-slots tests, injection regexes, everything pre-existing).

- [ ] **Step 8: Commit**

```bash
git add editor/client/media-slots.js editor/client/editor-client.js editor/server.js editor/test/media-slots.test.js editor/test/server.test.js editor/test/secrets-location.test.js
git commit -m "feat(editor): media-slots client — select, empty marking, drag-and-drop"
```

---

### Task 6: index.html — hero portrait becomes a slot

**Files:**
- Modify: `index.html` (portrait `<img>` at ~line 258; CONTENT `"hero"` object at ~line 500; the component's computed vals)

**Interfaces:**
- Consumes: the slot contract (Task 5) and check-paths validation (Task 3). Produces: `CONTENT.hero.photo` (string, `""` = empty).

- [ ] **Step 1: Add the content key** — in index.html's CONTENT block, add to the `"hero"` object (after its last existing key):

```json
    "photo": ""
```

- [ ] **Step 2: Map the empty sentinel in the component's vals** — find the component's render-vals return (search for where `hero` is passed to the template — e.g. `renderVals` / the object return near the bottom script). Add:

```js
      // "" means "no photo chosen yet": render the same 1x1 transparent GIF the
      // markup used to hard-code, so an empty slot looks exactly as before.
      heroPhotoSrc: CONTENT.hero.photo ||
        "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
```

(If the page passes `hero` straight through without computed vals, add `heroPhotoSrc` beside wherever `{{ hero.* }}` values are provided — read the page's dc-script to find the exact spot; it follows the same shape as montessori-acamp.html's `return { ... }` vals object.)

- [ ] **Step 3: Annotate the img** — replace (at ~line 258):

```html
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="Montessori School Committee students" style="width:100%;height:100%;object-fit:cover" loading="lazy">
```

with:

```html
        <img src="{{ heroPhotoSrc }}" data-media-slot="hero.photo" data-media-kind="image" alt="Montessori School Committee students" style="width:100%;height:100%;object-fit:cover" loading="lazy">
```

- [ ] **Step 4: Verify**

Run: `node editor/check-paths.js && npm test`
Expected: check-paths reports the new path resolves; suite green.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(content): index hero portrait is a media slot"
```

---

### Task 7: montessori-acamp.html — hero, founder, showcase video, gallery slots

**Files:**
- Modify: `montessori-acamp.html` (hero img ~line 282, founder img ~line 326, video ~line 409-411, gallery img ~line 530, CONTENT `"hero"`/`"founder"` objects ~line 716-730, vals return ~line 1037)

**Interfaces:**
- Produces: `CONTENT.hero.photo`, `CONTENT.founder.photo`, `CONTENT.showcase = { "video": ..., "poster": ... }`; gallery slots ride the existing `ph.p` stamping.

- [ ] **Step 1: CONTENT additions**
  - `"hero"` object: add `"photo": "assets/gallery/campus-2.jpg"`
  - `"founder"` object: add `"photo": "assets/people/founder.jpg"`
  - New top-level key after `"founder"`:

```json
  "showcase": {
    "video": "http://www.montessoritechnoschool.com/wp-content/uploads/2022/03/MONTESSORI-SCHOOL.mp4",
    "poster": "assets/gallery/campus-life.jpg"
  },
```

- [ ] **Step 2: Markup annotations**
  - Hero (~line 282):

```html
    <img src="{{ hero.photo }}" data-media-slot="hero.photo" data-media-kind="image" alt="Montessori School, A-Camp — students on the campus steps" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0" loading="lazy">
```

    (`hero` is already passed whole to the template — `{{ hero.quote }}` works on the same element's sibling — so `{{ hero.photo }}` needs no vals change; it is never empty on this page.)
  - Founder (~line 326):

```html
      <img src="{{ founder.photo }}" data-media-slot="founder.photo" data-media-kind="image" alt="{{ founder.name }}" style="width:100%;height:100%;object-fit:cover;display:block">
```

    Also update the section's HTML comment (~line 322) that says "the portrait itself is markup, since images are not editable text" — it now is editable via the media drawer.
  - Showcase video (~line 409-411) — switch from `<source>` child to a `src` attribute (the pattern the vidyanagar gallery already uses), so a re-render updates one attribute:

```html
      <video ref="{{ videoRef }}" controls playsinline muted src="{{ showcase.video }}" poster="{{ showcase.poster }}" data-media-slot="showcase.video" data-media-kind="video" data-media-poster="showcase.poster" style="width:100%;display:block;aspect-ratio:16/9;object-fit:cover"></video>
```

  - Gallery photo (~line 530) — the flip-card front image; `ph.p` is already stamped:

```html
                <div class="flip-f" style="border:1px solid #f0e0dc"><img src="{{ ph.src }}" data-media-slot="{{ ph.p }}.src" data-media-kind="image" alt="{{ ph.caption }}" style="width:100%;height:100%;object-fit:cover" loading="lazy"></div>
```

- [ ] **Step 3: Vals** — `showcase` must reach the template: in the vals return (~line 1037-1050), add `showcase: CONTENT.showcase,` beside the other content passthroughs (check how `hero`/`founder` reach the template on this page — if CONTENT objects are passed automatically, only mirror that mechanism).

- [ ] **Step 4: Verify**

Run: `node editor/check-paths.js && npm test`
Expected: all green — including page-content-fidelity.test.js, which round-trips the CONTENT block (run it specifically if the suite ordering hides it: `node --test editor/test/page-content-fidelity.test.js`).

- [ ] **Step 5: Commit**

```bash
git add montessori-acamp.html
git commit -m "feat(content): acamp hero, founder, showcase video and gallery are media slots"
```

---

### Task 8: montessori-vidyanagar.html — hero + empty showcase video

**Files:**
- Modify: `montessori-vidyanagar.html` (hero img ~line 271, video ~line 374, CONTENT `"hero"` ~line 644, vals return)

**Interfaces:**
- Produces: `CONTENT.hero.photo` (`""` = empty), `CONTENT.showcase = { "video": "", "poster": "" }`.

- [ ] **Step 1: CONTENT** — add `"photo": ""` to `"hero"`; add top-level:

```json
  "showcase": { "video": "", "poster": "" },
```

- [ ] **Step 2: Markup**
  - Hero (~line 271): same pattern as index —

```html
    <img src="{{ heroPhotoSrc }}" data-media-slot="hero.photo" data-media-kind="image" alt="Montessori School, Vidyanagar" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0" loading="lazy">
```

  - Video (~line 374; today it has no src at all and renders an empty black box — an empty-string src keeps that appearance, and the edit-mode dashed outline makes it discoverable):

```html
      <video ref="{{ videoRef }}" controls playsinline muted src="{{ showcase.video }}" poster="{{ showcase.poster }}" data-media-slot="showcase.video" data-media-kind="video" data-media-poster="showcase.poster" style="width:100%;display:block;aspect-ratio:16/9;object-fit:cover"></video>
```

- [ ] **Step 3: Vals** — in the component's vals return (same object that builds `gallery` at ~line 815): add

```js
      heroPhotoSrc: CONTENT.hero.photo ||
        "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
      showcase: CONTENT.showcase,
```

- [ ] **Step 4: Verify**

Run: `node editor/check-paths.js && npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add montessori-vidyanagar.html
git commit -m "feat(content): vidyanagar hero and showcase video are (empty) media slots"
```

---

### Task 9: Live smoke test

**Files:** none (verification only)

- [ ] **Step 1: Boot the editor** — `npm run edit` (or use the already-running instance; restart it to pick up server.js changes).
- [ ] **Step 2: Drive it** — on http://localhost:8899/montessori-acamp.html verify, in order:
  1. The pen cursor is GONE (native arrow); press Exit → pen returns; Resume → native again.
  2. Hovering the hero photo / founder photo / any gallery photo / the showcase video shows the dashed orange outline; logos and feature icons show nothing.
  3. Clicking the hero photo opens the drawer on Photos with the pick banner; clicking ✕ cancels (selection cleared).
  4. With at least one library record (uploads need `npm run setup`; if unconfigured, POST a fixture record with curl against `/api/media` using the page token pattern from the media-library smoke test), pick a tile → the hero image swaps and the bar counts 1 change (one `set` op; a video slot counts 2 — src and poster). Publish → the file's CONTENT block shows the Cloudinary URL.
  5. Drag a tile from the drawer over the page: matching slots light up; dropping on the founder photo swaps it; dropping on a paragraph does nothing.
  6. On http://localhost:8899/montessori-vidyanagar.html the empty hero and video slots show the dashed "empty" outline in edit mode and look unchanged outside it.
- [ ] **Step 3: Full suite one last time** — `npm test`. Expected: green.
- [ ] **Step 4: Report** — summarize what was verified; note that `media.json` placement URLs only render once `npm run setup` has configured a real cloudName.
