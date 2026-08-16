"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createServer } = require("../server.js");

function verifiedMeta(title) {
  return { title, provider_name: "YouTube", type: "video" };
}

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
  return { post, base, root };
}

test("adds a watch URL atomically: verifies it and persists the server-built record", async () => {
  const seen = [];
  const { post, root } = await boot(async (url) => {
    seen.push(url);
    return { ok: true, status: 200, json: async () => verifiedMeta("Sports Day 2026") };
  });
  const r = await post("/api/youtube/add", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.record.id, "dQw4w9WgXcQ");
  assert.equal(data.record.kind, "video");
  assert.equal(data.record.name, "Sports Day 2026");
  assert.match(data.record.createdAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "media.json"), "utf8")), [data.record]);
  // The outbound URL is built from the validated ID, never from raw user input.
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^https:\/\/www\.youtube\.com\/oembed\?url=/);
  assert.match(seen[0], /watch%3Fv%3DdQw4w9WgXcQ/);
});

test("oEmbed 4xx (private / deleted / embedding off) is a 422 that tells the editor the fix", async () => {
  const { post } = await boot(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  const r = await post("/api/youtube/add", { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(r.status, 422);
  assert.match(await r.text(), /Unlisted/);
});

test("network failure fails closed with 503 and writes no media record", async () => {
  const { post, root } = await boot(async () => { throw new Error("getaddrinfo ENOTFOUND"); });
  const r = await post("/api/youtube/add", { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(r.status, 503);
  assert.match(await r.text(), /nothing was added/i);
  assert.equal(fs.existsSync(path.join(root, "media.json")), false);
});

test("a non-YouTube URL is a 422 and oEmbed is never called", async () => {
  let called = 0;
  const { post } = await boot(async () => { called++; return { ok: true, status: 200, json: async () => verifiedMeta("Unused") }; });
  const r = await post("/api/youtube/add", { url: "https://vimeo.com/12345" });
  assert.equal(r.status, 422);
  assert.match(await r.text(), /YouTube link/);
  assert.equal(called, 0);
});

test("malformed bodies are a 400; a missing token is the uniform 403", async () => {
  const { post, base } = await boot(async () => ({ ok: true, status: 200, json: async () => verifiedMeta("Unused") }));
  assert.equal((await post("/api/youtube/add", { nope: 1 })).status, 400);
  assert.equal((await post("/api/youtube/add", null)).status, 400);
  assert.equal((await post("/api/youtube/add", { url: "x".repeat(2049) })).status, 400);
  const noToken = await fetch(base + "/api/youtube/add", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://youtu.be/dQw4w9WgXcQ" }),
  });
  assert.equal(noToken.status, 403);
});

test("an oEmbed 200 with an unparseable body fails closed", async () => {
  const { post, root } = await boot(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }));
  const r = await post("/api/youtube/add", { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(r.status, 502);
  assert.match(await r.text(), /nothing was added/i);
  assert.equal(fs.existsSync(path.join(root, "media.json")), false);
});

test("an oEmbed-shaped response must identify itself as a YouTube video", async () => {
  for (const meta of [
    { title: "Looks plausible", provider_name: "Not YouTube", type: "video" },
    { title: "Looks plausible", provider_name: "YouTube", type: "photo" },
    { title: "   ", provider_name: "YouTube", type: "video" },
  ]) {
    const { post, root } = await boot(async () => ({ ok: true, status: 200, json: async () => meta }));
    const r = await post("/api/youtube/add", { url: "dQw4w9WgXcQ" });
    assert.equal(r.status, 502);
    assert.equal(fs.existsSync(path.join(root, "media.json")), false);
  }
});

test("a duplicate video is a 409 and the library still contains one record", async () => {
  const { post, root } = await boot(async () => ({ ok: true, status: 200, json: async () => verifiedMeta("Assembly") }));
  assert.equal((await post("/api/youtube/add", { url: "dQw4w9WgXcQ" })).status, 200);
  const duplicate = await post("/api/youtube/add", { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(duplicate.status, 409);
  assert.match(await duplicate.text(), /already in/i);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "media.json"), "utf8")).length, 1);
});
