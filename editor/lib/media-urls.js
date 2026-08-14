(function (exports) {
  "use strict";
  // The ONE place a delivery URL is derived from a media.json record. `kind` is the
  // provider: images live on Cloudinary (id = public_id), videos on YouTube
  // (id = 11-char video id; uploaded manually in YouTube Studio as Unlisted — see
  // lib/youtube.js for why API upload is off). The Cloudinary image shape is pinned
  // to what the site already renders with (the gallery mapping in
  // montessori-vidyanagar.html): change them together or not at all.
  //
  // encodeURI, not encodeURIComponent, for public_ids: they are folder-scoped
  // ("msc/x") and the slash must survive into the URL path.
  function deliveryUrl(cloudName, record) {
    if (record.kind === "video") return embedUrl(record.id);
    return "https://res.cloudinary.com/" + cloudName + "/image/upload/f_auto,q_auto,w_1600/" + encodeURI(record.id);
  }
  // youtube-nocookie.com is YouTube's privacy-enhanced host (no tracking cookies
  // until playback). rel=0 keeps end-screen suggestions to this channel only.
  // modestbranding is defunct (YouTube ignores it) — deliberately omitted.
  function embedUrl(videoId) {
    return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(videoId) + "?rel=0";
  }
  Object.assign(exports, { deliveryUrl, embedUrl });
})(typeof module !== "undefined" ? module.exports : (window.EditorMediaUrls = {}));
