"use strict";
// The media library "database": a git-committed media.json at the site root holding an
// array of records describing every asset uploaded through the editor. The asset BYTES
// live in Cloudinary (uploaded straight from the browser, signed by /api/sign); this
// file is the index the media drawer lists, so it publishes and syncs between
// collaborators exactly like the site content does — no server-side database process,
// same as the rest of this zero-dependency editor.
const fs = require("node:fs");
const path = require("node:path");

// One authority for what a record may contain, patch.js-style: unknown keys are
// rejected outright so junk can never accumulate in a file that lives forever in git.
// `id` is the Cloudinary public_id — with cloudName (already in shared content) it
// derives every delivery/thumbnail URL, so no URL is ever stored.
const FIELDS = {
  id: { type: "string", required: true },
  kind: { type: "string", required: true },
  name: { type: "string" },
  format: { type: "string" },
  width: { type: "number" },
  height: { type: "number" },
  bytes: { type: "number" },
  createdAt: { type: "string" },
};
const KINDS = ["image", "video"];

function mediaPath(root) {
  return path.join(root, "media.json");
}

function readLibrary(root) {
  let raw;
  try {
    raw = fs.readFileSync(mediaPath(root), "utf8");
  } catch (e) {
    // Not existing yet is the normal fresh state. Anything else (EACCES, EISDIR, ...)
    // must surface, not masquerade as an empty library — a later write would then
    // clobber whatever is actually there.
    if (e.code === "ENOENT") return [];
    throw e;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("media.json is not valid JSON — fix or restore it before using the media library");
  }
  if (!Array.isArray(data)) {
    throw new Error("media.json must contain a JSON array of media records");
  }
  return data;
}

function validateRecord(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Media record must be an object");
  }
  for (const key of Object.keys(record)) {
    if (!FIELDS[key]) throw new Error("Unknown media record key: " + key);
  }
  for (const [key, spec] of Object.entries(FIELDS)) {
    const v = record[key];
    if (v === undefined) {
      if (spec.required) throw new Error("Media record is missing required key: " + key);
      continue;
    }
    if (typeof v !== spec.type) throw new Error("Media record key " + key + " must be a " + spec.type);
  }
  if (record.id === "") throw new Error("Media record id must be a non-empty string");
  if (!KINDS.includes(record.kind)) throw new Error("Media record kind must be one of: " + KINDS.join(", "));
}

function writeLibrary(root, records) {
  fs.writeFileSync(mediaPath(root), JSON.stringify(records, null, 2) + "\n");
}

function addRecord(root, record) {
  validateRecord(record); // throws => nothing written
  const records = readLibrary(root);
  if (records.some((r) => r && r.id === record.id)) {
    throw new Error("A media record with this id already exists: " + record.id);
  }
  records.unshift(record); // newest first — the order the drawer shows
  writeLibrary(root, records);
  return record;
}

function removeRecord(root, id) {
  const records = readLibrary(root);
  const next = records.filter((r) => !(r && r.id === id));
  if (next.length === records.length) return false;
  writeLibrary(root, next);
  return true;
}

module.exports = { readLibrary, addRecord, removeRecord, validateRecord };
