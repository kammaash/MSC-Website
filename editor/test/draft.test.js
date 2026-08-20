"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDraft, rejectText, applyListOp, classifyPublishResponse } = require("../client/draft.js");
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
  try {
    for (const [file, patch] of Object.entries(tx.patches)) {
      for (const op of patch.ops) applyListOp(disk[file], op);
      tx.markSaved(file);
    }
  } finally {
    tx.end();
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

test("markSavedToDisk (media uploads) sets the uncommitted bit without any pending ops, persists it, and markCommitted clears it", () => {
  // A media upload writes media.json on the server the moment it succeeds — no draft op
  // is ever pending, but the disk now differs from HEAD, exactly the state `uncommitted`
  // exists to report. Without this, a media-only session ends with Publish refusing
  // ("No changes to publish") while the upload sits unpublished on disk.
  const storage = memStore();
  const d = createDraft("index.html", storage);
  assert.equal(d.hasWork(), false);
  d.markSavedToDisk();
  assert.equal(d.count(), 0, "no pending ops — the write already happened server-side");
  assert.equal(d.hasUncommitted(), true);
  assert.equal(d.hasWork(), true, "Publish must have something to gate through");
  assert.equal(createDraft("index.html", storage).hasUncommitted(), true, "survives a reload");
  d.markCommitted();
  assert.equal(d.hasWork(), false);
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
  const tx = d.beginSave();
  tx.markSaved("index.html");
  tx.end();
  d.set("hero.sub", "B");
  d.clear();
  assert.equal(d.count(), 0);
  assert.equal(d.hasUncommitted(), true, "nothing in the browser can undo a file the server has written");
});

// ---------------------------------------------------------------------------
// Fix wave 2, item 1 — the transaction must have an exit for BOTH of the server's
// 409s. /api/publish does not signal success with 2xx alone:
//   409 "Nothing to publish (no changes)."        — the tree is already clean
//   409 "Published locally, but sync failed: …"   — the COMMIT SUCCEEDED, the push did not
// Treating either as a plain failure left `uncommitted` set with no way out: every further
// click answered "Nothing to publish (no changes)" while still inviting a retry, and the
// bar stayed "saved, not published" across reloads and editor restarts. The invitation was
// also false by then — the changes were committed, not merely saved.
// ---------------------------------------------------------------------------

// The exact strings server.js sends. Pinned here on purpose: classifyPublishResponse tells
// the two 409s apart by wording because the status cannot, so a change to server.js's
// message must fail HERE rather than silently strand a user in the field.
const NOTHING_409 = "Nothing to publish (no changes).";
const SYNC_409 =
  "Published locally, but sync failed: ! [rejected] main -> main (fetch first)\n" +
  "Your changes are committed; ask the site admin to resolve.";

test("item 1: the wording this classifier keys on still exists in server.js", () => {
  // The coupling is real and deliberate — a 409 status alone cannot separate "nothing to
  // commit" from "committed but not pushed". This test is what makes a server-side wording
  // change a red suite here instead of a user stuck with an uncleartable bar in the field.
  // (server.js is read, never written — it belongs to another change.)
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(src, /409,\s*"Nothing to publish \(no changes\)\."/, "server.js no longer sends the string classifyPublishResponse matches");
  assert.match(src, /409,\s*"Published locally, but sync failed: "/, "server.js no longer sends the string classifyPublishResponse matches");
  assert.equal(classifyPublishResponse(409, NOTHING_409).kind, "nothing-to-publish");
  assert.equal(classifyPublishResponse(409, SYNC_409).kind, "sync-failed");
});

test("item 1: a 200 ends the transaction", () => {
  assert.deepEqual(classifyPublishResponse(200, '{"ok":true}'), { committed: true, kind: "published" });
});

test("item 1: both of the server's 409s end the transaction, and are told apart", () => {
  assert.deepEqual(classifyPublishResponse(409, NOTHING_409), { committed: true, kind: "nothing-to-publish" });
  assert.deepEqual(classifyPublishResponse(409, SYNC_409), { committed: true, kind: "sync-failed" });
});

test("item 1: genuine failures do NOT end the transaction", () => {
  for (const [status, text] of [
    [500, "Publish failed: Author identity unknown"],
    [500, "Publish failed: Unable to create '.git/index.lock': File exists."],
    [403, "Forbidden"],
    [400, "Invalid publish request: body too large"],
  ]) {
    assert.deepEqual(classifyPublishResponse(status, text), { committed: false, kind: "failed" }, "status " + status);
  }
});

test("item 1: an UNRECOGNISED 409 falls back to the recoverable failure, never to a silent clear", () => {
  // If server.js's wording ever changes, the safe direction is the old stuck bar (which
  // the stale-bit confirm now makes survivable), not "published ✓" over uncommitted work.
  const r = classifyPublishResponse(409, "Some future 409 nobody has written yet");
  assert.deepEqual(r, { committed: false, kind: "failed" });
});

test("item 1: a push-conflict publish clears the bit, so the next click is not a doomed retry", () => {
  const disk = { "content.js": [] };
  const d = createDraft("index.html", memStore());
  d.listOp({ type: "add", path: "shared:news.acamp", item: { title: "A" } });
  saveAll(d, disk);
  assert.equal(d.hasUncommitted(), true);

  // git commit succeeded, git push did not.
  const outcome = classifyPublishResponse(409, SYNC_409);
  assert.equal(outcome.kind, "sync-failed");
  assert.equal(outcome.committed, true);
  d.markCommitted();

  assert.equal(d.hasUncommitted(), false, "the commit happened — the bit must not survive it");
  assert.equal(d.hasWork(), false, "further clicks must not be offered as a retry that cannot help");
  assert.equal(createDraft("index.html", memStore()).hasUncommitted(), false);
});

test("item 1: 'Nothing to publish' clears the bit too, so a stale one self-heals on the first click", () => {
  const store = memStore();
  store.setItem("msc-editor:uncommitted", "1"); // inherited from another checkout on the same port
  const d = createDraft("index.html", store);
  assert.equal(d.hasWork(), true, "precondition: the stale bit alone makes Publish available");

  const outcome = classifyPublishResponse(409, NOTHING_409);
  assert.equal(outcome.committed, true);
  d.markCommitted();

  assert.equal(d.hasWork(), false);
  assert.equal(createDraft("index.html", store).hasUncommitted(), false, "and it stays cleared across a reload");
});

// ---------------------------------------------------------------------------
// Fix wave 2, item 2 — retiring ops after a 200 makes the SEQUENTIAL retry safe but says
// nothing about two OVERLAPPING runs. Double-click Publish and both runs snapshot the same
// still-pending ops before either markSaved fires, both POST them, and the "add" lands
// twice. beginSave() now refuses to open a second transaction while one is open.
// ---------------------------------------------------------------------------

test("item 2: a second overlapping beginSave() is refused, so two runs cannot send the same ops", () => {
  const d = createDraft("index.html");
  d.set("hero.title", "A");

  const first = d.beginSave();
  assert.equal(d.isSaving(), true);
  assert.throws(() => d.beginSave(), /already in flight/, "the second click must not get its own snapshot");

  first.end();
  assert.equal(d.isSaving(), false);
  const second = d.beginSave(); // sequential is still perfectly fine
  assert.deepEqual(Object.keys(second.patches), ["index.html"]);
  second.end();
});

test("item 2: double-clicking Publish cannot duplicate an added item", () => {
  const disk = { "content.js": [{ title: "EXISTING" }] };
  const d = createDraft("index.html");
  d.listOp({ type: "add", path: "shared:news.acamp", item: { title: "ADDED" } });

  // Click 1 opens its transaction and its first /api/save is still in flight…
  const click1 = d.beginSave();
  // …when click 2 arrives. Before the interlock, this handed out the very same op.
  assert.throws(() => d.beginSave(), /already in flight/);

  // Click 1 completes normally.
  for (const [file, patch] of Object.entries(click1.patches)) {
    for (const op of patch.ops) applyListOp(disk[file], op);
    click1.markSaved(file);
  }
  click1.end();

  assert.deepEqual(disk["content.js"].map((x) => x.title), ["EXISTING", "ADDED"], "exactly one copy");
  assert.equal(d.count(), 0);
});

test("item 2: end() is idempotent and releases even when the run threw", () => {
  const d = createDraft("index.html");
  d.set("hero.title", "A");
  const tx = d.beginSave();
  try {
    throw new Error("/api/save 400d");
  } catch { /* the client's finally does this */ }
  tx.end();
  tx.end(); // a double release must not corrupt the interlock
  assert.equal(d.isSaving(), false);
  const next = d.beginSave();
  assert.equal(next.patches["index.html"].ops.length, 1, "the failed run's ops are still pending, and sendable again");
  next.end();
});

// ---- the empty-section rule, mirrored client-side (Task: empty-text block trap) ----
// Same discipline as rejectText above: the server stays the authority (lib/patch.js runs
// on every /api/save regardless of what the client does), and this proves the client's
// copy agrees with it rather than having invented a looser or stricter rule of its own.
// The client half exists so a doomed edit is refused at the moment the collaborator
// makes it, instead of surfacing at Publish against a file they have since kept editing.
const { rejectSet } = require("../client/draft.js");
const { applyPatch } = require("../lib/patch.js");
const templates = require("../collections.json");

test("rejectSet agrees with the server's set-op rules on every path/value pair", () => {
  // Every path below exists in this fixture, so a rejection can only come from the text
  // rules — never from "Unknown or non-text path".
  const fixture = () => ({
    pages: { library: { blocks: [
      { p: "text" }, { h: "heading" }, { note: "n", sub: "s" }, { list: [["t", "d"]] },
    ] } },
    fallback: { blocks: [{ p: "text" }] },
    hero: { title: "T" },
  });
  const paths = [
    "pages.library.blocks.0.p",
    "pages.library.blocks.1.h",
    "pages.library.blocks.2.note",
    "pages.library.blocks.2.sub",
    "pages.library.blocks.3.list.0.1",
    "fallback.blocks.0.p",
    "hero.title",
  ];
  const values = ["ordinary text", "", "   ", "\t\n ", "<script>x</script>", "CONTENT:END"];
  for (const path of paths) {
    for (const value of values) {
      let serverRejects = false;
      try { applyPatch(fixture(), { ops: [{ type: "set", path, value }] }, templates); }
      catch { serverRejects = true; }
      assert.equal(
        rejectSet(path, value) !== null, serverRejects,
        "mismatch for " + path + " = " + JSON.stringify(value)
      );
    }
  }
});

test("rejectSet names the way out when a section's text is emptied", () => {
  assert.match(rejectSet("pages.library.blocks.0.p", ""), /section needs some text/);
  assert.match(rejectSet("pages.library.blocks.0.p", ""), /✕/);
});

test("rejectSet still reports the plain text rules, so it replaces rejectText at the call site", () => {
  assert.match(rejectSet("hero.title", "<script>x</script>"), /script/i);
  assert.equal(rejectSet("hero.title", "ordinary"), null);
});
