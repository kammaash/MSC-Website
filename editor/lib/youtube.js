"use strict";
// YouTube helpers for the paste-a-link flow. Videos are uploaded manually in
// YouTube Studio (as Unlisted) and registered here by URL.
//
// Automated API upload stays OFF on purpose: Google locks videos uploaded via
// videos.insert from unaudited API projects to private, with no appeal until a
// compliance audit passes (support.google.com/youtube/answer/7300965) — private
// videos cannot be embedded, so an automated upload would produce broken players.
// Revisit only if the school ever passes that audit.
var ID_RE = /^[A-Za-z0-9_-]{11}$/;

function isVideoId(s) {
  return typeof s === "string" && ID_RE.test(s);
}

// Accepts: watch?v=, youtu.be/, shorts/, embed/, live/, /v/, the nocookie host,
// schemeless copies of any of those, or a bare 11-char ID. Returns the ID or null —
// never a guess: an ID we can't positively extract must not reach the library.
function parseVideoId(input) {
  if (typeof input !== "string") return null;
  var s = input.trim();
  if (isVideoId(s)) return s;
  var url = null;
  try { url = new URL(s); } catch (e) { /* maybe schemeless */ }
  if (url === null) {
    try { url = new URL("https://" + s); } catch (e) { return null; }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  var host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  if (host === "youtu.be") {
    var shortMatch = url.pathname.match(/^\/([^/]+)\/?$/);
    var seg = shortMatch ? shortMatch[1] : "";
    return isVideoId(seg) ? seg : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  var v = url.searchParams.get("v");
  if (v !== null) return url.pathname === "/watch" && isVideoId(v) ? v : null;
  var m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)\/?$/);
  if (m !== null && isVideoId(m[1])) return m[1];
  return null;
}

module.exports = { isVideoId, parseVideoId };
