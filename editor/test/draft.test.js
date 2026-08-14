"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDraft, rejectText, applyListOp } = require("../client/draft.js");
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

// The server's validateText rejects a non-string before it ever reaches the regexes.
// rejectText mirrored only the two regex rules, so rejectText(null) returned "fine"
// while the server threw — the exact drift the "fast, friendly front door" is supposed
// not to have. These values can reach it through a data-edit path that resolves to a
// non-text node, which patch.js rejects server-side.
test("rejectText rejects non-strings, exactly as validateText does", () => {
  for (const v of [null, undefined, 42, true, {}, [], ["a"]]) {
    let serverRejects = false;
    try { validateText(v); } catch { serverRejects = true; }
    assert.equal(serverRejects, true, "precondition: the server must reject " + JSON.stringify(v));
    assert.equal(rejectText(v) !== null, true, "client must also reject " + JSON.stringify(v));
  }
  assert.match(rejectText(null), /string/i);
});

// ---------------------------------------------------------------------------
// C1 — the save/publish transaction.
//
// /api/save writes a file to disk and /api/publish commits it: two round trips, one
// user action. When the second one fails the natural next move is to press Publish
// again, and before this state machine existed that re-sent ops which had ALREADY been
// applied to the file on disk. The two scenarios below are the ones proved against a
// live server; they are reproduced here with applyListOp standing in for the server's
// parse -> mutate -> stringify, which is legitimate because
// editor/test/list-op-equivalence.test.js proves applyListOp and lib/paths.js agree.
// ---------------------------------------------------------------------------

// A save round: send every pending patch, apply it to "disk", retire its ops. Mirrors
// editor-client.js's saveAll().
function saveAll(draft, disk) {
  const tx = draft.beginSave();
  for (const [file, patch] of Object.entries(tx.patches)) {
    for (const op of patch.ops) applyListOp(disk[file], op);
    tx.markSaved(file);
  }
}

test("C1: a failed publish followed by the obvious retry does not duplicate an added item", () => {
  const disk = { "content.js": [{ title: "EXISTING" }] };
  const d = createDraft("index.html");
  d.listOp({ type: "add", path: "shared:news.acamp", item: { title: "ADDED" } });

  saveAll(d, disk);
  assert.deepEqual(disk["content.js"].map((x) => x.title), ["EXISTING", "ADDED"]);

  // /api/publish 500s (git identity unset, stale index.lock, …): markCommitted is NOT
  // called. The retry must still be offered, and must be a no-op for the save half.
  assert.equal(d.hasUncommitted(), true, "the write is on disk and uncommitted");
  assert.equal(d.hasWork(), true, "Publish must remain available, or the retry is impossible");
  assert.equal(d.count(), 0, "the saved ops must be gone from the log");

  saveAll(d, disk); // the user presses Publish again
  assert.deepEqual(
    disk["content.js"].map((x) => x.title),
    ["EXISTING", "ADDED"],
    "the retry must not append a second copy"
  );
});

test("C1: a failed publish followed by the obvious retry does not delete an innocent neighbour", () => {
  const disk = { "content.js": [{ title: "FIRST" }, { title: "SECOND" }] };
  const d = createDraft("index.html");
  d.listOp({ type: "remove", path: "shared:news.acamp", index: 0 });

  saveAll(d, disk);
  assert.deepEqual(disk["content.js"].map((x) => x.title), ["SECOND"]);

  saveAll(d, disk); // publish failed; the user presses Publish again
  assert.deepEqual(
    disk["content.js"].map((x) => x.title),
    ["SECOND"],
    "the retry must not remove index 0 a second time"
  );
});

test("C1: a successful publish ends the transaction — no pending ops, nothing uncommitted", () => {
  const disk = { "content.js": [] };
  const d = createDraft("index.html");
  d.listOp({ type: "add", path: "shared:news.acamp", item: { title: "A" } });
  saveAll(d, disk);
  d.markCommitted();
  assert.equal(d.count(), 0);
  assert.equal(d.hasUncommitted(), false);
  assert.equal(d.hasWork(), false, "Publish's guard must refuse a no-op publish once everything is committed");
});

test("C1: hasWork() is false on a clean draft and true as soon as anything is pending", () => {
  const d = createDraft("index.html");
  assert.equal(d.hasWork(), false);
  assert.equal(d.hasUncommitted(), false);
  d.set("hero.title", "A");
  assert.equal(d.hasWork(), true);
});

test("C1: a partial saveAll retires only the file that succeeded; the rest stays pending", () => {
  const d = createDraft("index.html");
  d.set("hero.title", "page edit");
  d.listOp({ type: "add", path: "shared:news.acamp", item: { title: "A" } });

  const tx = d.beginSave();
  assert.deepEqual(Object.keys(tx.patches).sort(), ["content.js", "index.html"]);
  tx.markSaved("content.js"); // 200
  // index.html then 400s — its op must survive, content.js's must not come back.
  assert.equal(d.count(), 1);
  assert.deepEqual(d.toPatches(), { "index.html": { ops: [{ type: "set", path: "hero.title", value: "page edit" }] } });
  assert.equal(d.hasUncommitted(), true);
  assert.equal(d.hasWork(), true);
});

test("C1: an edit made while a save is in flight is not swallowed by that save's markSaved", () => {
  const d = createDraft("index.html");
  d.set("hero.title", "first");
  const tx = d.beginSave();                 // snapshot taken here
  d.set("hero.sub", "typed during the request"); // user keeps editing
  tx.markSaved("index.html");               // the in-flight save returns 200
  assert.equal(d.count(), 1, "only the snapshotted op may be retired");
  assert.deepEqual(d.toPatches(), { "index.html": { ops: [{ type: "set", path: "hero.sub", value: "typed during the request" }] } });
});

test("C1: the wire patch carries only ops — no bookkeeping fields leak into the request body", () => {
  const d = createDraft("index.html");
  d.set("hero.title", "A");
  const tx = d.beginSave();
  assert.deepEqual(Object.keys(tx.patches["index.html"]), ["ops"]);
  assert.deepEqual(JSON.parse(JSON.stringify(tx.patches)), tx.patches);
});

test("C1: toPatches() is a read-only view — it never retires an op", () => {
  const d = createDraft("index.html");
  d.set("hero.title", "A");
  d.toPatches(); d.toPatches();
  assert.equal(d.count(), 1);
  assert.equal(d.hasUncommitted(), false);
});

// The deferred finding folded into C1: "saved to disk" outlives the page. Discard
// reloads, and a reloaded page that forgot would show 0 changes and no warning while
// the edits sat in the working tree waiting for the next Publish to commit them.
function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test("C1: the uncommitted state survives a reload, so Discard and the reloaded bar stay honest", () => {
  const store = memStore();
  const before = createDraft("index.html", store);
  before.set("hero.title", "A");
  before.beginSave().markSaved("index.html");
  assert.equal(before.hasUncommitted(), true);

  const afterReload = createDraft("index.html", store); // Discard's location.reload()
  assert.equal(afterReload.count(), 0, "pending ops are genuinely gone — the reload dropped them");
  assert.equal(afterReload.hasUncommitted(), true, "but the disk writes are still uncommitted, and must be reported");
  assert.equal(afterReload.hasWork(), true, "Publish must still be able to commit them");

  afterReload.markCommitted();
  assert.equal(createDraft("index.html", store).hasUncommitted(), false, "committing must clear the persisted bit too");
});

test("C1: a storage that throws degrades to in-memory instead of breaking the editor", () => {
  const hostile = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
    removeItem() { throw new Error("SecurityError"); },
  };
  const d = createDraft("index.html", hostile);
  assert.equal(d.hasUncommitted(), false);
  d.set("hero.title", "A");
  d.beginSave().markSaved("index.html");
  assert.equal(d.hasUncommitted(), true, "the in-memory flag stays authoritative");
  d.markCommitted();
  assert.equal(d.hasUncommitted(), false);
});

test("C1: clear() drops pending ops but cannot un-write what the server already wrote", () => {
  const d = createDraft("index.html", memStore());
  d.set("hero.title", "A");
  d.beginSave().markSaved("index.html");
  d.set("hero.sub", "B");
  d.clear();
  assert.equal(d.count(), 0);
  assert.equal(d.hasUncommitted(), true, "nothing in the browser can undo a file the server has written");
});
