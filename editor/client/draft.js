(function (exports) {
  "use strict";
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
})(typeof module !== "undefined" ? module.exports : (window.EditorDraft = {}));
