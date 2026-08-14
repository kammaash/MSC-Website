"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { uploadVideo } = require("../lib/youtube.js");

test("throws while disabled, mentioning the audit", () => {
  assert.throws(() => uploadVideo({}), /audit/i);
  assert.throws(() => uploadVideo({ youtube: { enabled: false } }), /audit/i);
});

test("enabled flag reaches the not-implemented path", () => {
  assert.throws(() => uploadVideo({ youtube: { enabled: true } }), /not implemented/i);
});
