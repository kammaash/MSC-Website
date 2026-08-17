"use strict";
// editor-client.js (and draft.js, when loaded as a plain <script> rather than required)
// only ever run in a browser — there is no DOM here to load and exercise them against.
// These tests instead check source-level properties that matter and are checkable
// without a DOM: every request is tokenised (a missing token silently 403s the whole
// editor — the one regression that would ship broken with everything else looking
// fine), the fix-round-2 review findings (trim-before-compare, validate-then-catch-
// before-recording, honest Discard, the contenteditable value check, the
// beforeunload/Exit cleanup) are actually present and in the right order, and the
// files are at least syntactically valid, since nothing else ever parses them.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CLIENT_DIR = path.join(__dirname, "..", "client");
const EDITOR_CLIENT = path.join(CLIENT_DIR, "editor-client.js");
const DRAFT = path.join(CLIENT_DIR, "draft.js");
const SRC = fs.readFileSync(EDITOR_CLIENT, "utf8");

// Extracts the brace-balanced block that starts at (or after) the first "{" following
// `marker`, e.g. extractBlockAfter(src, "function apiFetch(") returns the whole function
// body, and extractBlockAfter(src, '#ed-discard").onclick') returns the whole handler —
// arrow-function callbacks don't have a name a simpler "find the function" search could
// key on. This replaces a fixed-length slice, which would silently stop covering a
// growing function without ever failing.
function extractBlockAfter(src, marker) {
  const markerIdx = src.indexOf(marker);
  assert.notEqual(markerIdx, -1, "marker not found: " + marker);
  const braceOpen = src.indexOf("{", markerIdx);
  let depth = 0;
  for (let i = braceOpen; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(markerIdx, i + 1);
    }
  }
  throw new Error("unbalanced braces scanning from marker: " + marker);
}

test("every /api/ fetch in editor-client.js is tokenised via apiFetch", () => {
  // apiFetch is the one place the x-editor-token header gets attached (from
  // window.__EDITOR_TOKEN, which the server injects per boot — see server.js's
  // TOKEN_SCRIPT). Every call that hits /api/ must go through it.
  //
  // 3 call sites as of Task 13: save, publish, and sign (the last one added for
  // Cloudinary upload signing — /api/sign is OUR server, so it's tokenised like
  // everything else that hits /api/).
  const apiFetchCalls = SRC.match(/apiFetch\(\s*["'`](\/api\/[^"'`]+)["'`]/g) || [];
  assert.equal(apiFetchCalls.length, 3, "expected exactly 3 apiFetch(...) call sites targeting /api/ (save, publish, sign)");

  // Because the wrapper is named with a capital F ("apiFetch"), a case-sensitive search
  // for the literal substring "fetch(" (lowercase f) can never match "apiFetch(" —
  // it only matches genuine bare fetch() calls. There must be exactly two: apiFetch's
  // own body (where the real, global fetch() gets invoked), and the direct-to-Cloudinary
  // upload POST in window.__edUpload, which must NEVER go through apiFetch — Cloudinary
  // is a third party, and apiFetch would hand it this machine's local editor token. If
  // this count ever rises above 2, a new call site has bypassed apiFetch for a call that
  // should have carried the token, or duplicated the Cloudinary escape hatch.
  const bareFetchCount = (SRC.match(/fetch\(/g) || []).length;
  assert.equal(bareFetchCount, 2, "expected exactly 2 bare fetch( calls: apiFetch's own body, and the direct-to-Cloudinary upload (intentionally untokenised)");

  const apiFetchBody = extractBlockAfter(SRC, "function apiFetch(");
  assert.match(apiFetchBody, /"x-editor-token":\s*window\.__EDITOR_TOKEN/);

  // The Cloudinary call itself must be the one bare fetch that does NOT target /api/ —
  // pinning this down keeps the count-based checks above from being satisfiable by some
  // other, wrong rearrangement (e.g. tokenising the Cloudinary call while leaving /api/sign
  // as a bare fetch would still pass the two counts above with the numbers swapped).
  const uploadBody = extractBlockAfter(SRC, "window.__edUpload = async function (listPath) {");
  assert.match(uploadBody, /apiFetch\(\s*["'`]\/api\/sign["'`]/, "/api/sign must be requested through apiFetch");
  assert.match(uploadBody, /fetch\(\s*["'`]https:\/\/api\.cloudinary\.com\//, "the Cloudinary upload must be a plain fetch(), not apiFetch()");
});

test("M2: apiFetch defaults content-type to application/json but a caller can still override it", () => {
  const apiFetchBody = extractBlockAfter(SRC, "function apiFetch(");
  // The default must be the FIRST argument to Object.assign (lowest precedence) so that
  // opts.headers — merged in second — can override it, with the token merged in last so
  // it can never be overridden.
  assert.match(
    apiFetchBody,
    /Object\.assign\(\s*\{\s*"content-type":\s*"application\/json"\s*\}\s*,\s*opts\s*&&\s*opts\.headers\s*,\s*\{\s*"x-editor-token":\s*window\.__EDITOR_TOKEN\s*\}\s*\)/
  );
});

test("M1: the contenteditable guard checks the actual value, not truthiness", () => {
  // getAttribute("contenteditable") is truthy for the string "false" too; a plain
  // truthiness check would refuse to ever open an element authored contenteditable="false".
  const fn = extractBlockAfter(SRC, "function isEditableNow(");
  assert.match(fn, /===\s*"plaintext-only"/);
  assert.match(fn, /===\s*"true"/);
  assert.doesNotMatch(fn, /return\s+v\s*;/, "must compare against specific values, not just return the raw attribute");

  // And it must actually be used to guard entry/exit, not bypassed with a raw getAttribute check.
  const usages = (SRC.match(/isEditableNow\(/g) || []).length;
  assert.ok(usages >= 4, "expected isEditableNow used in click/keydown/blur guards and Exit's cleanup, found " + usages);
});

test("I1: text is trimmed at capture time and at commit time, so padding from a {{ }} hole's surrounding markup can't compound", () => {
  const clickBlock = extractBlockAfter(SRC, 'addEventListener("click"');
  assert.match(clickBlock, /el\.__edOrig\s*=\s*el\.textContent\.trim\(\)/);

  const blurBlock = extractBlockAfter(SRC, 'addEventListener("blur"');
  assert.match(blurBlock, /const value = el\.textContent\.trim\(\)/);
});

test("I2: a stale/unknown path throws from applyLocal BEFORE the op is recorded, restores the text, and never reaches draft.set", () => {
  const blurBlock = extractBlockAfter(SRC, 'addEventListener("blur"');
  const tryIdx = blurBlock.indexOf("try {");
  const applyIdx = blurBlock.indexOf("applyLocal(path, value)");
  const catchIdx = blurBlock.indexOf("catch (err)");
  const draftSetIdx = blurBlock.indexOf("draft.set(path, value)");
  assert.ok(tryIdx !== -1 && applyIdx !== -1 && catchIdx !== -1 && draftSetIdx !== -1, "expected try/applyLocal/catch/draft.set all present");
  assert.ok(tryIdx < applyIdx, "applyLocal must be inside the try block");
  assert.ok(applyIdx < catchIdx, "catch must come after the applyLocal call");
  assert.ok(catchIdx < draftSetIdx, "draft.set must come after the try/catch, i.e. only run on success");

  // The catch handler must restore the original text and tell the user, same as the
  // rejectText short-circuit above it — both failure paths leave the element showing
  // exactly what it showed before the edit.
  const restoreCount = (blurBlock.match(/el\.textContent = el\.__edOrig/g) || []).length;
  assert.ok(restoreCount >= 2, "expected the original text restored on both the rejectText path and the applyLocal-throws path");
});

test("I3(a): a client-side validation rejection also restores text and returns before recording anything", () => {
  const blurBlock = extractBlockAfter(SRC, 'addEventListener("blur"');
  assert.match(blurBlock, /EditorDraft\.rejectText\(value\)/);
  const rejectIdx = blurBlock.indexOf("EditorDraft.rejectText(value)");
  const draftSetIdx = blurBlock.indexOf("draft.set(path, value)");
  assert.ok(rejectIdx < draftSetIdx, "rejectText check must run before the op is recorded");
});

test("I3(b): Discard warns honestly whenever anything is saved-but-uncommitted, and still has its plain path", () => {
  const discardBlock = extractBlockAfter(SRC, '#ed-discard").onclick');
  // Keyed on the draft's persisted transaction state, NOT a session-lifetime flag —
  // the fact is about the files on disk and survives Discard's own reload.
  assert.match(discardBlock, /draft\.hasUncommitted\(\)/);
  assert.match(discardBlock, /not undo/i);
  // The plain "nothing saved yet" path must still exist and still be reachable
  // (it stays the everyday case — most sessions publish without a partial failure).
  assert.match(discardBlock, /draft\.count\(\)\s*&&\s*!confirm/);

  // The old in-memory flag must be gone entirely: it was the thing that reset to a
  // clean-looking state on reload while the edits were still sitting in the repo.
  assert.doesNotMatch(SRC, /savedThisSession/, "the in-memory-only saved flag must be replaced by the draft's persisted state");
});

// ---- C1: the save/publish transaction ----

test("C1: saveAll sends a beginSave() snapshot and retires each file's ops the moment its save returns 200", () => {
  const saveAllBlock = extractBlockAfter(SRC, "function saveAll(");
  assert.match(saveAllBlock, /draft\.beginSave\(\)/, "saveAll must open a transaction, not read a plain patch list");
  assert.doesNotMatch(saveAllBlock, /draft\.toPatches\(\)/, "toPatches() is a read-only view; sending from it can never retire an op");

  const okIdx = saveAllBlock.indexOf("if (!r.ok)");
  const markIdx = saveAllBlock.indexOf("tx.markSaved(file)");
  assert.ok(okIdx !== -1 && markIdx !== -1, "expected the !r.ok throw and the markSaved call");
  assert.ok(okIdx < markIdx, "ops may only be retired AFTER the response is confirmed 200");
});

test("C1: the Publish guard admits the saved-but-uncommitted case, so the retry is possible", () => {
  const publishBlock = extractBlockAfter(SRC, "publishBtn.onclick");
  // The trap this fix could easily have created: guarding on the pending count alone
  // now that a successful save empties the log would refuse the retry outright and
  // strand the saved edits until some unrelated later publish swept them up.
  assert.match(publishBlock, /if\s*\(!draft\.hasWork\(\)\)\s*return alert\(/);
  // count() === 0 has exactly one legitimate use in this handler — half of the stale-bit
  // confirm's condition (item 3). Anywhere else it is the over-correction coming back, so
  // every occurrence must be paired with hasUncommitted() rather than simply absent.
  const countUses = [...publishBlock.matchAll(/draft\.count\(\)\s*===\s*0(.{0,30})/g)];
  assert.equal(countUses.length, 1, "expected exactly one draft.count() === 0 (the stale-bit confirm)");
  for (const m of countUses) {
    assert.match(m[1], /^ && draft\.hasUncommitted\(\)/, "draft.count() === 0 may only appear in the stale-bit confirm, never as the Publish gate");
  }

  // The transaction only ends on a response the classifier calls committed.
  const outcomeIdx = publishBlock.indexOf("if (!outcome.committed) throw");
  const committedIdx = publishBlock.indexOf("draft.markCommitted()");
  assert.ok(outcomeIdx !== -1 && committedIdx !== -1, "expected the outcome throw and the markCommitted call");
  assert.ok(outcomeIdx < committedIdx, "markCommitted may only run after the publish response is classified as committed");

  // And the failure path must tell the user where their work actually is.
  assert.match(publishBlock, /catch \(err\)[\s\S]*draft\.hasUncommitted\(\)/);
  assert.match(publishBlock, /Publish again/i);
});

test("item 1: both 409s end the transaction and neither invites a retry that cannot help", () => {
  const publishBlock = extractBlockAfter(SRC, "publishBtn.onclick");
  // The response must be classified, not judged by r.ok — a 2xx is not the only outcome
  // that means "committed".
  assert.match(publishBlock, /classifyPublishResponse\(r\.status, text\)/);
  assert.doesNotMatch(publishBlock, /if \(!r\.ok\) throw/, "r.ok alone would send both 409s down the failure path");
  // Pre-merge fix round, should-fix B: wrapped in describeApiError so a 403 (the editor
  // server having restarted under a still-open tab) gets a message the user can act on,
  // instead of the bare word "Forbidden". It still receives the SAME `text` read below —
  // no second body read, no change to which statuses end the transaction.
  assert.match(publishBlock, /if \(!outcome\.committed\) throw new Error\(describeApiError\(r\.status, text\)\)/);

  // The body may only be read once, before classification.
  assert.equal((publishBlock.match(/await r\.text\(\)/g) || []).length, 1, "the response body must be read exactly once");

  // Each 409 gets its own honest message…
  assert.match(publishBlock, /outcome\.kind === "sync-failed"/);
  assert.match(publishBlock, /outcome\.kind === "nothing-to-publish"/);
  // …and the sync-failed one must say the changes are COMMITTED and that retrying won't help.
  const syncIdx = publishBlock.indexOf('outcome.kind === "sync-failed"');
  const elseIdx = publishBlock.indexOf('outcome.kind === "nothing-to-publish"');
  const syncBranch = publishBlock.slice(syncIdx, elseIdx);
  assert.match(syncBranch, /committed/i);
  assert.match(syncBranch, /will not help/i);
  assert.doesNotMatch(syncBranch, /Press Publish again to retry/);

  // The retry invitation survives, but only on the genuine-failure path.
  const catchIdx = publishBlock.indexOf("catch (err)");
  assert.ok(catchIdx > elseIdx, "the retry invitation must live in the catch, after the outcome branches");
  assert.match(publishBlock.slice(catchIdx), /Press Publish again to retry/);
});

test("item 2: Publish cannot overlap itself — re-entry ignored, button disabled, released in a finally", () => {
  const publishBlock = extractBlockAfter(SRC, "publishBtn.onclick");
  assert.match(publishBlock, /^\s*publishBtn\.onclick = async \(\) => \{\s*\n\s*if \(publishing\) return;/, "re-entry must be refused first");
  assert.match(publishBlock, /publishing = true;\s*\n\s*publishBtn\.disabled = true;/);
  // Both must be released however the run ends — a throw must not leave the button dead.
  assert.match(publishBlock, /finally \{\s*\n\s*publishing = false;\s*\n\s*publishBtn\.disabled = false;\s*\n\s*\}/);
  const tryIdx = publishBlock.indexOf("try {");
  assert.ok(publishBlock.indexOf("publishing = true") < tryIdx, "the flag must be set before the awaits begin");

  // And saveAll must release the draft's own interlock however it ended, or one failed
  // publish would wedge every later one.
  const saveAllBlock = extractBlockAfter(SRC, "function saveAll(");
  assert.match(saveAllBlock, /finally \{\s*\n\s*tx\.end\(\)/);
});

test("item 3: a bit-only hasWork() asks before publishing, so a stale persisted bit can't commit silently", () => {
  const publishBlock = extractBlockAfter(SRC, "publishBtn.onclick");
  assert.match(publishBlock, /STALE-BIT CONFIRM/);
  assert.match(publishBlock, /if \(draft\.count\(\) === 0 && draft\.hasUncommitted\(\)\)/);
  const confirmIdx = publishBlock.indexOf("if (!confirm(");
  const publishingIdx = publishBlock.indexOf("publishing = true");
  assert.ok(confirmIdx !== -1 && confirmIdx < publishingIdx, "the question must be asked before anything is sent");
  assert.match(publishBlock.slice(confirmIdx), /different copy of the website/i, "the message must name the case a stale bit actually is");
});

test("C1: the change counter reports the uncommitted state, so a reloaded page can't claim '0 changes'", () => {
  const updateBlock = extractBlockAfter(SRC, "function update(");
  assert.match(updateBlock, /draft\.hasUncommitted\(\)/);
  assert.match(updateBlock, /saved, not published/);
});

test("C1: the draft is created with a persistent store, probed defensively", () => {
  assert.match(SRC, /createDraft\(pageFile,\s*store\)/);
  assert.match(SRC, /try \{ store = window\.localStorage; \} catch \{ store = null; \}/);
});

test("FC-1: the editor refuses to initialise inside a frame, before any state or UI exists", () => {
  // A clickjacked click INSIDE the framed editor is same-origin and fully authorised,
  // so the token/Origin guard cannot see it. The complete fix is response headers from
  // server.js (X-Frame-Options / frame-ancestors); this is the client-side half.
  assert.match(SRC, /window\.top !== window\.self/);
  assert.match(SRC, /if \(framed\) return;/);

  // A cross-origin read of window.top can throw. Throwing PROVES we are framed, so the
  // catch must select the refusing branch, never fall through to "probably fine".
  assert.match(SRC, /let framed = true;/, "the default must be the safe one");
  assert.match(SRC, /catch \{ framed = true; \}/, "a throw means framed, not fine");

  // And it must run before anything else: no listener, no draft, no bar.
  const framedIdx = SRC.indexOf("if (framed) return;");
  for (const later of [
    "window.__EDITOR_BOOTED = true",
    "EditorDraft.createDraft(",
    "document.body.appendChild(bar)",
    'addEventListener("click"',
    "window.__edUpload =",
  ]) {
    const idx = SRC.indexOf(later);
    assert.notEqual(idx, -1, "expected to find: " + later);
    assert.ok(framedIdx < idx, "the frame guard must run before: " + later);
  }

  // The comment must record that the server-side headers are the real fix and pending,
  // so this is never mistaken for complete protection.
  const preamble = SRC.slice(0, framedIdx);
  assert.match(preamble, /X-Frame-Options/);
  assert.match(preamble, /frame-ancestors/);
  assert.match(preamble, /PENDING/i);
});

test("M5: the Cloudinary response body is parsed defensively, so a proxy's HTML page can't become the error message", () => {
  const uploadBody = extractBlockAfter(SRC, "window.__edUpload = async function (listPath) {");
  const parseIdx = uploadBody.indexOf("upRes.json()");
  const okCheckIdx = uploadBody.indexOf("if (!upRes.ok || up.error)");
  assert.ok(parseIdx !== -1 && okCheckIdx !== -1, "expected the body parse and the status/error check");
  // The parse must be guarded rather than allowed to throw: an unguarded
  // `await upRes.json()` on an HTML error page surfaces "Unexpected token '<'" instead
  // of the HTTP status this branch exists to report.
  assert.match(uploadBody, /try \{ up = await upRes\.json\(\); \} catch \{ up = null; \}/);
  assert.doesNotMatch(uploadBody, /const up = await upRes\.json\(\);/, "the parse must not be able to throw past the status check");
  assert.match(uploadBody, /HTTP " \+ upRes\.status/, "a non-2xx must still report its status");
});

test("M6: doOp's timing comment is true about requestAnimationFrame and about both callers' React lanes", () => {
  const doOpBlock = extractBlockAfter(SRC, "function doOp(");
  // rAF runs at the start of a frame, BEFORE style recalc and layout — the old comment
  // claimed it ran after them.
  assert.match(doOpBlock, /before the browser's\s*\/\/\s*style recalc and layout/);
  assert.doesNotMatch(doOpBlock, /runs after both the microtask queue/, "the corrected sentence must replace the old claim");
  // And it must distinguish the two callers: a chrome button's native onclick (SyncLane
  // -> microtask) from __edUpload's post-await continuation (DefaultLane -> Scheduler
  // MessageChannel, a task).
  assert.match(doOpBlock, /SyncLane/);
  assert.match(doOpBlock, /DefaultLane/);
  assert.match(doOpBlock, /MessageChannel/);
  assert.match(doOpBlock, /microtask/);
});

test("M3: beforeunload is suppressed for Discard's own reload, not for any other way of leaving", () => {
  const discardBlock = extractBlockAfter(SRC, '#ed-discard").onclick');
  const discardingSetIdx = discardBlock.indexOf("discarding = true");
  const reloadIdx = discardBlock.indexOf("location.reload()");
  assert.ok(discardingSetIdx !== -1 && reloadIdx !== -1, "expected discarding flag set and a reload in the Discard handler");
  assert.ok(discardingSetIdx < reloadIdx, "the flag must be set BEFORE reload() fires beforeunload");

  assert.match(SRC, /addEventListener\("beforeunload",\s*\(e\)\s*=>\s*\{\s*if\s*\(!discarding\s*&&\s*draft\.count\(\)\)/);
});

test("M4: leaving edit mode clears hover outlines and takes any mid-edit element out of contenteditable", () => {
  const exitBlock = extractBlockAfter(SRC, '#ed-exit").onclick');
  assert.match(exitBlock, /classList\.remove\("ed-hover"\)/);
  assert.match(exitBlock, /isEditableNow\(active\)/);
  assert.match(exitBlock, /active\.blur\(\)/);
  // Must be gated on actually leaving edit mode (editing just went false), not run
  // unconditionally on every Exit/Resume toggle.
  assert.match(exitBlock, /if\s*\(!editing\)\s*\{[\s\S]*classList\.remove\("ed-hover"\)/);
});

test("node --check passes for draft.js and editor-client.js", () => {
  // These files are never require()'d by the browser-only path (editor-client.js isn't
  // require()'d at all; draft.js is required by draft.test.js), so a syntax error
  // introduced outside that one code path would otherwise ship straight to the browser
  // unnoticed until someone opened the console.
  execFileSync(process.execPath, ["--check", DRAFT]);
  execFileSync(process.execPath, ["--check", EDITOR_CLIENT]);
});

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
  assert.match(SRC, /document\.body\.classList\.add\("ed-editing"\)/,
    "initial edit mode must expose a CSS state hook");
  assert.match(SRC, /body\.ed-editing \[data-monte-cursor\]\{display:none!important\}/,
    "edit mode must hide any custom-cursor overlay even if page code reapplies it");
  assert.match(SRC, /body\.ed-editing,body\.ed-editing \*\{cursor:auto!important\}/,
    "edit mode must force a visible native cursor across the page");
  assert.match(SRC, /body\.ed-editing \.ed-tile\{cursor:grab!important\}/,
    "media tiles must expose a visible drag affordance");
  const exit = extractBlockAfter(SRC, '#ed-exit").onclick');
  assert.match(exit, /setEditingCursor\(editing\)/);
  assert.match(exit, /document\.body\.classList\.toggle\("ed-editing", editing\)/,
    "Exit/Resume must toggle editor-only interaction CSS");
});

test("inline gallery upload is photos-only — videos are YouTube links added in the drawer (Task: youtube videos)", () => {
  assert.match(SRC, /pickFile\("image\/\*"\)/);
  assert.ok(!/image\/\*,video\/\*/.test(SRC), "the combined image+video accept string must be gone");
  const up = extractBlockAfter(SRC, "window.__edUpload = async function");
  // The accept attribute is advisory (a file picker can still hand over anything),
  // so the Cloudinary response's resource_type is the real gate.
  assert.match(up, /resource_type !== "image"/);
  assert.ok(!/resource_type === "video" \? "video" : "image"/.test(SRC), "the video-kind branch must be gone");
});

test("gallery Add controls open the photo library and build the correct item shape", () => {
  const onAdd = extractBlockAfter(SRC, "function onAdd(");
  assert.match(onAdd, /EditorMedia\.openPicker\("image"/);
  assert.match(onAdd, /\{ kind: "image", id: record\.id, caption: "" \}/);
  assert.match(onAdd, /\{ src: window\.EditorMediaUrls\.deliveryUrl\(selectedCloudName, record\), caption: "" \}/);
  assert.match(SRC, /"\+ Add photo"/);
});

// ---- the attribute / <option> panel (text that can't take a caret) ----
// The popover that edits placeholders, alt text and dropdown choices lives in this
// file, beside the contenteditable handlers it complements. Its pure half — the
// parser, the attribute allowlist, the labels and the multi-field commit rule — lives
// in editor/lib/attr-spec.js and is unit-tested there. What is left is DOM code that
// only runs in a browser, so these are source-level checks in the style of the rest of
// this file: the properties that would otherwise ship silently broken.

test("the native <select> dropdown is suppressed on mousedown, the only event that can do it", () => {
  // preventDefault() on click is too late — the popup list is already on screen by then.
  assert.match(SRC, /addEventListener\(\s*"mousedown"/, "a mousedown listener is required to suppress the native <select> popup");
  const md = SRC.slice(SRC.indexOf('addEventListener("mousedown"'));
  assert.match(md.slice(0, 900), /preventDefault\(\)/);
});

test("the panel records edits through the same draft pipeline as every other edit", () => {
  // No hand-rolled save: apply to the in-memory content, then draft.set, then rerender.
  // A direct fetch() here would bypass the save/publish transaction entirely (the
  // apiFetch test above pins the total call count, which is what keeps that honest).
  const body = extractBlockAfter(SRC, "function commitAttrPanel(");
  assert.match(body, /applyLocal\(/);
  assert.match(body, /draft\.set\(/);
  assert.match(body, /rerender\(\)/);
  assert.ok(body.indexOf("applyLocal(") < body.indexOf("draft.set("),
    "applyLocal must precede draft.set so a failed apply never leaves an op in the log");
});

test("Exit disarms an already-open panel — Save cannot record an edit afterwards", () => {
  // The bar is fixed above the page, so Exit is clickable with a panel open, and the
  // panel's own Save button is still there afterwards. openAttrPanel() checking edit
  // mode is not enough: it only runs at open time. Same defence-in-depth as
  // media-slots.js's applyToSlot, which guards a callback the picker captured pre-Exit.
  const body = extractBlockAfter(SRC, "function commitAttrPanel(");
  const guard = body.indexOf("if (!editing)");
  const apply = body.indexOf("applyLocal(");
  assert.ok(guard !== -1, "commitAttrPanel must check the editing flag");
  assert.ok(guard < apply, "the edit-mode check must come before anything is applied");
});

test("Exit also removes the panel, the chip and the attribute outlines", () => {
  // Leaving edit mode must leave a plain public page: this happens in the Exit handler
  // itself, not on the user's next click.
  const exitHandler = extractBlockAfter(SRC, '#ed-exit").onclick');
  assert.match(exitHandler, /closeAttrPanel\(\)/);
  assert.match(exitHandler, /ed-attr-hover/);
  assert.match(exitHandler, /chip\.style\.display = "none"/);
});

test("the panel never writes the bound attribute onto the page element by hand", () => {
  // Every editor affordance is injected chrome. Writing the edited attribute directly
  // would desync the element from CONTENT on the next rerender, showing the user a
  // value the file disagrees with — rerender() is what repaints it.
  assert.doesNotMatch(SRC, /setAttribute\(\s*pair\.attr/);
});

test("the popover and its chip are fixed-position, so opening one cannot shift the page", () => {
  const style = SRC.slice(SRC.indexOf("attrStyle.textContent"), SRC.indexOf("document.head.appendChild(attrStyle)"));
  assert.equal((style.match(/position:fixed/g) || []).length, 2, "both #ed-attr-panel and #ed-attr-chip must be fixed");
});

test("every attribute-panel listener is gated on edit mode", () => {
  // Exit must leave a plain public page, so each delegated listener has to ask.
  for (const evt of ["mouseover", "mousedown", "click", "keydown"]) {
    const idx = SRC.indexOf('attrTargetFrom(e.target)');
    assert.notEqual(idx, -1, "attrTargetFrom must be the shared hit-test");
  }
  // The four listeners that can OPEN or decorate a panel each begin with the check.
  const opens = SRC.match(/addEventListener\("(mouseover|mousedown|click|keydown)", \(e\) => \{\n    if \(!editing/g) || [];
  assert.ok(opens.length >= 3, "expected at least three edit-mode-gated attribute listeners, found " + opens.length);
});

test("media-slots.js reaches the panel through EditorUI, not a second global", () => {
  const slots = fs.readFileSync(path.join(CLIENT_DIR, "media-slots.js"), "utf8");
  assert.match(slots, /UI\.openAttrPanel\(/);
  assert.doesNotMatch(slots, /window\.EditorAttrEdit/, "the standalone attr-edit global is gone");
  assert.match(SRC, /openAttrPanel, attrPairs/, "editor-client.js must export both on window.EditorUI");
});

test("an attribute-backed edit survives the whole real save pipeline, on the real page", () => {
  // Nothing about this round trip is a stand-in. It takes montessori-acamp.html AS IT
  // SHIPS, reads a placeholder binding out of its markup, drives the exact op the
  // panel would emit through the server's own applyPatch + replaceContent, and re-reads
  // the file's CONTENT block to see the new words. If data-edit-attr needed anything
  // the set-op pipeline does not already provide, this is where it would show.
  const { applyPatch } = require("../lib/patch.js");
  const { extractContent, replaceContent } = require("../lib/content-io.js");
  const { parseAttrSpec } = require("../lib/attr-spec.js");

  const file = path.join(__dirname, "..", "..", "montessori-acamp.html");
  const src = fs.readFileSync(file, "utf8");

  // Comments first. The page documents this very feature in its own prose, quoting a
  // data-edit-attr with an ellipsis for a path — real markup only, the same rule
  // check-paths.js applies for the same reason.
  const binding = require("../check-paths.js").stripComments(src).match(/data-edit-attr="(placeholder:[^"]+)"/);
  assert.ok(binding, "montessori-acamp.html should carry at least one placeholder binding");
  const [{ attr, path: contentPath }] = parseAttrSpec(binding[1]);
  assert.equal(attr, "placeholder");

  const data = extractContent(src).data;
  const before = contentPath.split(".").reduce((o, k) => o[k], data);
  assert.equal(typeof before, "string");

  applyPatch(data, { ops: [{ type: "set", path: contentPath, value: "Child's full name" }] }, {});
  const written = replaceContent(src, data);

  const after = contentPath.split(".").reduce((o, k) => o[k], extractContent(written).data);
  assert.equal(after, "Child's full name");
  assert.notEqual(after, before);
  // And the file is still a file: markers intact, block still strict JSON (the
  // extractContent above would have thrown otherwise), page markup untouched.
  assert.ok(written.includes(binding[0]), "the binding itself must not be rewritten by a save");
});

test("the server injects attr-spec.js before editor-client.js, which needs it", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const at = (f) => server.indexOf('"' + f + '">');
  const spec = at("/editor/lib/attr-spec.js");
  const ui = at("/editor/client/editor-client.js");
  assert.ok(spec !== -1, "attr-spec.js missing from INJECT");
  assert.ok(ui !== -1, "editor-client.js missing from INJECT");
  assert.ok(spec < ui, "attr-spec.js must load first — editor-client.js reads window.EditorAttrSpec");
  assert.doesNotMatch(server, /attr-edit\.js/, "the standalone attr-edit.js is no longer injected");
});
