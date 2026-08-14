(function (exports) {
  "use strict";
  // The ONE place a Cloudinary delivery URL is derived from a media.json record.
  // Shapes are pinned to what the site already renders with (see the gallery
  // mapping in montessori-vidyanagar.html): change them together or not at all.
  // encodeURI, not encodeURIComponent: public_ids are folder-scoped ("msc/x") and
  // the slash must survive into the URL path.
  function deliveryUrl(cloudName, record) {
    var cdn = "https://res.cloudinary.com/" + cloudName;
    if (record.kind === "video") return cdn + "/video/upload/q_auto/" + encodeURI(record.id) + ".mp4";
    return cdn + "/image/upload/f_auto,q_auto,w_1600/" + encodeURI(record.id);
  }
  function posterUrl(cloudName, record) {
    return "https://res.cloudinary.com/" + cloudName + "/video/upload/so_0,f_jpg,q_auto,w_800/" + encodeURI(record.id) + ".jpg";
  }
  Object.assign(exports, { deliveryUrl, posterUrl });
})(typeof module !== "undefined" ? module.exports : (window.EditorMediaUrls = {}));
