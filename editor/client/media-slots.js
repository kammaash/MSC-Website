(function () {
  "use strict";
  // Selection + drag-and-drop for media slots. A slot is an element carrying
  // data-media-slot="<content path>" (+ data-media-kind). Video slots are <iframe>
  // YouTube embeds: a src change reloads the frame on its own, and YouTube brings
  // its own poster frame — so there is no per-kind plumbing here at all.
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
    // The slot wrapper, rather than its nested browsing context, owns editor
    // pointer/drag events. Exit removes ed-editing and restores normal playback.
    "body.ed-editing [data-media-kind=video] iframe{pointer-events:none!important}" +
    // While a tile of a given kind is dragged, every matching slot lights up: this
    // highlight IS the contract of where media may land.
    "body.ed-dragging-image [data-media-kind=image],body.ed-dragging-video [data-media-kind=video]" +
    "{outline:3px dashed #e8541b!important;outline-offset:2px}" +
    ".ed-slot-dragover{outline-style:solid!important}";
  document.head.appendChild(style);

  var selected = null;
  function clearSelection(cancelPicker) {
    if (selected) selected.classList.remove("ed-slot-selected");
    selected = null;
    if (cancelPicker !== false) window.EditorMedia.cancelPick();
  }

  function applyToSlot(slotEl, record, cloudName) {
    // Defence in depth: a callback already captured by the picker must not mutate
    // content after Exit, even if another cancellation path regresses later.
    if (!UI.isEditing()) { clearSelection(); return; }
    var path = slotEl.getAttribute("data-media-slot");
    var kind = slotEl.getAttribute("data-media-kind");
    if (record.kind !== kind) {
      alert("That spot takes a " + kind + ", not a " + record.kind + ".");
      return;
    }
    var url = URLS.deliveryUrl(cloudName, record);
    try {
      // Apply first, record only on success — the same invariant as every other
      // editor mutation (see editor-client.js's doOp): a failed apply must never
      // leave an op in the draft log. One path, one write: a throw means nothing
      // was applied, so there is nothing to roll back.
      UI.applyLocal(path, url);
    } catch (err) {
      alert("Can't place media here:\n" + err.message);
      return;
    }
    UI.draft.set(path, url);
    clearSelection();
    UI.rerender(); UI.update();
    // rAF lands after the rerender's commit, so the empty-state marking sees the
    // slot's new value (same reasoning as doOp's rAF in editor-client.js).
    requestAnimationFrame(markEmpties);
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
    if (!el) {
      // Drawer controls are part of the active picker interaction. Page/background
      // clicks cancel it; drawer tabs, tiles and its close button handle themselves.
      if (!(e.target.closest && e.target.closest("#ed-media"))) clearSelection();
      return;
    }
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
      var live = Array.prototype.find.call(document.querySelectorAll("[data-media-slot]"), function (candidate) {
        return candidate.getAttribute("data-media-slot") === path;
      }) || el;
      applyToSlot(live, record, cloudName);
    }, function () {
      clearSelection(false);
    }, el.getAttribute("data-media-slot"));
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
