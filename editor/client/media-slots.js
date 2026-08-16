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
    // Contextual video actions exist only in local edit mode. The whole slot becomes
    // a hover/focus surface; each action keeps its icon circular with its label below.
    ".ed-video-slot{position:relative!important}" +
    ".ed-video-actions{display:none}" +
    "body.ed-editing .ed-video-actions{position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;gap:22px;" +
    "background:rgba(24,17,14,.68);opacity:0;pointer-events:none;transition:opacity .16s ease}" +
    "body.ed-editing .ed-video-slot:hover>.ed-video-actions,body.ed-editing .ed-video-slot:focus-within>.ed-video-actions{" +
    "opacity:1;pointer-events:auto}" +
    ".ed-video-action{display:flex;min-width:66px;flex-direction:column;align-items:center;gap:7px;padding:0;border:0;" +
    "background:transparent;color:#fff;font:600 12px/1.15 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer!important}" +
    ".ed-video-action-icon{display:grid;width:48px;height:48px;place-items:center;border-radius:999px;border:2px solid rgba(255,255,255,.82);" +
    "background:#fff;color:#a51915;font-size:24px;line-height:1;box-shadow:0 5px 16px rgba(0,0,0,.3);transition:transform .15s ease,background .15s ease}" +
    ".ed-video-action:hover .ed-video-action-icon,.ed-video-action:focus-visible .ed-video-action-icon{transform:scale(1.08);background:#ffd9c4}" +
    ".ed-video-action:focus-visible{outline:3px solid #ffb28d;outline-offset:5px;border-radius:8px}" +
    ".ed-video-action[data-video-action=remove] .ed-video-action-icon{background:#a51915;color:#fff}" +
    "@media(prefers-reduced-motion:reduce){.ed-video-actions,.ed-video-action-icon{transition:none!important}}" +
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

  function slotValue(slotEl) {
    try { return UI.getLocal(slotEl.getAttribute("data-media-slot")); }
    catch (e) { return null; }
  }

  function liveSlot(path, fallback) {
    return Array.prototype.find.call(document.querySelectorAll("[data-media-slot]"), function (candidate) {
      return candidate.getAttribute("data-media-slot") === path;
    }) || fallback;
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

  function openPickerForSlot(slotEl) {
    clearSelection();
    selected = slotEl;
    slotEl.classList.add("ed-slot-selected");
    var path = slotEl.getAttribute("data-media-slot");
    var kind = slotEl.getAttribute("data-media-kind");
    window.EditorMedia.openPicker(kind, function (record, cloudName) {
      applyToSlot(liveSlot(path, slotEl), record, cloudName);
    }, function () {
      clearSelection(false);
    }, path);
  }

  function removeVideoFromSlot(slotEl) {
    if (!UI.isEditing()) return;
    var path = slotEl.getAttribute("data-media-slot");
    if (slotEl.getAttribute("data-media-kind") !== "video" || slotValue(slotEl) === "") return;
    if (!confirm("Remove this video from the page?\n\nIt will stay in the Media library so you can add it again later.")) return;
    try {
      // Same apply-before-record transaction rule as placement: a broken/stale path
      // must never leave a draft operation claiming the removal succeeded.
      UI.applyLocal(path, "");
    } catch (err) {
      alert("Can't remove this video:\n" + err.message);
      return;
    }
    UI.draft.set(path, "");
    clearSelection();
    UI.rerender(); UI.update();
    requestAnimationFrame(markEmpties);
  }

  function videoAction(action, icon, label, slotEl) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "ed-video-action";
    button.setAttribute("data-video-action", action);
    button.setAttribute("aria-label", label + " for this video area");
    var iconEl = document.createElement("span");
    iconEl.className = "ed-video-action-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = icon;
    var labelEl = document.createElement("span");
    labelEl.textContent = label;
    button.appendChild(iconEl);
    button.appendChild(labelEl);
    button.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      if (action === "remove") removeVideoFromSlot(slotEl);
      else openPickerForSlot(slotEl);
    };
    return button;
  }

  function decorateVideoActions() {
    document.querySelectorAll('[data-media-kind="video"][data-media-slot]').forEach(function (slotEl) {
      slotEl.classList.add("ed-video-slot");
      var value = slotValue(slotEl);
      if (typeof value !== "string") return;
      var state = value === "" ? "empty" : "filled";
      var actions = Array.prototype.find.call(slotEl.children, function (child) {
        return child.classList && child.classList.contains("ed-video-actions");
      });
      if (actions && actions.getAttribute("data-video-state") === state) return;
      if (actions) actions.remove();
      actions = document.createElement("div");
      actions.className = "ed-video-actions";
      actions.setAttribute("data-video-state", state);
      actions.setAttribute("aria-label", "Video options");
      if (state === "empty") {
        actions.appendChild(videoAction("add", "+", "Add video", slotEl));
      } else {
        actions.appendChild(videoAction("replace", "↻", "Replace", slotEl));
        actions.appendChild(videoAction("remove", "×", "Remove", slotEl));
      }
      slotEl.appendChild(actions);
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
    decorateVideoActions();
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
    openPickerForSlot(el);
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
