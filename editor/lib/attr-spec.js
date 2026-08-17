(function (exports) {
  "use strict";
  // data-edit-attr="<attribute>:<content path>[;<attribute>:<content path>…]"
  //
  // The companion to data-edit. data-edit binds an element's TEXT to a content
  // path; this binds an ATTRIBUTE's value to one. Both end up emitting the exact
  // same draft op — {type:"set", path, value} — so nothing downstream of the
  // browser (draft.js's log, /api/save, lib/patch.js's applyPatch, lib/paths.js's
  // setPath) knows or needs to know that an attribute was involved. The attribute
  // name never leaves the page.
  //
  // Which is precisely why the allowlist below lives HERE and is enforced at parse
  // time. The server validates the VALUE (patch.js's validateText: no <script>, no
  // CONTENT markers) and it validates the PATH (it must already resolve to a
  // string). Neither of those says anything about where the value is about to be
  // painted. `alt` and `placeholder` are words a visitor reads; `src`, `href` and
  // `on*` are behaviour and resources, and a string that is perfectly innocent as
  // alt text ("javascript:…", "//evil.example/x.png") is not innocent as an href.
  // Refusing at parse time keeps that distinction impossible to lose: a page that
  // tries to bind a non-text attribute fails `node editor/check-paths.js` in CI
  // rather than shipping a content field that quietly steers the page.
  //
  // Keep this list minimal. Every entry is an attribute whose entire contents are
  // human-readable prose, with no URL, selector, script or layout meaning.
  const EDITABLE_ATTRS = new Set(["alt", "aria-label", "placeholder", "title"]);

  const SHAPE = 'data-edit-attr must be "attribute:path" pairs separated by ";" — got: ';

  function parseAttrSpec(raw) {
    if (typeof raw !== "string") throw new Error(SHAPE + String(raw));
    const pairs = [];
    for (const chunk of raw.split(";")) {
      const piece = chunk.trim();
      if (piece === "") continue; // a trailing ";" is punctuation, not an empty binding
      // Split on the FIRST colon only: a `shared:` path contains one of its own, and
      // it has to survive intact or the value lands in the page's CONTENT block
      // instead of content.js (see draft.js's route()).
      const i = piece.indexOf(":");
      if (i <= 0) throw new Error(SHAPE + raw);
      const attr = piece.slice(0, i).trim().toLowerCase();
      const path = piece.slice(i + 1).trim();
      if (attr === "" || path === "") throw new Error(SHAPE + raw);
      if (!EDITABLE_ATTRS.has(attr))
        throw new Error('"' + attr + '" is not an editable attribute — only ' + [...EDITABLE_ATTRS].sort().join(", ") + " carry text a visitor reads");
      pairs.push({ attr, path });
    }
    if (pairs.length === 0) throw new Error(SHAPE + raw);
    return pairs;
  }

  // How each bound attribute is described to someone who has never heard the word
  // "attribute". These are the field labels in editor-client.js's attribute panel and
  // the text of its hover chip.
  const LABELS = {
    placeholder: "Hint text shown inside the empty box",
    alt: "Photo description, for screen readers and search engines",
    title: "Tooltip shown on hover",
    "aria-label": "Description read aloud by screen readers",
  };
  function labelFor(attr) {
    return LABELS[attr] || "Text";
  }

  // Decides what the attribute panel's Save actually does, given the rows the user
  // typed into. Pure, and it lives here rather than beside the DOM code for one
  // reason: the panel commits SEVERAL fields at once, which makes it the only place
  // in the editor where "validate" and "apply" are not the same instant. The
  // single-field blur handler in editor-client.js can validate and apply back to
  // back; a four-field panel that applied as it went would, on hitting an illegal
  // value in row three, leave rows one and two already recorded in the draft log —
  // edits the user never confirmed, invisible until Publish. So every row is checked
  // first and the whole panel is refused as a unit. See editor/test/attr-spec.test.js.
  //
  //   rows  [{ path, value, orig, label }]  — `value` raw from the input, `orig` the
  //                                           trimmed value the panel opened with
  //   deps  { rejectText, getLocal }        — draft.js's rule, and a content reader
  //
  // Returns { ops: [{path, value}], error: null } or { ops: null, error: "…" }.
  function planCommit(rows, deps) {
    const ops = [];
    const byPath = new Map();
    for (const r of rows) {
      const value = String(r.value == null ? "" : r.value).trim();
      if (value === r.orig) continue;
      // An emptied placeholder or alt is nearly always a slip (select-all, type
      // nothing, click away) and the result is invisible on the page — the box just
      // looks blank. Refuse it here rather than let it save silently; the server has
      // no opinion on empty strings, and neither does the contenteditable path,
      // which at least SHOWS the user the field it emptied.
      if (value === "") return { ops: null, error: '"' + r.label + '" can\'t be left empty.' };
      const rejection = deps.rejectText(value);
      // Exactly the rule editor/lib/patch.js's validateText enforces server-side,
      // reached through draft.js's mirror of it — no third copy is introduced here.
      if (rejection) return { ops: null, error: '"' + r.label + '": ' + rejection };
      // Checked before anything is applied: a stale binding (an element left from an
      // old render) or a shared: path when content.js never loaded would otherwise
      // throw inside applyLocal, after earlier rows had already been recorded.
      if (typeof deps.getLocal(r.path) !== "string")
        return { ops: null, error: '"' + r.label + '" points at ' + r.path + ', which is not a piece of text this page can save.' };
      if (byPath.has(r.path)) {
        // Same path twice with different values is an authoring mistake (two options
        // bound to one content key). Last-wins would save one value while the panel
        // showed the user the other.
        if (byPath.get(r.path) !== value)
          return { ops: null, error: "Two of these fields are the same piece of text (" + r.path + ") and were given different values." };
        continue;
      }
      byPath.set(r.path, value);
      ops.push({ path: r.path, value });
    }
    return { ops, error: null };
  }

  Object.assign(exports, { parseAttrSpec, EDITABLE_ATTRS, planCommit, labelFor, LABELS });
})(typeof module !== "undefined" ? module.exports : (window.EditorAttrSpec = {}));
