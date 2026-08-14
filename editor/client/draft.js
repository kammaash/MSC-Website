(function (exports) {
  "use strict";
  // Mirrors editor/lib/patch.js's validateText exactly (same three rules, same order) —
  // that file remains the authority, since it runs server-side on every /api/save
  // regardless of what the client does. This is only a fast, friendly front door: reject
  // client-side, before saveAll() writes anything, so a doomed edit never has a chance to
  // land some files on disk and then fail on a later one (see editor-client.js's blur
  // handler). Returns null when the value is fine, or a message naming the violated rule.
  function rejectText(value) {
    if (typeof value !== "string") return "Text value must be a string";
    if (/<\s*\/?\s*script/i.test(value)) return "Text may not contain script tags";
    if (/CONTENT:BEGIN|CONTENT:END/i.test(value)) return "Text may not contain CONTENT:BEGIN or CONTENT:END markers";
    return null;
  }
  // Applies an add/move/remove op directly to an in-memory array — the single place
  // that encodes "what a list op means" on the client. Deliberately mirrors
  // editor/lib/paths.js's addItem/removeItem/moveItem exactly: same splice calls, same
  // argument order, same bounds guard on remove/move (same error message shape, too).
  // That file remains the authority (it's what the server actually applies to
  // content.js on /api/save), so this is a copy that must never drift from it — see
  // editor/test/list-op-equivalence.test.js, which runs the same ops through both and
  // asserts identical resulting arrays, including the boundary cases (move
  // first<->second, last<->second-last, remove first/last). A drift here is the most
  // damaging failure this editor can have: the browser would show one item moving or
  // disappearing while /api/save actually moves or removes a different one.
  function applyListOp(list, op) {
    if (op.type === "add") { list.push({ ...op.item }); return; }
    if (op.type === "remove") {
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= list.length) throw new Error("Bad index: " + op.index);
      list.splice(op.index, 1);
      return;
    }
    if (op.type === "move") {
      for (const i of [op.from, op.to])
        if (!Number.isInteger(i) || i < 0 || i >= list.length) throw new Error("Bad index: " + i);
      list.splice(op.to, 0, list.splice(op.from, 1)[0]);
      return;
    }
    throw new Error("Unknown list op type: " + (op && op.type));
  }
  // ---- the save/publish transaction ----
  // Publishing is TWO server round trips: /api/save writes each file to disk, then
  // /api/publish commits (and maybe pushes) them. Those are one action to the user and
  // two to the machine, and both defects found in this seam came from pretending
  // otherwise. A draft therefore tracks two INDEPENDENT facts:
  //
  //   pending    (`ops`)         — recorded in this browser, NOT yet written to disk
  //   uncommitted (`uncommitted`) — already written to disk, NOT yet committed
  //
  // An op crosses from the first to the second exactly once, in a transaction's
  // markSaved(file), which DELETES that file's ops from the log. That deletion is the
  // whole fix for the replay bug: /api/save applies a patch by parse -> mutate ->
  // stringify against whatever is on disk *now*, so replaying an already-saved op is
  // always wrong — it appends a second copy of an added item, or removes whatever
  // innocent neighbour has slid into the deleted index. Once markSaved has run there
  // is physically nothing left to replay, so the obvious "Publish failed, click
  // Publish again" retry cannot corrupt anything. Impossible by construction, not by
  // remembering to check a flag.
  //
  // `uncommitted` is persisted through the optional `storage` argument (localStorage in
  // the browser) because it describes the repo's working tree, not this page: Discard
  // reloads, and a reloaded page that had forgotten would show "0 changes" and offer no
  // warning while those edits sat on disk waiting for the next Publish to sweep them
  // into a commit. Storage is best-effort — a browser that refuses it (private mode
  // throws on access) just loses the memory across a reload, never the ability to edit.
  // The key is scoped to the localStorage origin, i.e. http://localhost:<port> — NOT to a
  // particular checkout. Two clones served on the same port at different times therefore
  // share this bit, and nothing the page can see distinguishes them: the server injects
  // only window.__EDITOR_TOKEN, which is minted fresh on every boot, and location gives
  // the same "/" for either clone. Rather than fake an identity, the editor makes a stale
  // bit HARMLESS: hasWork() being true with zero pending ops is the only state a stale bit
  // can produce on its own, and editor-client.js confirms with the user before publishing
  // in exactly that state (search "STALE-BIT CONFIRM"). A stale bit also self-heals on the
  // first Publish against a clean tree, since the server's "Nothing to publish" 409 ends
  // the transaction and clears it.
  const STORAGE_KEY = "msc-editor:uncommitted";

  // What an /api/publish response means for the transaction. Kept here — beside the state
  // it ends — and unit-tested, because "which responses end the transaction" is the half
  // of this state machine that is easiest to get wrong: the server does NOT signal success
  // with 2xx alone.
  //
  //   200 {ok:true}                        committed and pushed (or push disabled)
  //   409 "Nothing to publish (no changes)" the tree is already clean — nothing left to
  //                                         commit, so the transaction is over
  //   409 "Published locally, but sync…"    the COMMIT SUCCEEDED and only the push failed;
  //                                         this is the push-conflict case, the most
  //                                         realistic trigger of the whole retry story
  //
  // Both 409s end the transaction. Treating them as plain failures left `uncommitted` set
  // forever: every further click answered "Nothing to publish (no changes)" while still
  // inviting a retry, the bar stayed "saved, not published" through reloads and restarts,
  // and the invitation was a lie — by then the changes were committed, not merely saved.
  //
  // FRAGILE ON PURPOSE: the two 409s are told apart by the server's own wording
  // (server.js's /api/publish handler), because the status code alone cannot separate
  // them. If that wording changes, this classifier stops recognising the case and an
  // unrecognised 409 falls back to "not committed" — which restores the old stuck bar,
  // the recoverable failure, rather than silently clearing the bit and claiming work is
  // published when it is not. editor/test/draft.test.js pins both strings so a wording
  // change is a test failure here, not a mystery in the field.
  const PUBLISH_409 = [
    [/^Nothing to publish/, "nothing-to-publish"],
    [/^Published locally, but sync failed/, "sync-failed"],
  ];
  function classifyPublishResponse(status, text) {
    if (status >= 200 && status < 300) return { committed: true, kind: "published" };
    if (status === 409) {
      for (const [re, kind] of PUBLISH_409) if (re.test(String(text))) return { committed: true, kind };
    }
    return { committed: false, kind: "failed" };
  }

  function createDraft(pageFile, storage) {
    let ops = [];
    let inFlight = false; // one open beginSave() transaction at a time — see beginSave()
    const route = (p) => (p.startsWith("shared:") ? ["content.js", p.slice(7)] : [pageFile, p]);
    const readStore = () => { try { return !!storage && storage.getItem(STORAGE_KEY) === "1"; } catch { return false; } };
    // The in-memory flag stays authoritative; storage is only a mirror, so a storage
    // that throws degrades to "forgets across reload" rather than breaking the session.
    let uncommitted = readStore();
    const setUncommitted = (v) => {
      uncommitted = v;
      try { if (storage) { if (v) storage.setItem(STORAGE_KEY, "1"); else storage.removeItem(STORAGE_KEY); } } catch { /* best effort */ }
    };
    // Groups `list` into the wire shape /api/save expects, and remembers which original
    // op objects fed each file so they can be removed by identity later.
    const group = (list) => {
      const patches = {};
      const sources = new Map();
      for (const op of list) {
        const [file, path] = route(op.path);
        (patches[file] = patches[file] || { ops: [] }).ops.push({ ...op, path });
        if (!sources.has(file)) sources.set(file, []);
        sources.get(file).push(op);
      }
      return { patches, sources };
    };
    return {
      set(path, value) { ops.push({ type: "set", path, value }); },
      listOp(op) { ops.push(op); },
      count() { return ops.length; },
      // True once anything has been written to disk without a successful commit after
      // it. Survives a reload (see STORAGE_KEY above).
      hasUncommitted() { return uncommitted; },
      // What the Publish button must gate on. NOT `count() === 0`: after a save
      // succeeds and the commit fails there are zero pending ops and yet there is
      // very much something to publish — the files already on disk. Gating on the
      // count alone would make the retry impossible and strand those edits until some
      // later, unrelated publish quietly swept them up.
      hasWork() { return ops.length > 0 || uncommitted; },
      // Read-only view of what is still pending, for tests and diagnostics. Anything
      // that actually SENDS a patch must use beginSave(), which is the only path that
      // can retire an op from the log.
      toPatches() { return group(ops).patches; },
      // Opens a save transaction over the ops recorded so far. The snapshot is taken
      // here, so an edit the user makes while an /api/save is still in flight stays
      // pending instead of being silently marked as saved by a markSaved() call that
      // was never told about it.
      //
      // Only ONE transaction may be open at a time. Retiring ops after a 200 makes the
      // SEQUENTIAL retry safe, but says nothing about two OVERLAPPING runs: double-click
      // Publish and both runs snapshot the same still-pending ops before either one's
      // markSaved fires, both POST them, and the "add" lands twice. editor-client.js also
      // disables the button for the duration — that is the fix the user experiences — but
      // the interlock here is what makes a second concurrent send impossible rather than
      // merely unlikely. Release it with end(), from a finally.
      beginSave() {
        if (inFlight) throw new Error("A save is already in flight — finish or fail it before starting another");
        inFlight = true;
        const { patches, sources } = group(ops.slice());
        let open = true;
        return {
          patches,
          // Call ONLY after /api/save returned 200 for `file`.
          markSaved(file) {
            const done = new Set(sources.get(file) || []);
            if (done.size === 0) return;
            ops = ops.filter((op) => !done.has(op)); // removed by identity, so mid-flight edits survive
            setUncommitted(true);
          },
          // Idempotent, so a finally can call it without caring how the run ended.
          end() { if (open) { open = false; inFlight = false; } },
        };
      },
      // True while a transaction opened by beginSave() has not been end()ed.
      isSaving() { return inFlight; },
      // Call ONLY when classifyPublishResponse() reports committed: true — which includes
      // both 409s, not just a 200. See that function for why.
      markCommitted() { setUncommitted(false); },
      // Throws away pending ops. Does not touch `uncommitted` — nothing in the browser
      // can un-write a file the server already wrote.
      clear() { ops = []; },
    };
  }
  exports.createDraft = createDraft;
  exports.rejectText = rejectText;
  exports.applyListOp = applyListOp;
  exports.classifyPublishResponse = classifyPublishResponse;
})(typeof module !== "undefined" ? module.exports : (window.EditorDraft = {}));
