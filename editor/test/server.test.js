"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server.js");

function tmpSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-ed-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body><h1>Hi</h1></body></html>");
  fs.writeFileSync(path.join(dir, "plain.js"), "var x = 1;");
  return dir;
}

async function boot(opts = {}) {
  const root = tmpSite();
  const srv = createServer({ root, config: { push: false }, templates: {}, secrets: null, ...opts });
  await new Promise((r) => srv.listen(0, r));
  const base = "http://127.0.0.1:" + srv.address().port;
  return { root, srv, base };
}

test("serves html with editor scripts injected before </body>", async () => {
  const { srv, base } = await boot();
  after(() => srv.close());
  const text = await (await fetch(base + "/")).text();
  assert.match(text, /editor-client\.js"><\/script><\/body>/);
  assert.match(text, /<h1>Hi<\/h1>/);
});

test("serves non-html files byte-identical", async () => {
  const { srv, base } = await boot();
  after(() => srv.close());
  assert.equal(await (await fetch(base + "/plain.js")).text(), "var x = 1;");
});

test("404 on unknown path, 403 on traversal", async () => {
  const { srv, base } = await boot();
  after(() => srv.close());
  assert.equal((await fetch(base + "/nope.html")).status, 404);
  assert.equal((await fetch(base + "/..%2f..%2fetc%2fpasswd")).status, 403);
});
