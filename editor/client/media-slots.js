(function () {
  "use strict";
  // Selection + drag-and-drop for media slots. A slot is an element carrying
  // data-media-slot="<content path>" (+ data-media-kind). Most slots store a
  // delivery URL; shared Cloudinary galleries opt into data-media-value="id" so
  // they keep their established public-ID shape. Both still use the same draft
  // pipeline as text edits and never create or move page elements.
  if (!window.EditorUI || !window.EditorMedia || !window.EditorMediaUrls) return;
  var UI = window.EditorUI;
  var URLS = window.EditorMediaUrls;

  var style = document.createElement("style");
  style.textContent =
    ".ed-slot-hover{outline:2px dashed #e8541b!important;outline-offset:2px;cursor:pointer!important}" +
    ".ed-slot-selected{outline:3px solid #e8541b!important;outline-offset:2px}" +
    ".ed-media-empty{outline:2px dashed #c2410f!important;outline-offset:-2px}" +
    // Contextual media actions exist only in local edit mode. The whole slot becomes
    // a hover/focus surface; each action keeps its icon circular with its label below.
    ".ed-context-slot{position:relative!important}" +
    ".ed-slot-actions{display:none}" +
    "body.ed-editing .ed-slot-actions{position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;gap:22px;" +
    "background:rgba(24,17,14,.68);opacity:0;pointer-events:none;transition:opacity .16s ease}" +
    "body.ed-editing .ed-context-slot:hover>.ed-slot-actions,body.ed-editing .ed-context-slot:focus-within>.ed-slot-actions{" +
    "opacity:1;pointer-events:auto}" +
    // Flip-card captions remain visible/editable: their media controls sit in a
    // compact corner panel instead of covering the whole card back.
    "body.ed-editing .flip.ed-context-slot>.ed-slot-actions{inset:8px 8px auto auto;padding:9px 10px;border-radius:12px}" +
    "body.ed-editing .ed-hero-photo-slot>.ed-slot-actions{inset:80px 0 0}" +
    ".ed-slot-action{display:flex;min-width:66px;flex-direction:column;align-items:center;gap:7px;padding:0;border:0;" +
    "background:transparent;color:#fff;font:600 12px/1.15 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer!important}" +
    ".ed-slot-action-icon{display:grid;width:48px;height:48px;place-items:center;border-radius:999px;border:2px solid rgba(255,255,255,.82);" +
    "background:#fff;color:#a51915;font-size:24px;line-height:1;box-shadow:0 5px 16px rgba(0,0,0,.3);transition:transform .15s ease,background .15s ease}" +
    ".ed-slot-action:hover .ed-slot-action-icon,.ed-slot-action:focus-visible .ed-slot-action-icon{transform:scale(1.08);background:#ffd9c4}" +
    ".ed-slot-action:focus-visible{outline:3px solid #ffb28d;outline-offset:5px;border-radius:8px}" +
    ".ed-slot-action[data-media-action=remove] .ed-slot-action-icon{background:#a51915;color:#fff}" +
    "@media(prefers-reduced-motion:reduce){.ed-slot-actions,.ed-slot-action-icon{transition:none!important}}" +
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
    var value = slotEl.getAttribute("data-media-value") === "id"
      ? record.id
      : URLS.deliveryUrl(cloudName, record);
    if (typeof value !== "string" || value === "") {
      alert("That media item has no usable " + (slotEl.getAttribute("data-media-value") === "id" ? "public ID" : "URL") + ".");
      return;
    }
    try {
      // Apply first, record only on success — the same invariant as every other
      // editor mutation (see editor-client.js's doOp): a failed apply must never
      // leave an op in the draft log. One path, one write: a throw means nothing
      // was applied, so there is nothing to roll back.
      UI.applyLocal(path, value);
    } catch (err) {
      alert("Can't place media here:\n" + err.message);
      return;
    }
    UI.draft.set(path, value);
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

  function removeFromSlot(slotEl) {
    if (!UI.isEditing()) return;
    var path = slotEl.getAttribute("data-media-slot");
    var kind = slotEl.getAttribute("data-media-kind");
    if ((kind !== "image" && kind !== "video") || slotValue(slotEl) === "") return;
    var noun = kind === "image" ? "photo" : "video";
    if (!confirm("Remove this " + noun + " from the page?\n\nIt will stay in the Media library so you can add it again later.")) return;
    try {
      // Same apply-before-record transaction rule as placement: a broken/stale path
      // must never leave a draft operation claiming the removal succeeded.
      UI.applyLocal(path, "");
    } catch (err) {
      alert("Can't remove this " + noun + ":\n" + err.message);
      return;
    }
    UI.draft.set(path, "");
    clearSelection();
    UI.rerender(); UI.update();
    requestAnimationFrame(markEmpties);
  }

  function mediaAction(action, icon, label, slotEl) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "ed-slot-action";
    button.setAttribute("data-media-action", action);
    button.setAttribute("aria-label", label + " for this " + slotEl.getAttribute("data-media-kind") + " area");
    var iconEl = document.createElement("span");
    iconEl.className = "ed-slot-action-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = icon;
    var labelEl = document.createElement("span");
    labelEl.textContent = label;
    button.appendChild(iconEl);
    button.appendChild(labelEl);
    button.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      if (action === "remove") removeFromSlot(slotEl);
      else if (action === "describe") UI.openAttrPanel(describedEl(slotEl));
      else openPickerForSlot(slotEl);
    };
    return button;
  }

  // The element inside this slot whose alt text is bound to content, or null. The
  // photo's description is the one visitor-readable string on a hero image that the
  // hover affordance in editor-client.js cannot reach: this overlay covers the <img>
  // edge-to-edge, so the img never receives a mouseover of its own. Rather than
  // reimplement the editing UI here, the overlay offers a "Describe" action that
  // opens editor-client.js's attribute panel against the bound element directly.
  //
  // Only slots that actually HAVE a binding get the action. Gallery images take
  // their alt from an editable caption right beneath them (alt="{{ ph.caption }}"),
  // and are deliberately left unbound so one string never grows two editing surfaces.
  function describedEl(slotEl) {
    if (!UI.openAttrPanel || !UI.attrPairs) return null;
    var found = slotEl.querySelector("[data-edit-attr]");
    if (!found) return null;
    var pairs = UI.attrPairs(found);
    for (var i = 0; i < pairs.length; i++) if (pairs[i].attr === "alt") return found;
    return null;
  }

  function decorateSlotActions() {
    document.querySelectorAll('[data-media-slot][data-media-kind="image"],[data-media-slot][data-media-kind="video"]').forEach(function (slotEl) {
      slotEl.classList.add("ed-context-slot");
      // Actions must be children of a container, never a void media element.
      if (/^(IMG|IFRAME|VIDEO)$/.test(slotEl.tagName)) return;
      var value = slotValue(slotEl);
      if (typeof value !== "string") return;
      // The described-ness of a slot is part of its rendered state: a photo dropped
      // into an empty slot brings its <img> (and so its alt binding) with it, so the
      // "should this overlay have a Describe button" answer can change without the
      // filled/empty answer changing. Both go in the state key, or the cheap
      // "same state, leave it alone" bail below would keep a stale button set.
      var state = (value === "" ? "empty" : "filled") + (describedEl(slotEl) ? "+alt" : "");
      var actions = Array.prototype.find.call(slotEl.children, function (child) {
        return child.classList && child.classList.contains("ed-slot-actions");
      });
      if (actions && actions.getAttribute("data-media-state") === state) return;
      if (actions) actions.remove();
      actions = document.createElement("div");
      actions.className = "ed-slot-actions";
      actions.setAttribute("data-media-state", state);
      actions.setAttribute("aria-label", (slotEl.getAttribute("data-media-kind") === "image" ? "Photo" : "Video") + " options");
      if (value === "") {
        actions.appendChild(mediaAction("add", "+", slotEl.getAttribute("data-media-kind") === "image" ? "Add photo" : "Add video", slotEl));
      } else {
        actions.appendChild(mediaAction("replace", "↻", "Replace", slotEl));
        actions.appendChild(mediaAction("remove", "×", "Remove", slotEl));
      }
      // Offered in both states: the description belongs to the spot on the page, not
      // to whichever photo currently fills it, and writing it before choosing a photo
      // is perfectly reasonable.
      if (describedEl(slotEl)) actions.appendChild(mediaAction("describe", "✎", "Describe", slotEl));
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
    decorateSlotActions();
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
    var interactive = e.target.closest && e.target.closest("button, a, input, textarea, select, [data-edit], [data-edit-attr], .ed-menu");
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
