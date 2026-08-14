"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { signParams } = require("../lib/cloudinary.js");

test("signs sorted params per Cloudinary spec (sha1 of k=v&... + secret)", () => {
  const sig = signParams({ timestamp: 1723600000, folder: "msc" }, "shhh");
  const expected = crypto.createHash("sha1").update("folder=msc&timestamp=1723600000" + "shhh").digest("hex");
  assert.equal(sig, expected);
});
