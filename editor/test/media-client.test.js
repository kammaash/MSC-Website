"use strict";
// media.js only ever runs in a browser, like editor-client.js — so, same approach as
// editor-client.test.js: source-level checks of the properties that matter and are
// checkable without a DOM. The two invariants that would ship broken-but-looking-fine
// are the token discipline (every /api/ call must go through the shared apiFetch, and
// the one direct-to-Cloudinary upload must NOT — Cloudinary must never see the local
// editor token) and library records reaching the DOM as text, never as markup.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MEDIA = path.join(__dirname, "..", "client", "media.js");
const EDITOR_CLIENT = path.join(__dirname, "..", "client", "editor-client.js");
const SRC = fs.readFileSync(MEDIA, "utf8");

test("media.js is syntactically valid", () => {
  execFileSync(process.execPath, ["--check", MEDIA]);
});

test("server injects media.js, after editor-client.js (media.js needs window.EditorUI)", () => {
  // The end-to-end injected-page assertions live in server.test.js and
  // secrets-location.test.js; this pins the ORDER in the INJECT source.
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const client = server.indexOf('"/editor/client/editor-client.js">');
  const media = server.indexOf('"/editor/client/media.js">');
  assert.ok(client !== -1, "editor-client.js missing from INJECT");
  assert.ok(media !== -1, "media.js missing from INJECT");
  assert.ok(media > client, "media.js must load after editor-client.js");
});

test("media.js refuses to run without its injected editor dependencies", () => {
  // editor-client.js declines to boot when framed (FC-1) or already booted; media.js
  // must inherit that decision rather than re-derive it — no EditorUI, no media drawer.
  assert.match(SRC, /if \(!window\.EditorUI \|\| !window\.EditorMediaUrls\) return;/);
});

test("editor-client.js shares apiFetch and describeApiError through EditorUI for media.js to use", () => {
  const src = fs.readFileSync(EDITOR_CLIENT, "utf8");
  const exportLine = src.match(/window\.EditorUI = \{[^}]*\}/);
  assert.ok(exportLine, "EditorUI export not found");
  assert.match(exportLine[0], /apiFetch/);
  assert.match(exportLine[0], /describeApiError/);
  assert.match(exportLine[0], /getLocal/);
});

test("every /api/ call in media.js is tokenised via the shared apiFetch", () => {
  const apiCalls = SRC.match(/apiFetch\(\s*["'`](\/api\/[^"'`]+)["'`]/g) || [];
  // list, sign, add photo record, atomic YouTube verify+add, photo setup, delete.
  assert.equal(apiCalls.length, 6, "expected exactly 6 apiFetch(...) call sites targeting /api/");
  // No /api/ URL may appear anywhere except immediately inside an apiFetch call.
  const bareApi = SRC.replace(/apiFetch\(\s*["'`]\/api\//g, "").match(/["'`]\/api\//g) || [];
  assert.deepEqual(bareApi, [], "found /api/ URLs not routed through apiFetch");
});

test("exactly one bare fetch() call site — the direct-to-Cloudinary upload, which must never carry the editor token", () => {
  // Same reasoning as editor-client.test.js: lowercase "fetch(" can never match
  // "apiFetch(", so this counts only genuine bare fetch() calls.
  const bare = SRC.match(/[^a-zA-Z.]fetch\(/g) || [];
  assert.equal(bare.length, 1, "expected exactly 1 bare fetch() call (the Cloudinary upload)");
  assert.match(SRC, /fetch\("https:\/\/api\.cloudinary\.com\//);
});

test("library records reach the DOM as text, never as markup", () => {
  // A record's name/caption is user-supplied (a filename). innerHTML with record data
  // would be an injection sink; the only innerHTML permitted is the drawer's own
  // static chrome (built from string literals, no ${} interpolation of record fields).
  for (const m of SRC.match(/\.innerHTML\s*=\s*[^;]+;/g) || []) {
    assert.ok(!/\$\{/.test(m) && !/\brec\b|\brecord\b/.test(m),
      "innerHTML assignment appears to interpolate data: " + m);
  }
});

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

test("media.js exposes picker open/cancel and exits pick mode on close", () => {
  assert.match(SRC, /window\.EditorMedia = \{ openPicker: openPicker, cancelPick: cancelPick \}/);
  const close = extractBlockAfter(SRC, "function setOpen(");
  assert.match(close, /cancelPick\(\)/); // closing the drawer always cancels pick mode
  const cancel = extractBlockAfter(SRC, "function cancelPick(");
  assert.match(cancel, /pick = null/);
  assert.match(cancel, /onCancel\(\)/);
});

test("tile delete controls never bubble into the pick-to-place tile handler", () => {
  const handler = extractBlockAfter(SRC, "del.onclick = function");
  const stopIdx = handler.indexOf("e.stopPropagation()");
  const removeIdx = handler.indexOf("removeRec(rec)");
  assert.ok(stopIdx !== -1 && removeIdx !== -1 && stopIdx < removeIdx,
    "delete must stop propagation before starting removal");
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

test("Videos tab uses one atomic /api/youtube/add call — never a file upload or generic media POST", () => {
  assert.match(SRC, /apiFetch\("\/api\/youtube\/add"/);
  const add = extractBlockAfter(SRC, "function addYouTubeLink(");
  assert.match(add, /prompt\(/);
  assert.doesNotMatch(add, /apiFetch\("\/api\/media"/);
  assert.match(add, /data\.record\.kind !== "video"/);
  // No video file picker anywhere: videos are links, not uploads.
  assert.ok(!/video\/\*/.test(SRC), "found a video/* file-picker accept string");
  // The button label flips with the tab so the affordance is honest.
  assert.match(SRC, /"🔗 Add YouTube video"/);
});

test("drawer presents explicit tabs, setup state, picker guidance and cancellation", () => {
  assert.match(SRC, /role="tablist" aria-label="Media type"/);
  assert.match(SRC, /Photos<\/strong><small>Upload images/);
  assert.match(SRC, /Videos<\/strong><small>YouTube links/);
  assert.match(SRC, /photoUploadsEnabled = data\.photoUploadsEnabled === true/);
  assert.match(SRC, /data\.mediaUncommitted === true/);
  assert.match(SRC, /Set up photo uploads/);
  assert.match(SRC, /type="password"/);
  assert.match(SRC, /apiFetch\("\/api\/photo-setup"/);
  assert.match(SRC, /function describeSlot\(/);
  assert.match(SRC, /id="ed-media-cancel-pick"/);
  assert.match(SRC, /Use this video/);
  assert.match(SRC, /Use this photo/);
});

test("photo uploads validate type and size before signing, and use a dedicated Cloudinary folder", () => {
  const up = extractBlockAfter(SRC, "function uploadOne(");
  assert.match(SRC, /function photoFileProblem\(/);
  assert.match(SRC, /image\/jpeg/);
  assert.match(SRC, /image\/png/);
  assert.match(SRC, /image\/webp/);
  assert.match(SRC, /15 \* 1024 \* 1024/);
  assert.ok(up.indexOf("photoFileProblem(file)") < up.indexOf('apiFetch("/api/sign"'),
    "local validation must run before requesting an upload signature");
  assert.match(up, /folder: "msc-website"/);
  assert.match(up, /fd\.append\("folder", "msc-website"\)/);
});

test("drawer forces visible native interaction cursors and respects reduced motion", () => {
  assert.match(SRC, /#ed-media,#ed-media \*\{[^}]*cursor:auto!important/);
  assert.match(SRC, /#ed-media button\{cursor:pointer!important\}/);
  assert.match(SRC, /ed-tile\{[^}]*cursor:grab!important/);
  assert.match(SRC, /prefers-reduced-motion:reduce/);
});

test("drawer thumbnails come from the shared media URL authority", () => {
  const t = extractBlockAfter(SRC, "function thumbUrl(");
  assert.match(t, /URLS\.thumbnailUrl\(cloudName, rec\)/);
});

test("the drawer's own upload (Photos tab) is photos-only — a non-image Cloudinary response is refused, not stored", () => {
  // Mirrors editor-client.test.js's "inline gallery upload is photos-only": accept="image/*"
  // is only a picker hint, so the Cloudinary response's resource_type is the real gate. Without
  // it, a .mp4 picked from the Photos tab would upload to Cloudinary and get stored as a bogus
  // record, exactly what videos-are-YouTube-only forbids.
  const up = extractBlockAfter(SRC, "function uploadOne(");
  assert.match(up, /resource_type !== "image"/);
  assert.ok(!/resource_type === "video" \? "video" : "image"/.test(SRC), "the video-kind ternary must be gone");

  // The guard must run before the record is ever posted to /api/media, not after.
  const guardIdx = up.indexOf('resource_type !== "image"');
  const postIdx = up.indexOf('apiFetch("/api/media"');
  assert.ok(guardIdx !== -1 && postIdx !== -1 && guardIdx < postIdx,
    "the photos-only guard must run before uploadOne's POST /api/media");
});
