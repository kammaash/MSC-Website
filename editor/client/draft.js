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
})(typeof module !== "undefined" ? module.exports : (window.EditorDraft = {}));
