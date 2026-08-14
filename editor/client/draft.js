(function (exports) {
  "use strict";
  // Mirrors editor/lib/patch.js's validateText exactly (same two rules, same order) —
  // that file remains the authority, since it runs server-side on every /api/save
  // regardless of what the client does. This is only a fast, friendly front door: reject
  // client-side, before saveAll() writes anything, so a doomed edit never has a chance to
  // land some files on disk and then fail on a later one (see editor-client.js's blur
  // handler). Returns null when the value is fine, or a message naming the violated rule.
  function rejectText(value) {
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
  function createDraft(pageFile) {
    let ops = [];
    const route = (p) => (p.startsWith("shared:") ? ["content.js", p.slice(7)] : [pageFile, p]);
    return {
      set(path, value) { ops.push({ type: "set", path, value }); },
      listOp(op) { ops.push(op); },
      count() { return ops.length; },
      toPatches() {
        const byFile = {};
        for (const op of ops) {
          const [file, path] = route(op.path);
          (byFile[file] = byFile[file] || { ops: [] }).ops.push({ ...op, path });
        }
        return byFile;
      },
      clear() { ops = []; },
    };
  }
  exports.createDraft = createDraft;
  exports.rejectText = rejectText;
  exports.applyListOp = applyListOp;
})(typeof module !== "undefined" ? module.exports : (window.EditorDraft = {}));
