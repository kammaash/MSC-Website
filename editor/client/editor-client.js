(function () {
  "use strict";
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
    for (const [file, patch] of Object.entries(tx.patches)) {
      const r = await apiFetch("/api/save", { method: "POST", body: JSON.stringify({ file, patch }) });
      if (!r.ok) throw new Error(await r.text());
      tx.markSaved(file);
      update(); // the count drops file by file, and the bar starts saying "saved, not published"
    }
  }
  bar.querySelector("#ed-publish").onclick = async () => {
    // Deliberately hasWork(), not count() === 0. After a save succeeds and the commit
    // fails, there are zero pending ops and the work is still unpublished — sitting on
    // disk. Gating on the count would refuse the one action that finishes the job.
    if (!draft.hasWork()) return alert("No changes to publish.");
    try {
      await saveAll(); // a retry after a commit failure finds nothing to send and falls straight through
      const r = await apiFetch("/api/publish", { method: "POST", body: JSON.stringify({ message: "content: update via editor" }) });
      if (!r.ok) throw new Error(await r.text());
      draft.markCommitted(); update();
      alert("Published ✓ — the live site updates in about a minute.");
    } catch (err) {
      update(); // a partial save may have moved some ops from pending to uncommitted
      // Say plainly where the work ended up. The realistic failures here (git identity
      // unset, a stale index.lock, a push conflict) all leave the edits safely written,
      // and the user's instinct — press Publish again — is now exactly the right move.
      alert(
        "Publish failed:\n" + err.message +
        (draft.hasUncommitted()
          ? "\n\nYour changes ARE saved to disk — nothing was lost. Press Publish again to retry the commit; it will not duplicate or delete anything."
          : "")
      );
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
  function onAdd(listPath) {
    if (listPath.includes("galleries.")) return window.__edUpload(listPath);
    const item = { date: new Date().toISOString().slice(0, 10), title: "New post", body: "Write the announcement here." };
    doOp({ type: "add", path: listPath, item });
  }
  function menuFor(listPath, index, length) {
    const m = document.createElement("span");
    m.className = "ed-menu";
    const mk = (label, title, fn) => {
      const b = document.createElement("button");
      b.textContent = label; b.title = title;
      b.onclick = (e) => { e.stopPropagation(); e.preventDefault(); fn(); };
      m.appendChild(b);
    };
    if (index > 0) mk("↑", "Move up", () => doOp({ type: "move", path: listPath, from: index, to: index - 1 }));
    if (index < length - 1) mk("↓", "Move down", () => doOp({ type: "move", path: listPath, from: index, to: index + 1 }));
    mk("✕", "Delete", () => { if (confirm("Delete this item?")) doOp({ type: "remove", path: listPath, index }); });
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
      const items = listEl.querySelectorAll(":scope [data-item]");
      items.forEach((it, i) => it.appendChild(menuFor(listPath, i, items.length))); // position:relative is already on this element in the page's own markup
      const add = document.createElement("button");
      add.className = "ed-add"; add.textContent = "+ Add";
      add.onclick = () => onAdd(listPath);
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
    const file = await pickFile("image/*,video/*");
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
      if (!signRes.ok) throw new Error(await signRes.text());
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
      const item = { kind: up.resource_type === "video" ? "video" : "image", id: up.public_id, caption: "" };
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

  window.EditorUI = { draft, applyLocal, rerender, decorate, update, isEditing: () => editing };
  update();
})();
