(function () {
  "use strict";
  // Selection + drag-and-drop for media slots. A slot is an element carrying
  // data-media-slot="<content path>" (+ data-media-kind, optional data-media-poster).
  // Placing media ONLY writes URL strings at those paths through the same draft
  // pipeline as text edits — it can never create or move elements, which is the
  // whole "structure and styling stay intact" guarantee.
  if (!window.EditorUI || !window.EditorMedia || !window.EditorMediaUrls) return;
  var UI = window.EditorUI;
  var URLS = window.EditorMediaUrls;

  var style = document.createElement("style");
  style.textContent =
    ".ed-slot-hover{outline:2px dashed #e8541b!important;outline-offset:2px;cursor:pointer!important}" +
    ".ed-slot-selected{outline:3px solid #e8541b!important;outline-offset:2px}" +
    ".ed-media-empty{outline:2px dashed #c2410f!important;outline-offset:-2px}" +
    // While a tile of a given kind is dragged, every matching slot lights up: this
    // highlight IS the contract of where media may land.
    "body.ed-dragging-image [data-media-kind=image],body.ed-dragging-video [data-media-kind=video]" +
    "{outline:3px dashed #e8541b!important;outline-offset:2px}" +
    ".ed-slot-dragover{outline-style:solid!important}";
  document.head.appendChild(style);

  var selected = null;
  function clearSelection() {
    if (selected) selected.classList.remove("ed-slot-selected");
    selected = null;
  }

  function applyToSlot(slotEl, record, cloudName) {
    var path = slotEl.getAttribute("data-media-slot");
    var kind = slotEl.getAttribute("data-media-kind");
    if (record.kind !== kind) {
      alert("That spot takes a " + kind + ", not a " + record.kind + ".");
      return;
    }
    var url = URLS.deliveryUrl(cloudName, record);
    var posterPath = slotEl.getAttribute("data-media-poster");
    var posterUrl = posterPath ? URLS.posterUrl(cloudName, record) : null;

    // Capture prior values so we can restore them if anything fails. Either both
    // paths are applied and recorded together, or neither are — a partial mutation
    // (primary path applied but poster path not, or vice versa) must never reach
    // the draft log, and must not leave the in-memory content out of sync with it.
    var priorValue;
    var priorPosterValue;
    try {
      priorValue = UI.getLocal(path);
      priorPosterValue = posterPath ? UI.getLocal(posterPath) : null;
    } catch (e) {
      // If we can't even read the prior values, the paths are broken; bail out.
      alert("Can't place media here:\n" + e.message);
      return;
    }

    try {
      // Apply both values. If either throws, both will be restored below.
      UI.applyLocal(path, url);
      if (posterPath) UI.applyLocal(posterPath, posterUrl);
    } catch (err) {
      // Restore prior values so the in-memory content and draft log stay in sync.
      UI.applyLocal(path, priorValue);
      if (posterPath) UI.applyLocal(posterPath, priorPosterValue);
      alert("Can't place media here:\n" + err.message);
      return;
    }
    // Both applies succeeded; record both to the draft.
    UI.draft.set(path, url);
    if (posterPath) UI.draft.set(posterPath, posterUrl);
    clearSelection();
    UI.rerender(); UI.update();
    // A <video> whose src attribute just changed keeps playing the old source until
    // load() is called; the element may be replaced by the rerender, so find it
    // fresh. rAF usually lands after React's commit; the marking observer below
    // converges the empty-state classes either way (same reasoning as doOp's rAF).
    requestAnimationFrame(function () {
      document.querySelectorAll('video[data-media-slot]').forEach(function (v) {
        if (v.getAttribute("data-media-slot") === path) v.load();
      });
      markEmpties();
    });
  }

  // Dashed marking for slots whose content value is currently "" — they read as
  // "drop media here" instead of invisible. Interpolated (per-item gallery) slots
  // always have a value, so unresolved getLocal is treated as non-empty.
  function markEmpties() {
    document.querySelectorAll("[data-media-slot]").forEach(function (el) {
      var v;
      try { v = UI.getLocal(el.getAttribute("data-media-slot")); } catch (e) { v = null; }
      el.classList.toggle("ed-media-empty", UI.isEditing() && v === "");
    });
  }

  // ---- hover + click select (delegated, editing-gated) ----
  document.body.addEventListener("mouseover", function (e) {
    if (!UI.isEditing()) return;
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    if (el) el.classList.add("ed-slot-hover");
  });
  document.body.addEventListener("mouseout", function (e) {
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    if (el) el.classList.remove("ed-slot-hover");
  });
  document.body.addEventListener("click", function (e) {
    if (!UI.isEditing()) return;
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    if (!el) { clearSelection(); return; }
    // If the actual click target is on an interactive control inside the slot
    // (e.g. a list item menu button, or a text input), let that control handle
    // its own click instead. Media slots may wrap elements with their own
    // interactive chrome, so only claim the click if it's on the slot itself or
    // a non-interactive descendant.
    var interactive = e.target.closest && e.target.closest("button, a, input, textarea, select, .ed-menu");
    if (interactive && el.contains(interactive)) return;
    e.preventDefault(); e.stopPropagation();
    clearSelection();
    selected = el;
    el.classList.add("ed-slot-selected");
    var kind = el.getAttribute("data-media-kind");
    window.EditorMedia.openPicker(kind, function (record, cloudName) {
      // The rerender inside applyToSlot may replace the element; re-find it by path
      // so the write targets the slot as it exists NOW.
      var path = el.getAttribute("data-media-slot");
      var live = document.querySelector('[data-media-slot="' + path.replace(/"/g, '\\"') + '"]') || el;
      applyToSlot(live, record, cloudName);
    });
  }, true);

  // ---- drag and drop ----
  function dragPayload(e) {
    var kinds = ["image", "video"];
    for (var i = 0; i < kinds.length; i++) {
      if (Array.prototype.indexOf.call(e.dataTransfer.types, "application/x-msc-media-" + kinds[i]) !== -1) return kinds[i];
    }
    return null;
  }
  document.body.addEventListener("dragover", function (e) {
    if (!UI.isEditing()) return;
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    var kind = dragPayload(e);
    if (!el || !kind || el.getAttribute("data-media-kind") !== kind) return;
    e.preventDefault(); // this is what makes the slot a legal drop target — nothing else is
    e.dataTransfer.dropEffect = "copy";
    el.classList.add("ed-slot-dragover");
  });
  document.body.addEventListener("dragleave", function (e) {
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    if (el) el.classList.remove("ed-slot-dragover");
  });
  document.body.addEventListener("drop", function (e) {
    if (!UI.isEditing()) return;
    var el = e.target.closest && e.target.closest("[data-media-slot]");
    var kind = dragPayload(e);
    if (!el || !kind || el.getAttribute("data-media-kind") !== kind) return;
    e.preventDefault();
    el.classList.remove("ed-slot-dragover");
    var payload;
    try { payload = JSON.parse(e.dataTransfer.getData("application/x-msc-media-" + kind)); } catch (err) { payload = null; }
    if (!payload || !payload.record) return;
    applyToSlot(el, payload.record, payload.cloudName);
  });

  // Keep empty-marking honest across rerenders and Exit/Resume: piggyback on DOM
  // mutations the same way editor-client.js's observer does, debounced.
  var moT;
  new MutationObserver(function () {
    clearTimeout(moT);
    moT = setTimeout(markEmpties, 150);
  }).observe(document.body, { childList: true, subtree: true });
  markEmpties();
})();
