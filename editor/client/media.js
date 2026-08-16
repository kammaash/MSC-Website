(function () {
  "use strict";
  // Loaded after editor-client.js by construction (server.js's INJECT order). If the
  // editor client declined to boot — framed page (FC-1), double load — EditorUI is
  // absent and the media drawer must decline with it. MediaUrls is the shared URL
  // authority injected immediately before the client modules.
  if (!window.EditorUI || !window.EditorMediaUrls) return;
  var UI = window.EditorUI;
  var URLS = window.EditorMediaUrls;
  var apiFetch = UI.apiFetch;
  var describeApiError = UI.describeApiError;

  // ---- state ----
  var cloudName = null;
  var records = null; // null = never loaded; [] = loaded, empty
  var photoUploadsEnabled = null; // null while loading; boolean from /api/media
  var tab = "image"; // segmented control: "image" (Photos) | "video" (Videos)
  var open = false;
  var pick = null; // { kind, onPick } while choosing media for a slot; null otherwise
  var setupOpen = false;

  // ---- chrome ----
  // Static markup only — record data NEVER goes through innerHTML (a filename is
  // user-supplied text); the grid below is built with createElement/textContent.
  var drawer = document.createElement("div");
  drawer.id = "ed-media";
  drawer.innerHTML =
    '<style>' +
    '#ed-media,#ed-media *{box-sizing:border-box;cursor:auto!important}' +
    '#ed-media{position:fixed;top:0;right:0;bottom:0;width:390px;max-width:94vw;z-index:2147482999;' +
    'background:linear-gradient(180deg,#2c2521 0%,#211c19 100%);color:#fff;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
    'box-shadow:-12px 0 36px rgba(20,12,8,.32);border-left:1px solid rgba(255,255,255,.08);' +
    'display:none;flex-direction:column;transform:translateX(104%);opacity:.6;transition:transform .28s cubic-bezier(.22,1,.36,1),opacity .2s ease}' +
    '#ed-media.ed-open{transform:translateX(0);opacity:1}' +
    '#ed-media header{display:flex;gap:12px;align-items:center;padding:18px 18px 14px;border-bottom:1px solid rgba(255,255,255,.1)}' +
    '#ed-media .ed-heading{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px}' +
    '#ed-media .ed-heading strong{font-size:16px;letter-spacing:.01em}' +
    '#ed-media .ed-heading span{color:#bfb5ae;font-size:11px}' +
    '#ed-media button{cursor:pointer!important}' +
    '#ed-media button:focus-visible,#ed-media .ed-tile:focus-visible{outline:3px solid #ffb28d;outline-offset:2px}' +
    '#ed-media #ed-media-close{display:flex;align-items:center;gap:6px;border:1px solid #5a504a;border-radius:8px;background:#39312d;color:#f7f2ef;padding:7px 9px;font:inherit;font-size:12px;font-weight:600}' +
    '#ed-media #ed-media-close:hover{background:#4a403a;border-color:#71645c}' +
    '#ed-media .ed-seg{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:14px 16px 0;padding:4px;background:#1e1917;border:1px solid #4a423c;border-radius:12px}' +
    '#ed-media .ed-seg button{display:flex;align-items:center;gap:9px;min-width:0;border:0;border-radius:8px;padding:9px 10px;background:transparent;color:#cfc7c0;text-align:left;font:inherit;transition:background .16s ease,color .16s ease,transform .16s ease}' +
    '#ed-media .ed-seg button:hover:not(:disabled){background:#39312d;color:#fff}' +
    '#ed-media .ed-seg button.ed-on{background:#e8541b;color:#fff;box-shadow:0 4px 14px rgba(232,84,27,.25)}' +
    '#ed-media .ed-seg button:active:not(:disabled){transform:scale(.98)}' +
    '#ed-media .ed-seg button:disabled{opacity:.32;cursor:not-allowed!important}' +
    '#ed-media .ed-seg b{font-size:17px;line-height:1}' +
    '#ed-media .ed-seg span{display:flex;min-width:0;flex-direction:column}' +
    '#ed-media .ed-seg strong{font-size:12px}' +
    '#ed-media .ed-seg small{font-size:10px;color:inherit;opacity:.76}' +
    '#ed-media .ed-help{margin:10px 16px 0;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.055);color:#cfc7c0;font-size:11px;line-height:1.45}' +
    '#ed-media.ed-picking .ed-help{display:none}' +
    '#ed-media .ed-pickbar{display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center;margin:10px 16px 0;padding:11px 12px;border-radius:10px;background:#fff3ec;color:#73230b;border:1px solid #ffb28d}' +
    '#ed-media .ed-pickbar[hidden]{display:none}' +
    '#ed-media .ed-pickbar strong{font-size:12px}' +
    '#ed-media .ed-pickbar span{font-size:10.5px;line-height:1.35}' +
    '#ed-media .ed-pickbar button{grid-column:2;grid-row:1/3;border:0;border-radius:7px;background:#73230b;color:#fff;padding:7px 9px;font:inherit;font-size:11px;font-weight:600}' +
    '#ed-media .ed-tools{display:grid;grid-template-columns:1fr;gap:5px;padding:12px 16px 10px}' +
    '#ed-media .ed-tools button{width:100%;min-height:38px;padding:8px 12px;border-radius:9px;border:0;background:#e8541b;color:#fff;font:inherit;font-size:12px;font-weight:700;transition:transform .16s ease,filter .16s ease}' +
    '#ed-media .ed-tools button:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px)}' +
    '#ed-media .ed-tools button:active:not(:disabled){transform:translateY(0) scale(.99)}' +
    '#ed-media .ed-tools button:disabled{background:#4a423c;color:#a89f99;cursor:not-allowed!important}' +
    '#ed-media .ed-action-note{min-height:16px;color:#bfb5ae;font-size:10.5px;text-align:center}' +
    '#ed-media .ed-photo-setup{margin:0 16px 12px;padding:12px;border:1px solid #6c5c53;border-radius:11px;background:#332c28}' +
    '#ed-media .ed-photo-setup[hidden]{display:none}' +
    '#ed-media .ed-photo-setup strong{display:block;margin-bottom:3px;font-size:12px}' +
    '#ed-media .ed-photo-setup p{margin:0 0 10px;color:#cfc7c0;font-size:10.5px;line-height:1.4}' +
    '#ed-media .ed-photo-setup label{display:block;margin-top:8px;color:#d8d0ca;font-size:10.5px}' +
    '#ed-media .ed-photo-setup input{display:block;width:100%;margin-top:4px;padding:8px 9px;border:1px solid #655950;border-radius:7px;background:#211c19;color:#fff;font:12px inherit}' +
    '#ed-media .ed-photo-setup input:focus{border-color:#ff9c70;outline:2px solid rgba(232,84,27,.25)}' +
    '#ed-media .ed-setup-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:11px}' +
    '#ed-media .ed-setup-actions button{min-height:34px;border:0;border-radius:7px;background:#e8541b;color:#fff;font:inherit;font-size:11px;font-weight:700}' +
    '#ed-media .ed-setup-actions .ed-setup-cancel{background:#514740}' +
    '#ed-media .ed-library-meta{display:flex;justify-content:space-between;align-items:center;padding:0 16px 8px;color:#bfb5ae;font-size:10.5px}' +
    '#ed-media .ed-grid{flex:1;overflow-y:auto;padding:0 16px 18px;display:grid;' +
    'grid-template-columns:1fr 1fr;gap:12px;align-content:start;scrollbar-color:#5a504a transparent}' +
    '#ed-media .ed-tile{position:relative;background:#332c28;border:1px solid rgba(255,255,255,.08);border-radius:11px;overflow:hidden;cursor:grab!important;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}' +
    '#ed-media.ed-picking .ed-tile{cursor:pointer!important}' +
    '#ed-media .ed-tile:hover{transform:translateY(-2px);border-color:#826b5f;box-shadow:0 8px 20px rgba(0,0,0,.24)}' +
    '#ed-media.ed-picking .ed-tile:hover{border-color:#ff8b55;box-shadow:0 0 0 2px rgba(232,84,27,.25),0 10px 22px rgba(0,0,0,.28)}' +
    '#ed-media .ed-tile img{display:block;width:100%;height:116px;object-fit:cover;background:#1c1714}' +
    '#ed-media .ed-tile figcaption{padding:7px 8px;font-size:11px;color:#e4dcd7;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#ed-media .ed-tile .ed-del{position:absolute;top:7px;right:7px;width:28px;height:28px;border:1px solid rgba(255,255,255,.2);border-radius:8px;' +
    'background:rgba(32,25,22,.9);color:#fff;font:14px sans-serif;transition:background .15s ease,transform .15s ease}' +
    '#ed-media .ed-tile .ed-del:hover{background:#a51915;transform:scale(1.05)}' +
    '#ed-media .ed-tile .ed-badge{position:absolute;top:8px;left:8px;padding:3px 7px;border-radius:7px;' +
    'background:rgba(38,32,29,.9);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}' +
    '#ed-media .ed-use{display:none;position:absolute;left:8px;right:8px;bottom:35px;padding:7px;border-radius:7px;background:#e8541b;color:#fff;text-align:center;font-size:10.5px;font-weight:700;box-shadow:0 5px 12px rgba(0,0,0,.25)}' +
    '#ed-media.ed-picking .ed-use{display:block}' +
    '#ed-media .ed-empty{grid-column:1/-1;border:1px dashed #5a504a;border-radius:12px;background:rgba(255,255,255,.03);color:#cfc7c0;text-align:center;padding:34px 18px;line-height:1.55}' +
    '#ed-media-btn{background:#4a423c}' +
    '@media (prefers-reduced-motion:reduce){#ed-media,#ed-media *{transition:none!important}}' +
    '</style>' +
    '<header><div class="ed-heading"><strong>Media library</strong><span>Choose what appears on this page</span></div>' +
    '<button id="ed-media-close" type="button" title="Close media library" aria-label="Close media library"><span>Close</span> ✕</button></header>' +
    '<div class="ed-seg" role="tablist" aria-label="Media type">' +
    '<button id="ed-seg-photos" type="button" role="tab"><b>▧</b><span><strong>Photos</strong><small>Upload images</small></span></button>' +
    '<button id="ed-seg-videos" type="button" role="tab"><b>▶</b><span><strong>Videos</strong><small>YouTube links</small></span></button></div>' +
    '<div class="ed-help">Select a Photos or Videos tab. Add media here, then click a page media area or drag a tile onto its matching outline.</div>' +
    '<div class="ed-pickbar" hidden><div><strong class="ed-pick-title">Choose media</strong><br><span class="ed-pick-copy"></span></div>' +
    '<button id="ed-media-cancel-pick" type="button">Cancel</button></div>' +
    '<div class="ed-tools"><button id="ed-media-upload" type="button">Upload photos</button><div class="ed-action-note"></div></div>' +
    '<form class="ed-photo-setup" hidden><strong>Connect Cloudinary</strong>' +
    '<p>Enter the three values from Cloudinary Dashboard → API Keys. The secret stays on this computer and is never published.</p>' +
    '<label>Cloud name<input name="cloudName" autocomplete="off" required></label>' +
    '<label>API key<input name="apiKey" autocomplete="off" required></label>' +
    '<label>API secret<input name="apiSecret" type="password" autocomplete="new-password" required></label>' +
    '<div class="ed-setup-actions"><button type="submit">Save &amp; enable</button><button class="ed-setup-cancel" type="button">Cancel</button></div></form>' +
    '<div class="ed-library-meta"><strong class="ed-library-count">Media</strong><span>Click to use · drag to place</span></div>' +
    '<div class="ed-grid"></div>';
  document.body.appendChild(drawer);

  var grid = drawer.querySelector(".ed-grid");
  var segPhotos = drawer.querySelector("#ed-seg-photos");
  var segVideos = drawer.querySelector("#ed-seg-videos");
  var uploadBtn = drawer.querySelector("#ed-media-upload");
  var actionNote = drawer.querySelector(".ed-action-note");
  var setupForm = drawer.querySelector(".ed-photo-setup");
  var libraryCount = drawer.querySelector(".ed-library-count");
  var pickBar = drawer.querySelector(".ed-pickbar");
  var pickTitle = drawer.querySelector(".ed-pick-title");
  var pickCopy = drawer.querySelector(".ed-pick-copy");

  // The Media button lives in the editor bar, right before Publish.
  var bar = document.getElementById("ed-bar");
  var mediaBtn = document.createElement("button");
  mediaBtn.id = "ed-media-btn";
  mediaBtn.textContent = "🖼 Media";
  bar.insertBefore(mediaBtn, bar.querySelector("#ed-publish"));

  // ---- rendering ----
  function thumbUrl(rec) {
    return URLS.thumbnailUrl(cloudName, rec);
  }
  function describeSlot(path, kind) {
    if (/hero\.photo$/.test(path)) return "hero photo";
    if (/founder\.photo$/.test(path)) return "founder photo";
    if (/showcase\.video$/.test(path)) return "showcase video";
    if (/gallery/i.test(path)) return "gallery photo";
    return kind === "video" ? "selected video area" : "selected photo area";
  }
  function render() {
    var isPhoto = tab === "image";
    drawer.classList.toggle("ed-picking", !!pick);
    uploadBtn.textContent = isPhoto
      ? (photoUploadsEnabled === false ? "⚙ Set up photo uploads" : "⬆ Upload photos")
      : "🔗 Add YouTube video";
    uploadBtn.disabled = !!uploading || (isPhoto && photoUploadsEnabled === null);
    actionNote.textContent = isPhoto
      ? (photoUploadsEnabled === true ? "JPG, PNG or WebP · stored securely in Cloudinary"
        : photoUploadsEnabled === null ? "Checking photo upload setup…"
        : "One-time setup · credentials stay outside the website")
      : "Paste an Unlisted YouTube video link";
    setupForm.hidden = !setupOpen || !isPhoto || photoUploadsEnabled !== false;
    segPhotos.classList.toggle("ed-on", tab === "image");
    segVideos.classList.toggle("ed-on", tab === "video");
    segPhotos.setAttribute("aria-selected", String(tab === "image"));
    segVideos.setAttribute("aria-selected", String(tab === "video"));
    segPhotos.disabled = !!pick && pick.kind !== "image";
    segVideos.disabled = !!pick && pick.kind !== "video";
    pickBar.hidden = !pick;
    if (pick) {
      var noun = pick.kind === "video" ? "video" : "photo";
      pickTitle.textContent = "Choose a " + noun;
      pickCopy.textContent = "For the " + describeSlot(pick.path, pick.kind) + " — click a tile or drag it onto the highlighted area.";
    }
    grid.textContent = "";
    if (records === null) {
      libraryCount.textContent = "Loading…";
      var loading = document.createElement("div");
      loading.className = "ed-empty";
      loading.textContent = "Loading your media library…";
      grid.appendChild(loading);
      return;
    }
    var shown = records.filter(function (r) { return r && r.kind === tab; });
    libraryCount.textContent = shown.length + " " + (isPhoto ? "photo" : "video") + (shown.length === 1 ? "" : "s");
    if (shown.length === 0) {
      var empty = document.createElement("div");
      empty.className = "ed-empty";
      empty.textContent = tab === "image"
        ? (photoUploadsEnabled === true
          ? "No photos yet. Use Upload photos to add images you can place on any page."
          : "No photos yet. Run npm run setup in Terminal to enable photo uploads.")
        : "No videos yet. Upload to the school's YouTube channel (set to Unlisted) in YouTube Studio, then Add YouTube link here.";
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
      del.onclick = function (e) {
        // A tile click places media while pick mode is armed. Never let the nested
        // delete control bubble into that handler — Cancel and OK must both mean
        // exactly what their confirmation dialog says.
        e.stopPropagation();
        removeRec(rec);
      };
      tile.appendChild(del);
      var cap = document.createElement("figcaption");
      cap.textContent = rec.name || rec.id; // textContent, never innerHTML — filenames are user-supplied
      cap.title = rec.name || rec.id;
      tile.appendChild(cap);
      tile.draggable = true;
      if (pick) {
        tile.tabIndex = 0;
        tile.setAttribute("role", "button");
        tile.setAttribute("aria-label", "Use " + (rec.name || rec.id));
      }
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
      tile.onkeydown = function (e) {
        if (pick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          tile.onclick();
        }
      };
      var use = document.createElement("span");
      use.className = "ed-use";
      use.textContent = rec.kind === "video" ? "Use this video" : "Use this photo";
      tile.appendChild(use);
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
      photoUploadsEnabled = data.photoUploadsEnabled === true;
      if (data.mediaUncommitted === true) {
        // Recover the transaction bit after reload or a lost add/delete response.
        // The server reports the real git state; Publish must never overlook it.
        UI.draft.markSavedToDisk();
        UI.update();
      }
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
  function cancelPick() {
    var onCancel = pick && pick.onCancel;
    pick = null;
    if (onCancel) onCancel();
    render();
  }
  function setOpen(v) {
    cancelPick(); // opening normally or closing always cancels pick mode
    setOpenInner(v);
  }
  function openPicker(kind, onPick, onCancel, path) {
    cancelPick();
    pick = { kind: kind, onPick: onPick, onCancel: onCancel, path: path };
    tab = kind;
    render();
    if (!open) setOpenInner(true); else { render(); refresh(); }
  }
  window.EditorMedia = { openPicker: openPicker, cancelPick: cancelPick };
  mediaBtn.onclick = function () { setOpen(!open); };
  drawer.querySelector("#ed-media-close").onclick = function () { setOpen(false); };
  drawer.querySelector("#ed-media-cancel-pick").onclick = function () { cancelPick(); };
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
  function photoFileProblem(file) {
    var allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!file || allowed.indexOf(file.type) === -1) return "Choose a JPG, PNG or WebP photo.";
    if (!Number.isFinite(file.size) || file.size <= 0) return "That photo is empty.";
    if (file.size > 15 * 1024 * 1024) return "That photo is larger than 15 MB. Resize it and try again.";
    return null;
  }
  function uploadOne(file) {
    var problem = photoFileProblem(file);
    if (problem) return Promise.reject(new Error(problem));
    var timestamp = Math.floor(Date.now() / 1000);
    return apiFetch("/api/sign", {
      method: "POST", body: JSON.stringify({ paramsToSign: { timestamp: timestamp, folder: "msc-website" } }),
    }).then(function (signRes) {
      if (!signRes.ok) return signRes.text().then(function (t) { throw new Error(describeApiError(signRes.status, t)); });
      return signRes.json();
    }).then(function (s) {
      var fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", s.apiKey);
      fd.append("timestamp", String(timestamp));
      fd.append("folder", "msc-website");
      fd.append("signature", s.signature);
      // Cloudinary is a third party — a bare fetch, NEVER apiFetch, which would leak
      // this machine's local editor token off-machine (same rule as editor-client.js).
      return fetch("https://api.cloudinary.com/v1_1/" + s.cloudName + "/auto/upload", { method: "POST", body: fd });
    }).then(function (upRes) {
      return upRes.json().catch(function () { return null; }).then(function (up) {
        if (!up || typeof up !== "object") up = {};
        if (!upRes.ok || up.error) throw new Error((up.error && up.error.message) || ("Cloudinary upload failed (HTTP " + upRes.status + ")"));
        if (typeof up.public_id !== "string" || up.public_id === "") throw new Error("Cloudinary response is missing public_id");
        // accept="image/*" is only a picker hint — a determined pick can still hand us a
        // video. Videos live on YouTube now (drawer → Videos → Add YouTube link), so a
        // non-image response is refused here rather than stored as a bogus record.
        if (up.resource_type !== "image") {
          throw new Error("Only photos can be uploaded here. Videos go on YouTube — switch to the Videos tab and use 🔗 Add YouTube link.");
        }
        var rec = {
          id: up.public_id,
          kind: "image",
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
  // Videos never travel through this machine: the human uploads in YouTube Studio
  // (Unlisted), pastes the link, and the server verifies and stores it atomically.
  // Network or malformed-metadata failures fail closed: no unverified player enters
  // the library and the collaborator can retry without cleaning up partial state.
  function addYouTubeLink() {
    var input = prompt("Paste the YouTube link.\n\n(Upload the video in YouTube Studio first and set its visibility to Unlisted.)");
    if (!input) return Promise.resolve(null);
    return apiFetch("/api/youtube/add", { method: "POST", body: JSON.stringify({ url: input }) }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(describeApiError(r.status, t)); });
      return r.json();
    }).then(function (data) {
      if (!data || !data.record || data.record.kind !== "video") {
        throw new Error("The editor received an invalid video record. Nothing was placed.");
      }
      return data.record;
    });
  }
  var uploading = false; // one batch at a time — same reasoning as the Publish interlock
  setupForm.querySelector(".ed-setup-cancel").onclick = function () {
    setupOpen = false;
    setupForm.reset();
    render();
  };
  setupForm.onsubmit = async function (e) {
    e.preventDefault();
    if (uploading) return;
    var fields = new FormData(setupForm);
    uploading = true;
    render();
    try {
      var response = await apiFetch("/api/photo-setup", {
        method: "POST",
        body: JSON.stringify({
          cloudName: fields.get("cloudName"),
          apiKey: fields.get("apiKey"),
          apiSecret: fields.get("apiSecret"),
        }),
      });
      if (!response.ok) throw new Error(describeApiError(response.status, await response.text()));
      var configured = await response.json();
      cloudName = configured.cloudName;
      photoUploadsEnabled = true;
      setupOpen = false;
      setupForm.reset(); // especially clear the secret from the DOM
      if (window.SHARED_CONTENT) window.SHARED_CONTENT.cloudName = cloudName;
      UI.draft.markSavedToDisk(); // setup updated content.js's published cloud name
      UI.rerender();
      UI.update();
      render();
    } catch (err) {
      alert("Couldn't enable photo uploads:\n" + err.message);
    } finally {
      uploading = false;
      render();
    }
  };
  uploadBtn.onclick = async function () {
    if (uploading) return;
    if (tab === "image" && photoUploadsEnabled === false) {
      setupOpen = true;
      render();
      setupForm.querySelector('input[name="cloudName"]').focus();
      return;
    }
    if (tab === "video") {
      uploading = true;
      uploadBtn.disabled = true;
      try {
        var vrec = await addYouTubeLink();
        if (vrec) {
          if (records) records.unshift(vrec); // mirror the server's newest-first order
          UI.draft.markSavedToDisk(); // media.json changed on disk — Publish must know
          UI.update();
          render();
        }
      } catch (err) {
        alert("Couldn't add the video:\n" + err.message);
      } finally {
        uploading = false;
        uploadBtn.disabled = false;
      }
      return;
    }
    var files = await pickFiles("image/*");
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
