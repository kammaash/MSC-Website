"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { createServer, readJson } = require("../server.js");

function tmpSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-sec-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body><h1>Hi</h1></body></html>");
  return dir;
}

async function boot(opts = {}) {
  const root = tmpSite();
  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, token, ...opts });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const base = "http://127.0.0.1:" + srv.address().port;
  return { root, srv, base, token };
}

// ---- Critical 2: editor/secrets.json and dotfiles must never be servable ----

test("GET /editor/secrets.json is 403, whether or not the file exists", async () => {
  const { base } = await boot();
  const r = await fetch(base + "/editor/secrets.json");
  assert.equal(r.status, 403);
});

test("GET /editor/config.json and /editor/collections.json are 403 (only lib/*.js and client/*.js are allowlisted)", async () => {
  const { base } = await boot();
  assert.equal((await fetch(base + "/editor/config.json")).status, 403);
  assert.equal((await fetch(base + "/editor/collections.json")).status, 403);
});

test("GET /.git/config is 403 (dot-segment block)", async () => {
  const { base } = await boot();
  assert.equal((await fetch(base + "/.git/config")).status, 403);
  assert.equal((await fetch(base + "/.git/HEAD")).status, 403);
});

test("GET /editor/lib/paths.js (allowlisted) still works", async () => {
  const { base } = await boot();
  const r = await fetch(base + "/editor/lib/paths.js");
  assert.equal(r.status, 200);
});

// ---- Critical 1: token / content-type / origin guard on every /api/* route ----

test("api guard rejects missing token on /api/publish — 403", async () => {
  const { base } = await boot();
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "x" }),
  });
  assert.equal(r.status, 403);
});

test("api guard rejects wrong token on /api/publish — 403", async () => {
  const { base } = await boot();
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": "wrong" },
    body: JSON.stringify({ message: "x" }),
  });
  assert.equal(r.status, 403);
});

test("api guard rejects non-JSON content-type even with a valid token — 415 (CORS simple-request bypass)", async () => {
  const { base, token } = await boot();
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "text/plain", "x-editor-token": token },
    body: JSON.stringify({ message: "x" }),
  });
  assert.equal(r.status, 415);
});

test("api guard rejects a foreign Origin even with a valid token — 403", async () => {
  const { base, token } = await boot();
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token, origin: "http://evil.example" },
    body: JSON.stringify({ message: "x" }),
  });
  assert.equal(r.status, 403);
});

test("api guard accepts a matching localhost/127.0.0.1 Origin", async () => {
  const { base, token, srv } = await boot();
  const port = srv.address().port;
  const r = await fetch(base + "/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token, origin: "http://127.0.0.1:" + port },
    body: JSON.stringify({ message: "x" }),
  });
  // Origin/token/content-type all pass; falls through to the real publish handler (this
  // fixture has no git repo, so it 400s inside the handler — the point is it is NOT 403/415).
  assert.notEqual(r.status, 403);
  assert.notEqual(r.status, 415);
});

// ---- Critical 3: /api/sign is not an open signing oracle ----

async function bootSign() {
  const root = tmpSite();
  fs.writeFileSync(path.join(root, "content.js"),
    '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"cloudName": "demo"};\n/* CONTENT:END */');
  const token = crypto.randomUUID();
  const secrets = { cloudinaryApiKey: "key123", cloudinaryApiSecret: "secret123" };
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const base = "http://127.0.0.1:" + srv.address().port;
  const sign = (paramsToSign) => fetch(base + "/api/sign", {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token },
    body: JSON.stringify({ paramsToSign }),
  });
  return { sign };
}

test("sign rejects a disallowed parameter (e.g. public_ids, a destroy/rename shaped payload)", async () => {
  const { sign } = await bootSign();
  const r = await sign({ timestamp: Math.floor(Date.now() / 1000), public_ids: ["a", "b"] });
  assert.equal(r.status, 400);
});

test("sign rejects a stale timestamp", async () => {
  const { sign } = await bootSign();
  const staleTs = Math.floor(Date.now() / 1000) - 1000; // > 120s skew
  const r = await sign({ timestamp: staleTs, folder: "news" });
  assert.equal(r.status, 400);
});

test("sign accepts an allowlisted, fresh request", async () => {
  const { sign } = await bootSign();
  const r = await sign({ timestamp: Math.floor(Date.now() / 1000), folder: "news" });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.apiKey, "key123");
  assert.equal(typeof body.signature, "string");
});

// ---- Important 4: CONTENT marker injection guard (patch.js) ----

test("a set value containing CONTENT:BEGIN is rejected too (not just CONTENT:END)", async () => {
  const { applyPatch } = require("../lib/patch.js");
  assert.throws(
    () => applyPatch({ hero: { title: "x" } }, { ops: [{ type: "set", path: "hero.title", value: "/* CONTENT:BEGIN */" }] }, {}),
    /CONTENT:BEGIN|CONTENT:END/,
  );
});

// ---- Important 6: readJson must not corrupt multi-byte UTF-8 split across chunks ----

test("readJson reassembles a multi-byte UTF-8 character split across a chunk boundary", async () => {
  const payload = JSON.stringify({ value: "A—B·C" }); // em dash (3 bytes) + middle dot (2 bytes)
  const buf = Buffer.from(payload, "utf8");
  const emDashStart = buf.indexOf(0xe2); // first byte of the UTF-8 em-dash sequence
  assert.ok(emDashStart > 0, "fixture must contain the em dash byte sequence");
  // Split INSIDE the multi-byte sequence: chunk1 ends one byte into the character.
  const chunk1 = buf.subarray(0, emDashStart + 1);
  const chunk2 = buf.subarray(emDashStart + 1);

  const fakeReq = new EventEmitter();
  const pending = readJson(fakeReq);
  fakeReq.emit("data", chunk1);
  fakeReq.emit("data", chunk2);
  fakeReq.emit("end");

  const result = await pending;
  assert.equal(result.value, "A—B·C");
});

test("readJson destroys the request and rejects once the 5MB guard is exceeded", async () => {
  const fakeReq = new EventEmitter();
  let destroyed = false;
  fakeReq.destroy = () => { destroyed = true; };
  const pending = readJson(fakeReq);
  fakeReq.emit("data", Buffer.alloc(6e6)); // over the 5MB cap
  await assert.rejects(pending);
  assert.equal(destroyed, true);
});
