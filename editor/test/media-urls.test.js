"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { deliveryUrl, posterUrl } = require("../lib/media-urls.js");

// The URL shapes are pinned to the convention the site already renders with —
// montessori-vidyanagar.html's gallery mapping (~line 815-824). If these change,
// change them there too.
test("deliveryUrl for an image uses f_auto,q_auto,w_1600 under /image/upload", () => {
  assert.equal(
    deliveryUrl("demo-cloud", { id: "msc/photo-1", kind: "image" }),
    "https://res.cloudinary.com/demo-cloud/image/upload/f_auto,q_auto,w_1600/msc/photo-1"
  );
});

test("deliveryUrl for a video uses q_auto under /video/upload with an .mp4 extension", () => {
  assert.equal(
    deliveryUrl("demo-cloud", { id: "msc/clip-1", kind: "video" }),
    "https://res.cloudinary.com/demo-cloud/video/upload/q_auto/msc/clip-1.mp4"
  );
});

test("posterUrl derives the first-frame jpg exactly like the vidyanagar gallery does", () => {
  assert.equal(
    posterUrl("demo-cloud", { id: "msc/clip-1", kind: "video" }),
    "https://res.cloudinary.com/demo-cloud/video/upload/so_0,f_jpg,q_auto,w_800/msc/clip-1.jpg"
  );
});

test("public_id slashes survive but URL-hostile characters are escaped", () => {
  // encodeURI keeps "/" (public_ids are folder-scoped) but escapes spaces etc.
  assert.match(deliveryUrl("c", { id: "a b/c", kind: "image" }), /\/a%20b\/c$/);
});
