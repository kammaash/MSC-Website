"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
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
  const token = crypto.randomUUID();
  const srv = createServer({ root, config, templates: {}, secrets: null, token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const oldEnv = process.env.EDITOR_NO_PUSH;
  if (env !== undefined) process.env.EDITOR_NO_PUSH = env; else delete process.env.EDITOR_NO_PUSH;
  after(() => { if (oldEnv === undefined) delete process.env.EDITOR_NO_PUSH; else process.env.EDITOR_NO_PUSH = oldEnv; });
  const publish = () => fetch("http://127.0.0.1:" + srv.address().port + "/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json", "x-editor-token": token },
    body: JSON.stringify({ message: "content: test" }),
  });
  return { root, bare, publish, token, port: () => srv.address().port };
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

// Vacuity fix: the `config.push === true` gate itself was never proven — every existing
// test either had push:true or had no real change. Prove that with push:false AND a real
// staged change, the local commit still happens but the bare remote is never touched.
test("push:false commits locally but never pushes, even with a real change", async () => {
  const { root, bare, publish } = await boot({ push: false });
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "4"};\n/* CONTENT:END */');
  assert.equal((await publish()).status, 200);
  assert.match(g(root, "log", "-1", "--format=%s"), /content: test/);
  assert.match(g(bare, "log", "-1", "--format=%s"), /init/); // bare remote never touched
});

// Important 5: a genuine `git commit` failure (not "nothing staged") must not be reported
// as the misleading "Nothing to publish (no changes)." — the collaborator's edits are
// sitting staged, not absent. Force a deterministic non-empty-diff commit failure with a
// pre-commit hook (independent of this machine's global git identity config) and assert
// the real git stderr comes back in a 500, not the 409 "no changes" message.
test("a real commit failure (not 'nothing staged') is reported as 500 with git's stderr, not 409", async () => {
  const { root, bare, publish } = await boot({ push: false });
  const hookPath = path.join(root, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hookPath, "#!/bin/sh\necho 'blocked by test pre-commit hook' >&2\nexit 1\n");
  fs.chmodSync(hookPath, 0o755);
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "5"};\n/* CONTENT:END */');

  const r = await publish();
  assert.equal(r.status, 500);
  const text = await r.text();
  assert.match(text, /blocked by test pre-commit hook/);
  assert.doesNotMatch(text, /Nothing to publish/);
  assert.match(g(root, "log", "-1", "--format=%s"), /init/); // no commit was created
  assert.match(g(bare, "log", "-1", "--format=%s"), /init/); // remote untouched
  // Fix round 5, Fix C: the useful part of git's own message must still reach the client
  // (round 1's finding 5), but the absolute local checkout path it's phrased in terms of
  // ("hook failed in <root>") must not. This is a THROWAWAY tmp fixture root (from boot()
  // above), never the real repo — asserting its absence here proves the redaction, not that
  // any path was safe to leak in the first place.
  assert.ok(!text.includes(root), `response must not contain the absolute fixture repo path, got: ${text}`);
});

// Fix round 5, Fix C: `git add` (server.js, just before the commit step) used to be unwrapped,
// falling through to the outer catch — which only genericises errors carrying `.code` (fs/OS
// errors), never execFileSync's own non-zero-exit errors (which carry `.status`, not `.code`).
// A stale `.git/index.lock` — the realistic case: a prior editor process (or `git` itself)
// crashed mid-write and never cleaned up its lock — makes `git add` fail with a message that
// embeds the absolute checkout path: "fatal: Unable to create '<root>/.git/index.lock': File
// exists." Prove that failure now redacts the path while still surfacing git's real reason.
test("a stale .git/index.lock on `git add` is reported as 500 with git's message but no absolute path", async () => {
  const { root, bare, publish } = await boot({ push: false });
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "7"};\n/* CONTENT:END */');
  const lockPath = path.join(root, ".git", "index.lock");
  fs.writeFileSync(lockPath, ""); // simulates the lock a crashed git/editor process left behind

  try {
    const r = await publish();
    assert.equal(r.status, 500);
    const text = await r.text();
    // The real reason (git's own words) must still reach the collaborator...
    assert.match(text, /index\.lock/);
    assert.match(text, /File exists/);
    // ...but not the absolute local path it's phrased in terms of.
    assert.ok(!text.includes(root), `response must not contain the absolute fixture repo path, got: ${text}`);
    assert.match(g(root, "log", "-1", "--format=%s"), /init/); // no commit was created
    assert.match(g(bare, "log", "-1", "--format=%s"), /init/); // remote untouched
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
});

// Fold-in B: `readJson(req).catch(() => ({}))` used to swallow EVERY body error, including
// "body present but rejected" (oversized), and silently proceed with the default message.
// An oversized body must 400 and create no commit, distinct from the genuinely-empty-body
// case (which is fine and uses the default message — covered implicitly by every other test
// here sending a real small JSON body).
test("an oversized publish body is rejected — no commit created", async () => {
  const { root, bare, token, port } = await boot({ push: false });
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "6"};\n/* CONTENT:END */');
  const hugeMessage = "x".repeat(6 * 1024 * 1024); // over the 5MB readJson cap
  let status;
  try {
    const r = await fetch("http://127.0.0.1:" + port() + "/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json", "x-editor-token": token },
      body: JSON.stringify({ message: hugeMessage }),
    });
    status = r.status;
  } catch {
    // readJson intentionally req.destroy()s once the 5MB guard trips, to stop a malicious
    // client from continuing to stream. A client still mid-upload when that happens can
    // observe a connection reset instead of a clean HTTP response — both are acceptable
    // outcomes; what actually matters is that the oversized body never reaches a commit.
    status = "connection-reset";
  }
  assert.ok(status === 400 || status === "connection-reset", `unexpected status ${status}`);
  assert.match(g(root, "log", "-1", "--format=%s"), /init/); // no commit was created
  assert.match(g(bare, "log", "-1", "--format=%s"), /init/); // remote untouched
});
