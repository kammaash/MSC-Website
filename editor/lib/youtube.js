"use strict";
/*
  YouTube auto-upload — INTENTIONALLY DISABLED.
  Google locks videos uploaded via videos.insert from unverified API projects
  to private, with no appeal (support.google.com/youtube/answer/7300965).
  Until the project passes Google's compliance audit, videos go to Cloudinary.
  When the audit passes: set { "youtube": { "enabled": true } } in
  editor/config.json and implement against videos.insert (quota: 100/day),
  uploading to each school's Brand Account channel.
*/
function uploadVideo(config) {
  if (!config || !config.youtube || config.youtube.enabled !== true)
    throw new Error("YouTube upload is disabled until the Google API compliance audit passes; videos upload to Cloudinary instead.");
  throw new Error("YouTube upload not implemented yet — implement videos.insert here once the audit passes.");
}
module.exports = { uploadVideo };
