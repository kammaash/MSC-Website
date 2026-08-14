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
  // content-type defaults to application/json — every /api/* POST requires it exactly
  // (server.js's uniform guard) — but a caller (e.g. Task 13's upload signing) can still
  // override it by passing its own headers.content-type, since opts.headers is merged
  // in after the default and before the non-negotiable token.
  function apiFetch(url, opts) {
    const headers = Object.assign({ "content-type": "application/json" }, opts && opts.headers, { "x-editor-token": window.__EDITOR_TOKEN });
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
    const rejection = window.EditorDraft.rejectText(value);
    if (rejection) {
      // Same rule the server enforces (editor/lib/patch.js's validateText, mirrored in
      // draft.js's rejectText) — reject here so the user finds out immediately, not
      // after saveAll has already written an earlier file to disk.
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

  // ---- publish / discard / exit ----
  // Set the moment any /api/save returns 200. Each save writes its file to disk
  // immediately (server.js's /api/save handler), so if a later file in the same
  // saveAll() run gets rejected (script tags, a CONTENT marker slipping past the
  // client-side rejectText check some other way, etc.), the earlier file's edit is
  // already on disk — permanently, until the *next* successful publish quietly commits
  // it. Once this is true, Discard reloading the page can no longer promise a clean
  // revert, so it must say so instead of silently lying about what "discard" undid.
  let savedThisSession = false;
  async function saveAll() {
    const byFile = draft.toPatches();
    for (const [file, patch] of Object.entries(byFile)) {
      const r = await apiFetch("/api/save", { method: "POST", body: JSON.stringify({ file, patch }) });
      if (!r.ok) throw new Error(await r.text());
      savedThisSession = true;
    }
  }
  bar.querySelector("#ed-publish").onclick = async () => {
    if (draft.count() === 0) return alert("No changes to publish.");
    try {
      await saveAll();
      const r = await apiFetch("/api/publish", { method: "POST", body: JSON.stringify({ message: "content: update via editor" }) });
      if (!r.ok) throw new Error(await r.text());
      draft.clear(); update();
      savedThisSession = false; // everything saved this session just got committed — nothing left for Discard to misrepresent
      alert("Published ✓ — the live site updates in about a minute.");
    } catch (err) { alert("Publish failed:\n" + err.message); }
  };
  // beforeunload's own guard must not fire for a reload Discard itself triggers —
  // otherwise every discard pops a second, redundant "leave site?" browser prompt on
  // top of the confirm() below. `discarding` is checked, not just set-and-forget,
  // because it must stay false for every OTHER way the page might unload.
  let discarding = false;
  bar.querySelector("#ed-discard").onclick = () => {
    if (savedThisSession) {
      const rest = draft.count() ? " and " + draft.count() + " more unsaved change(s) will be lost" : "";
      if (!confirm(
        "Some changes were already saved to disk this session — reloading will NOT undo them " +
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
    bar.querySelector("#ed-exit").textContent = editing ? "Exit" : "Resume";
    if (!editing) {
      // Leaving edit mode must leave nothing mid-edit behind: a lingering hover
      // outline from whatever the mouse was last over, and — more importantly — an
      // element still literally contenteditable, which the mouseover/click handlers
      // above stop touching the instant `editing` goes false.
      document.querySelectorAll(".ed-hover").forEach((n) => n.classList.remove("ed-hover"));
      const active = document.activeElement;
      if (active instanceof HTMLElement && isEditableNow(active)) active.blur(); // runs the normal commit/validate path
    }
    // decorate() (Task 12) strips all .ed-add/.ed-menu chrome when !editing and rebuilds
    // it when re-entering — called last, after the blur() above, so decorate()'s own
    // "don't run mid-edit" guard never sees the element we just blurred as still active.
    decorate();
  };
  window.addEventListener("beforeunload", (e) => { if (!discarding && draft.count()) e.preventDefault(); });

  // ---- collections chrome (Task 12): + Add / ↑ / ↓ / ✕ on [data-list] sections ----
  // Every list op (add/move/remove) is recorded to the draft, applied to the in-memory
  // content object, and followed by an immediate decorate() — see decorate() below for
  // why a full rebuild, not a targeted DOM patch, is the only safe way to keep chrome
  // wired to the right index.
  function doOp(op, mutate) {
    draft.listOp(op);
    applyLocal(op.path, mutate);
    rerender(); update();
    // Rebuild synchronously here rather than waiting on the debounced MutationObserver
    // below: that debounce is 120ms, and a fast second click (e.g. double-tapping ↑)
    // inside that window would fire against chrome still wired to the pre-mutation
    // array order — the exact stale-index/wrong-item-deleted failure this task calls
    // out as the one to get right. decorate() is idempotent, so the observer redoing
    // the same rebuild a moment later (once it notices the DOM change from rerender()
    // and from this call) is harmless.
    decorate();
  }
  function onAdd(listPath) {
    if (listPath.includes("galleries.")) return window.__edUpload
      ? window.__edUpload(listPath)
      : alert("Uploads arrive in the next build step.");
    const item = { date: new Date().toISOString().slice(0, 10), title: "New post", body: "Write the announcement here." };
    doOp({ type: "add", path: listPath, item }, (l) => l.push({ ...item }));
  }
  function menuFor(item, listPath, index, length) {
    const m = document.createElement("span");
    m.className = "ed-menu";
    const mk = (label, title, fn) => {
      const b = document.createElement("button");
      b.textContent = label; b.title = title;
      b.onclick = (e) => { e.stopPropagation(); e.preventDefault(); fn(); };
      m.appendChild(b);
    };
    if (index > 0) mk("↑", "Move up", () => doOp({ type: "move", path: listPath, from: index, to: index - 1 }, (l) => l.splice(index - 1, 0, l.splice(index, 1)[0])));
    if (index < length - 1) mk("↓", "Move down", () => doOp({ type: "move", path: listPath, from: index, to: index + 1 }, (l) => l.splice(index + 1, 0, l.splice(index, 1)[0])));
    mk("✕", "Delete", () => { if (confirm("Delete this item?")) doOp({ type: "remove", path: listPath, index }, (l) => l.splice(index, 1)); });
    return m;
  }
  function decorate() {
    // Guard against tearing down chrome mid-keystroke: this runs not just from doOp()
    // above but from a debounced MutationObserver reacting to ANY DOM change on the
    // page — an unrelated section re-rendering, a nav dropdown opening. A rebuild while
    // the user has a data-edit field open (contenteditable) wouldn't itself corrupt that
    // field's text (decorate only ever touches .ed-add/.ed-menu nodes), but there's no
    // reason to run it mid-keystroke either — skip it and let the field's own blur (or
    // whatever unrelated mutation happens once it's done) retrigger decorate() via the
    // observer below.
    const active = document.activeElement;
    if (active instanceof HTMLElement && isEditableNow(active)) return;
    document.querySelectorAll(".ed-add,.ed-menu").forEach((n) => n.remove()); // rebuild fresh — never stale indices
    if (!editing) return;
    document.querySelectorAll("[data-list]").forEach((listEl) => {
      const listPath = listEl.getAttribute("data-list");
      const items = listEl.querySelectorAll(":scope [data-item]");
      items.forEach((it, i) => { it.style.position = "relative"; it.appendChild(menuFor(it, listPath, i, items.length)); });
      const add = document.createElement("button");
      add.className = "ed-add"; add.textContent = "+ Add";
      add.onclick = () => onAdd(listPath);
      listEl.parentElement.insertBefore(add, listEl.nextSibling); // sibling, not child: React owns the list's children
    });
  }
  // Debounced so a burst of dc-runtime DOM churn (e.g. a whole section re-rendering)
  // collapses into one rebuild instead of one per mutation record. The disconnect-then-
  // decorate-then-reconnect order is what stops this from driving itself in a loop:
  // decorate()'s own writes (removing/adding .ed-add/.ed-menu, same for the DOM changes
  // doOp()'s rerender() causes) would otherwise queue more mutation records while the
  // observer is still connected, each one scheduling another decorate(), forever. With
  // the observer disconnected for the duration of decorate(), those self-caused
  // mutations are never recorded at all; observe() only starts watching again once
  // decorate() has already finished reacting to whatever came before.
  let moT;
  const mo = new MutationObserver(() => {
    clearTimeout(moT);
    moT = setTimeout(() => { mo.disconnect(); decorate(); observe(); }, 120);
  });
  const observe = () => mo.observe(document.body, { childList: true, subtree: true });
  decorate(); observe();

  window.EditorUI = { draft, applyLocal, rerender, decorate, update, isEditing: () => editing };
  update();
})();
