"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { deliveryUrl, embedUrl } = require("../lib/media-urls.js");

// Image shape is pinned to the convention the site already renders with —
// montessori-vidyanagar.html's gallery mapping. If it changes, change both.
test("deliveryUrl for an image uses f_auto,q_auto,w_1600 under /image/upload", () => {
  assert.equal(
    deliveryUrl("demo-cloud", { id: "msc/photo-1", kind: "image" }),
    "https://res.cloudinary.com/demo-cloud/image/upload/f_auto,q_auto,w_1600/msc/photo-1"
  );
});

test("deliveryUrl for a video is the privacy-enhanced YouTube embed, rel=0", () => {
  assert.equal(
    deliveryUrl("demo-cloud", { id: "dQw4w9WgXcQ", kind: "video" }),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"
  );
});

test("embedUrl derives the same shape from a bare id", () => {
  assert.equal(embedUrl("dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
});

test("posterUrl is gone — YouTube provides its own poster frames", () => {
  assert.equal(require("../lib/media-urls.js").posterUrl, undefined);
});

test("image public_id slashes survive but URL-hostile characters are escaped", () => {
  // encodeURI keeps "/" (public_ids are folder-scoped) but escapes spaces etc.
  assert.match(deliveryUrl("c", { id: "a b/c", kind: "image" }), /\/a%20b\/c$/);
});
