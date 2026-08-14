(function () {
  "use strict";
  if (window.__EDITOR_BOOTED) return;
  window.__EDITOR_BOOTED = true;
  const P = window.EditorPaths;
  const pageFile = location.pathname.replace(/^\//, "") || "index.html";
  const draft = window.EditorDraft.createDraft(pageFile);
  let editing = true;

  // Every /api/* call must carry this header — the server mints one random token per
  // boot and injects it as window.__EDITOR_TOKEN before this script runs (see
  // server.js's TOKEN_SCRIPT). Without it every request 403s; a foreign page cannot
  // read this global (it's same-origin only) so it can't forge the header either.
  function apiFetch(url, opts) {
    const headers = Object.assign({}, opts && opts.headers, { "x-editor-token": window.__EDITOR_TOKEN });
    return fetch(url, Object.assign({}, opts, { headers }));
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
  function rerender() { if (window.__rerender) window.__rerender(); }

  // ---- top bar ----
  const bar = document.createElement("div");
  bar.id = "ed-bar";
  bar.innerHTML =
    '<style>' +
    '#ed-bar{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;gap:10px;align-items:center;' +
    'background:#26201d;color:#fff;font:13px/1.4 -apple-system,sans-serif;padding:8px 14px;box-shadow:0 1px 6px rgba(0,0,0,.3)}' +
    '#ed-bar button{font:inherit;padding:4px 12px;border-radius:6px;border:0;cursor:pointer;background:#4a423c;color:#fff}' +
    '#ed-bar #ed-publish{background:#e8541b;font-weight:600}' +
    '.ed-hover{outline:2px dashed #e8541b !important;outline-offset:2px;cursor:text}' +
    '.ed-add{font:600 13px sans-serif;margin:10px 0;padding:8px 16px;border:2px dashed #e8541b;border-radius:8px;' +
    'background:#fff;color:#e8541b;cursor:pointer}' +
    '.ed-menu{position:absolute;top:6px;right:6px;display:flex;gap:4px;z-index:9999}' +
    '.ed-menu button{font:12px sans-serif;width:26px;height:26px;border-radius:6px;border:0;cursor:pointer;' +
    'background:#26201d;color:#fff}' +
    '</style>' +
    '<strong>✏️ Editing</strong><span id="ed-count">0 changes</span><span style="flex:1"></span>' +
    '<button id="ed-publish">Publish</button><button id="ed-discard">Discard</button><button id="ed-exit">Exit</button>';
  document.body.appendChild(bar);

  const countEl = bar.querySelector("#ed-count");
  function update() { countEl.textContent = draft.count() + " change" + (draft.count() === 1 ? "" : "s"); }

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
    if (el.getAttribute("contenteditable")) return; // already editing it
    el.__edOrig = el.textContent;
    try { el.contentEditable = "plaintext-only"; } catch { el.contentEditable = "true"; }
    el.focus();
  }, true);
  document.body.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.getAttribute("contenteditable")) return;
    if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    if (e.key === "Escape") { el.textContent = el.__edOrig; el.blur(); }
  }, true);
  document.body.addEventListener("blur", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.hasAttribute || !el.hasAttribute("data-edit")) return;
    if (!el.getAttribute("contenteditable")) return;
    el.removeAttribute("contenteditable");
    const path = el.getAttribute("data-edit");
    const value = el.textContent;
    if (value === el.__edOrig) return;
    draft.set(path, value);
    applyLocal(path, value); // keep in-memory content in sync so rerenders don't revert
    update();
  }, true);

  // ---- publish / discard / exit ----
  async function saveAll() {
    const byFile = draft.toPatches();
    for (const [file, patch] of Object.entries(byFile)) {
      const r = await apiFetch("/api/save", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ file, patch }),
      });
      if (!r.ok) throw new Error(await r.text());
    }
  }
  bar.querySelector("#ed-publish").onclick = async () => {
    if (draft.count() === 0) return alert("No changes to publish.");
    try {
      await saveAll();
      const r = await apiFetch("/api/publish", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "content: update via editor" }),
      });
      if (!r.ok) throw new Error(await r.text());
      draft.clear(); update();
      alert("Published ✓ — the live site updates in about a minute.");
    } catch (err) { alert("Publish failed:\n" + err.message); }
  };
  bar.querySelector("#ed-discard").onclick = () => {
    if (draft.count() && !confirm("Throw away " + draft.count() + " unsaved change(s)?")) return;
    location.reload();
  };
  bar.querySelector("#ed-exit").onclick = () => {
    editing = !editing;
    bar.querySelector("#ed-exit").textContent = editing ? "Exit" : "Resume";
    document.querySelectorAll(".ed-add,.ed-menu").forEach((n) => (n.style.display = editing ? "" : "none"));
  };
  window.addEventListener("beforeunload", (e) => { if (draft.count()) e.preventDefault(); });

  // `decorate` is a placeholder for Task 12 (collections chrome: + Add / up / down / x
  // menus on list items) to overwrite with real behaviour; exported now, as a no-op, so
  // any code written against window.EditorUI.decorate before Task 12 lands doesn't throw.
  window.EditorUI = { draft, applyLocal, rerender, decorate: function () {}, update, isEditing: () => editing };
  update();
})();
