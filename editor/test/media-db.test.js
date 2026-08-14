"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readLibrary, addRecord, removeRecord } = require("../lib/media-db.js");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "msc-media-"));
}

const RECORD = {
  id: "msc/photo-abc123",
  kind: "image",
  name: "sports-day.jpg",
  format: "jpg",
  width: 4032,
  height: 3024,
  bytes: 2400000,
  createdAt: "2026-08-14T10:00:00.000Z",
};

test("readLibrary returns [] when media.json does not exist yet", () => {
  assert.deepEqual(readLibrary(tmpRoot()), []);
});

test("readLibrary throws a clear error on corrupt media.json rather than silently returning []", () => {
  // A silent [] here would be the worst outcome: the next addRecord would then
  // overwrite the corrupt-but-recoverable file with a one-item library.
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, "media.json"), "{ not json");
  assert.throws(() => readLibrary(root), /media\.json/);
});

test("readLibrary throws when media.json is valid JSON but not an array", () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, "media.json"), '{"media": []}');
  assert.throws(() => readLibrary(root), /media\.json/);
});

test("addRecord persists the record and readLibrary round-trips it", () => {
  const root = tmpRoot();
  addRecord(root, RECORD);
  assert.deepEqual(readLibrary(root), [RECORD]);
});

test("addRecord prepends — newest upload first", () => {
  const root = tmpRoot();
  addRecord(root, RECORD);
  const second = { ...RECORD, id: "msc/video-def456", kind: "video" };
  addRecord(root, second);
  assert.deepEqual(readLibrary(root).map((r) => r.id), [second.id, RECORD.id]);
});

test("addRecord writes git-friendly JSON: pretty-printed with a trailing newline", () => {
  const root = tmpRoot();
  addRecord(root, RECORD);
  const raw = fs.readFileSync(path.join(root, "media.json"), "utf8");
  assert.ok(raw.endsWith("\n"), "must end with a newline");
  assert.ok(raw.includes("\n  "), "must be indented, not single-line");
});

test("addRecord rejects a duplicate id — file untouched", () => {
  const root = tmpRoot();
  addRecord(root, RECORD);
  assert.throws(() => addRecord(root, { ...RECORD }), /already/i);
  assert.equal(readLibrary(root).length, 1);
});

test("addRecord rejects a missing or empty id", () => {
  const root = tmpRoot();
  assert.throws(() => addRecord(root, { ...RECORD, id: "" }), /id/);
  const noId = { ...RECORD };
  delete noId.id;
  assert.throws(() => addRecord(root, noId), /id/);
  assert.deepEqual(readLibrary(root), []);
});

test("addRecord rejects a kind other than image or video", () => {
  const root = tmpRoot();
  assert.throws(() => addRecord(root, { ...RECORD, kind: "raw" }), /kind/);
  assert.deepEqual(readLibrary(root), []);
});

test("addRecord rejects unknown keys so junk can never accumulate in the library", () => {
  const root = tmpRoot();
  assert.throws(() => addRecord(root, { ...RECORD, evil: "x" }), /evil/);
  assert.deepEqual(readLibrary(root), []);
});

test("addRecord rejects a non-object record (null, array, string)", () => {
  const root = tmpRoot();
  for (const bad of [null, [], "x", 42]) {
    assert.throws(() => addRecord(root, bad), /record/i);
  }
  assert.deepEqual(readLibrary(root), []);
});

test("addRecord rejects wrong-typed optional fields", () => {
  const root = tmpRoot();
  assert.throws(() => addRecord(root, { ...RECORD, width: "4032" }), /width/);
  assert.throws(() => addRecord(root, { ...RECORD, name: 7 }), /name/);
  assert.deepEqual(readLibrary(root), []);
});

test("removeRecord removes by id and reports true", () => {
  const root = tmpRoot();
  addRecord(root, RECORD);
  assert.equal(removeRecord(root, RECORD.id), true);
  assert.deepEqual(readLibrary(root), []);
});

test("removeRecord reports false for an id not in the library — file untouched", () => {
  const root = tmpRoot();
  addRecord(root, RECORD);
  assert.equal(removeRecord(root, "msc/never-uploaded"), false);
  assert.equal(readLibrary(root).length, 1);
});
