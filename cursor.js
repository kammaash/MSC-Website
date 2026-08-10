/*
  CUSTOM CURSOR
  =============
  Replaces the system pointer on every page (loaded from each page's <helmet>).
  Self-installing: it boots itself on DOMContentLoaded, so a page only has to
  include the script.

  Two styles:
    "Pen (ink)"  the default. A pen nib follows the pointer and, while you drag
                 on empty space, draws a real ink trail that fades out.
    "Dot"        a plain dot that grows over interactive elements.
    "Native"     no custom cursor. Forced on touch devices, where a floating
                 pointer makes no sense and would just be visual noise.

  The choice persists in localStorage under "monteCursor" and is exposed as
  window.MonteCursor for the pages to set (see applyCursor() in index.html).

  Two details drive most of the code below:
    - the cursor must stay visible over the dark red/navy sections, so the ink
      colour is re-sampled from whatever is actually under the pointer;
    - the pen must get out of the way when you are trying to click or select
      text, so it yields to a dot over interactive elements and hands back the
      native I-beam over text.
*/
(function () {
  // Ink colours: NAVY over light backgrounds, LIGHT_INK over dark ones.
  var NAVY = "#16294d";
  var LIGHT_INK = "#f4f7ff";
  // The cursor currently installed, kept so teardown() can unwind it. Holds
  // the listeners and the animation-frame handle; null when none is active.
  var current = null;

  // Parse a computed background-color string into [r,g,b], or null if fully transparent.
  function parseRGB(str) {
    var m = str && str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(",").map(function (s) { return parseFloat(s); });
    if (p.length >= 4 && p[3] === 0) return null;
    return p;
  }

  // Walk up from the element under (x,y) to the first opaque background and
  // report whether it's a dark region (e.g. the navy sections) by luminance.
  function isDarkAt(x, y) {
    var el = document.elementFromPoint(x, y), depth = 0;
    while (el && depth < 14) {
      var rgb = parseRGB(getComputedStyle(el).backgroundColor);
      if (rgb) return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) < 120;
      el = el.parentElement; depth++;
    }
    return false;
  }

  // Remove the active cursor completely: stop its animation loop, detach every
  // listener, delete the elements and the injected stylesheets (all tagged
  // data-monte-cursor), and give the real pointer back. Called before
  // installing a new style so the two can never run at once.
  function teardown() {
    if (current) {
      cancelAnimationFrame(current.raf);
      window.removeEventListener("pointermove", current.onMove);
      document.removeEventListener("pointerover", current.onOver);
      document.removeEventListener("pointerdown", current.onDown);
      document.removeEventListener("pointerup", current.onUp);
      current = null;
    }
    document.querySelectorAll("[data-monte-cursor]").forEach(function (n) { n.remove(); });
    document.body.style.cursor = "";
  }

  // Install a cursor style, replacing whatever was active.
  function apply(type) {
    teardown();
    type = type || "Pen (ink)";
    // Bail out on touch devices as well as on an explicit "Native" choice:
    // pointer:coarse means there is no hovering pointer to decorate.
    if (type === "Native" || (window.matchMedia && matchMedia("(pointer:coarse)").matches)) {
      document.body.style.cursor = "";
      return;
    }
    // Hide the real pointer, then draw our own into a fixed, click-through
    // overlay pinned above the page.
    var style = document.createElement("style");
    style.setAttribute("data-monte-cursor", "");
    style.textContent = "*{cursor:none!important}";
    document.head.appendChild(style);
    var root = document.createElement("div");
    root.setAttribute("data-monte-cursor", "");
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999";
    document.body.appendChild(root);

    // What counts as "interactive" (pen yields to a dot) and what counts as
    // text (pen yields to the native I-beam so selection still feels normal).
    // data-btn / data-card are the same hooks index.html uses for its pointer
    // effects, so decorated elements automatically get the right cursor too.
    var sel = "a,button,input,select,textarea,[data-btn],[data-card]";
    var textSel = "p,h1,h2,h3,h4,h5,h6,li,em,strong,blockquote,label,input,textarea,option";
    // Live pointer state, written by the listeners and read by the animation
    // loop. Tracking position here rather than reacting per event keeps the
    // drawing on one requestAnimationFrame tick.
    var mx = innerWidth / 2, my = innerHeight / 2;
    var hovering = false, pressing = false, onText = false;
    var onMove = function (e) { mx = e.clientX; my = e.clientY; };
    var onOver = function (e) {
      hovering = !!(e.target.closest && e.target.closest(sel));
      onText = !!(e.target.closest && e.target.closest(textSel));
    };
    var onDown = function () { pressing = true; };
    var onUp = function () { pressing = false; };
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);

    var step, extraStyle = null;

    // ===== "Pen (ink)": nib + fading ink trail =====
    if (type === "Pen (ink)") {
      extraStyle = document.createElement("style");
      extraStyle.setAttribute("data-monte-cursor", "");
      document.head.appendChild(extraStyle);
      // Toggle hiding the native pointer. Turned back on over text so the
      // I-beam reappears and selection looks like it does anywhere else.
      var setOverride = function (on) { style.textContent = on ? "*{cursor:none!important}" : ""; };
      // Suppress text selection only while actually drawing, so dragging a
      // stroke across a paragraph does not also highlight it.
      var setNoSelect = function (on) { extraStyle.textContent = on ? "*{user-select:none!important;-webkit-user-select:none!important}" : ""; };
      var ns = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(ns, "svg");
      svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%;overflow:visible");
      root.appendChild(svg);
      var inkColor = NAVY, onDark = false, darkAt = 0;
      // Draw one stroke segment between two pointer samples. Each segment is
      // an SVG line that starts fading almost immediately and removes itself
      // once invisible, so the trail evaporates behind the pen and the SVG
      // never accumulates nodes.
      var drawSeg = function (x1, y1, x2, y2) {
        var ln = document.createElementNS(ns, "line");
        ln.setAttribute("x1", x1); ln.setAttribute("y1", y1);
        ln.setAttribute("x2", x2); ln.setAttribute("y2", y2);
        ln.setAttribute("stroke", inkColor);
        ln.setAttribute("stroke-width", "2.6");
        ln.setAttribute("stroke-linecap", "round");
        ln.style.transition = "opacity 1.5s ease .6s";
        svg.appendChild(ln);
        requestAnimationFrame(function () { ln.style.opacity = "0"; });
        setTimeout(function () { ln.remove(); }, 2300);
      };
      var pen = document.createElement("div");
      var dot = document.createElement("div");
      dot.style.cssText = "position:absolute;top:0;left:0;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:" + NAVY + ";opacity:0;transition:opacity .15s ease";
      root.appendChild(dot);
      // Proximity detection. pointerover alone only fires once the pointer is
      // literally over an element; the pen is drawn above and to the left of
      // the hotspot, so it would still be overlapping a button when the state
      // flipped. Instead every interactive element's box is cached (refreshed
      // at most every 350ms, since layout changes on scroll and resize) and
      // grown by NEAR_PAD, so the pen yields just before it reaches one.
      var nearRects = [], nearAt = 0, NEAR_PAD = 28;
      var refreshRects = function () {
        nearRects = [];
        document.querySelectorAll(sel).forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.width && r.height) nearRects.push(r);
        });
        nearAt = performance.now();
      };
      var nearInteractive = function () {
        if (performance.now() - nearAt > 350) refreshRects();
        for (var i = 0; i < nearRects.length; i++) {
          var r = nearRects[i];
          if (mx > r.left - NEAR_PAD && mx < r.right + NEAR_PAD && my > r.top - NEAR_PAD && my < r.bottom + NEAR_PAD) return true;
        }
        return false;
      };
      // The nib itself: an inline SVG pen rotated 45 degrees so its tip lands
      // on the pointer position. Inline rather than an image file so it needs
      // no network request and cannot flash in late.
      pen.style.cssText = "position:absolute;top:0;left:0;width:42px;height:42px;transform-origin:0% 100%;filter:drop-shadow(1px 2px 1px rgba(0,0,0,.22))";
      pen.innerHTML = "<svg width='42' height='42' viewBox='0 0 42 42' fill='none' xmlns='http://www.w3.org/2000/svg'><g transform='rotate(45 21 21)'><rect x='16.5' y='2' width='9' height='24' rx='2' fill='#16294d'/><rect x='16.5' y='2' width='4.5' height='24' fill='#22386b'/><rect x='16.5' y='7' width='9' height='3' fill='#f6c500'/><path d='M16.5 26 L21 38 L25.5 26 Z' fill='#e8dccb'/><path d='M21 32 L21 38 L25.5 26 Z' fill='#c9b79a'/><path d='M20 34 L21 38 L22 34 Z' fill='#16294d'/></g></svg>";
      root.appendChild(pen);
      // penLast is the previous pointer sample, used as the start point of the
      // next ink segment; writing is true only during an actual drawing drag.
      var penLast = null, writing = false;
      // One animation-frame tick. Decides which of four states the cursor is
      // in and renders it: hovering something interactive (dot), over text
      // (native I-beam), writing (pen + ink), or idle (pen).
      step = function () {
        // Sample the region under the cursor (throttled) so ink/dot stay
        // visible over dark navy sections by switching to a light ink.
        if (performance.now() - darkAt > 90) {
          darkAt = performance.now();
          onDark = isDarkAt(mx, my);
          inkColor = onDark ? LIGHT_INK : NAVY;
        }
        var hov = hovering || nearInteractive();
        // A drag only becomes "writing" if it STARTED on empty, non-interactive
        // space. Latching it at press time means that once a stroke is under
        // way it keeps drawing even as it passes over a button or a paragraph,
        // instead of breaking up mid-line.
        if (pressing && !writing && !onText && !hov) writing = true;
        if (!pressing) writing = false;
        if (hov && !writing) {
          setOverride(true); setNoSelect(false);
          pen.style.opacity = "0"; penLast = null;
          dot.style.background = inkColor;
          dot.style.opacity = "1";
          dot.style.transform = "translate(" + mx + "px," + my + "px)";
          return;
        }
        dot.style.opacity = "0";
        if (onText && !writing) {
          setOverride(false); setNoSelect(false);
          pen.style.opacity = "0"; penLast = null;
          return;
        }
        if (writing) {
          setOverride(true); setNoSelect(true);
          pen.style.opacity = "1";
          // Small vertical wobble and a deeper shadow while drawing, so the pen
          // reads as pressed against the page rather than gliding over it.
          var bob = Math.sin(performance.now() / 60) * 1.7;
          pen.style.transform = "translate(" + mx + "px," + (my - 42 + 3 + bob) + "px)";
          pen.style.filter = "drop-shadow(2px 5px 3px rgba(0,0,0,.3))";
          if (penLast) drawSeg(penLast[0], penLast[1], mx, my);
          penLast = [mx, my];
        } else {
          setNoSelect(false); penLast = null;
          setOverride(true);
          pen.style.opacity = "1";
          pen.style.transform = "translate(" + mx + "px," + (my - 42) + "px)";
          pen.style.filter = "drop-shadow(1px 2px 1px rgba(0,0,0,.22))";
        }
      };
    } else {
      // "Dot" — a single dot that tracks the pointer precisely, grows over
      // interactive elements, and recolors to light ink over dark navy regions.
      var dotCur = document.createElement("div");
      dotCur.style.cssText = "position:absolute;top:0;left:0;width:10px;height:10px;margin:-5px 0 0 -5px;background:" + NAVY + ";border-radius:50%;transition:background .15s ease";
      root.append(dotCur);
      var dotDarkAt = 0;
      step = function () {
        if (performance.now() - dotDarkAt > 90) {
          dotDarkAt = performance.now();
          dotCur.style.background = isDarkAt(mx, my) ? LIGHT_INK : NAVY;
        }
        dotCur.style.transform = "translate(" + mx + "px," + my + "px) scale(" + (pressing ? 0.7 : hovering ? 1.9 : 1) + ")";
      };
    }

    var handle = { root: root, style: style, style2: extraStyle, onMove: onMove, onOver: onOver, onDown: onDown, onUp: onUp, raf: 0 };
    var loop = function () { step(); handle.raf = requestAnimationFrame(loop); };
    handle.raf = requestAnimationFrame(loop);
    current = handle;
  }

  // Public API. get() reads the saved preference, set() saves and applies one,
  // apply() switches style without persisting.
  window.MonteCursor = {
    apply: apply,
    get: function () {
      try {
        var v = localStorage.getItem("monteCursor");
        // Only two styles remain (plus Native for touch); map anything else
        // — including legacy "Ring + dot"/"Soft glow"/"Invert lens" — to default.
        return (v === "Dot" || v === "Native") ? v : "Pen (ink)";
      } catch (e) { return "Pen (ink)"; }
    },
    set: function (type) { try { localStorage.setItem("monteCursor", type); } catch (e) {} apply(type); }
  };

  function boot() {
    apply(window.MonteCursor.get());
    // Keep open tabs in sync: the storage event fires in OTHER tabs when the
    // preference changes, so switching style in one applies it everywhere.
    window.addEventListener("storage", function (e) {
      if (e.key === "monteCursor") apply(e.newValue || "Pen (ink)");
    });
  }
  // Boot now if the document is already parsed, otherwise wait. The script is
  // injected via <helmet>, so it can arrive either side of DOMContentLoaded.
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
