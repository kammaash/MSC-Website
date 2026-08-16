(function (exports) {
  "use strict";
  // The ONE place a delivery URL is derived from a media.json record. `kind` is the
  // provider: images live on Cloudinary (id = public_id), videos on YouTube
  // (id = 11-char video id; uploaded manually in YouTube Studio as Unlisted — see
  // lib/youtube.js for why API upload is off). Full-size placement and drawer
  // thumbnails deliberately use different Cloudinary transforms for their surfaces.
  //
  // Encode each public-id segment independently: folder slashes survive while URL
  // delimiters and spaces inside a segment cannot change the URL's meaning.
  function imageId(id) {
    return String(id).split("/").map(encodeURIComponent).join("/");
  }
  function deliveryUrl(cloudName, record) {
    if (!record || (record.kind !== "image" && record.kind !== "video")) {
      throw new Error("Unknown media kind");
    }
    if (record.kind === "video") return embedUrl(record.id);
    return "https://res.cloudinary.com/" + encodeURIComponent(cloudName) +
      "/image/upload/f_auto,q_auto,w_1600/" + imageId(record.id);
  }
  // youtube-nocookie.com is YouTube's privacy-enhanced host (no tracking cookies
  // until playback). rel=0 keeps end-screen suggestions to this channel only.
  // modestbranding is defunct (YouTube ignores it) — deliberately omitted.
  function embedUrl(videoId) {
    if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      throw new Error("Invalid YouTube video ID");
    }
    return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(videoId) + "?rel=0";
  }
  function thumbnailUrl(cloudName, record) {
    if (record.kind === "video") {
      embedUrl(record.id); // same strict validation as full-size delivery
      return "https://i.ytimg.com/vi/" + encodeURIComponent(record.id) + "/mqdefault.jpg";
    }
    return "https://res.cloudinary.com/" + encodeURIComponent(cloudName) +
      "/image/upload/c_fill,w_300,h_220,q_auto/" + imageId(record.id);
  }
  Object.assign(exports, { deliveryUrl, embedUrl, thumbnailUrl });
})(typeof module !== "undefined" ? module.exports : (window.EditorMediaUrls = {}));
