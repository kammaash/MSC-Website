"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { createServer } = require("../server.js");

const SHARED = '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {\n  "cloudName": "demo-cloud"\n};\n/* CONTENT:END */';

const RECORD = {
  id: "msc/photo-abc123",
  kind: "image",
  name: "sports-day.jpg",
  format: "jpg",
  width: 4032,
  height: 3024,
  bytes: 2400000,
  createdAt: "2026-08-14T10:00:00.000Z",
};

async function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "msc-media-api-"));
  fs.writeFileSync(path.join(root, "content.js"), SHARED);
  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const base = "http://127.0.0.1:" + srv.address().port;
  const get = (p, headers = {}) => fetch(base + p, { headers: { "x-editor-token": token, ...headers } });
  const post = (p, body, headers = {}) => fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token, ...headers },
    body: JSON.stringify(body),
  });
  return { root, base, get, post, token };
}

test("GET /api/media on a fresh site returns an empty library and the cloudName", async () => {
  const { get } = await boot();
  const r = await get("/api/media");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { cloudName: "demo-cloud", records: [] });
});

test("GET /api/media requires the editor token", async () => {
  const { base } = await boot();
  const r = await fetch(base + "/api/media"); // no token
  assert.equal(r.status, 403);
});

test("POST /api/media adds a record, persists it to media.json, and the list returns it", async () => {
  const { root, get, post } = await boot();
  const r = await post("/api/media", { record: RECORD });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "media.json"), "utf8")), [RECORD]);
  assert.deepEqual((await (await get("/api/media")).json()).records, [RECORD]);
});

test("POST /api/media rejects an invalid record with a 400 naming the problem — nothing written", async () => {
  const { root, post } = await boot();
  const r = await post("/api/media", { record: { ...RECORD, kind: "raw" } });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /kind/);
  assert.equal(fs.existsSync(path.join(root, "media.json")), false);
});

test("POST /api/media rejects a body without a record object", async () => {
  const { post } = await boot();
  for (const body of [{}, { record: null }, { record: [] }, null]) {
    const r = await post("/api/media", body);
    assert.equal(r.status, 400);
  }
});

test("POST /api/media rejects a duplicate id with a 409", async () => {
  const { post } = await boot();
  assert.equal((await post("/api/media", { record: RECORD })).status, 200);
  const r = await post("/api/media", { record: RECORD });
  assert.equal(r.status, 409);
});

test("POST /api/media/delete removes the record from media.json", async () => {
  const { root, post } = await boot();
  await post("/api/media", { record: RECORD });
  const r = await post("/api/media/delete", { id: RECORD.id });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "media.json"), "utf8")), []);
});

test("POST /api/media/delete answers 404 for an id not in the library", async () => {
  const { post } = await boot();
  await post("/api/media", { record: RECORD });
  const r = await post("/api/media/delete", { id: "msc/never-uploaded" });
  assert.equal(r.status, 404);
});

test("POST /api/media/delete rejects a missing or non-string id with a 400", async () => {
  const { post } = await boot();
  for (const body of [{}, { id: 42 }, { id: "" }]) {
    assert.equal((await post("/api/media/delete", body)).status, 400);
  }
});

test("GET /api/media names the problem when media.json is corrupt instead of a generic error", async () => {
  const { root, get } = await boot();
  fs.writeFileSync(path.join(root, "media.json"), "{ not json");
  const r = await get("/api/media");
  assert.equal(r.status, 400);
  assert.match(await r.text(), /media\.json/);
});

test("publish sweeps media.json into the commit alongside content files", async () => {
  const g = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "msc-media-pub-"));
  g(root, "init", "-b", "main");
  g(root, "config", "user.email", "t@t"); g(root, "config", "user.name", "t");
  fs.writeFileSync(path.join(root, "content.js"), SHARED);
  g(root, "add", "-A"); g(root, "commit", "-m", "init");
  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const base = "http://127.0.0.1:" + srv.address().port;
  const post = (p, body) => fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token },
    body: JSON.stringify(body),
  });
  // The only change on disk is a new media record — publish must see and commit it.
  assert.equal((await post("/api/media", { record: RECORD })).status, 200);
  assert.equal((await post("/api/publish", { message: "content: media" })).status, 200);
  assert.match(g(root, "log", "-1", "--format=%s"), /content: media/);
  assert.match(g(root, "show", "--name-only", "--format=", "HEAD"), /media\.json/);
});
