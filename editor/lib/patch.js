"use strict";
const { getPath, setPath, addItem, removeItem, moveItem } = require("./paths.js");
const { parseVideoId } = require("./youtube.js");

function validateText(value) {
  if (typeof value !== "string") throw new Error("Text value must be a string");
  if (/<\s*\/?\s*script/i.test(value)) throw new Error("Text may not contain script tags");
  if (/CONTENT:BEGIN|CONTENT:END/i.test(value)) throw new Error("Text may not contain CONTENT:BEGIN or CONTENT:END markers");
}

// A video reaches a block's embed.src by two routes, and both are our own code:
// collections.js builds the canonical youtube.com/embed/<id> when the block chooser adds
// a video, and media-urls.js builds the privacy-enhanced youtube-nocookie.com form with
// ?rel=0 when one is dropped on the block's media slot. Both must be acceptable — a rule
// that took only one would let the two routes disagree — but nothing else may reach an
// <iframe src> on a published page. validateText is not the relevant guard here: it
// blocks "<script", which is not the threat. The id is re-derived through lib/youtube.js
// so only a positively-identified video gets through.
const EMBED_SRC = /^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/[A-Za-z0-9_-]{11}(?:\?rel=0)?$/;
const EMBED_SRC_MESSAGE = "embed.src must be a YouTube embed link for a real video id.";

function isEmbedSrc(value) {
  return typeof value === "string" && EMBED_SRC.test(value) && parseVideoId(value) !== null;
}

// The same rule again, as a content path rather than a field inside an added item —
// because a media slot writes through `set`, which never touches LEAF_RULES. Without
// this, a value the `add` path refuses could still be written by a drop.
const EMBED_SRC_PATH = /^(?:pages\.[^.]+|fallback)\.blocks\.\d+\.embed\.src$/;

// Judgement calls a JSON shape template cannot express, keyed by the field path
// inside an item. Shape belongs in collections.json; these rules stay in code.
//   kind      — the shared-gallery item's provider tag; anything else would make
//               media-urls.js throw at render time on a published page.
//   embed.src — written verbatim into an <iframe src> on a published page; see
//               isEmbedSrc above for which forms are accepted and why. The same rule
//               runs on `set` (EMBED_SRC_PATH), because a media slot writes that way.
const LEAF_RULES = {
  "kind": {
    ok: (v) => v === "image" || v === "video",
    why: "kind must be image or video",
  },
  "embed.src": {
    ok: (v) => isEmbedSrc(v),
    why: EMBED_SRC_MESSAGE,
  },
};

// A subpage block is dispatched on truthiness — `if (b.p) … else if (b.h) … else if
// (b.note) …` in each subpage's renderVals(). So a block whose dispatch key is emptied
// matches no branch and renders NOTHING: no element, therefore no data-edit to click
// back into and no data-item to carry a ✕. The block still exists in CONTENT but the
// editor can no longer see or reach it, and the only way back is hand-editing the page —
// the exact pain this editor exists to remove. Emptying one of those keys is therefore
// refused outright; removing a section is what ✕ is for.
//
// Deliberately only these three. Every other editable string on a block sits inside a
// value that stays truthy when the string goes empty — a note's `sub`, a list row, a
// photo caption, a person's name — so emptying one hides a field, never the block.
const REQUIRES_TEXT = /^(?:pages\.[^.]+|fallback)\.blocks\.\d+\.(?:p|h|note)$/;
const REQUIRES_TEXT_MESSAGE = "A section needs some text. To remove the section entirely, use its ✕ button.";

function requiresText(path) {
  return typeof path === "string" && REQUIRES_TEXT.test(path);
}

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

function applyPatch(data, patch, templates) {
  for (const op of (patch && patch.ops) || []) {
    if (op.type === "set") {
      validateText(op.value);
      if (requiresText(op.path) && op.value.trim() === "") throw new Error(REQUIRES_TEXT_MESSAGE);
      // "" is how a video is taken off the page; the subpage maps it to about:blank.
      if (EMBED_SRC_PATH.test(op.path) && op.value !== "" && !isEmbedSrc(op.value)) throw new Error(EMBED_SRC_MESSAGE);
      if (typeof getPath(data, op.path) !== "string") throw new Error("Unknown or non-text path: " + op.path);
      setPath(data, op.path, op.value);
    } else if (op.type === "add") {
      validateShape(op.item, requireCollection(templates, op.path), "");
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

module.exports = { applyPatch, validateText, validateShape, requireCollection, requiresText, isEmbedSrc, REQUIRES_TEXT_MESSAGE };
