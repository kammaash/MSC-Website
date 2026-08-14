"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createServer } = require("../server.js");

const g = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

async function boot(config, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-pub-"));
  const bare = path.join(dir, "remote.git");
  const root = path.join(dir, "site");
  execFileSync("git", ["init", "--bare", bare]);
  fs.mkdirSync(root);
  g(root, "init", "-b", "main");
  g(root, "config", "user.email", "t@t"); g(root, "config", "user.name", "t");
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "1"};\n/* CONTENT:END */');
  g(root, "add", "-A"); g(root, "commit", "-m", "init");
  g(root, "remote", "add", "origin", bare);
  g(root, "push", "-u", "origin", "main"); // local bare only — never the real repo
  const srv = createServer({ root, config, templates: {}, secrets: null });
  await new Promise((r) => srv.listen(0, r));
  after(() => srv.close());
  const oldEnv = process.env.EDITOR_NO_PUSH;
  if (env !== undefined) process.env.EDITOR_NO_PUSH = env; else delete process.env.EDITOR_NO_PUSH;
  after(() => { if (oldEnv === undefined) delete process.env.EDITOR_NO_PUSH; else process.env.EDITOR_NO_PUSH = oldEnv; });
  const publish = () => fetch("http://127.0.0.1:" + srv.address().port + "/api/publish", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "content: test" }),
  });
  return { root, bare, publish };
}

test("publish commits and pushes when enabled", async () => {
  const { root, bare, publish } = await boot({ push: true });
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "2"};\n/* CONTENT:END */');
  assert.equal((await publish()).status, 200);
  assert.match(g(root, "log", "-1", "--format=%s"), /content: test/);
  assert.match(g(bare, "log", "-1", "--format=%s"), /content: test/); // reached the (local bare) remote
});

test("EDITOR_NO_PUSH=1 commits but does not push", async () => {
  const { root, bare, publish } = await boot({ push: true }, "1");
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "3"};\n/* CONTENT:END */');
  assert.equal((await publish()).status, 200);
  assert.match(g(root, "log", "-1", "--format=%s"), /content: test/);
  assert.match(g(bare, "log", "-1", "--format=%s"), /init/); // remote untouched
});

test("no changes → 409", async () => {
  const { publish } = await boot({ push: false });
  assert.equal((await publish()).status, 409);
});
