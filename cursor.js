(function () {
  var NAVY = "#16294d";
  var LIGHT_INK = "#f4f7ff";
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

  function apply(type) {
    teardown();
    type = type || "Pen (ink)";
    if (type === "Native" || (window.matchMedia && matchMedia("(pointer:coarse)").matches)) {
      document.body.style.cursor = "";
      return;
    }
    var style = document.createElement("style");
    style.setAttribute("data-monte-cursor", "");
    style.textContent = "*{cursor:none!important}";
    document.head.appendChild(style);
    var root = document.createElement("div");
    root.setAttribute("data-monte-cursor", "");
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999";
    document.body.appendChild(root);

    var sel = "a,button,input,select,textarea,[data-btn],[data-card]";
    var textSel = "p,h1,h2,h3,h4,h5,h6,li,em,strong,blockquote,label,input,textarea,option";
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

    if (type === "Pen (ink)") {
      extraStyle = document.createElement("style");
      extraStyle.setAttribute("data-monte-cursor", "");
      document.head.appendChild(extraStyle);
      var setOverride = function (on) { style.textContent = on ? "*{cursor:none!important}" : ""; };
      var setNoSelect = function (on) { extraStyle.textContent = on ? "*{user-select:none!important;-webkit-user-select:none!important}" : ""; };
      var ns = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(ns, "svg");
      svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%;overflow:visible");
      root.appendChild(svg);
      var inkColor = NAVY, onDark = false, darkAt = 0;
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
      pen.style.cssText = "position:absolute;top:0;left:0;width:42px;height:42px;transform-origin:0% 100%;filter:drop-shadow(1px 2px 1px rgba(0,0,0,.22))";
      pen.innerHTML = "<svg width='42' height='42' viewBox='0 0 42 42' fill='none' xmlns='http://www.w3.org/2000/svg'><g transform='rotate(45 21 21)'><rect x='16.5' y='2' width='9' height='24' rx='2' fill='#16294d'/><rect x='16.5' y='2' width='4.5' height='24' fill='#22386b'/><rect x='16.5' y='7' width='9' height='3' fill='#f6c500'/><path d='M16.5 26 L21 38 L25.5 26 Z' fill='#e8dccb'/><path d='M21 32 L21 38 L25.5 26 Z' fill='#c9b79a'/><path d='M20 34 L21 38 L22 34 Z' fill='#16294d'/></g></svg>";
      root.appendChild(pen);
      var penLast = null, writing = false;
      step = function () {
        // Sample the region under the cursor (throttled) so ink/dot stay
        // visible over dark navy sections by switching to a light ink.
        if (performance.now() - darkAt > 90) {
          darkAt = performance.now();
          onDark = isDarkAt(mx, my);
          inkColor = onDark ? LIGHT_INK : NAVY;
        }
        var hov = hovering || nearInteractive();
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
    window.addEventListener("storage", function (e) {
      if (e.key === "monteCursor") apply(e.newValue || "Pen (ink)");
    });
  }
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
