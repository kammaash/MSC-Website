"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseVideoId, isVideoId } = require("../lib/youtube.js");

// Every URL shape an editor plausibly pastes. The 11-char ID grammar is YouTube's
// own (base64url alphabet); anything else must come back null, never a guess.
test("parseVideoId accepts every common YouTube URL form", () => {
  const ID = "dQw4w9WgXcQ";
  for (const input of [
    "https://www.youtube.com/watch?v=" + ID,
    "https://youtube.com/watch?v=" + ID + "&t=42s",
    "http://m.youtube.com/watch?v=" + ID,
    "https://youtu.be/" + ID,
    "https://youtu.be/" + ID + "?si=share-junk",
    "https://www.youtube.com/shorts/" + ID,
    "https://www.youtube.com/embed/" + ID,
    "https://www.youtube.com/live/" + ID,
    "https://www.youtube-nocookie.com/embed/" + ID + "?rel=0",
    "youtube.com/watch?v=" + ID,   // schemeless — people paste from the address bar
    "youtu.be/" + ID,
    ID,                             // a bare ID is fine too
    "  https://youtu.be/" + ID + "  ", // stray whitespace
  ]) {
    assert.equal(parseVideoId(input), ID, "failed on: " + input);
  }
});

test("parseVideoId rejects everything that is not a YouTube video link", () => {
  for (const input of [
    "https://vimeo.com/12345678",
    "https://example.com/watch?v=dQw4w9WgXcQ", // right shape, wrong site
    "https://www.youtube.com/@somechannel",
    "https://www.youtube.com/playlist?list=PL123",
    "not a url at all",
    "https://youtu.be/tooshort",
    "javascript:alert(1)",
    "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
    "",
    null,
    42,
  ]) {
    assert.equal(parseVideoId(input), null, "should reject: " + input);
  }
});

test("isVideoId is the strict 11-char grammar", () => {
  assert.equal(isVideoId("dQw4w9WgXcQ"), true);
  assert.equal(isVideoId("a_b-C0d1E2f"), true);
  assert.equal(isVideoId("dQw4w9WgXc"), false);   // 10 chars
  assert.equal(isVideoId("dQw4w9WgXcQQ"), false); // 12 chars
  assert.equal(isVideoId("dQw4w9WgXc!"), false);  // bad char
  assert.equal(isVideoId(""), false);
  assert.equal(isVideoId(null), false);
});
