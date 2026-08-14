"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDraft, rejectText } = require("../client/draft.js");
const { validateText } = require("../lib/patch.js");

test("groups ops per file, stripping shared: prefix, preserving order", () => {
  const d = createDraft("index.html");
  d.set("hero.title", "A");
  d.listOp({ type: "add", path: "shared:news.acamp", item: { date: "", title: "", body: "" } });
  d.set("shared:news.acamp.0.title", "B");
  assert.equal(d.count(), 3);
  const p = d.toPatches();
  assert.deepEqual(Object.keys(p).sort(), ["content.js", "index.html"]);
  assert.deepEqual(p["index.html"].ops, [{ type: "set", path: "hero.title", value: "A" }]);
  assert.equal(p["content.js"].ops[0].type, "add");
  assert.deepEqual(p["content.js"].ops[1], { type: "set", path: "news.acamp.0.title", value: "B" });
  d.clear();
  assert.equal(d.count(), 0);
});

// I3(a) — the editor client needs a fast, friendly front door that mirrors the server's
// rejections (editor/lib/patch.js's validateText) so an obviously-doomed edit never
// reaches saveAll and risks writing an earlier file's patch before a later one 400s.
// The server stays the authority: this proves the client's copy of the rule agrees with
// it on every sample, not that the client invented its own, looser or stricter rule.
test("rejectText agrees with patch.js's validateText on every sample", () => {
  const samples = [
    "hello world",
    "",
    "  leading and trailing space  ",
    "<script>alert(1)</script>",
    "<SCRIPT src=x>evil</script >",
    "< / script>",
    "text containing CONTENT:BEGIN mid-sentence",
    "text containing content:end (any case)",
    "a perfectly normal sentence about school facilities.",
  ];
  for (const s of samples) {
    let serverRejects = false;
    try { validateText(s); } catch { serverRejects = true; }
    assert.equal(rejectText(s) !== null, serverRejects, "mismatch for: " + JSON.stringify(s));
  }
});

test("rejectText returns null (no rejection) for an ordinary edit", () => {
  assert.equal(rejectText("Welcome to Little Millennium"), null);
});

test("rejectText names which rule was violated", () => {
  assert.match(rejectText("<script>x</script>"), /script/i);
  assert.match(rejectText("oops CONTENT:END here"), /CONTENT:BEGIN|CONTENT:END/);
});
