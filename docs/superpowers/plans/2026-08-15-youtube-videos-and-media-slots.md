# YouTube Videos + Edit-Mode Media Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution model:** dispatch each task to a fresh **Sonnet** subagent. Every task is
> self-contained (full code included; no task requires reading another task). If a task's
> subagent fails the same step twice, or reports that the codebase doesn't match the plan,
> STOP that task and escalate to the session (Fable) model to diagnose before re-dispatching.
> Tasks must run in order — later tasks call functions earlier tasks create.

> **Base state (verify before Task 1):** HEAD is `2222061` or a descendant. The old plan
> (`2026-08-15-edit-mode-media-slots.md`) executed through its Task 5: the cursor handoff
> (`aecda7d`), Cloudinary-flavored `media-urls.js` (`c7fd222`), check-paths slot validation
> (`743bf68`), drawer pick mode + drag (`001d0b1`), `media-slots.js` + injection
> (`5b08da0`), and a follow-up fix (`2222061`: slot clicks yield to interactive controls;
> transactional poster apply) are ALL SHIPPED. Its page-migration tasks
> (index/acamp/vidyanagar) did NOT run — this plan replaces them. If `git log` doesn't
> show those commits, or the three pages already contain `data-media-slot`, STOP and
> escalate.

**Goal:** All videos are YouTube-hosted (uploaded manually in YouTube Studio as Unlisted, registered in the editor by pasted link); images stay on Cloudinary; the already-shipped slot machinery switches its video half from Cloudinary to YouTube embeds; and the three main pages get their media slots.

**Architecture:** `media.json` records use `kind` as the provider: `kind:"image"` → `id` is a Cloudinary public_id, `kind:"video"` → `id` is an 11-char YouTube video ID. A new `POST /api/youtube/resolve` endpoint parses pasted URLs and validates them against YouTube's keyless oEmbed API (server-side, injectable fetch). `editor/lib/media-urls.js` stays the one authority turning a record into a delivery URL — its video branch becomes a YouTube embed URL and `posterUrl` dies. Pages render videos as `<iframe>` embeds; placing media writes one URL string through the existing draft → /api/save pipeline.

**Tech Stack:** Plain Node ≥22 (zero dependencies, global `fetch`), vanilla JS client files injected by `editor/server.js`, `node --test` suites.

**Spec:** `docs/superpowers/specs/2026-08-15-youtube-video-hosting-design.md` (amends `docs/superpowers/specs/2026-08-15-edit-mode-media-slots-design.md`)

## Global Constraints

- Zero npm dependencies; Node >= 22 (`package.json` engines).
- Every client `/api/*` call goes through `EditorUI.apiFetch` (token discipline); calls to Cloudinary must NEVER go through it; the client NEVER calls YouTube directly (only the server's oEmbed check, plus `<iframe>`/`<img>` tags the browser loads from markup).
- The server's ONLY outbound network call is `https://www.youtube.com/oembed?...` with a regex-validated video ID, behind the injectable `oembedFetch` option — tests must never touch the network.
- No Google API credentials or secrets exist anywhere in this feature. Automated YouTube API upload stays off (unaudited API projects get uploads locked to private — support.google.com/youtube/answer/7300965).
- Record data (filenames, titles, captions) reaches the DOM via `textContent`/`createElement`, never `innerHTML`.
- Apply-before-record invariant: mutate in-memory content first (throws → abort), only then `draft.set(...)` — an op must never enter the draft log if the local apply failed.
- All tests green after every task: `npm test` (runs `node --test "editor/test/*.test.js"` then `node editor/check-paths.js`).
- Test style: server behavior via real HTTP against `createServer` on a tmp root; browser-only files via source-level assertions (see `editor/test/editor-client.test.js`).
- YouTube embed URL shape everywhere: `https://www.youtube-nocookie.com/embed/<id>?rel=0`. Video thumbnail shape everywhere: `https://i.ytimg.com/vi/<id>/mqdefault.jpg`.
- check-paths' `data-media-poster` support (shipped in `743bf68`) stays even though no page will use the attribute — it's inert and removing it is churn.

---

### Task 1: `editor/lib/youtube.js` — parse and validate YouTube links

**Files:**
- Rewrite: `editor/lib/youtube.js` (currently a disabled-upload stub exporting `uploadVideo`)
- Rewrite: `editor/test/youtube.test.js` (currently tests the stub's throws)
- Modify: `editor/config.json` (drop the dead `"youtube"` key)

**Interfaces:**
- Produces: `parseVideoId(input) -> string|null` (accepts full URLs in any common form, schemeless URLs, or a bare 11-char ID; returns the ID or null) and `isVideoId(s) -> boolean` (`/^[A-Za-z0-9_-]{11}$/`). UMD: `module.exports` in node, `window.EditorYouTube` in the browser (same pattern as `editor/lib/paths.js`). Task 2 (media-db) and Task 3 (server) consume both.

- [ ] **Step 1: Write the failing tests** — replace the entire contents of `editor/test/youtube.test.js` with:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseVideoId, isVideoId } = require("../lib/youtube.js");

// Every URL shape an editor plausibly pastes. The 11-char ID grammar is YouTube's
// own (base64url alphabet); anything else must come back null, never a guess.
test("parseVideoId accepts every common YouTube URL form", () => {
  const ID = "dQw4w9WgXcQ";
  for (const input of [
    "https://www.youtube.com/watch?v=" + ID,
    "https://youtube.com/watch?v=" + ID + "&t=42s",
    "http://m.youtube.com/watch?v=" + ID,
    "https://youtu.be/" + ID,
    "https://youtu.be/" + ID + "?si=share-junk",
    "https://www.youtube.com/shorts/" + ID,
    "https://www.youtube.com/embed/" + ID,
    "https://www.youtube.com/live/" + ID,
    "https://www.youtube-nocookie.com/embed/" + ID + "?rel=0",
    "youtube.com/watch?v=" + ID,   // schemeless — people paste from the address bar
    "youtu.be/" + ID,
    ID,                             // a bare ID is fine too
    "  https://youtu.be/" + ID + "  ", // stray whitespace
  ]) {
    assert.equal(parseVideoId(input), ID, "failed on: " + input);
  }
});

test("parseVideoId rejects everything that is not a YouTube video link", () => {
  for (const input of [
    "https://vimeo.com/12345678",
    "https://example.com/watch?v=dQw4w9WgXcQ", // right shape, wrong site
    "https://www.youtube.com/@somechannel",
    "https://www.youtube.com/playlist?list=PL123",
    "not a url at all",
    "https://youtu.be/tooshort",
    "javascript:alert(1)",
    "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
    "",
    null,
    42,
  ]) {
    assert.equal(parseVideoId(input), null, "should reject: " + input);
  }
});

test("isVideoId is the strict 11-char grammar", () => {
  assert.equal(isVideoId("dQw4w9WgXcQ"), true);
  assert.equal(isVideoId("a_b-C0d1E2f"), true);
  assert.equal(isVideoId("dQw4w9WgXc"), false);   // 10 chars
  assert.equal(isVideoId("dQw4w9WgXcQQ"), false); // 12 chars
  assert.equal(isVideoId("dQw4w9WgXc!"), false);  // bad char
  assert.equal(isVideoId(""), false);
  assert.equal(isVideoId(null), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test editor/test/youtube.test.js`
Expected: FAIL — `parseVideoId` is not exported (the stub exports `uploadVideo`).

- [ ] **Step 3: Rewrite `editor/lib/youtube.js`:**

```js
(function (exports) {
  "use strict";
  // YouTube helpers for the paste-a-link flow. Videos are uploaded manually in
  // YouTube Studio (as Unlisted) and registered here by URL.
  //
  // Automated API upload stays OFF on purpose: Google locks videos uploaded via
  // videos.insert from unaudited API projects to private, with no appeal until a
  // compliance audit passes (support.google.com/youtube/answer/7300965) — private
  // videos cannot be embedded, so an automated upload would produce broken players.
  // Revisit only if the school ever passes that audit.
  var ID_RE = /^[A-Za-z0-9_-]{11}$/;

  function isVideoId(s) {
    return typeof s === "string" && ID_RE.test(s);
  }

  // Accepts: watch?v=, youtu.be/, shorts/, embed/, live/, /v/, the nocookie host,
  // schemeless copies of any of those, or a bare 11-char ID. Returns the ID or null —
  // never a guess: an ID we can't positively extract must not reach the library.
  function parseVideoId(input) {
    if (typeof input !== "string") return null;
    var s = input.trim();
    if (isVideoId(s)) return s;
    var url = null;
    try { url = new URL(s); } catch (e) { /* maybe schemeless */ }
    if (url === null) {
      try { url = new URL("https://" + s); } catch (e) { return null; }
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    var host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
    if (host === "youtu.be") {
      var seg = url.pathname.split("/")[1] || "";
      return isVideoId(seg) ? seg : null;
    }
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
    var v = url.searchParams.get("v");
    if (v !== null) return isVideoId(v) ? v : null;
    var m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
    if (m !== null && isVideoId(m[1])) return m[1];
    return null;
  }

  Object.assign(exports, { isVideoId, parseVideoId });
})(typeof module !== "undefined" ? module.exports : (window.EditorYouTube = {}));
```

- [ ] **Step 4: Drop the dead config key** — `editor/config.json` currently reads:

```json
{ "port": 8899, "push": true, "youtube": { "enabled": false } }
```

Replace with:

```json
{ "port": 8899, "push": true }
```

(Nothing reads `config.youtube` after this task — the old stub was its only consumer.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test editor/test/youtube.test.js && npm test`
Expected: youtube tests PASS; full suite green (nothing else imported the old stub).

- [ ] **Step 6: Commit**

```bash
git add editor/lib/youtube.js editor/test/youtube.test.js editor/config.json
git commit -m "feat(editor): youtube.js parses/validates video links; retire the upload stub"
```

---

### Task 2: media-db — a video record's id must be a YouTube ID

**Files:**
- Modify: `editor/lib/media-db.js` (require at top; `validateRecord` at ~line 54-71)
- Modify: `editor/test/symlinked-editor-dir.test.js`, `editor/test/secrets-boot-message.test.js`, `editor/test/secrets-location.test.js` (fixture lib lists)
- Test: `editor/test/media-db.test.js` (append)

**Interfaces:**
- Consumes: `isVideoId` from `editor/lib/youtube.js` (Task 1).
- Produces: `validateRecord` (existing export, stricter): `kind:"video"` now requires `id` to satisfy `isVideoId`. Tasks 3/5 rely on invalid video records being impossible to store.

- [ ] **Step 1: Write the failing test** — append to `editor/test/media-db.test.js` (reuse the file's existing imports; add `validateRecord` to its destructured require of `../lib/media-db.js` if it isn't already there):

```js
test("kind is the provider: a video id must be an 11-char YouTube id, images stay free-form", () => {
  validateRecord({ id: "dQw4w9WgXcQ", kind: "video" }); // must not throw
  assert.throws(() => validateRecord({ id: "msc/clip-1", kind: "video" }), /YouTube/);
  assert.throws(() => validateRecord({ id: "short", kind: "video" }), /YouTube/);
  validateRecord({ id: "msc/photo-1", kind: "image" }); // Cloudinary ids unaffected
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test editor/test/media-db.test.js`
Expected: the new test FAILS (validateRecord accepts `msc/clip-1` as a video id today).

- [ ] **Step 3: Implement** — in `editor/lib/media-db.js`, add below the existing requires (`fs`, `path`):

```js
const { isVideoId } = require("./youtube.js");
```

Update the schema comment at ~line 11-14 (it says "`id` is the Cloudinary public_id") to:

```js
// One authority for what a record may contain, patch.js-style: unknown keys are
// rejected outright so junk can never accumulate in a file that lives forever in git.
// `kind` is the provider: for "image", `id` is the Cloudinary public_id (cloudName +
// id derives every delivery/thumbnail URL); for "video", `id` is the 11-character
// YouTube video ID (videos are uploaded manually in YouTube Studio as Unlisted and
// registered by link — see lib/youtube.js for why the API upload route is off).
```

And in `validateRecord`, directly after the existing `KINDS.includes(record.kind)` check:

```js
  if (record.kind === "video" && !isVideoId(record.id)) {
    throw new Error("A video record's id must be an 11-character YouTube video ID (got: " + record.id + ")");
  }
```

- [ ] **Step 4: Add `youtube.js` to the fixture lib lists** — media-db.js now requires it, so every test fixture that copies lib files into a tmp checkout and loads server.js (which requires media-db) from there would crash with MODULE_NOT_FOUND without it:
  - `editor/test/symlinked-editor-dir.test.js` ~line 46: add `"youtube.js"` to `REAL_LIB_FILES`.
  - `editor/test/secrets-boot-message.test.js` ~line 29: add `"youtube.js"` to `REAL_LIB_FILES`.
  - `editor/test/secrets-location.test.js` ~line 47: add `"youtube.js"` to `LIB_FILES`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: ALL PASS — media-db and media-api suites (their fixtures use `kind:"image"` records, unaffected) AND the three fixture suites from Step 4.

- [ ] **Step 6: Commit**

```bash
git add editor/lib/media-db.js editor/test/media-db.test.js editor/test/symlinked-editor-dir.test.js editor/test/secrets-boot-message.test.js editor/test/secrets-location.test.js
git commit -m "feat(editor): media-db enforces YouTube id shape for video records"
```

---

### Task 3: `POST /api/youtube/resolve` — parse + oEmbed-verify a pasted link

**Files:**
- Modify: `editor/server.js` (require at top ~line 11; `createServer` signature ~line 222; new endpoint after the `/api/sign` handler ~line 381)
- Test: create `editor/test/youtube-resolve.test.js`

**Interfaces:**
- Consumes: `parseVideoId` (Task 1).
- Produces: `createServer` accepts a new optional `oembedFetch` (a `fetch`-compatible function, defaults to global `fetch`) — tests inject it. Endpoint contract (Task 5's client consumes it): request `{ url: string }`; responses:
  - `200 {"id","title","unverified":false}` — parsed and confirmed by oEmbed
  - `200 {"id","title":null,"unverified":true}` — parsed, but YouTube unreachable (offline is not an error)
  - `422` text — not a YouTube link, or oEmbed refused it (private/deleted/embedding disabled)
  - `400` text — malformed request body

- [ ] **Step 1: Write the failing tests** — create `editor/test/youtube-resolve.test.js`:

```js
"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createServer } = require("../server.js");

// Same boot pattern as media-api.test.js, plus an injectable oembedFetch so no test
// ever touches the network. The stub mimics the two fetch outcomes the endpoint
// distinguishes: an HTTP answer (ok or not), and a thrown network error.
async function boot(oembedFetch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "msc-yt-api-"));
  fs.writeFileSync(path.join(root, "content.js"),
    '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {\n  "cloudName": "demo-cloud"\n};\n/* CONTENT:END */');
  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, token, oembedFetch });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const base = "http://127.0.0.1:" + srv.address().port;
  const post = (p, body, headers = {}) => fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token, ...headers },
    body: JSON.stringify(body),
  });
  return { post, base };
}

test("resolves a watch URL: parses the id, confirms via oEmbed, returns the title", async () => {
  const seen = [];
  const { post } = await boot(async (url) => {
    seen.push(url);
    return { ok: true, status: 200, json: async () => ({ title: "Sports Day 2026" }) };
  });
  const r = await post("/api/youtube/resolve", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: "dQw4w9WgXcQ", title: "Sports Day 2026", unverified: false });
  // The outbound URL is built from the validated ID, never from raw user input.
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^https:\/\/www\.youtube\.com\/oembed\?url=/);
  assert.match(seen[0], /watch%3Fv%3DdQw4w9WgXcQ/);
});

test("oEmbed 4xx (private / deleted / embedding off) is a 422 that tells the editor the fix", async () => {
  const { post } = await boot(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  const r = await post("/api/youtube/resolve", { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(r.status, 422);
  assert.match(await r.text(), /Unlisted/);
});

test("network failure is NOT an error: the id still resolves, title comes back null", async () => {
  const { post } = await boot(async () => { throw new Error("getaddrinfo ENOTFOUND"); });
  const r = await post("/api/youtube/resolve", { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: "dQw4w9WgXcQ", title: null, unverified: true });
});

test("a non-YouTube URL is a 422 and oEmbed is never called", async () => {
  let called = 0;
  const { post } = await boot(async () => { called++; return { ok: true, status: 200, json: async () => ({}) }; });
  const r = await post("/api/youtube/resolve", { url: "https://vimeo.com/12345" });
  assert.equal(r.status, 422);
  assert.match(await r.text(), /YouTube link/);
  assert.equal(called, 0);
});

test("malformed bodies are a 400; a missing token is the uniform 403", async () => {
  const { post, base } = await boot(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  assert.equal((await post("/api/youtube/resolve", { nope: 1 })).status, 400);
  assert.equal((await post("/api/youtube/resolve", null)).status, 400);
  const noToken = await fetch(base + "/api/youtube/resolve", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://youtu.be/dQw4w9WgXcQ" }),
  });
  assert.equal(noToken.status, 403);
});

test("an oEmbed 200 with an unparseable body still resolves, marked unverified", async () => {
  const { post } = await boot(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }));
  const r = await post("/api/youtube/resolve", { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: "dQw4w9WgXcQ", title: null, unverified: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test editor/test/youtube-resolve.test.js`
Expected: FAIL — every POST answers 404 (there is no such endpoint yet).

- [ ] **Step 3: Implement** — three edits in `editor/server.js`:

3a. Next to the existing media-db require (~line 11):

```js
const { parseVideoId } = require("./lib/youtube.js");
```

3b. Extend the `createServer` destructuring (~line 222):

```js
function createServer({ root, config, templates, secrets, token, oembedFetch }) {
```

and directly below the `AUTH_TOKEN` constant inside it:

```js
  // The one outbound call this server ever makes: YouTube's keyless oEmbed lookup,
  // used to verify a pasted video link and fetch its title. Injectable so tests
  // never touch the network.
  const fetchOembed = oembedFetch || fetch;
```

3c. Add the endpoint AFTER the `/api/sign` handler's closing brace (~line 381) and BEFORE the `// ---- media library ----` comment:

```js
      if (req.method === "POST" && url.pathname === "/api/youtube/resolve") {
        const body = await readJson(req);
        if (body === null || typeof body !== "object" || Array.isArray(body) || typeof body.url !== "string") {
          return send(res, 400, "Invalid request: expected { url: \"...\" }");
        }
        const id = parseVideoId(body.url);
        if (!id) {
          return send(res, 422, "That doesn't look like a YouTube link. Paste the video's own URL " +
            "from youtube.com or youtu.be (open the video in YouTube Studio and use Share).");
        }
        // oEmbed is public and keyless, and answers 4xx for exactly the videos that
        // would render as broken players on the site: private, deleted, or embedding
        // disabled. A network failure must NOT block the editor (offline laptops are
        // normal here) — the id is already validated, so resolve it unverified and
        // let the client ask for a name instead of a title.
        let r;
        try {
          r = await fetchOembed(
            "https://www.youtube.com/oembed?url=" +
              encodeURIComponent("https://www.youtube.com/watch?v=" + id) + "&format=json",
            { signal: AbortSignal.timeout(5000) }
          );
        } catch {
          return send(res, 200, JSON.stringify({ id, title: null, unverified: true }), "application/json");
        }
        if (!r.ok) {
          return send(res, 422, "YouTube wouldn't confirm that video (HTTP " + r.status + "). " +
            "In YouTube Studio, check the video's visibility is Unlisted (not Private) and that " +
            "embedding is allowed, then paste the link again.");
        }
        let meta;
        try { meta = await r.json(); } catch { meta = null; }
        const title = meta !== null && typeof meta === "object" && typeof meta.title === "string" ? meta.title : null;
        return send(res, 200, JSON.stringify({ id, title, unverified: title === null }), "application/json");
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test editor/test/youtube-resolve.test.js && npm test`
Expected: new suite PASSES; full suite green.

- [ ] **Step 5: Commit**

```bash
git add editor/server.js editor/test/youtube-resolve.test.js
git commit -m "feat(editor): /api/youtube/resolve — parse a pasted link, verify via oEmbed"
```

---

### Task 4: video slots become YouTube embeds — media-urls + media-slots switch over

**Files:**
- Modify: `editor/lib/media-urls.js` (whole file — video branch + posterUrl removal)
- Modify: `editor/client/media-slots.js` (header comment ~line 4; `applyToSlot` ~lines 30-62)
- Rewrite: `editor/test/media-urls.test.js`
- Modify: `editor/test/media-slots.test.js` (append one test)

**Interfaces:**
- Consumes: nothing new.
- Produces: `deliveryUrl(cloudName, record)` — unchanged signature, but `kind:"video"` now returns the YouTube embed URL (cloudName ignored) — and new `embedUrl(videoId)`. **`posterUrl` is deleted** (YouTube supplies its own poster frame); `media-slots.js` no longer reads `data-media-poster` or calls `<video>.load()`. Tasks 6–8 (pages) rely on video slots being `<iframe>`s.

- [ ] **Step 1: Write the failing tests** —

1a. Replace the entire contents of `editor/test/media-urls.test.js` with:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { deliveryUrl, embedUrl } = require("../lib/media-urls.js");

// Image shape is pinned to the convention the site already renders with —
// montessori-vidyanagar.html's gallery mapping. If it changes, change both.
test("deliveryUrl for an image uses f_auto,q_auto,w_1600 under /image/upload", () => {
  assert.equal(
    deliveryUrl("demo-cloud", { id: "msc/photo-1", kind: "image" }),
    "https://res.cloudinary.com/demo-cloud/image/upload/f_auto,q_auto,w_1600/msc/photo-1"
  );
});

test("deliveryUrl for a video is the privacy-enhanced YouTube embed, rel=0", () => {
  assert.equal(
    deliveryUrl("demo-cloud", { id: "dQw4w9WgXcQ", kind: "video" }),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"
  );
});

test("embedUrl derives the same shape from a bare id", () => {
  assert.equal(embedUrl("dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
});

test("posterUrl is gone — YouTube provides its own poster frames", () => {
  assert.equal(require("../lib/media-urls.js").posterUrl, undefined);
});

test("image public_id slashes survive but URL-hostile characters are escaped", () => {
  // encodeURI keeps "/" (public_ids are folder-scoped) but escapes spaces etc.
  assert.match(deliveryUrl("c", { id: "a b/c", kind: "image" }), /\/a%20b\/c$/);
});
```

1b. Append to `editor/test/media-slots.test.js`:

```js
test("no video-element special-casing survives — video slots are iframes now", () => {
  assert.ok(!/\.load\(\)/.test(SRC), "no <video>.load() calls: iframe src changes reload themselves");
  assert.ok(!/data-media-poster/.test(SRC), "poster plumbing must not exist");
  assert.ok(!/posterUrl/.test(SRC), "posterUrl was deleted from media-urls");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test editor/test/media-urls.test.js editor/test/media-slots.test.js`
Expected: the video/embed/posterUrl-gone tests FAIL against the Cloudinary implementation; the new media-slots test FAILS (load()/poster still present).

- [ ] **Step 3: Replace `editor/lib/media-urls.js` entirely with:**

```js
(function (exports) {
  "use strict";
  // The ONE place a delivery URL is derived from a media.json record. `kind` is the
  // provider: images live on Cloudinary (id = public_id), videos on YouTube
  // (id = 11-char video id; uploaded manually in YouTube Studio as Unlisted — see
  // lib/youtube.js for why API upload is off). The Cloudinary image shape is pinned
  // to what the site already renders with (the gallery mapping in
  // montessori-vidyanagar.html): change them together or not at all.
  //
  // encodeURI, not encodeURIComponent, for public_ids: they are folder-scoped
  // ("msc/x") and the slash must survive into the URL path.
  function deliveryUrl(cloudName, record) {
    if (record.kind === "video") return embedUrl(record.id);
    return "https://res.cloudinary.com/" + cloudName + "/image/upload/f_auto,q_auto,w_1600/" + encodeURI(record.id);
  }
  // youtube-nocookie.com is YouTube's privacy-enhanced host (no tracking cookies
  // until playback). rel=0 keeps end-screen suggestions to this channel only.
  // modestbranding is defunct (YouTube ignores it) — deliberately omitted.
  function embedUrl(videoId) {
    return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(videoId) + "?rel=0";
  }
  Object.assign(exports, { deliveryUrl, embedUrl });
})(typeof module !== "undefined" ? module.exports : (window.EditorMediaUrls = {}));
```

- [ ] **Step 4: Strip the poster/load plumbing from `editor/client/media-slots.js`** —

4a. In the header comment (~line 4), change

```
  // data-media-slot="<content path>" (+ data-media-kind, optional data-media-poster).
```

to

```
  // data-media-slot="<content path>" (+ data-media-kind). Video slots are <iframe>
  // YouTube embeds: a src change reloads the frame on its own, and YouTube brings
  // its own poster frame — so there is no per-kind plumbing here at all.
```

4b. Replace the ENTIRE `applyToSlot` function (it currently carries poster plumbing, a
prior-value rollback for the two-path poster transaction — commit `2222061` — and a
`<video>.load()` rAF block; with the poster path gone there is only ONE write, so a
throw means nothing was applied and the rollback machinery has nothing left to do) with:

```js
  function applyToSlot(slotEl, record, cloudName) {
    var path = slotEl.getAttribute("data-media-slot");
    var kind = slotEl.getAttribute("data-media-kind");
    if (record.kind !== kind) {
      alert("That spot takes a " + kind + ", not a " + record.kind + ".");
      return;
    }
    var url = URLS.deliveryUrl(cloudName, record);
    try {
      // Apply first, record only on success — the same invariant as every other
      // editor mutation (see editor-client.js's doOp): a failed apply must never
      // leave an op in the draft log. One path, one write: a throw means nothing
      // was applied, so there is nothing to roll back.
      UI.applyLocal(path, url);
    } catch (err) {
      alert("Can't place media here:\n" + err.message);
      return;
    }
    UI.draft.set(path, url);
    clearSelection();
    UI.rerender(); UI.update();
    // rAF lands after the rerender's commit, so the empty-state marking sees the
    // slot's new value (same reasoning as doOp's rAF in editor-client.js).
    requestAnimationFrame(markEmpties);
  }
```

Everything OUTSIDE `applyToSlot` stays untouched — in particular the interactive-control
click guard (`e.target.closest("button, a, input, textarea, select, .ed-menu")`) from
commit `2222061` must survive.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: ALL PASS — including every pre-existing media-slots source assertion (apply-before-record, no-network, etc.).

- [ ] **Step 6: Commit**

```bash
git add editor/lib/media-urls.js editor/client/media-slots.js editor/test/media-urls.test.js editor/test/media-slots.test.js
git commit -m "feat(editor): video slots switch to YouTube embeds; posterUrl retired"
```

---

### Task 5: media drawer — Videos tab adds by YouTube link

**Files:**
- Modify: `editor/client/media.js` (`thumbUrl` ~line 68; empty-state text ~line 84; `render()`; the `// ---- upload ----` section)
- Test: `editor/test/media-client.test.js` (append + update one pinned count)

**Interfaces:**
- Consumes: `POST /api/youtube/resolve` (Task 3), existing `POST /api/media`, `EditorUI.{apiFetch, describeApiError, draft.markSavedToDisk, update}`.
- Produces: behavior only. The Videos tab's action button reads "🔗 Add YouTube link" and prompts for a URL; video tiles thumbnail from `i.ytimg.com`. The Photos tab is unchanged (Cloudinary file upload, now explicitly `image/*`).

- [ ] **Step 1: Write the failing tests** — append to `editor/test/media-client.test.js` (the file already defines `extractBlockAfter` near the bottom — added with the pick-mode tests; reuse it, do NOT redefine it):

```js
test("Videos tab adds by YouTube link through /api/youtube/resolve — never a file upload", () => {
  assert.match(SRC, /apiFetch\("\/api\/youtube\/resolve"/);
  const add = extractBlockAfter(SRC, "function addYouTubeLink(");
  assert.match(add, /prompt\(/);
  assert.match(add, /kind: "video"/);
  // No video file picker anywhere: videos are links, not uploads.
  assert.ok(!/video\/\*/.test(SRC), "found a video/* file-picker accept string");
  // The button label flips with the tab so the affordance is honest.
  assert.match(SRC, /uploadBtn\.textContent = tab === "image" \? "⬆ Upload" : "🔗 Add YouTube link"/);
});

test("video tiles thumbnail from YouTube's image CDN; images stay on Cloudinary", () => {
  const t = extractBlockAfter(SRC, "function thumbUrl(");
  assert.match(t, /i\.ytimg\.com\/vi\//);
  assert.match(t, /res\.cloudinary\.com/);
});
```

And update ONE pinned count in the EXISTING tests: in `"every /api/ call in media.js is tokenised via the shared apiFetch"` (~line 47-50), change `assert.equal(apiCalls.length, 4, ...)` to `5` and update its message — the fifth is `/api/youtube/resolve`. The `"exactly one bare fetch()"` test is UNCHANGED (still exactly 1 — the Cloudinary image upload; the link flow adds no bare fetch).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test editor/test/media-client.test.js`
Expected: the two new tests FAIL ("marker not found: function addYouTubeLink("), and the updated count test FAILS (4 ≠ 5). All others PASS.

- [ ] **Step 3: Implement in `media.js`** —

3a. Replace the whole `thumbUrl` function (~line 68-74; it currently branches on `rec.kind` to build a Cloudinary poster jpg for videos) with:

```js
  function thumbUrl(rec) {
    // Videos are YouTube-hosted: thumbs come straight from YouTube's image CDN
    // (works for Unlisted). Images are Cloudinary, cropped for the tile.
    if (rec.kind === "video") return "https://i.ytimg.com/vi/" + encodeURIComponent(rec.id) + "/mqdefault.jpg";
    return "https://res.cloudinary.com/" + encodeURIComponent(cloudName) +
      "/image/upload/c_fill,w_300,h_220,q_auto/" + rec.id;
  }
```

3b. In `render()`, add as its first line (the label must track the active tab):

```js
    uploadBtn.textContent = tab === "image" ? "⬆ Upload" : "🔗 Add YouTube link";
```

3c. Update the Videos empty-state text (~line 86). Replace:

```js
        : "No videos yet. Upload some — they'll be available to place on any page.";
```

with:

```js
        : "No videos yet. Upload to the school's YouTube channel (set to Unlisted) in YouTube Studio, then Add YouTube link here.";
```

3d. Add `addYouTubeLink` directly above `uploadBtn.onclick`:

```js
  // Videos never travel through this machine: the human uploads in YouTube Studio
  // (Unlisted), pastes the link, and the server verifies it via oEmbed. A null title
  // in the response means YouTube was unreachable (offline) — ask for a name rather
  // than fail; the id itself was already validated.
  function addYouTubeLink() {
    var input = prompt("Paste the YouTube link.\n\n(Upload the video in YouTube Studio first and set its visibility to Unlisted.)");
    if (!input) return Promise.resolve(null);
    return apiFetch("/api/youtube/resolve", { method: "POST", body: JSON.stringify({ url: input }) }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(describeApiError(r.status, t)); });
      return r.json();
    }).then(function (v) {
      var name = v.title;
      if (name === null) {
        name = prompt("Couldn't reach YouTube to fetch the title (offline?). Name this video:", "");
        if (name === null) return null; // cancelled
      }
      var rec = { id: v.id, kind: "video", name: name || v.id, createdAt: new Date().toISOString() };
      return apiFetch("/api/media", { method: "POST", body: JSON.stringify({ record: rec }) }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(describeApiError(r.status, t)); });
        return rec;
      });
    });
  }
```

3e. Branch `uploadBtn.onclick` on the tab. Replace its opening lines:

```js
  uploadBtn.onclick = async function () {
    if (uploading) return;
    var files = await pickFiles(tab === "image" ? "image/*" : "video/*");
```

with:

```js
  uploadBtn.onclick = async function () {
    if (uploading) return;
    if (tab === "video") {
      uploading = true;
      uploadBtn.disabled = true;
      try {
        var vrec = await addYouTubeLink();
        if (vrec) {
          if (records) records.unshift(vrec); // mirror the server's newest-first order
          UI.draft.markSavedToDisk(); // media.json changed on disk — Publish must know
          UI.update();
          render();
        }
      } catch (err) {
        alert("Couldn't add the video:\n" + err.message);
      } finally {
        uploading = false;
        uploadBtn.disabled = false;
      }
      return;
    }
    var files = await pickFiles("image/*");
```

(The rest of the image batch loop stays exactly as it is. A duplicate paste surfaces as the existing 409 "A media record with this id already exists" via `describeApiError` — correct and self-explanatory.)

- [ ] **Step 4: Run the client tests**

Run: `node --test editor/test/media-client.test.js editor/test/editor-client.test.js`
Expected: ALL PASS — including "exactly 5 apiFetch", "exactly 1 bare fetch", and the pick-mode tests from the shipped drawer work.

- [ ] **Step 5: Commit**

```bash
git add editor/client/media.js editor/test/media-client.test.js
git commit -m "feat(editor): media drawer Videos tab adds by pasted YouTube link"
```

---

### Task 6: inline gallery upload is photos-only

**Files:**
- Modify: `editor/client/editor-client.js` (`window.__edUpload` ~line 451-508)
- Test: `editor/test/editor-client.test.js` (append)

**Interfaces:**
- Consumes: nothing new. Produces: `__edUpload` accepts only images; a non-image Cloudinary response is an error pointing the editor at the drawer's link flow.

- [ ] **Step 1: Write the failing test** — append to `editor/test/editor-client.test.js` (this file already defines `extractBlockAfter`):

```js
test("inline gallery upload is photos-only — videos are YouTube links added in the drawer (Task: youtube videos)", () => {
  assert.match(SRC, /pickFile\("image\/\*"\)/);
  assert.ok(!/image\/\*,video\/\*/.test(SRC), "the combined image+video accept string must be gone");
  const up = extractBlockAfter(SRC, "window.__edUpload = async function");
  // The accept attribute is advisory (a file picker can still hand over anything),
  // so the Cloudinary response's resource_type is the real gate.
  assert.match(up, /resource_type !== "image"/);
  assert.ok(!/resource_type === "video" \? "video" : "image"/.test(SRC), "the video-kind branch must be gone");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test editor/test/editor-client.test.js`
Expected: the new test FAILS (`pickFile("image/*,video/*")` and the ternary are still there).

- [ ] **Step 3: Implement** — two edits inside `window.__edUpload`:

Replace:

```js
    const file = await pickFile("image/*,video/*");
```

with:

```js
    const file = await pickFile("image/*");
```

Replace:

```js
      const item = { kind: up.resource_type === "video" ? "video" : "image", id: up.public_id, caption: "" };
```

with:

```js
      // accept="image/*" is advisory only — the picker can still hand over anything.
      // Videos don't belong on Cloudinary at all (they're YouTube links, added in
      // the Media drawer), so a non-image response is refused, not stored.
      if (up.resource_type !== "image") {
        throw new Error("Only photos can be added here. Videos go on YouTube — open 🖼 Media → Videos → Add YouTube link.");
      }
      const item = { kind: "image", id: up.public_id, caption: "" };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test editor/test/editor-client.test.js`
Expected: ALL PASS (the bare-fetch and apiFetch pins in this file are unaffected).

- [ ] **Step 5: Commit**

```bash
git add editor/client/editor-client.js editor/test/editor-client.test.js
git commit -m "feat(editor): inline gallery upload is photos-only"
```

---

### Task 7: index.html — hero portrait becomes a slot

**Files:**
- Modify: `index.html` (portrait `<img>` at ~line 258; CONTENT `"hero"` object at ~line 500; the component's computed vals)

**Interfaces:**
- Consumes: the slot contract (shipped `media-slots.js`, as amended in Task 4) and check-paths validation (shipped). Produces: `CONTENT.hero.photo` (string, `""` = empty).

- [ ] **Step 1: Add the content key** — in index.html's CONTENT block, add to the `"hero"` object (after its last existing key):

```json
    "photo": ""
```

- [ ] **Step 2: Map the empty sentinel in the component's vals** — find the component's render-vals return (search for where `hero` is passed to the template). Add:

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

### Task 8: montessori-acamp.html — image slots + YouTube showcase iframe, resume-playback removed

**Files:**
- Modify: `montessori-acamp.html` (top-of-file behavior comment ~line 39; hero img ~line 282; founder img ~line 326; showcase section comment + video ~lines 393-412; gallery img ~line 530; CONTENT `"hero"`/`"founder"` objects ~line 716-730; mount logic ~lines 823-834 and ~line 890; vals return ~line 1037-1050)

**Interfaces:**
- Produces: `CONTENT.hero.photo`, `CONTENT.founder.photo`, `CONTENT.showcase = { "video": "" }`; gallery slots ride the existing `ph.p` stamping. The showcase `<video>` element, its `videoRef`, and the resume-playback feature are deleted.

- [ ] **Step 1: CONTENT additions**
  - `"hero"` object: add a `"photo"` key whose value is the hero `<img>`'s CURRENT src attribute (read it at ~line 282 first; if it's a real asset path, copy it verbatim so the live page doesn't change; if it's the transparent-GIF placeholder, use `""`).
  - `"founder"` object: same rule, from the founder `<img>` at ~line 326.
  - New top-level key after `"founder"`:

```json
  "showcase": { "video": "" },
```

(`""`, not the old montessoritechnoschool.com mp4: that hotlink is `http://` on an `https://` site — mixed content, already blocked by every modern browser — and the section comment itself says to swap it out when the school supplies a file. The school's video moves to YouTube and gets placed through the drawer.)

- [ ] **Step 2: Markup annotations**
  - Hero (~line 282) — add the slot attributes, switch src to the content value:

```html
    <img src="{{ hero.photo }}" data-media-slot="hero.photo" data-media-kind="image" alt="Montessori School, A-Camp — students on the campus steps" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0" loading="lazy">
```

    (Keep the element's existing alt/style if they differ from the above — only `src` and the two `data-media-*` attributes are the change. `hero` is already passed whole to the template, so `{{ hero.photo }}` needs no vals change when the value is non-empty; if Step 1 set `""`, use a `heroPhotoSrc` computed val exactly as in Task 7.)
  - Founder (~line 326) — same pattern:

```html
      <img src="{{ founder.photo }}" data-media-slot="founder.photo" data-media-kind="image" alt="{{ founder.name }}" style="width:100%;height:100%;object-fit:cover;display:block">
```

    Also update the section's HTML comment (~line 322) that says the portrait "is markup, since images are not editable text" — it now is editable via the media drawer.
  - Showcase (~lines 393-412): replace the section's explanatory comment (~lines 393-400) with:

```html
<!-- STUDENTS SHOWCASE
     A YouTube embed (an Unlisted video on the school's channel), placed through
     the editor's media drawer. "" means no video chosen yet — renderVals maps it
     to about:blank so the frame stays an empty black box (an src of "" would
     recursively load this very page inside itself). -->
```

    and replace the whole `<video ...>...</video>` element (~lines 409-411, including its `<source>` child) with:

```html
      <iframe src="{{ showcaseVideoSrc }}" title="Students showcase video" data-media-slot="showcase.video" data-media-kind="video" style="width:100%;display:block;aspect-ratio:16/9;border:0;background:#000" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>
```

- [ ] **Step 3: Delete the resume-playback feature** (a plain iframe can't read or set playback position; the design drops the feature rather than adopt YouTube's IFrame API script):
  - Delete the whole `---- 2. Resume the showcase video ...` block in the mount logic (~lines 823-834: the comment plus the `const v = this._videoEl; if (v) { ... }` block).
  - Delete the unmount cleanup line (~line 890): `if (this._videoEl && this._vSave) this._videoEl.removeEventListener("timeupdate", this._vSave);`
  - Delete the `videoRef: (el) => { this._videoEl = el; },` entry from the vals return (~line 1042).
  - Renumber the following `---- N.` comment labels in the mount block down by one so they stay sequential.
  - Update the top-of-file behavior list (~line 39): change `- the showcase video, which remembers its playback position` to `- the showcase video (a YouTube embed placed via the editor)`. Do the same for the matching entry in the second numbered list (~line 665) — reword or renumber so no comment still promises remembered playback position.

- [ ] **Step 4: Vals** — in the vals return (~line 1037-1050), add:

```js
      showcaseVideoSrc: CONTENT.showcase.video || "about:blank",
```

  - Gallery photo (~line 530) — the flip-card front image; `ph.p` is already stamped:

```html
                <div class="flip-f" style="border:1px solid #f0e0dc"><img src="{{ ph.src }}" data-media-slot="{{ ph.p }}.src" data-media-kind="image" alt="{{ ph.caption }}" style="width:100%;height:100%;object-fit:cover" loading="lazy"></div>
```

- [ ] **Step 5: Verify**

Run: `node editor/check-paths.js && npm test`
Expected: all green — including page-content-fidelity.test.js, which round-trips the CONTENT block (run it specifically if the suite ordering hides it: `node --test editor/test/page-content-fidelity.test.js`). Also `grep -c "_videoEl\|_vSave\|videoRef" montessori-acamp.html` must print `0`.

- [ ] **Step 6: Commit**

```bash
git add montessori-acamp.html
git commit -m "feat(content): acamp slots — hero, founder, gallery images; YouTube showcase iframe"
```

---

### Task 9: montessori-vidyanagar.html — hero + empty showcase iframe + YouTube gallery videos

**Files:**
- Modify: `montessori-vidyanagar.html` (top-of-file comment ~line 40; hero img ~line 271; showcase comment + video ~lines 360-374; gallery comment ~lines 452-459 and template ~line 474; CONTENT `"hero"` ~line 644; mount logic ~lines 720-731 and ~line 787; gallery mapping ~lines 810-824; vals return; `videoRef` ~line 938; behavior list ~line 603)

**Interfaces:**
- Produces: `CONTENT.hero.photo` (`""` = empty), `CONTENT.showcase = { "video": "" }`; the gallery renders `kind:"video"` items as YouTube iframes (item `id` = YouTube video ID).

- [ ] **Step 1: CONTENT** — add `"photo": ""` to `"hero"`; add a top-level key:

```json
  "showcase": { "video": "" },
```

- [ ] **Step 2: Markup**
  - Hero (~line 271) — same empty-sentinel pattern as index:

```html
    <img src="{{ heroPhotoSrc }}" data-media-slot="hero.photo" data-media-kind="image" alt="Montessori School, Vidyanagar" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0" loading="lazy">
```

    (Keep the element's existing alt/style; only `src` + the `data-media-*` attributes change.)
  - Showcase (~lines 360-374): replace the explanatory comment (~lines 360-364) with the same STUDENTS SHOWCASE comment as Task 8 Step 2, and the `<video ref="{{ videoRef }}" ...></video>` element (~line 374) with:

```html
      <iframe src="{{ showcaseVideoSrc }}" title="Students showcase video" data-media-slot="showcase.video" data-media-kind="video" style="width:100%;display:block;aspect-ratio:16/9;border:0;background:#000" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>
```

  - Gallery video branch (~line 474) — replace the `<video>` with an iframe (same 4:3 tile the images use; YouTube letterboxes inside it):

```html
          <sc-if value="{{ ga.isVideo }}"><iframe src="{{ ga.url }}" title="{{ ga.caption }}" loading="lazy" style="width:100%;aspect-ratio:4/3;border:0;display:block;background:#26201d" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></sc-if>
```

  - Update the GALLERY comment (~lines 452-459): the sentence "Cloudinary URLs are built in renderVals since {{ }} cannot concatenate" becomes "Delivery URLs are built in renderVals since {{ }} cannot concatenate — Cloudinary for photos, YouTube embeds for videos (item id = YouTube video ID)."

- [ ] **Step 3: Gallery mapping** (~lines 815-824) — replace the `gallery` mapping with:

```js
    const gallery = S.galleries.vidyanagar.map((it, i) => ({
      ...it,
      p: "shared:galleries.vidyanagar." + i,
      isImage: it.kind === "image",
      isVideo: it.kind === "video",
      // Photos are Cloudinary public IDs; videos are YouTube video IDs — embedded
      // via the privacy-enhanced host, end-screen suggestions kept to this channel.
      url: it.kind === "image"
        ? cdn + "/image/upload/f_auto,q_auto,w_800/" + it.id
        : "https://www.youtube-nocookie.com/embed/" + it.id + "?rel=0",
    }));
```

(The `poster` field is deleted — nothing renders it once the `<video>` is gone. Also update the comment above at ~line 810: "Cloudinary URLs are built here" → "Delivery URLs are built here".)

- [ ] **Step 4: Delete the resume-playback feature** — mirror of Task 8 Step 3:
  - Delete the `---- 2. Resume the showcase video ----` block (~lines 720-731).
  - Delete the unmount cleanup (~line 787): `if (this._videoEl && this._vSave) ...`.
  - Delete `videoRef: (el) => { this._videoEl = el; },` (~line 938).
  - Renumber the following `---- N.` labels; update the behavior lists at ~line 40 and ~line 603 the same way as Task 8 Step 3.

- [ ] **Step 5: Vals** — in the component's vals return (the same object that builds `gallery`): add

```js
      heroPhotoSrc: CONTENT.hero.photo ||
        "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
      showcaseVideoSrc: CONTENT.showcase.video || "about:blank",
```

- [ ] **Step 6: Verify**

Run: `node editor/check-paths.js && npm test`
Expected: green; `grep -c "_videoEl\|_vSave\|videoRef" montessori-vidyanagar.html` prints `0`.

- [ ] **Step 7: Commit**

```bash
git add montessori-vidyanagar.html
git commit -m "feat(content): vidyanagar slots — hero, YouTube showcase + gallery embeds"
```

---

### Task 10: Live smoke test

**Files:** none (verification only). Requires network access for the YouTube steps.

- [ ] **Step 1: Boot the editor** — `npm run edit` (restart any already-running instance to pick up server.js changes).
- [ ] **Step 2: Drive the YouTube flow** — on http://localhost:8899/montessori-acamp.html:
  1. Open 🖼 Media → Videos. The button reads "🔗 Add YouTube link"; the empty state mentions YouTube Studio.
  2. Click it and paste `https://youtu.be/dQw4w9WgXcQ` (any public video works for the smoke test). The tile appears with a real YouTube thumbnail and the video's real title — no name prompt (that only appears offline).
  3. Paste the same link again → the alert surfaces the 409 "already exists".
  4. Paste `https://vimeo.com/1` → the alert says it isn't a YouTube link.
- [ ] **Step 3: Drive the slots** — still on the acamp page:
  1. The pen cursor is GONE (native arrow); Exit → pen returns; Resume → native again.
  2. Hovering the hero photo / founder photo / any gallery photo / the showcase frame shows the dashed orange outline; logos and feature icons show nothing. The empty showcase frame shows the dashed "empty" marking.
  3. Click the showcase frame → drawer opens on Videos in pick mode; click the tile added in Step 2 → the iframe loads the YouTube player; the bar counts 1 change.
  4. Click the hero photo → drawer opens on Photos in pick mode (image uploads need `npm run setup`; if Cloudinary is unconfigured, POST a fixture image record via curl with the page token, the same trick the media-library smoke test used). Pick a tile → the image swaps.
  5. Drag a video tile over the page: only the showcase frame lights up; dropping on the founder photo does nothing; dropping on the showcase swaps it.
  6. Publish → the page's CONTENT block shows `"video": "https://www.youtube-nocookie.com/embed/..."` and the media.json commit rides along.
- [ ] **Step 4: Vidyanagar + index spot-checks** — http://localhost:8899/montessori-vidyanagar.html: empty hero and showcase slots show dashed marking in edit mode and look unchanged outside it; http://localhost:8899/: hero slot works. Verify the inline gallery "+ Add" upload on vidyanagar only offers image files in the picker.
- [ ] **Step 5: Full suite one last time** — `npm test`. Expected: green.
- [ ] **Step 6: Report** — summarize what was verified. Note for the human: the smoke-test video record (`dQw4w9WgXcQ`) and any placed test media should be removed via the drawer's ✕ before a real publish, and image placement only renders once `npm run setup` has configured a real Cloudinary cloudName.
