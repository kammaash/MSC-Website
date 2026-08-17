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
  const apply = extractBlockAfter(SRC, "function applyToSlot");
  assert.match(apply, /if \(!UI\.isEditing\(\)\)/,
    "a captured picker callback must not write after edit mode exits");
  const applyLocalIdx = apply.indexOf("UI.applyLocal(");
  const draftSetIdx = apply.indexOf("UI.draft.set(");
  assert.ok(applyLocalIdx !== -1 && draftSetIdx !== -1 && applyLocalIdx < draftSetIdx,
    "applyLocal must run (and be able to throw) before draft.set records the op");
});

test("kind mismatch is refused before any mutation", () => {
  const apply = extractBlockAfter(SRC, "function applyToSlot");
  assert.match(apply, /record\.kind !== kind/);
});

test("shared gallery image slots preserve their public-ID storage shape", () => {
  const apply = extractBlockAfter(SRC, "function applyToSlot");
  assert.match(apply, /getAttribute\("data-media-value"\) === "id"/);
  assert.match(apply, /\? record\.id\s*:\s*URLS\.deliveryUrl/);
  assert.match(apply, /typeof value !== "string" \|\| value === ""/,
    "missing IDs and URLs must be rejected before the slot is mutated");
});

test("media uploads count as publishable disk state via markSavedToDisk — never here; placement is a draft op", () => {
  // Placement goes through draft.set (a pending op), NOT markSavedToDisk (which is
  // for server-side writes like the upload itself). Guard against confusing the two.
  assert.ok(!/markSavedToDisk/.test(SRC), "media-slots must not touch markSavedToDisk");
});

test("click, dragover and drop handlers are each editing-gated", () => {
  for (const event of ["click", "dragover", "drop"]) {
    const block = extractBlockAfter(SRC, `addEventListener("${event}"`);
    assert.match(block, /UI\.isEditing\(\)/, event + " must be editing-gated");
  }
});

test("dragover and drop accept only kind-matching slots before preventDefault", () => {
  for (const event of ["dragover", "drop"]) {
    const block = extractBlockAfter(SRC, `addEventListener("${event}"`);
    const editIdx = block.indexOf("UI.isEditing()");
    const kindIdx = block.indexOf('el.getAttribute("data-media-kind") !== kind');
    const preventIdx = block.indexOf("e.preventDefault()");
    assert.ok(editIdx !== -1 && kindIdx !== -1 && preventIdx !== -1 &&
      editIdx < preventIdx && kindIdx < preventIdx,
    event + " must gate editing and kind before making the drop legal");
    if (event === "dragover") {
      assert.equal((block.match(/e\.preventDefault\(\)/g) || []).length, 1,
        "dragover must have exactly one legal-drop preventDefault");
    }
  }
});

test("video iframe pointer events belong to the slot wrapper only while editing", () => {
  assert.match(SRC, /body\.ed-editing \[data-media-kind=video\] iframe\{pointer-events:none!important\}/);
});

test("image and video slots expose rounded, labelled hover and keyboard-focus actions only in edit mode", () => {
  assert.match(SRC, /body\.ed-editing \.ed-slot-actions/);
  assert.match(SRC, /\.ed-context-slot:hover>\.ed-slot-actions/);
  assert.match(SRC, /\.ed-context-slot:focus-within>\.ed-slot-actions/);
  assert.match(SRC, /border-radius:999px/);
  assert.match(SRC, /className = "ed-slot-action-icon"/);
  assert.match(SRC, /label \+ " for this " \+ slotEl\.getAttribute\("data-media-kind"\) \+ " area"/);
  assert.match(SRC, /prefers-reduced-motion:reduce/);
});

test("empty media slots show kind-specific Add; populated slots show Replace and Remove", () => {
  const decorate = extractBlockAfter(SRC, "function decorateSlotActions(");
  assert.match(decorate, /value === "" \? "empty" : "filled"/);
  assert.match(decorate, /"Add photo" : "Add video"/);
  assert.match(decorate, /mediaAction\("replace", "↻", "Replace"/);
  assert.match(decorate, /mediaAction\("remove", "×", "Remove"/);
});

test("media action buttons stop slot-click bubbling and Add/Replace reuse the verified picker", () => {
  const action = extractBlockAfter(SRC, "function mediaAction(");
  assert.match(action, /e\.preventDefault\(\); e\.stopPropagation\(\)/);
  assert.match(action, /action === "remove"/);
  assert.match(action, /openPickerForSlot\(slotEl\)/);
  const picker = extractBlockAfter(SRC, "function openPickerForSlot(");
  assert.match(picker, /EditorMedia\.openPicker/);
  assert.match(picker, /applyToSlot\(liveSlot\(path, slotEl\), record, cloudName\)/);
});

test("Remove clears only the page slot, confirms first, and records after apply succeeds", () => {
  const remove = extractBlockAfter(SRC, "function removeFromSlot(");
  assert.match(remove, /UI\.isEditing\(\)/);
  assert.match(remove, /kind === "image" \? "photo" : "video"/);
  assert.match(remove, /stay in the Media library/);
  assert.doesNotMatch(remove, /apiFetch|media\/delete|removeRecord/);
  const applyIdx = remove.indexOf('UI.applyLocal(path, "")');
  const draftIdx = remove.indexOf('UI.draft.set(path, "")');
  assert.ok(applyIdx !== -1 && draftIdx !== -1 && applyIdx < draftIdx,
    "Remove must apply successfully before recording the empty value");
  assert.match(remove, /UI\.rerender\(\); UI\.update\(\)/);
});

test("selection cancellation disarms picker mode, while drawer interactions remain usable", () => {
  const clear = extractBlockAfter(SRC, "function clearSelection(");
  assert.match(clear, /EditorMedia\.cancelPick\(\)/);
  const click = extractBlockAfter(SRC, 'addEventListener("click"');
  assert.match(click, /closest\("#ed-media"\)/,
    "drawer tile/control clicks must not be mistaken for off-slot page clicks");
  const picker = extractBlockAfter(SRC, "function openPickerForSlot(");
  assert.match(picker, /clearSelection\(false\)/,
    "picker cancellation callback must clear the selected outline without recursion");
});

test("record data never reaches innerHTML", () => {
  for (const m of SRC.match(/\.innerHTML\s*=\s*[^;]+;/g) || []) {
    assert.ok(!/\$\{/.test(m) && !/\brec\b|\brecord\b/.test(m), "innerHTML with data: " + m);
  }
});

test("click handler guards against swallowing interactive controls inside slots", () => {
  // Media slots may wrap list items whose own interactive chrome (buttons, etc.)
  // lives inside them. The capture-phase click listener must not claim clicks
  // targeting those controls, or stopPropagation() will prevent them from firing.
  assert.match(SRC, /e\.target\.closest.*button.*a.*input.*textarea.*select.*\[data-edit\].*\.ed-menu/);
  assert.match(SRC, /if \(interactive && el\.contains\(interactive\)\) return;/);
});

test("no video-element special-casing survives — video slots are iframes now", () => {
  assert.ok(!/\.load\(\)/.test(SRC), "no <video>.load() calls: iframe src changes reload themselves");
  assert.ok(!/data-media-poster/.test(SRC), "poster plumbing must not exist");
  assert.ok(!/posterUrl/.test(SRC), "posterUrl was deleted from media-urls");
});

// ---- alt text under a media slot ----
// A hero photo's <img> is covered edge-to-edge by this file's own hover overlay, so
// the data-edit-attr affordance in editor-client.js can never be reached with a mouse.
// The overlay therefore grows a third action for it rather than leaving the photo's
// description as the one string on the page with no way in.

test("a filled slot offers Describe alongside Replace and Remove", () => {
  const src = fs.readFileSync(FILE, "utf8");
  assert.match(src, /"describe"/, "a describe action must exist");
  assert.match(src, /Describe/, "the action needs a user-facing label");
});

test("Describe opens the editor's attribute panel rather than duplicating its logic", () => {
  const src = fs.readFileSync(FILE, "utf8");
  assert.match(src, /UI\.openAttrPanel\(/,
    "the description panel lives in editor-client.js — media-slots.js must call into it");
  assert.doesNotMatch(src, /draft\.set\(\s*[^)]*alt/i, "media-slots.js must not record alt edits itself");
});

test("Describe appears only when the slot actually contains a bound alt", () => {
  // Most slots have no alt binding (gallery images take their alt from an editable
  // caption). Offering the action there would open an empty panel.
  const src = fs.readFileSync(FILE, "utf8");
  assert.match(src, /\[data-edit-attr\]/, "the slot must be searched for a bound descendant");
});

test("a click on a bound element inside a slot is left to the attribute panel, not swallowed", () => {
  // The slot's click handler claims any click that isn't on a known interactive
  // control. [data-edit-attr] has to join that list or a bound <input> placeholder
  // sitting inside a slot would open the media picker instead of its own panel.
  const src = fs.readFileSync(FILE, "utf8");
  const selector = src.match(/closest\(\s*"(button, a, input[^"]*)"\s*\)/);
  assert.ok(selector, "the interactive-exclusion selector was not found");
  assert.match(selector[1], /\[data-edit-attr\]/);
});
