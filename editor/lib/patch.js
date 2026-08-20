"use strict";
const { getPath, setPath, addItem, removeItem, moveItem } = require("./paths.js");
const { parseVideoId } = require("./youtube.js");

function validateText(value) {
  if (typeof value !== "string") throw new Error("Text value must be a string");
  if (/<\s*\/?\s*script/i.test(value)) throw new Error("Text may not contain script tags");
  if (/CONTENT:BEGIN|CONTENT:END/i.test(value)) throw new Error("Text may not contain CONTENT:BEGIN or CONTENT:END markers");
}

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

module.exports = { applyPatch, validateText, validateShape, requireCollection };
