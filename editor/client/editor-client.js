(function () {
  "use strict";
  // FC-1 — refuse to initialise anywhere but the top-level document. The Origin/token
  // guard in server.js stops a foreign page from CALLING /api/*, but it cannot stop one
  // from FRAMING http://localhost:8899 (the fixed default port) and steering the user's
  // clicks into it: a click that lands inside the frame is same-origin and fully
  // authorised, and "+ Add" (no dialog) followed by "Publish" (no dialog before the
  // request) is two clicks that commit — and, with the shipped "push": true, push — a
  // placeholder card to the live school site.
  //
  // The COMPLETE fix is response headers the framing page cannot opt out of:
  // X-Frame-Options: DENY, Content-Security-Policy: frame-ancestors 'none', and
  // X-Content-Type-Options: nosniff. That work belongs in editor/server.js and is still
  // PENDING — this client-side check is the half that can ship today, and it is not a
  // substitute (a framed page could still be served if this script failed to load).
  //
  // It runs first, before any state, listener or UI exists, so a framed editor is
  // absent rather than merely disabled. Reading window.top is a cross-origin property
  // access when the framer is foreign and can throw; a throw proves we are NOT the top
  // document, so it is treated as a positive detection, not as "probably fine".
  let framed = true;
  try { framed = window.top !== window.self; } catch { framed = true; }
  if (framed) return;

  if (window.__EDITOR_BOOTED) return;
  window.__EDITOR_BOOTED = true;
  const P = window.EditorPaths;
  const pageFile = location.pathname.replace(/^\//, "") || "index.html";
  // The draft persists its "saved to disk but not committed" bit here. Property access
  // on window.localStorage itself throws in some privacy modes, so it is probed once and
  // degraded to null — the draft treats a missing store as "nothing remembered".
  let store = null;
  try { store = window.localStorage; } catch { store = null; }
  const draft = window.EditorDraft.createDraft(pageFile, store);
  const applyListOp = window.EditorDraft.applyListOp; // shared with lib/paths.js — see doOp() below
  let editing = true;

  // The site's custom cursor (cursor.js) hides the native pointer and draws a pen
  // that only yields over its own fixed selector list — editable elements aren't in
  // it, so while editing it actively fights the editor (no I-beam over fields, ink
  // strokes over drop targets). While editing, hand back the native cursor. apply(),
  // never set(): the visitor-facing preference in localStorage must survive editing.
  function setEditingCursor(editingNow) {
    if (!window.MonteCursor) return; // page without cursor.js
    window.MonteCursor.apply(editingNow ? "Native" : window.MonteCursor.get());
  }
  // cursor.js boots on DOMContentLoaded and its listener was registered earlier in
  // parse order (it loads in the page's own markup; this file is injected before
  // </body>), so this listener fires AFTER the pen boots — Native lands last. If the
  // document is somehow already parsed, MonteCursor exists now and is applied now.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setEditingCursor(editing); });
  } else {
    setEditingCursor(true);
  }

  // Every /api/* call must carry this header — the server mints one random token per
  // boot and injects it as window.__EDITOR_TOKEN before this script runs (see
  // server.js's TOKEN_SCRIPT). Without it every request 403s; a foreign page cannot
  // read this global (it's same-origin only) so it can't forge the header either.
  // content-type defaults to application/json — every /api/* POST requires it exactly
  // (server.js's uniform guard) — but a caller (e.g. Task 13's upload signing) can still
  // override it by passing its own headers.content-type, since opts.headers is merged
  // in after the default and before the non-negotiable token.
  function apiFetch(url, opts) {
    const headers = Object.assign({ "content-type": "application/json" }, opts && opts.headers, { "x-editor-token": window.__EDITOR_TOKEN });
    return fetch(url, Object.assign({}, opts, { headers }));
  }

  // A 403 from any /api/* call practically always means window.__EDITOR_TOKEN no longer
  // matches what the server currently expects — the server mints one random token per boot
  // (see server.js's TOKEN_SCRIPT) and forgets the old one the instant it restarts, but a
  // tab left open across that restart keeps holding the dead token in memory. The server's
  // own body for that case is the bare word "Forbidden", which read literally in an
  // alert() ("Publish failed:\nForbidden") tells the user nothing they can act on. Reload
  // re-fetches the page and its current token, which is the actual fix — say that instead.
  function describeApiError(status, text) {
    if (status === 403) {
      return "The editor server appears to have restarted, so this browser tab's session " +
        "is no longer valid.\n\nReload the page and try again.";
    }
    return text;
  }

  // ---- helpers shared with collections chrome (Task 12) ----
  function targetFor(path) {
    return path.startsWith("shared:") ? [window.SHARED_CONTENT, path.slice(7)] : [window.__CONTENT, path];
  }
  function applyLocal(path, valueOrFn) {
    const [obj, p] = targetFor(path);
    if (typeof valueOrFn === "function") valueOrFn(P.getPath(obj, p)); // list mutation
    else P.setPath(obj, p, valueOrFn);
  }
  function getLocal(path) {
    const [obj, p] = targetFor(path);
    return P.getPath(obj, p);
  }
  function rerender() { if (window.__rerender) window.__rerender(); }

  // The only two values `el.contentEditable = "..."` ever produces (see the click
  // handler below): "plaintext-only" normally, or "true" as the fallback for browsers
  // that reject "plaintext-only". `getAttribute("contenteditable")` is truthy for the
  // string "false" too, so a plain truthiness check would refuse to ever open an
  // element explicitly authored contenteditable="false" in the page's own markup.
  function isEditableNow(el) {
    const v = el.getAttribute("contenteditable");
    return v === "plaintext-only" || v === "true";
  }

  // ---- top bar ----
  const bar = document.createElement("div");
  bar.id = "ed-bar";
  bar.innerHTML =
    '<style>' +
    '#ed-bar{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;gap:10px;align-items:center;' +
    'background:#26201d;color:#fff;font:13px/1.4 -apple-system,sans-serif;padding:8px 14px;box-shadow:0 1px 6px rgba(0,0,0,.3)}' +
    '#ed-bar button{font:inherit;padding:4px 12px;border-radius:6px;border:0;cursor:pointer;background:#4a423c;color:#fff}' +
    '#ed-bar #ed-publish{background:#e8541b;font-weight:600}' +
    // Cursor.js may re-apply itself after a page rerender. Edit mode therefore
    // enforces native cursors in CSS as well as calling MonteCursor.apply("Native").
    'body.ed-editing [data-monte-cursor]{display:none!important}' +
    'body.ed-editing,body.ed-editing *{cursor:auto!important}' +
    'body.ed-editing [data-edit]{cursor:text!important}' +
    'body.ed-editing button,body.ed-editing a,body.ed-editing [data-media-slot]{cursor:pointer!important}' +
    'body.ed-editing .ed-tile{cursor:grab!important}' +
    'body.ed-editing .ed-tile:active{cursor:grabbing!important}' +
    '.ed-hover{outline:2px dashed #e8541b !important;outline-offset:2px;cursor:text}' +
    // justify-self:start only ever affects a grid ITEM's own sizing, so it's inert
    // everywhere .ed-add sits as a flex/block sibling — but on the two subpages
    // listEl.parentElement is a `grid-template-columns:1fr` container, so without it
    // the button stretches to the full column width (measured 756px vs 99px
    // everywhere else) instead of hugging its own text like every other Add button.
    '.ed-add{font:600 13px sans-serif;margin:10px 0;padding:8px 16px;border:2px dashed #e8541b;border-radius:8px;' +
    'background:#fff;color:#e8541b;cursor:pointer;justify-self:start}' +
    '.ed-menu{position:absolute;top:6px;right:6px;display:flex;gap:4px;z-index:9999}' +
    // A section block (family "blocks") nests its own rows/photos, each with their
    // OWN top-right menu one level down. On a subpage the block root and its first
    // row both start position:relative at the same top-right corner (the rows
    // container's top margin collapses through — position:relative alone doesn't
    // create a block formatting context), so the section's menu painted directly on
    // top of the row's, and the row's ↑ ↓ ✕ were entirely unreachable. Top-left
    // rather than a negative top offset: a negative offset would instead overlap the
    // page's section heading above the very first block.
    '.ed-menu.ed-menu-block{right:auto;left:6px}' +
    '.ed-menu button{font:12px sans-serif;width:26px;height:26px;border-radius:6px;border:0;cursor:pointer;' +
    'background:#26201d;color:#fff}' +
    // ✕ matches the media overlay's remove action (#a51915 fill, white glyph) so the
    // editor's two destructive controls look like one idea. Disabled = at the floor.
    '.ed-menu button.ed-del{background:#a51915;border-radius:999px;border:2px solid rgba(255,255,255,.82)}' +
    '.ed-menu button.ed-del:disabled{opacity:.45;cursor:not-allowed}' +
    '.ed-menu.ed-menu-slot{right:auto;left:6px}' +
    '</style>' +
    '<strong>✏️ Editing</strong><span id="ed-count">0 changes</span><span style="flex:1"></span>' +
    '<button id="ed-publish">Publish</button><button id="ed-discard">Discard</button><button id="ed-exit">Exit</button>';
  document.body.appendChild(bar);

  const countEl = bar.querySelector("#ed-count");
  // Shared state hook for editor-only interaction CSS (notably video-slot iframe
  // pointer handling). The editor scripts are injected only by the local server,
  // and Exit must restore the public page's normal interactions immediately.
  document.body.classList.add("ed-editing");
  // Reports both halves of the transaction (see draft.js's createDraft), because they
  // are separately true: edits can be pending in this browser, already saved to disk
  // and awaiting a commit, or both at once. Showing only the pending count is what let
  // a reloaded page claim "0 changes" while saved edits sat in the working tree.
  function update() {
    const n = draft.count();
    const parts = [];
    if (n || !draft.hasUncommitted()) parts.push(n + " change" + (n === 1 ? "" : "s"));
    if (draft.hasUncommitted()) parts.push("saved, not published");
    countEl.textContent = parts.join(" · ");
  }

  // ---- text editing ----
  document.body.addEventListener("mouseover", (e) => {
    if (!editing) return;
    const el = e.target.closest && e.target.closest("[data-edit]");
    if (el) el.classList.add("ed-hover");
  });
  document.body.addEventListener("mouseout", (e) => {
    const el = e.target.closest && e.target.closest("[data-edit]");
    if (el) el.classList.remove("ed-hover");
  });
  document.body.addEventListener("click", (e) => {
    if (!editing) return;
    const el = e.target.closest && e.target.closest("[data-edit]");
    if (!el) return;
    e.preventDefault(); e.stopPropagation(); // block link navigation while editing
    if (isEditableNow(el)) return; // already editing it
    // Trim at capture time so the "unchanged" check below compares like with like: the
    // source markup around a {{ }} hole (see support.js's walkText) keeps its literal
    // surrounding whitespace/indentation as part of the text node, e.g.
    // "\n        {{ hero.sub }}\n      " — so el.textContent is padded with that
    // indentation on first load. Comparing an untrimmed capture against a trimmed
    // commit would treat every edit as "changed" (harmless) but comparing two untrimmed
    // values would let the padding itself compound on every round trip.
    el.__edOrig = el.textContent.trim();
    try { el.contentEditable = "plaintext-only"; } catch { el.contentEditable = "true"; }
    el.focus();
  }, true);
  document.body.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !isEditableNow(el)) return;
    if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    if (e.key === "Escape") { el.textContent = el.__edOrig; el.blur(); }
  }, true);
  document.body.addEventListener("blur", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.hasAttribute || !el.hasAttribute("data-edit")) return;
    if (!isEditableNow(el)) return;
    el.removeAttribute("contenteditable");
    const path = el.getAttribute("data-edit");
    const value = el.textContent.trim();
    if (value === el.__edOrig) return;
    const rejection = window.EditorDraft.rejectSet(path, value);
    if (rejection) {
      // Same rules the server enforces (editor/lib/patch.js's validateText and its
      // empty-section rule, both mirrored in draft.js's rejectSet) — reject here so the
      // user finds out immediately, not after saveAll has already written an earlier
      // file to disk. Path-aware, because whether an empty value is allowed depends on
      // WHERE it is going: emptying a section's own text would make the whole block
      // render nothing and leave nothing on screen to click or delete.
      el.textContent = el.__edOrig;
      alert("Can't save this edit:\n" + rejection);
      return;
    }
    try {
      // Do this before recording the op: a stale data-edit (element left over from an
      // old render) or a shared: path when SHARED_CONTENT never loaded makes
      // EditorPaths.setPath throw "Path not found". If that happens the op must never
      // reach the draft log — there'd be nothing to remove it later, the counter would
      // over-report, and Publish would be the first place the failure surfaces.
      applyLocal(path, value); // keep in-memory content in sync so rerenders don't revert
    } catch (err) {
      el.textContent = el.__edOrig;
      alert("Can't save this edit:\n" + err.message);
      return;
    }
    draft.set(path, value);
    update();
  }, true);

  // ---- text that can't take a caret: attributes and <option> labels ----
  // The handlers above make an element's TEXT editable: click, contentEditable, blur,
  // save. That covers almost the whole site, but it structurally cannot cover two
  // things a visitor still reads:
  //
  //   1. ATTRIBUTES — a form field's placeholder, an image's alt text. There is no
  //      text node to put a caret in.
  //   2. <option> LABELS — the browser paints a native dropdown, no click ever
  //      reaches the <option>, and no browser lets an <option> be contenteditable.
  //
  // Both are solved the same way: a small fixed-position popover holding one plain
  // <input> per string. The popover is the ONLY new thing. Everything behind it is
  // the machinery every other edit already uses — validated with draft.js's
  // rejectText, applied with applyLocal, recorded with draft.set, repainted by
  // rerender. The op that reaches /api/save is a plain {type:"set", path, value},
  // indistinguishable from one a contenteditable blur produced, so patch.js, paths.js
  // and the save/publish transaction needed no changes at all.
  //
  // Markup contract:
  //   <input  data-edit-attr="placeholder:admissionsSection.namePlaceholder">
  //   <img    data-edit-attr="alt:footer.logoAlt">        (";"-separated for several)
  //   <select>… <option data-edit="admissionsSection.optionUnsure">…
  //
  // <option> deliberately reuses plain data-edit rather than inventing a third
  // attribute: an option's editable string IS its element text, so it gets
  // check-paths.js's existing validation for free. Only the AFFORDANCE differs. The
  // [data-edit] handlers above never fire for one, because a click on a <select>
  // targets the <select> and closest() only ever walks upwards.
  //
  // The parsing, the attribute allowlist, the field labels and the multi-field commit
  // rule all live in editor/lib/attr-spec.js — require()-able, and unit-tested there.
  const SPEC = window.EditorAttrSpec;

  const attrStyle = document.createElement("style");
  attrStyle.textContent =
    // Mirrors [data-edit]'s dashed outline, so the two kinds of editable text read as
    // one feature rather than two.
    ".ed-attr-hover{outline:2px dashed #e8541b!important;outline-offset:2px}" +
    "body.ed-editing [data-edit-attr]{cursor:text!important}" +
    "body.ed-editing select.ed-attr-select{cursor:pointer!important}" +
    // The chip names what a click would edit. Fixed, so it can never move the page.
    "#ed-attr-chip{position:fixed;z-index:2147483001;display:none;max-width:280px;padding:5px 9px;border-radius:7px;" +
    "background:#26201d;color:#fff;font:12px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
    "box-shadow:0 4px 14px rgba(0,0,0,.3);pointer-events:none}" +
    // Likewise fixed: opening the popover must not reflow a single pixel of the page.
    "#ed-attr-panel{position:fixed;z-index:2147483002;width:340px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);" +
    "overflow:auto;background:#fff;color:#26201d;border-radius:12px;border:1px solid rgba(38,32,29,.16);" +
    "box-shadow:0 18px 44px rgba(0,0,0,.28);padding:16px;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
    "#ed-attr-panel h3{margin:0 0 4px;font:600 15px/1.3 inherit}" +
    "#ed-attr-panel .ed-attr-note{margin:0 0 12px;color:#6b615b;font-size:12px}" +
    "#ed-attr-panel label{display:block;margin:0 0 12px}" +
    "#ed-attr-panel label span{display:block;margin-bottom:4px;color:#6b615b;font-size:11.5px}" +
    "#ed-attr-panel input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid rgba(38,32,29,.28);" +
    "border-radius:7px;font:14px inherit;color:#26201d;background:#fff}" +
    "#ed-attr-panel input:focus{outline:2px solid #e8541b;outline-offset:1px}" +
    "#ed-attr-panel .ed-attr-fixed{margin:0 0 12px;padding:8px 10px;border-radius:7px;background:#f6f1ed;color:#6b615b;font-size:12px}" +
    "#ed-attr-panel .ed-attr-fixed b{display:block;color:#26201d;font-size:13.5px;font-weight:600;margin-bottom:2px}" +
    "#ed-attr-panel .ed-attr-buttons{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}" +
    "#ed-attr-panel button{font:inherit;padding:7px 14px;border-radius:7px;border:0;cursor:pointer;background:#eee7e1;color:#26201d}" +
    "#ed-attr-panel button.ed-attr-save{background:#a51915;color:#fff;font-weight:600}" +
    // The block chooser reuses the attribute panel's visual language on purpose —
    // same radius, shadow and type scale — so it reads as the same editor.
    "#ed-block-chooser{position:fixed;z-index:2147483002;width:200px;background:#fff;color:#26201d;border-radius:12px;" +
    "border:1px solid rgba(38,32,29,.16);box-shadow:0 18px 44px rgba(0,0,0,.28);padding:10px;" +
    "font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
    "#ed-block-chooser h3{margin:2px 4px 8px;font:600 12px/1.3 inherit;color:#6b615b;text-transform:uppercase;letter-spacing:.06em}" +
    "#ed-block-chooser button{display:block;width:100%;text-align:left;font:inherit;padding:8px 10px;border-radius:7px;" +
    "border:0;cursor:pointer;background:transparent;color:#26201d}" +
    "#ed-block-chooser button:hover{background:#f6f1ed}";
  document.head.appendChild(attrStyle);

  const chip = document.createElement("div");
  chip.id = "ed-attr-chip";
  document.body.appendChild(chip);

  // The attribute bindings on `el`, or [] if it has none / the spec is malformed. A
  // malformed spec is a page-authoring bug that `node editor/check-paths.js` fails on;
  // here it just means "not editable", so one bad binding can never take the whole
  // editor down mid-session.
  function attrPairs(el) {
    const raw = el.getAttribute && el.getAttribute("data-edit-attr");
    if (!raw) return [];
    try { return SPEC.parseAttrSpec(raw); } catch { return []; }
  }

  // A <select> is editable when at least one of its options carries data-edit. Options
  // WITHOUT one are shown in the panel as read-only rows: on index.html and
  // montessori-vidyanagar.html the first few choices are rendered from the school /
  // programme cards above, and those are already click-editable there. Binding them
  // here as well would give one string two editing surfaces — the same reason the
  // alt="{{ f.title }}" images are left alone.
  function optionRows(sel) {
    return Array.prototype.map.call(sel.options, (opt, i) => ({ opt, path: opt.getAttribute("data-edit"), index: i }));
  }
  function selectIsEditable(sel) {
    return optionRows(sel).some((r) => !!r.path);
  }

  // The element a click should open a panel for, or null. Order matters: an <option>
  // lives inside a <select>, and a bound <img> can live inside anything.
  function attrTargetFrom(node) {
    if (!node || !node.closest) return null;
    const sel = node.closest("select");
    if (sel && selectIsEditable(sel)) return sel;
    const bound = node.closest("[data-edit-attr]");
    if (bound && attrPairs(bound).length) return bound;
    return null;
  }

  // What the hover chip says. Deliberately describes the STRING, not the mechanism.
  function chipTextFor(el) {
    if (el.tagName === "SELECT") return "✏️ Edit the choices in this list";
    const pairs = attrPairs(el);
    if (pairs.length === 1) return "✏️ " + SPEC.labelFor(pairs[0].attr);
    return "✏️ Edit this text";
  }

  let attrPanel = null;
  let attrAnchor = null;

  function closeAttrPanel() {
    if (attrPanel) attrPanel.remove();
    attrPanel = null;
    attrAnchor = null;
  }

  // Clamped to the viewport so a field near the bottom or the right edge still gets a
  // fully visible panel. Measured after insertion, because the height depends on how
  // many rows there are.
  function placeAttrPanel(el) {
    const r = el.getBoundingClientRect();
    const p = attrPanel.getBoundingClientRect();
    const gap = 8;
    let top = r.bottom + gap;
    if (top + p.height > window.innerHeight - gap) top = Math.max(gap, r.top - p.height - gap);
    if (top + p.height > window.innerHeight - gap) top = Math.max(gap, window.innerHeight - p.height - gap);
    let left = r.left;
    if (left + p.width > window.innerWidth - gap) left = window.innerWidth - p.width - gap;
    attrPanel.style.top = Math.max(gap, top) + "px";
    attrPanel.style.left = Math.max(gap, left) + "px";
  }

  // Reads the value a row should open with. The DOM is the source of truth for what is
  // on screen, but CONTENT is the source of truth for what will be saved, and the two
  // agree except for the whitespace the template leaves around a {{ hole }} — so
  // prefer CONTENT and fall back to the DOM only if the path cannot be read.
  function attrCurrentValue(path, domFallback) {
    let v;
    try { v = getLocal(path); } catch { v = undefined; }
    return typeof v === "string" ? v : String(domFallback == null ? "" : domFallback).trim();
  }

  function attrFieldRow(labelText, path, value) {
    const label = document.createElement("label");
    const cap = document.createElement("span");
    cap.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    label.appendChild(cap);
    label.appendChild(input);
    return { node: label, input, path, orig: value, label: labelText };
  }

  function attrFixedRow(text) {
    const d = document.createElement("div");
    d.className = "ed-attr-fixed";
    const b = document.createElement("b");
    b.textContent = text;
    d.appendChild(b);
    d.appendChild(document.createTextNode("Edited with the cards above — change it there and this choice follows."));
    return d;
  }

  // Builds the row list for `el`. A <select> contributes its options; anything else
  // contributes its data-edit-attr pairs.
  function buildAttrRows(el, body) {
    const rows = [];
    if (el.tagName === "SELECT") {
      optionRows(el).forEach((r) => {
        if (!r.path) { body.appendChild(attrFixedRow(r.opt.text.trim())); return; }
        const f = attrFieldRow("Choice " + (r.index + 1), r.path, attrCurrentValue(r.path, r.opt.text));
        rows.push(f);
        body.appendChild(f.node);
      });
      return rows;
    }
    attrPairs(el).forEach((pair) => {
      const f = attrFieldRow(SPEC.labelFor(pair.attr), pair.path, attrCurrentValue(pair.path, el.getAttribute(pair.attr)));
      rows.push(f);
      body.appendChild(f.node);
    });
    return rows;
  }

  function commitAttrPanel(rows) {
    // Defence in depth, and not a theoretical one: the editor bar is fixed above the
    // page, so Exit is perfectly clickable with a panel open, and the panel's own Save
    // button survives the click. openAttrPanel() checks edit mode, but only at the
    // moment it opens. Without this, Exit → Save would record content edits on a page
    // that is meant to be behaving as the plain public site. (media-slots.js's
    // applyToSlot carries the same guard, for the same shape of bug.)
    if (!editing) { closeAttrPanel(); return false; }
    const plan = SPEC.planCommit(
      rows.map((r) => ({ path: r.path, value: r.input.value, orig: r.orig, label: r.label })),
      {
        rejectText: window.EditorDraft.rejectText,
        getLocal: (p) => { try { return getLocal(p); } catch { return undefined; } },
      }
    );
    if (plan.error) { alert("Can't save this edit:\n" + plan.error); return false; }
    if (!plan.ops.length) return true;
    for (const op of plan.ops) {
      try {
        // Apply first, record only on success — the same invariant as the blur handler
        // above and doOp below. planCommit already proved each path resolves to a
        // string, so reaching this catch means something changed underneath us; stop
        // rather than press on, so the log never describes an edit that did not happen.
        applyLocal(op.path, op.value);
      } catch (err) {
        alert("Can't save this edit:\n" + err.message);
        return false;
      }
      draft.set(op.path, op.value);
    }
    rerender();
    update();
    return true;
  }

  function openAttrPanel(el) {
    if (!editing || !el) return;
    closeAttrPanel();
    chip.style.display = "none";
    attrAnchor = el;

    attrPanel = document.createElement("div");
    attrPanel.id = "ed-attr-panel";
    attrPanel.setAttribute("role", "dialog");
    attrPanel.setAttribute("aria-label", "Edit text");

    const h = document.createElement("h3");
    h.textContent = el.tagName === "SELECT" ? "The choices in this list" : "Text you can't click on the page";
    const note = document.createElement("p");
    note.className = "ed-attr-note";
    note.textContent = el.tagName === "SELECT"
      ? "These are the options someone picks from when sending an enquiry."
      : "This wording is part of the page but can't be clicked directly.";
    attrPanel.appendChild(h);
    attrPanel.appendChild(note);

    const body = document.createElement("div");
    attrPanel.appendChild(body);
    const rows = buildAttrRows(el, body);

    const buttons = document.createElement("div");
    buttons.className = "ed-attr-buttons";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeAttrPanel(); };
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ed-attr-save";
    saveBtn.textContent = "Save";
    saveBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (commitAttrPanel(rows)) closeAttrPanel(); };
    buttons.appendChild(cancelBtn);
    buttons.appendChild(saveBtn);
    attrPanel.appendChild(buttons);

    // Enter saves, Escape cancels — the same two keys the contenteditable path binds
    // (see the keydown handler above), so the muscle memory carries over.
    attrPanel.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (commitAttrPanel(rows)) closeAttrPanel(); }
      if (e.key === "Escape") { e.preventDefault(); closeAttrPanel(); }
    });

    document.body.appendChild(attrPanel);
    placeAttrPanel(el);
    if (rows.length) rows[0].input.focus();
    else saveBtn.focus();
  }

  document.body.addEventListener("mouseover", (e) => {
    if (!editing) return;
    const el = attrTargetFrom(e.target);
    if (!el) return;
    if (el.tagName === "SELECT") el.classList.add("ed-attr-select");
    el.classList.add("ed-attr-hover");
    if (attrPanel) return; // an open panel already says what is being edited
    chip.textContent = chipTextFor(el);
    chip.style.display = "block";
    const r = el.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    chip.style.top = Math.max(4, r.top - c.height - 6) + "px";
    chip.style.left = Math.min(Math.max(4, r.left), window.innerWidth - c.width - 4) + "px";
  });
  document.body.addEventListener("mouseout", (e) => {
    const el = attrTargetFrom(e.target);
    if (el) el.classList.remove("ed-attr-hover");
    chip.style.display = "none";
  });

  // The native <select> popup is opened by the browser's DEFAULT ACTION on mousedown.
  // By the time a click event fires it is already on screen, so this is the only
  // listener that can suppress it — preventDefault() here, and the list never appears.
  document.body.addEventListener("mousedown", (e) => {
    if (!editing) return;
    const el = attrTargetFrom(e.target);
    if (!el || el.tagName !== "SELECT") return; // only the dropdown needs its default suppressed
    e.preventDefault();
    e.stopPropagation();
    openAttrPanel(el);
  }, true);

  document.body.addEventListener("click", (e) => {
    if (!editing) return;
    if (attrPanel && attrPanel.contains(e.target)) return; // the panel's own controls
    const el = attrTargetFrom(e.target);
    if (!el) {
      // A click anywhere else closes the panel WITHOUT saving. Deliberately unlike the
      // contenteditable path, which commits on blur: that field shows its edit in
      // place, so a blur-commit is visible. A placeholder or an alt string is not on
      // screen while you type it, and a stray click that silently rewrote three form
      // labels would be both invisible and unexplained. Cancel is the safe default
      // when the user's intent is ambiguous; Save is one click away.
      if (attrPanel) closeAttrPanel();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (el.tagName === "SELECT") return; // already handled on mousedown
    openAttrPanel(el);
  }, true);

  // A select reached by keyboard must offer the same panel, and must not open the
  // native list either.
  document.body.addEventListener("keydown", (e) => {
    if (!editing || attrPanel) return;
    const el = attrTargetFrom(e.target);
    if (!el) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    openAttrPanel(el);
  }, true);

  // The panel is anchored to an element's screen position, so scrolling or resizing
  // moves the page out from under it. Re-place rather than close: closing would throw
  // away typing the user has not saved.
  function repositionAttrPanel() {
    chip.style.display = "none";
    if (!attrPanel || !attrAnchor) return;
    if (attrAnchor.isConnected) placeAttrPanel(attrAnchor);
    else closeAttrPanel(); // the anchor was removed by a rerender
  }
  window.addEventListener("scroll", repositionAttrPanel, true);
  window.addEventListener("resize", repositionAttrPanel);

  // ---- publish / discard / exit ----
  // Publish is a two-step transaction — write every file, then commit them all — and
  // the draft models it as one (see the long comment over createDraft in draft.js).
  // Each /api/save writes its file to disk immediately, so a run that succeeds on
  // content.js and then fails on index.html has already changed the repo permanently;
  // and once a file is on disk, its ops are durable and must never be sent again.
  // markSaved(file) retires them from the log the instant the 200 comes back, which is
  // what makes the "Publish failed → click Publish again" retry safe: the second run
  // has nothing left to replay and goes straight to the commit.
  async function saveAll() {
    const tx = draft.beginSave();
    try {
      for (const [file, patch] of Object.entries(tx.patches)) {
        const r = await apiFetch("/api/save", { method: "POST", body: JSON.stringify({ file, patch }) });
        if (!r.ok) throw new Error(describeApiError(r.status, await r.text()));
        tx.markSaved(file);
        update(); // the count drops file by file, and the bar starts saying "saved, not published"
      }
    } finally {
      tx.end(); // release the draft's one-transaction-at-a-time interlock, however this ended
    }
  }
  const publishBtn = bar.querySelector("#ed-publish");
  // Publish is the one handler that must not overlap itself. Retiring ops after a 200
  // makes the SEQUENTIAL retry safe, but two clicks in quick succession start two runs
  // that both snapshot the same still-pending ops before either markSaved fires — and the
  // "add" lands on disk twice. The button is disabled for the duration (what the user
  // sees) and re-entry is ignored outright (what a stray programmatic call hits); the
  // draft's own interlock in beginSave() is the backstop behind both.
  let publishing = false;
  publishBtn.onclick = async () => {
    if (publishing) return;
    // Deliberately hasWork(), not count() === 0. After a save succeeds and the commit
    // fails, there are zero pending ops and the work is still unpublished — sitting on
    // disk. Gating on the count would refuse the one action that finishes the job.
    if (!draft.hasWork()) return alert("No changes to publish.");
    // STALE-BIT CONFIRM. hasWork() with zero pending ops rests entirely on the persisted
    // "saved, not published" bit, and that bit is scoped to http://localhost:<port>, not
    // to a checkout (see draft.js's STORAGE_KEY). A second clone served on the same port
    // inherits it, and publishing on a false bit would `git add` + commit whatever happens
    // to be dirty in THAT repo — something the old count-only guard made unreachable. One
    // question makes it harmless; the everyday retry (which is exactly this state) costs
    // the user a single Enter.
    if (draft.count() === 0 && draft.hasUncommitted()) {
      if (!confirm(
        "There are no unsaved changes on this page, but this browser remembers changes that " +
        "were saved and not yet published — usually a media upload, or a Publish that failed part-way.\n\n" +
        "Publish them now?\n\n" +
        "If you don't recognise this (for example, this is a different copy of the website), " +
        "click Cancel and tell the site admin."
      )) return;
    }
    publishing = true;
    publishBtn.disabled = true;
    try {
      await saveAll(); // a retry after a commit failure finds nothing to send and falls straight through
      const r = await apiFetch("/api/publish", { method: "POST", body: JSON.stringify({ message: "content: update via editor" }) });
      // The body is read exactly once, then classified. A 2xx is NOT the only outcome that
      // ends the transaction: both of the server's 409s do too (see draft.js's
      // classifyPublishResponse). Treating them as plain failures left the bit set with no
      // way out — every further click answered "Nothing to publish (no changes)" while
      // still inviting a retry that could not help.
      const text = await r.text();
      const outcome = window.EditorDraft.classifyPublishResponse(r.status, text);
      if (!outcome.committed) throw new Error(describeApiError(r.status, text));
      draft.markCommitted(); update();
      if (outcome.kind === "sync-failed") {
        // The commit succeeded; only the push did not. Do NOT invite a retry — pressing
        // Publish again would answer "Nothing to publish" and change nothing.
        alert(
          "Your changes are saved and committed on this computer, but they could not be sent " +
          "to the live site:\n\n" + text +
          "\n\nNothing is lost, and pressing Publish again will not help. Please tell the site admin."
        );
      } else if (outcome.kind === "nothing-to-publish") {
        alert("Nothing left to publish — everything is already committed. Nothing was lost.");
      } else {
        alert("Published ✓ — the live site updates in about a minute.");
      }
    } catch (err) {
      update(); // a partial save may have moved some ops from pending to uncommitted
      // Only genuine failures reach here now (a 500 from git, a rejected save, a dropped
      // connection), and those really do leave the edits written but uncommitted — so the
      // user's instinct, press Publish again, really is the right move.
      alert(
        "Publish failed:\n" + err.message +
        (draft.hasUncommitted()
          ? "\n\nYour changes ARE saved to disk — nothing was lost. Press Publish again to retry the commit; it will not duplicate or delete anything."
          : "")
      );
    } finally {
      publishing = false;
      publishBtn.disabled = false;
    }
  };
  // beforeunload's own guard must not fire for a reload Discard itself triggers —
  // otherwise every discard pops a second, redundant "leave site?" browser prompt on
  // top of the confirm() below. `discarding` is checked, not just set-and-forget,
  // because it must stay false for every OTHER way the page might unload.
  let discarding = false;
  bar.querySelector("#ed-discard").onclick = () => {
    // hasUncommitted() rather than a session-lifetime flag: the fact being reported is
    // about the files on disk, and it outlives this page. It is restored from storage
    // on boot, so the page the user lands on AFTER a discard still tells them the truth
    // instead of resetting to a clean-looking "0 changes".
    if (draft.hasUncommitted()) {
      const rest = draft.count() ? " and " + draft.count() + " more unsaved change(s) will be lost" : "";
      if (!confirm(
        "Some changes are already saved to disk and not yet published — reloading will NOT undo them " +
        "(they'll be picked up by the next Publish)" + rest + ". Reload anyway?"
      )) return;
    } else if (draft.count() && !confirm("Throw away " + draft.count() + " unsaved change(s)?")) {
      return;
    }
    discarding = true;
    location.reload();
  };
  bar.querySelector("#ed-exit").onclick = () => {
    editing = !editing;
    document.body.classList.toggle("ed-editing", editing);
    bar.querySelector("#ed-exit").textContent = editing ? "Exit" : "Resume";
    setEditingCursor(editing); // Resume brings Native back; Exit restores the visitor's cursor
    if (!editing) {
      // Leaving edit mode must leave nothing mid-edit behind: a lingering hover
      // outline from whatever the mouse was last over, and — more importantly — an
      // element still literally contenteditable, which the mouseover/click handlers
      // above stop touching the instant `editing` goes false.
      document.querySelectorAll(".ed-hover").forEach((n) => n.classList.remove("ed-hover"));
      const active = document.activeElement;
      if (active instanceof HTMLElement && isEditableNow(active)) active.blur(); // runs the normal commit/validate path
      // The attribute panel is a body child, not page chrome, so nothing else would
      // take it away — and it must go NOW rather than on the user's next click, since
      // its Save button is still sitting there (commitAttrPanel refuses to act once
      // `editing` is false, but leaving a dead dialog on a page pretending to be the
      // public site is its own bug).
      closeAttrPanel();
      closeBlockChooser();
      chip.style.display = "none";
      document.querySelectorAll(".ed-attr-hover").forEach((n) => n.classList.remove("ed-attr-hover"));
    }
    // decorate() (Task 12) strips all .ed-add/.ed-menu chrome when !editing and rebuilds
    // it when re-entering — called last, after the blur() above, so decorate()'s own
    // "don't run mid-edit" guard never sees the element we just blurred as still active.
    decorate();
  };
  window.addEventListener("beforeunload", (e) => { if (!discarding && draft.count()) e.preventDefault(); });

  // ---- collections chrome (Task 12): + Add / ↑ / ↓ / ✕ on [data-list] sections ----
  // Every list op (add/move/remove) is recorded to the draft, applied to the in-memory
  // content object, and followed by a decorate() rebuild — see decorate() below for why
  // a full rebuild, not a targeted DOM patch, is the only safe way to keep chrome wired
  // to the right index. The actual splice/push arithmetic for each op type lives in
  // exactly one place — window.EditorDraft.applyListOp (editor/client/draft.js) — used
  // here AND provably equivalent to editor/lib/paths.js's server-side addItem/
  // removeItem/moveItem (see editor/test/list-op-equivalence.test.js). Nothing in this
  // file hand-writes a splice call.
  function doOp(op) {
    try {
      // Apply first, record only on success — same invariant as the text-edit blur
      // handler above (search "must never reach the draft log" in this file) and for
      // the same reason: if applyListOp throws (a stale/mismatched list path, an
      // out-of-range index), the op must not end up in the draft log — there'd be
      // nothing to remove it later, the change counter would over-report, and Publish
      // would be the first place the failure surfaces, against a file that by then
      // disagrees with what's on screen.
      applyLocal(op.path, (list) => applyListOp(list, op));
    } catch (err) {
      alert("Can't apply this change:\n" + err.message);
      return;
    }
    draft.listOp(op);
    rerender(); update();
    // rerender() calls window.__rerender(), which is a plain React 18 `this.setState({})`
    // (see e.g. montessori-acamp.html's dc-script) on a createRoot root. That update is
    // auto-batched and its DOM commit is NOT synchronous with this call — decorating on
    // the very next line would rebuild chrome against the PRE-mutation DOM (an add
    // wouldn't have its new card yet; a remove/move would still show the old order).
    //
    // WHERE React's flush actually lands depends on how doOp got here, and the two
    // callers differ. From a chrome button's native onclick (↑ / ↓ / ✕ / "+ Add") the
    // update is discrete priority — SyncLane — and flushes in a microtask, i.e. before
    // the next frame. From window.__edUpload the doOp call happens in a post-`await`
    // continuation, where React 18 assigns DefaultLane and schedules through the
    // Scheduler's MessageChannel: that is a task, not a microtask, and it is not
    // guaranteed to have run by the time any given frame callback fires.
    //
    // requestAnimationFrame itself runs at the START of a frame — before the browser's
    // style recalc and layout for that frame, not after them. So it reliably covers the
    // microtask case (the DOM is already committed by then) and only usually covers the
    // MessageChannel case. That is fine: this is a latency optimisation, not the
    // correctness guarantee. The debounced MutationObserver rebuild below converges
    // either way; rAF is what keeps a fast second click (e.g. double-tapping ↑) from
    // reading a stale index during the ~1 frame before the observer's 120ms pass.
    requestAnimationFrame(decorate);
  }
  // One place that opens the drawer in pick mode and normalises what every Add flow
  // needs from a record: its id, its full-size delivery URL and a human name. The
  // picker opens BEFORE anything is recorded — a cancelled pick calls back nobody,
  // so no op ever exists to clean up.
  function pickMediaThen(kind, listPath, cb) {
    if (!window.EditorMedia || !window.EditorMediaUrls) {
      alert("The media library isn't ready yet. Close and reopen the editor, then try again.");
      return;
    }
    window.EditorMedia.openPicker(kind, (record, selectedCloudName) => {
      cb({ id: record.id, url: window.EditorMediaUrls.deliveryUrl(selectedCloudName, record), title: record.name || "" });
    }, null, listPath);
  }
  function onAdd(listPath, anchorEl) {
    if (window.EditorCollections.family(listPath) === "blocks") { openBlockChooser(listPath, anchorEl); return; }
    const mediaKind = window.EditorCollections.mediaFor(listPath);
    if (mediaKind) {
      pickMediaThen(mediaKind, listPath, (media) => {
        doOp({ type: "add", path: listPath, item: window.EditorCollections.blankItem(listPath, null, media) });
      });
      return;
    }
    doOp({ type: "add", path: listPath, item: window.EditorCollections.blankItem(listPath, null, null) });
  }

  // ---- the block chooser: which kind of section does "+ Add section" add? ----
  // A popover in #ed-attr-panel's visual language (same radius, shadow, type scale)
  // so it reads as the same editor rather than a third UI. Escape or any outside
  // click dismisses it without recording anything.
  function closeBlockChooser() {
    const el = document.getElementById("ed-block-chooser");
    if (el) { el.remove(); document.removeEventListener("pointerdown", onChooserOutside, true); document.removeEventListener("keydown", onChooserEscape, true); }
  }
  function onChooserOutside(e) { if (!e.target.closest("#ed-block-chooser")) closeBlockChooser(); }
  function onChooserEscape(e) { if (e.key === "Escape") { e.stopPropagation(); closeBlockChooser(); } }
  function openBlockChooser(listPath, anchorEl) {
    closeBlockChooser();
    const panel = document.createElement("div");
    panel.id = "ed-block-chooser";
    const h = document.createElement("h3");
    h.textContent = "Add a section";
    panel.appendChild(h);
    window.EditorCollections.blockKinds().forEach((k) => {
      const b = document.createElement("button");
      b.textContent = k.label;
      b.onclick = () => {
        closeBlockChooser();
        if (k.kind === "video") {
          // Two blocks — the heading seeded from the video's title, then the player.
          // Two ops in sequence; if the second fails the first is left in place and
          // the failure reported, consistent with doOp's apply-then-record rule.
          pickMediaThen("video", listPath, (media) => {
            const items = window.EditorCollections.blankItem(listPath, "video", media);
            doOp({ type: "add", path: listPath, item: items[0] });
            doOp({ type: "add", path: listPath, item: items[1] });
          });
        } else if (k.media) {
          pickMediaThen(k.media, listPath, (media) => {
            doOp({ type: "add", path: listPath, item: window.EditorCollections.blankItem(listPath, k.kind, media) });
          });
        } else {
          doOp({ type: "add", path: listPath, item: window.EditorCollections.blankItem(listPath, k.kind, null) });
        }
      };
      panel.appendChild(b);
    });
    document.body.appendChild(panel);
    // Fixed positioning beside the Add button, clamped to the viewport.
    const r = anchorEl.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8)) + "px";
    panel.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - panel.offsetHeight - 8)) + "px";
    document.addEventListener("pointerdown", onChooserOutside, true);
    document.addEventListener("keydown", onChooserEscape, true);
  }

  function menuFor(listPath, index, length) {
    const m = document.createElement("span");
    m.className = "ed-menu";
    const mk = (label, title, fn, className, disabled) => {
      const b = document.createElement("button");
      b.textContent = label; b.title = title;
      if (className) b.className = className;
      if (disabled) b.disabled = true;
      else b.onclick = (e) => { e.stopPropagation(); e.preventDefault(); fn(); };
      m.appendChild(b);
    };
    if (index > 0) mk("↑", "Move up", () => doOp({ type: "move", path: listPath, from: index, to: index - 1 }));
    if (index < length - 1) mk("↓", "Move down", () => doOp({ type: "move", path: listPath, from: index, to: index + 1 }));
    // The floor forbids deleting the LAST item (news excepted — see collections.js).
    // At the floor the button renders disabled with a tooltip rather than hidden: a
    // control that silently fails to appear reads as a bug, and the user retries
    // instead of understanding.
    const floor = window.EditorCollections.floorFor(listPath);
    if (length <= floor) mk("✕", "At least one must remain — this is the last one", null, "ed-del", true);
    else mk("✕", "Delete", () => { if (confirm("Delete this item?")) doOp({ type: "remove", path: listPath, index }); }, "ed-del");
    return m;
  }
  function decorate() {
    // Bail out while a data-edit field is genuinely being typed into. This wouldn't by
    // itself corrupt that field's text (decorate only ever touches .ed-add/.ed-menu
    // nodes), but there's no reason to rebuild mid-keystroke — and doing so is exactly
    // what the MutationObserver below would otherwise be recording as a mutation.
    // Recovery: the observer is configured with attributes:true/attributeFilter:
    // ["contenteditable"] specifically so the field's own blur handler removing that
    // attribute (see the blur listener above) is itself an observed mutation — it
    // re-arms the 120ms debounce, and by the time that fires isEditableNow(active) is
    // false, so this guard no longer trips and the rebuild goes through. Without that
    // attribute observation, a bail here would have nothing left to wake it back up:
    // typing itself never mutates childList/subtree (plaintext-only edits update a Text
    // node's characterData, which isn't observed either), so the debounce that already
    // fired would simply never fire again.
    const active = document.activeElement;
    if (active instanceof HTMLElement && isEditableNow(active)) return;
    document.querySelectorAll(".ed-add,.ed-menu").forEach((n) => n.remove()); // rebuild fresh — never stale indices
    if (!editing) return;
    document.querySelectorAll("[data-list]").forEach((listEl) => {
      const listPath = listEl.getAttribute("data-list");
      // Lists nest now (a section block CONTAINS its rows/photos), and :scope
      // [data-item] is a DESCENDANT query — without this filter the outer list
      // would stamp a second menu, with its own indices, onto every nested row.
      const items = Array.from(listEl.querySelectorAll(":scope [data-item]"))
        .filter((it) => it.parentElement && it.parentElement.closest("[data-list]") === listEl);
      items.forEach((it, i) => {
        const menu = menuFor(listPath, i, items.length); // position:relative is already on this element in the page's own markup
        // A gallery photo is also a media slot, whose hover actions own the
        // top-right corner — shift this menu top-left so the two never overlap.
        if (it.hasAttribute("data-media-slot")) menu.classList.add("ed-menu-slot");
        // A "blocks" item nests its own [data-list] of rows/photos, whose first
        // item's menu sits at this same top-right corner (see .ed-menu-block above)
        // — shift the SECTION's menu top-left so it never paints over the row's.
        // Keyed on the family, not on "does this item happen to contain a nested
        // list": every section menu lands in the same place, not only the ones
        // whose first row would otherwise collide.
        if (window.EditorCollections.family(listPath) === "blocks") menu.classList.add("ed-menu-block");
        it.appendChild(menu);
      });
      const add = document.createElement("button");
      add.className = "ed-add";
      add.textContent = window.EditorCollections.addLabel(listPath);
      add.onclick = (e) => onAdd(listPath, e.currentTarget);
      listEl.parentElement.insertBefore(add, listEl.nextSibling); // sibling, not child: React owns the list's children
    });
  }

  // ---- media upload (Cloudinary; signed by the local server) ----
  function pickFile(accept) {
    return new Promise((resolve) => {
      const i = document.createElement("input");
      i.type = "file"; i.accept = accept;
      i.onchange = () => resolve(i.files[0] || null);
      // Without this, dismissing the file picker without choosing anything resolves
      // nothing — the promise (and the "await pickFile(...)" below it) hangs forever,
      // leaking one permanently-pending await per cancelled attempt.
      i.oncancel = () => resolve(null);
      i.click();
    });
  }
  window.__edUpload = async function (listPath) {
    const file = await pickFile("image/*");
    if (!file) return;
    const busy = document.createElement("div");
    busy.textContent = "Uploading " + file.name + "…";
    busy.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483000;background:#26201d;color:#fff;padding:10px 16px;border-radius:8px;font:13px sans-serif";
    document.body.appendChild(busy);
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      // /api/sign is OUR server, asked to sign an upload on our behalf — like every other
      // /api/* call it goes through apiFetch, which carries the editor token and 403s
      // without it.
      const signRes = await apiFetch("/api/sign", {
        method: "POST", body: JSON.stringify({ paramsToSign: { timestamp } }),
      });
      if (!signRes.ok) throw new Error(describeApiError(signRes.status, await signRes.text()));
      const s = await signRes.json();
      const fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", s.apiKey);
      fd.append("timestamp", String(timestamp));
      fd.append("signature", s.signature);
      // api.cloudinary.com is a THIRD PARTY, not this server — this must be a plain,
      // un-wrapped call to the global fetch, never routed through apiFetch. apiFetch
      // would attach x-editor-token (this machine's local editor API secret) to a
      // request leaving the machine entirely, for a host that has no business seeing
      // it; it would also force application/json, but Cloudinary's upload endpoint
      // requires multipart FormData.
      const upRes = await fetch("https://api.cloudinary.com/v1_1/" + s.cloudName + "/auto/upload", { method: "POST", body: fd });
      // Parsing must never be able to become the reported failure. A proxy that
      // intercepts this request answers with an HTML error page, and an unguarded
      // `await upRes.json()` throws "Unexpected token '<'" — which is then the message
      // the user sees, hiding the HTTP status the checks below exist to report. An
      // unparseable (or non-object) body simply means "no structured error here": a
      // non-2xx falls through to the HTTP-status message, and a 2xx falls through to
      // the missing-public_id message. Both name what actually went wrong.
      let up;
      try { up = await upRes.json(); } catch { up = null; }
      if (!up || typeof up !== "object") up = {};
      // A non-2xx response and/or an {error:{message}} body both mean the upload
      // failed; either can happen independently (a network proxy could return a non-2xx
      // with a differently-shaped body). And even a 200 needs its own shape check: an
      // unexpected response would leave item.id === undefined below, which
      // JSON.stringify() silently drops from the request body — the tile would still
      // appear to the user (the local push happens either way) and the failure would
      // only surface later, at Publish, as a server-side "Item keys must be exactly:
      // caption,id,kind" 400 against a file the user has since kept editing. Fail here
      // instead, before doOp ever runs, so the user sees it at the moment it happened.
      if (!upRes.ok || up.error) throw new Error((up.error && up.error.message) || ("Cloudinary upload failed (HTTP " + upRes.status + ")"));
      if (typeof up.public_id !== "string" || up.public_id === "") throw new Error("Cloudinary response is missing public_id");
      // accept="image/*" is advisory only — the picker can still hand over anything.
      // Videos don't belong on Cloudinary at all (they're YouTube links, added in
      // the Media drawer), so a non-image response is refused, not stored.
      if (up.resource_type !== "image") {
        throw new Error("Only photos can be added here. Videos go on YouTube — open 🖼 Media → Videos → Add YouTube link.");
      }
      const item = { kind: "image", id: up.public_id, caption: "" };
      doOp({ type: "add", path: listPath, item });
    } catch (err) {
      alert("Upload failed:\n" + err.message);
    } finally {
      busy.remove();
    }
  };

  // Debounced so a burst of dc-runtime DOM churn (e.g. a whole section re-rendering)
  // collapses into one rebuild instead of one per mutation record. Inside THIS
  // callback, the disconnect-then-decorate-then-reconnect order is what stops it from
  // driving itself in a loop: decorate()'s own writes (removing/adding .ed-add/
  // .ed-menu) would otherwise queue more mutation records while the observer is still
  // connected, each one scheduling another round, forever — disconnecting for the
  // duration of decorate() means those particular writes are never recorded at all.
  //
  // That guarantee is local to this callback, not global: doOp() above triggers its own
  // decorate() (via requestAnimationFrame, see doOp's comment) with the observer left
  // connected, so THAT rebuild's DOM writes — and rerender()'s — DO get recorded here
  // and schedule one more debounced pass 120ms later. That extra pass is harmless
  // (decorate() is idempotent — same chrome, same indices, nothing left to change) and
  // it terminates: with no further mutations after it, no new debounce gets scheduled.
  //
  // attributes/attributeFilter (added for a data-edit field specifically) is what lets
  // decorate()'s own mid-keystroke bail-out (see decorate()'s comment) ever get
  // retried: the field's blur handler removing its contenteditable attribute is the
  // only DOM change a completed text edit produces — no childList/subtree mutation, no
  // rerender() call — so without observing that attribute, a bailed-out decorate()
  // would never be asked to run again until some unrelated part of the page happened to
  // change.
  let moT;
  const mo = new MutationObserver(() => {
    clearTimeout(moT);
    moT = setTimeout(() => { mo.disconnect(); decorate(); observe(); }, 120);
  });
  const observe = () => mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["contenteditable"] });
  decorate(); observe();

  // apiFetch/describeApiError are shared so media.js (loaded right after this file)
  // talks to /api/* with the same token discipline instead of growing a drifting copy.
  // openAttrPanel/attrPairs are shared so media-slots.js's "✎ Describe" action can
  // open the attribute panel for a hero photo's alt text: that overlay covers the
  // <img> edge-to-edge, so the img never receives a hover of its own.
  window.EditorUI = {
    draft, applyLocal, getLocal, rerender, decorate, update, apiFetch, describeApiError,
    isEditing: () => editing, openAttrPanel, attrPairs,
  };
  update();
})();
