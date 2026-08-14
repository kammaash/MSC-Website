"use strict";
// Proves editor/client/draft.js's applyListOp — what the BROWSER applies optimistically
// to the in-memory content object the instant a chrome button (+ Add / ↑ / ↓ / ✕) is
// clicked — computes the exact same resulting array as editor/lib/paths.js's
// addItem/removeItem/moveItem — what the SERVER applies authoritatively, inside
// applyPatch, when /api/save actually writes content.js to disk.
//
// A drift between the two is the most damaging failure this editor can have, and it
// would be invisible until Publish: the tile the user watched move or disappear
// client-side would not be the one that actually moved or disappeared on disk. This
// test turns that "the splice arithmetic matches" claim from an eyeballed read into a
// real, mechanically-checked one, across the boundary cases that are most likely to
// expose an off-by-one: moving the first item, moving the last item, removing the
// first item, removing the last item.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyListOp } = require("../client/draft.js");
const { addItem, removeItem, moveItem } = require("../lib/paths.js");

function viaServer(list, op) {
  const obj = { list: list.map((x) => ({ ...x })) };
  if (op.type === "add") addItem(obj, "list", op.item);
  else if (op.type === "remove") removeItem(obj, "list", op.index);
  else if (op.type === "move") moveItem(obj, "list", op.from, op.to);
  else throw new Error("unknown op: " + op.type);
  return obj.list;
}
function viaClient(list, op) {
  const copy = list.map((x) => ({ ...x }));
  applyListOp(copy, op);
  return copy;
}
const SAMPLE = () => [{ n: "a" }, { n: "b" }, { n: "c" }, { n: "d" }];

test("add: client and server produce identical arrays", () => {
  const op = { type: "add", item: { n: "e" } };
  assert.deepEqual(viaClient(SAMPLE(), op), viaServer(SAMPLE(), op));
});

test("move first -> second (0 -> 1): client and server agree", () => {
  const op = { type: "move", from: 0, to: 1 };
  const result = viaClient(SAMPLE(), op);
  assert.deepEqual(result, viaServer(SAMPLE(), op));
  assert.deepEqual(result.map((x) => x.n), ["b", "a", "c", "d"]);
});

test("move last -> second-last (3 -> 2): client and server agree", () => {
  const op = { type: "move", from: 3, to: 2 };
  const result = viaClient(SAMPLE(), op);
  assert.deepEqual(result, viaServer(SAMPLE(), op));
  assert.deepEqual(result.map((x) => x.n), ["a", "b", "d", "c"]);
});

test("remove first (index 0): client and server agree", () => {
  const op = { type: "remove", index: 0 };
  const result = viaClient(SAMPLE(), op);
  assert.deepEqual(result, viaServer(SAMPLE(), op));
  assert.deepEqual(result.map((x) => x.n), ["b", "c", "d"]);
});

test("remove last (index 3): client and server agree", () => {
  const op = { type: "remove", index: 3 };
  const result = viaClient(SAMPLE(), op);
  assert.deepEqual(result, viaServer(SAMPLE(), op));
  assert.deepEqual(result.map((x) => x.n), ["a", "b", "c"]);
});

// The ↑/↓ chrome buttons only ever issue adjacent single-step moves (from -> from±1),
// and for those specifically, splice(to, 0, splice(from, 1)[0]) and the transposed
// splice(from, 0, splice(to, 1)[0]) produce the SAME result — an adjacent swap is
// symmetric in from/to. That means the two boundary tests above, despite matching what
// the real UI does, would not by themselves catch the argument order being swapped. A
// non-adjacent move is what actually discriminates the two argument positions, which is
// why it's asserted here on its own (in addition to appearing inside the composite
// sequence test below).
test("move non-adjacent (1 -> 3): client and server agree, and the result is NOT symmetric under swapping from/to", () => {
  const op = { type: "move", from: 1, to: 3 };
  const result = viaClient(SAMPLE(), op);
  assert.deepEqual(result, viaServer(SAMPLE(), op));
  assert.deepEqual(result.map((x) => x.n), ["a", "c", "d", "b"]);
  const swapped = { type: "move", from: op.to, to: op.from };
  assert.notDeepEqual(result, viaServer(SAMPLE(), swapped), "sanity check: a non-adjacent move must NOT equal its from/to-swapped counterpart, or this test couldn't have caught a transposed argument bug");
});

test("a mixed add/move/remove sequence stays identical at every step, applied to independent arrays", () => {
  let a = SAMPLE();
  let b = SAMPLE();
  const ops = [
    { type: "add", item: { n: "e" } },       // a b c d e
    { type: "move", from: 4, to: 1 },        // a e b c d
    { type: "remove", index: 0 },            // e b c d
    { type: "move", from: 0, to: 3 },        // b c d e
  ];
  for (const op of ops) {
    a = viaClient(a, op);
    b = viaServer(b, op);
    assert.deepEqual(a, b, "client/server diverged at op " + JSON.stringify(op));
  }
  assert.deepEqual(a.map((x) => x.n), ["b", "c", "d", "e"]);
});
