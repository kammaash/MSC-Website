"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createServer } = require("../server.js");

// Same boot pattern as media-api.test.js, plus an injectable oembedFetch so no test
// ever touches the network. The stub mimics the two fetch outcomes the endpoint
// distinguishes: an HTTP answer (ok or not), and a thrown network error.
async function boot(oembedFetch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "msc-yt-api-"));
  fs.writeFileSync(path.join(root, "content.js"),
    '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {\n  "cloudName": "demo-cloud"\n};\n/* CONTENT:END */');
  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, token, oembedFetch });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const base = "http://127.0.0.1:" + srv.address().port;
  const post = (p, body, headers = {}) => fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token, ...headers },
    body: JSON.stringify(body),
  });
  return { post, base };
}

test("resolves a watch URL: parses the id, confirms via oEmbed, returns the title", async () => {
  const seen = [];
  const { post } = await boot(async (url) => {
    seen.push(url);
    return { ok: true, status: 200, json: async () => ({ title: "Sports Day 2026" }) };
  });
  const r = await post("/api/youtube/resolve", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: "dQw4w9WgXcQ", title: "Sports Day 2026", unverified: false });
  // The outbound URL is built from the validated ID, never from raw user input.
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^https:\/\/www\.youtube\.com\/oembed\?url=/);
  assert.match(seen[0], /watch%3Fv%3DdQw4w9WgXcQ/);
});

test("oEmbed 4xx (private / deleted / embedding off) is a 422 that tells the editor the fix", async () => {
  const { post } = await boot(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  const r = await post("/api/youtube/resolve", { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(r.status, 422);
  assert.match(await r.text(), /Unlisted/);
});

test("network failure is NOT an error: the id still resolves, title comes back null", async () => {
  const { post } = await boot(async () => { throw new Error("getaddrinfo ENOTFOUND"); });
  const r = await post("/api/youtube/resolve", { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: "dQw4w9WgXcQ", title: null, unverified: true });
});

test("a non-YouTube URL is a 422 and oEmbed is never called", async () => {
  let called = 0;
  const { post } = await boot(async () => { called++; return { ok: true, status: 200, json: async () => ({}) }; });
  const r = await post("/api/youtube/resolve", { url: "https://vimeo.com/12345" });
  assert.equal(r.status, 422);
  assert.match(await r.text(), /YouTube link/);
  assert.equal(called, 0);
});

test("malformed bodies are a 400; a missing token is the uniform 403", async () => {
  const { post, base } = await boot(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  assert.equal((await post("/api/youtube/resolve", { nope: 1 })).status, 400);
  assert.equal((await post("/api/youtube/resolve", null)).status, 400);
  const noToken = await fetch(base + "/api/youtube/resolve", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://youtu.be/dQw4w9WgXcQ" }),
  });
  assert.equal(noToken.status, 403);
});

test("an oEmbed 200 with an unparseable body still resolves, marked unverified", async () => {
  const { post } = await boot(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }));
  const r = await post("/api/youtube/resolve", { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: "dQw4w9WgXcQ", title: null, unverified: true });
});
