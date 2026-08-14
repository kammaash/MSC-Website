"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
  const srv = createServer({ root, config: { push: false }, templates, secrets: null });
  await new Promise((r) => srv.listen(0, r));
  after(() => srv.close());
  const post = (p, body) => fetch("http://127.0.0.1:" + srv.address().port + p, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { root, post };
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
