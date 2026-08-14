(function () {
  "use strict";
  // Loaded after editor-client.js by construction (server.js's INJECT order). If the
  // editor client declined to boot — framed page (FC-1), double load — EditorUI is
  // absent and the media drawer must decline with it, not re-derive those checks.
  if (!window.EditorUI) return;
  var UI = window.EditorUI;
  var apiFetch = UI.apiFetch;
  var describeApiError = UI.describeApiError;

  // ---- state ----
  var cloudName = null;
  var records = null; // null = never loaded; [] = loaded, empty
  var tab = "image"; // segmented control: "image" (Photos) | "video" (Videos)
  var open = false;
  var pick = null; // { kind, onPick } while choosing media for a slot; null otherwise

  // ---- chrome ----
  // Static markup only — record data NEVER goes through innerHTML (a filename is
  // user-supplied text); the grid below is built with createElement/textContent.
  var drawer = document.createElement("div");
  drawer.id = "ed-media";
  drawer.innerHTML =
    '<style>' +
    '#ed-media{position:fixed;top:0;right:0;bottom:0;width:340px;max-width:90vw;z-index:2147482999;' +
    'background:#26201d;color:#fff;font:13px/1.4 -apple-system,sans-serif;box-shadow:-4px 0 18px rgba(0,0,0,.35);' +
    'display:none;flex-direction:column;transform:translateX(100%);transition:transform .2s ease}' +
    '#ed-media.ed-open{transform:translateX(0)}' +
    '#ed-media header{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid #4a423c}' +
    '#ed-media header strong{flex:1}' +
    '#ed-media .ed-seg{display:flex;margin:10px 12px 0;border:1px solid #4a423c;border-radius:8px;overflow:hidden}' +
    '#ed-media .ed-seg button{flex:1;font:inherit;padding:6px 0;border:0;cursor:pointer;background:transparent;color:#cfc7c0}' +
    '#ed-media .ed-seg button.ed-on{background:#e8541b;color:#fff;font-weight:600}' +
    '#ed-media .ed-tools{display:flex;gap:8px;padding:10px 12px}' +
    '#ed-media .ed-tools button{font:inherit;padding:6px 12px;border-radius:6px;border:0;cursor:pointer;background:#4a423c;color:#fff}' +
    '#ed-media .ed-tools #ed-media-upload{background:#e8541b;font-weight:600}' +
    '#ed-media .ed-grid{flex:1;overflow-y:auto;padding:0 12px 12px;display:grid;' +
    'grid-template-columns:1fr 1fr;gap:10px;align-content:start}' +
    '#ed-media .ed-tile{position:relative;background:#332c28;border-radius:8px;overflow:hidden}' +
    '#ed-media .ed-tile img{display:block;width:100%;height:110px;object-fit:cover;background:#1c1714}' +
    '#ed-media .ed-tile figcaption{padding:5px 7px;font-size:11px;color:#cfc7c0;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#ed-media .ed-tile .ed-del{position:absolute;top:5px;right:5px;width:24px;height:24px;border:0;border-radius:6px;' +
    'cursor:pointer;background:rgba(38,32,29,.85);color:#fff;font:12px sans-serif}' +
    '#ed-media .ed-tile .ed-badge{position:absolute;top:5px;left:5px;padding:2px 6px;border-radius:6px;' +
    'background:rgba(38,32,29,.85);font-size:10px}' +
    '#ed-media .ed-empty{grid-column:1/-1;color:#cfc7c0;text-align:center;padding:28px 8px}' +
    '#ed-media .ed-pickbar{margin:0 12px 10px;padding:8px 10px;border-radius:8px;background:#e8541b;font-weight:600}' +
    '#ed-media-btn{background:#4a423c}' +
    '</style>' +
    '<header><strong>Media library</strong><button id="ed-media-close" title="Close">✕</button></header>' +
    '<div class="ed-seg"><button id="ed-seg-photos">Photos</button><button id="ed-seg-videos">Videos</button></div>' +
    '<div class="ed-tools"><button id="ed-media-upload">⬆ Upload</button></div>' +
    '<div class="ed-pickbar" hidden>Click a tile to place it in the selected spot — or close to cancel.</div>' +
    '<div class="ed-grid"></div>';
  document.body.appendChild(drawer);

  var grid = drawer.querySelector(".ed-grid");
  var segPhotos = drawer.querySelector("#ed-seg-photos");
  var segVideos = drawer.querySelector("#ed-seg-videos");
  var uploadBtn = drawer.querySelector("#ed-media-upload");

  // The Media button lives in the editor bar, right before Publish.
  var bar = document.getElementById("ed-bar");
  var mediaBtn = document.createElement("button");
  mediaBtn.id = "ed-media-btn";
  mediaBtn.textContent = "🖼 Media";
  bar.insertBefore(mediaBtn, bar.querySelector("#ed-publish"));

  // ---- rendering ----
  function thumbUrl(rec) {
    // Cloudinary derives everything from cloudName + public_id; a video's poster frame
    // is just the same URL under /video/upload with a .jpg extension.
    var base = "https://res.cloudinary.com/" + encodeURIComponent(cloudName) + "/" +
      rec.kind + "/upload/c_fill,w_300,h_220,q_auto/" + rec.id;
    return rec.kind === "video" ? base + ".jpg" : base;
  }
  function render() {
    segPhotos.classList.toggle("ed-on", tab === "image");
    segVideos.classList.toggle("ed-on", tab === "video");
    grid.textContent = "";
    if (records === null) return; // still loading — refresh() will re-render
    var shown = records.filter(function (r) { return r && r.kind === tab; });
    if (shown.length === 0) {
      var empty = document.createElement("div");
      empty.className = "ed-empty";
      empty.textContent = tab === "image"
        ? "No photos yet. Upload some — they'll be available to place on any page."
        : "No videos yet. Upload some — they'll be available to place on any page.";
      grid.appendChild(empty);
      return;
    }
    shown.forEach(function (rec) {
      var tile = document.createElement("figure");
      tile.className = "ed-tile";
      tile.style.margin = "0";
      var img = document.createElement("img");
      img.loading = "lazy";
      img.alt = rec.name || rec.id;
      img.src = thumbUrl(rec);
      tile.appendChild(img);
      if (rec.kind === "video") {
        var badge = document.createElement("span");
        badge.className = "ed-badge";
        badge.textContent = "▶ video";
        tile.appendChild(badge);
      }
      var del = document.createElement("button");
      del.className = "ed-del";
      del.title = "Remove from library";
      del.textContent = "✕";
      del.onclick = function () { removeRec(rec); };
      tile.appendChild(del);
      var cap = document.createElement("figcaption");
      cap.textContent = rec.name || rec.id; // textContent, never innerHTML — filenames are user-supplied
      cap.title = rec.name || rec.id;
      tile.appendChild(cap);
      tile.draggable = true;
      tile.style.cursor = "grab";
      tile.ondragstart = function (e) {
        e.dataTransfer.setData("application/x-msc-media-" + rec.kind, JSON.stringify({ record: rec, cloudName: cloudName }));
        e.dataTransfer.effectAllowed = "copy";
        document.body.classList.add("ed-dragging-" + rec.kind);
      };
      tile.ondragend = function () {
        document.body.classList.remove("ed-dragging-image", "ed-dragging-video");
      };
      tile.onclick = function () {
        if (!pick) return;
        if (rec.kind !== pick.kind) return; // wrong tab clicked mid-pick; tabs already filter
        var cb = pick.onPick;
        setOpen(false); // clears pick + hides banner
        cb(rec, cloudName);
      };
      grid.appendChild(tile);
    });
  }

  function refresh() {
    return apiFetch("/api/media").then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(describeApiError(r.status, t)); });
      return r.json();
    }).then(function (data) {
      cloudName = data.cloudName;
      records = data.records;
      render();
    }).catch(function (err) {
      records = records || [];
      render();
      alert("Couldn't load the media library:\n" + err.message);
    });
  }

  // ---- open/close ----
  function setOpenInner(v) {
    open = v;
    if (v) {
      drawer.style.display = "flex";
      drawer.style.top = bar.offsetHeight + "px"; // sit below the editor bar, whatever its height
      requestAnimationFrame(function () { drawer.classList.add("ed-open"); });
      refresh(); // re-fetch on every open — another collaborator may have published uploads
    } else {
      drawer.classList.remove("ed-open");
      setTimeout(function () { if (!open) drawer.style.display = "none"; }, 200); // after the slide-out
    }
  }
  function setOpen(v) {
    pick = null; // opening normally or closing always cancels pick mode
    drawer.querySelector(".ed-pickbar").hidden = true;
    setOpenInner(v);
  }
  function openPicker(kind, onPick) {
    pick = { kind: kind, onPick: onPick };
    tab = kind;
    drawer.querySelector(".ed-pickbar").hidden = false;
    if (!open) setOpenInner(true); else { render(); refresh(); }
  }
  window.EditorMedia = { openPicker: openPicker };
  mediaBtn.onclick = function () { setOpen(!open); };
  drawer.querySelector("#ed-media-close").onclick = function () { setOpen(false); };
  segPhotos.onclick = function () { tab = "image"; render(); };
  segVideos.onclick = function () { tab = "video"; render(); };

  // ---- upload ----
  function pickFiles(accept) {
    return new Promise(function (resolve) {
      var i = document.createElement("input");
      i.type = "file"; i.accept = accept; i.multiple = true;
      i.onchange = function () { resolve(Array.prototype.slice.call(i.files)); };
      i.oncancel = function () { resolve([]); }; // dismissed picker must not hang the await
      i.click();
    });
  }
  function uploadOne(file) {
    var timestamp = Math.floor(Date.now() / 1000);
    return apiFetch("/api/sign", {
      method: "POST", body: JSON.stringify({ paramsToSign: { timestamp: timestamp } }),
    }).then(function (signRes) {
      if (!signRes.ok) return signRes.text().then(function (t) { throw new Error(describeApiError(signRes.status, t)); });
      return signRes.json();
    }).then(function (s) {
      var fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", s.apiKey);
      fd.append("timestamp", String(timestamp));
      fd.append("signature", s.signature);
      // Cloudinary is a third party — a bare fetch, NEVER apiFetch, which would leak
      // this machine's local editor token off-machine (same rule as editor-client.js).
      return fetch("https://api.cloudinary.com/v1_1/" + s.cloudName + "/auto/upload", { method: "POST", body: fd });
    }).then(function (upRes) {
      return upRes.json().catch(function () { return null; }).then(function (up) {
        if (!up || typeof up !== "object") up = {};
        if (!upRes.ok || up.error) throw new Error((up.error && up.error.message) || ("Cloudinary upload failed (HTTP " + upRes.status + ")"));
        if (typeof up.public_id !== "string" || up.public_id === "") throw new Error("Cloudinary response is missing public_id");
        var rec = {
          id: up.public_id,
          kind: up.resource_type === "video" ? "video" : "image",
          name: file.name,
          createdAt: new Date().toISOString(),
        };
        if (typeof up.format === "string") rec.format = up.format;
        if (typeof up.width === "number") rec.width = up.width;
        if (typeof up.height === "number") rec.height = up.height;
        if (typeof up.bytes === "number") rec.bytes = up.bytes;
        return apiFetch("/api/media", { method: "POST", body: JSON.stringify({ record: rec }) }).then(function (r) {
          if (!r.ok) return r.text().then(function (t) { throw new Error(describeApiError(r.status, t)); });
          return rec;
        });
      });
    });
  }
  var uploading = false; // one batch at a time — same reasoning as the Publish interlock
  uploadBtn.onclick = async function () {
    if (uploading) return;
    var files = await pickFiles(tab === "image" ? "image/*" : "video/*");
    if (files.length === 0) return;
    uploading = true;
    uploadBtn.disabled = true;
    var busy = document.createElement("div");
    busy.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483000;background:#26201d;color:#fff;padding:10px 16px;border-radius:8px;font:13px sans-serif";
    document.body.appendChild(busy);
    var failed = [];
    try {
      for (var i = 0; i < files.length; i++) {
        busy.textContent = "Uploading " + files[i].name + " (" + (i + 1) + "/" + files.length + ")…";
        try {
          var rec = await uploadOne(files[i]);
          if (records) records.unshift(rec); // mirror the server's newest-first order
          // media.json changed on disk with no pending draft op — Publish must know
          // there is now something to commit (see draft.js's markSavedToDisk).
          UI.draft.markSavedToDisk();
          UI.update();
          render();
        } catch (err) {
          failed.push(files[i].name + " — " + err.message);
        }
      }
    } finally {
      busy.remove();
      uploading = false;
      uploadBtn.disabled = false;
    }
    if (failed.length) alert("Some uploads failed:\n\n" + failed.join("\n"));
  };

  // ---- delete ----
  function removeRec(rec) {
    if (!confirm("Remove \"" + (rec.name || rec.id) + "\" from the media library?\n\n" +
      "It disappears from this list (and from the next Publish), but the uploaded file itself is kept, so the site admin can restore it.")) return;
    apiFetch("/api/media/delete", { method: "POST", body: JSON.stringify({ id: rec.id }) }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(describeApiError(r.status, t)); });
      records = records.filter(function (x) { return x && x.id !== rec.id; });
      UI.draft.markSavedToDisk(); // same as upload: media.json changed on disk
      UI.update();
      render();
    }).catch(function (err) {
      alert("Couldn't remove it:\n" + err.message);
    });
  }
})();
