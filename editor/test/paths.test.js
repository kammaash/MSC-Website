"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../lib/paths.js");

const fix = () => ({ hero: { title: "T" }, list: [{ t: "a" }, { t: "b" }, { t: "c" }] });

test("getPath resolves nested and indexed paths", () => {
  assert.equal(P.getPath(fix(), "hero.title"), "T");
  assert.equal(P.getPath(fix(), "list.1.t"), "b");
  assert.equal(P.getPath(fix(), "list.9.t"), undefined);
  assert.equal(P.getPath(fix(), "nope.x"), undefined);
});

test("setPath writes only existing paths", () => {
  const o = fix();
  P.setPath(o, "hero.title", "New");
  assert.equal(o.hero.title, "New");
  assert.throws(() => P.setPath(o, "hero.missing", "x"), /Path not found/);
  assert.throws(() => P.setPath(o, "list.5.t", "x"), /Path not found/);
});

test("list ops add, remove, move with bounds checks", () => {
  const o = fix();
  P.addItem(o, "list", { t: "d" });
  assert.equal(o.list.length, 4);
  P.removeItem(o, "list", 0);
  assert.equal(o.list[0].t, "b");
  P.moveItem(o, "list", 2, 0);
  assert.equal(o.list[0].t, "d");
  assert.throws(() => P.removeItem(o, "list", 99), /Bad index/);
  assert.throws(() => P.addItem(o, "hero", {}), /Not a list/);
});
