"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createServer } = require("../server.js");

const PAGE = `<html><body><x-dc></x-dc><script type="text/x-dc" data-dc-script>
/* CONTENT:BEGIN */
const CONTENT = {
  "hero": { "title": "Old" }
};
/* CONTENT:END */
class Component {}
</script></body></html>`;

const SHARED = `/* CONTENT:BEGIN */
window.SHARED_CONTENT = {
  "news": { "acamp": [] }
};
/* CONTENT:END */`;

async function boot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "msc-save-"));
  fs.writeFileSync(path.join(root, "index.html"), PAGE);
  fs.writeFileSync(path.join(root, "content.js"), SHARED);
  const templates = { "news.acamp": { date: "", title: "", body: "" } };
  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const post = (p, body, headers = {}) => fetch("http://127.0.0.1:" + srv.address().port + p, {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token, ...headers },
    body: JSON.stringify(body),
  });
  return { root, post, token, port: () => srv.address().port };
}

test("save rewrites a page CONTENT block", async () => {
  const { root, post } = await boot();
  const r = await post("/api/save", { file: "index.html", patch: { ops: [{ type: "set", path: "hero.title", value: "New" }] } });
  assert.equal(r.status, 200);
  const out = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(out, /"title": "New"/);
  assert.match(out, /class Component/); // logic untouched
});

test("save applies ordered ops to content.js collections", async () => {
  const { root, post } = await boot();
  const ops = [
    { type: "add", path: "news.acamp", item: { date: "d", title: "t", body: "b" } },
    { type: "set", path: "news.acamp.0.title", value: "Sports Day" },
  ];
  const r = await post("/api/save", { file: "content.js", patch: { ops } });
  assert.equal(r.status, 200);
  assert.match(fs.readFileSync(path.join(root, "content.js"), "utf8"), /Sports Day/);
});

test("rejects unknown file, bad path, bad item — file untouched", async () => {
  const { root, post } = await boot();
  const before = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.equal((await post("/api/save", { file: "support.js", patch: { ops: [] } })).status, 400);
  assert.equal((await post("/api/save", { file: "index.html", patch: { ops: [{ type: "set", path: "hero.nope", value: "x" }] } })).status, 400);
  assert.equal((await post("/api/save", { file: "index.html", patch: { ops: [{ type: "set", path: "hero.title", value: "</script>" }] } })).status, 400);
  assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), before);
});

// Vacuity fix: the CONTENT_FILES allowlist on /api/save had no test at all. A plain
// "file doesn't happen to exist outside root" assertion would pass even with the check
// deleted (ENOENT also 400s) — that was exactly the reviewer's point. To actually prove
// the guard is load-bearing, put a REAL, parseable CONTENT file at the traversal target
// ("../content.js" from the site root) and confirm /api/save refuses to touch it.
test("save rejects a file path that escapes the site root — real file one level up is untouched", async () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "msc-save-esc-"));
  const root = path.join(outer, "site");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "index.html"), PAGE);
  fs.writeFileSync(path.join(root, "content.js"), SHARED);
  const decoyPath = path.join(outer, "content.js"); // exactly what "../content.js" resolves to
  fs.writeFileSync(decoyPath, SHARED);

  const templates = { "news.acamp": { date: "", title: "", body: "" } };
  const token = crypto.randomUUID();
  const srv = createServer({ root, config: { push: false }, templates, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const before = fs.readFileSync(decoyPath, "utf8");

  const r = await fetch("http://127.0.0.1:" + srv.address().port + "/api/save", {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token },
    body: JSON.stringify({
      file: "../content.js",
      patch: { ops: [{ type: "add", path: "news.acamp", item: { date: "d", title: "t", body: "b" } }] },
    }),
  });
  assert.equal(r.status, 400);
  assert.equal(fs.readFileSync(decoyPath, "utf8"), before);
});

// Same allowlist, checked for a couple of other traversal/absolute shapes. (These do not
// happen to have a real file to corrupt in this fixture, so they are supplementary to —
// not a replacement for — the decoy-file test above.)
test("save rejects other escaping/absolute file paths — site files untouched", async () => {
  const { root, post } = await boot();
  const beforeIndex = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const bad = ["../../etc/passwd", "/etc/passwd"];
  for (const file of bad) {
    const r = await post("/api/save", { file, patch: { ops: [{ type: "set", path: "hero.title", value: "pwned" }] } });
    assert.equal(r.status, 400, `expected 400 for file=${file}`);
  }
  assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), beforeIndex);
});

// Important 4: a `set` value containing a CONTENT marker would corrupt the CONTENT block
// beyond repair (every future parse throws "Duplicate CONTENT:END marker"). Must be
// rejected before the file is ever rewritten.
test("save rejects a value containing CONTENT:BEGIN/END markers — file untouched", async () => {
  const { root, post } = await boot();
  const before = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const r = await post("/api/save", {
    file: "index.html",
    patch: { ops: [{ type: "set", path: "hero.title", value: "oops /* CONTENT:END */ more" }] },
  });
  assert.equal(r.status, 400);
  assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), before);
});

test("save rejects requests missing the editor token — file untouched", async () => {
  const { root, port } = await boot();
  const before = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const r = await fetch("http://127.0.0.1:" + port() + "/api/save", {
    method: "POST",
    headers: { "content-type": "application/json" }, // no x-editor-token at all
    body: JSON.stringify({ file: "index.html", patch: { ops: [{ type: "set", path: "hero.title", value: "x" }] } }),
  });
  assert.equal(r.status, 403);
  assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), before);
});

test("save rejects requests with the wrong editor token — file untouched", async () => {
  const { root, post } = await boot();
  const before = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const r = await post("/api/save", { file: "index.html", patch: { ops: [{ type: "set", path: "hero.title", value: "x" }] } }, { "x-editor-token": "not-the-real-token" });
  assert.equal(r.status, 403);
  assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), before);
});

test("save rejects a text/plain content-type even with a valid token — file untouched (CORS simple-request bypass)", async () => {
  const { root, port, token } = await boot();
  const before = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const r = await fetch("http://127.0.0.1:" + port() + "/api/save", {
    method: "POST",
    headers: { "content-type": "text/plain", "x-editor-token": token },
    body: JSON.stringify({ file: "index.html", patch: { ops: [{ type: "set", path: "hero.title", value: "x" }] } }),
  });
  assert.equal(r.status, 415);
  assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), before);
});

test("save rejects a foreign Origin even with a valid token — file untouched", async () => {
  const { root, post } = await boot();
  const before = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const r = await post(
    "/api/save",
    { file: "index.html", patch: { ops: [{ type: "set", path: "hero.title", value: "x" }] } },
    { origin: "http://evil.example" },
  );
  assert.equal(r.status, 403);
  assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), before);
});
