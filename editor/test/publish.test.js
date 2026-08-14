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

// ---------------------------------------------------------------------------
// Pre-merge fix round, must-fix 1: `git add -- <content files>` used to be followed by a
// BARE `git commit -m msg` (commits the WHOLE index) probed by a whole-index
// `git diff --cached --quiet`. A single unrelated file staged by anything else sharing
// this checkout — another tool, a half-finished `git add`, a fresh-Mac git-identity-unset
// failure mode leaving content files staged from a prior attempt — was, by itself, enough
// to satisfy that probe and make Publish create a commit with ZERO content changes and
// that unrelated file in it, while still reporting "Published ✓". The fix pathspec-limits
// BOTH the probe (`git diff --quiet HEAD -- <existing>`) and the commit
// (`git commit -- <existing>`) to the exact same files `git add` just staged, so they can
// never disagree. These four tests are the reviewer's own validated table, reproduced.
// ---------------------------------------------------------------------------

test("must-fix 1, row 1: unrelated file staged, no content change → 409 'Nothing to publish', nothing committed", async () => {
  const { root, bare, publish } = await boot({ push: false });
  fs.writeFileSync(path.join(root, "EVIL_UNRELATED.txt"), "not content — staged by something else sharing this checkout");
  g(root, "add", "EVIL_UNRELATED.txt");
  // Sanity: something IS staged (the old whole-index probe would have treated this as
  // "changes to publish" and committed it).
  assert.notEqual(g(root, "status", "--porcelain").trim(), "");

  const r = await publish();
  assert.equal(r.status, 409);
  assert.equal(await r.text(), "Nothing to publish (no changes).");
  assert.match(g(root, "log", "-1", "--format=%s"), /init/); // no commit was created
  assert.match(g(bare, "log", "-1", "--format=%s"), /init/); // remote untouched
  // The unrelated file is still staged, exactly where it started — publish must not have
  // touched it at all, not stage it further and not unstage it either.
  assert.equal(g(root, "diff", "--cached", "--name-only").trim(), "EVIL_UNRELATED.txt");
});

test("must-fix 1, row 2: content change + unrelated staged file → commits content only; the unrelated file stays staged, out of HEAD", async () => {
  const { root, bare, publish } = await boot({ push: false });
  fs.writeFileSync(path.join(root, "EVIL_UNRELATED.txt"), "not content — staged by something else sharing this checkout");
  g(root, "add", "EVIL_UNRELATED.txt");
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "row2"};\n/* CONTENT:END */');

  const r = await publish();
  assert.equal(r.status, 200);
  assert.match(g(root, "log", "-1", "--format=%s"), /content: test/); // real commit happened
  assert.match(g(bare, "log", "-1", "--format=%s"), /init/); // push:false — bare untouched either way

  // The unrelated file must be OUT of the commit that was just made...
  const committedFiles = g(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n").filter(Boolean);
  assert.deepEqual(committedFiles, ["content.js"], "only content.js may be in the new commit");
  // ...but still staged afterward — Publish must neither commit it nor unstage it.
  assert.equal(g(root, "diff", "--cached", "--name-only").trim(), "EVIL_UNRELATED.txt");
  assert.ok(!fs.existsSync(path.join(bare, "EVIL_UNRELATED.txt")));
});

test("must-fix 1, row 3: content file staged then reverted in the worktree → probe and commit agree, nothing committed", async () => {
  const { root, bare, publish } = await boot({ push: false });
  const original = fs.readFileSync(path.join(root, "content.js"), "utf8");
  // Stage a real change...
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "row3-staged"};\n/* CONTENT:END */');
  g(root, "add", "content.js");
  // ...then revert the worktree back to what HEAD already has, WITHOUT unstaging. The
  // handler's own `git add -- <existing>` (the first thing it does) re-captures this
  // reverted content into the index before the probe ever runs, so by the time the probe
  // runs the index (like the worktree) once again matches HEAD exactly.
  fs.writeFileSync(path.join(root, "content.js"), original);

  const r = await publish();
  assert.equal(r.status, 409);
  assert.equal(await r.text(), "Nothing to publish (no changes).");
  assert.match(g(root, "log", "-1", "--format=%s"), /init/); // no commit was created
  assert.match(g(bare, "log", "-1", "--format=%s"), /init/); // remote untouched
});

test("must-fix 1, row 4: a partially-staged unrelated file (git add -p) is excluded entirely — even the staged hunk stays out of HEAD", async () => {
  const { root, bare, publish } = await boot({ push: false });
  // A file already tracked (so a partial `git add -p`-style stage — captured here by
  // writing, staging, then writing again — makes sense: index != worktree != HEAD, all
  // three different).
  fs.writeFileSync(path.join(root, "README_UNRELATED.txt"), "line one\n");
  g(root, "add", "README_UNRELATED.txt");
  g(root, "commit", "-m", "add unrelated file");
  fs.writeFileSync(path.join(root, "README_UNRELATED.txt"), "line one\nline two (staged)\n");
  g(root, "add", "README_UNRELATED.txt"); // stage "line two"
  fs.writeFileSync(path.join(root, "README_UNRELATED.txt"), "line one\nline two (staged)\nline three (unstaged)\n");
  fs.writeFileSync(path.join(root, "content.js"), '/* CONTENT:BEGIN */\nwindow.SHARED_CONTENT = {"a": "row4"};\n/* CONTENT:END */');

  const r = await publish();
  assert.equal(r.status, 200);
  assert.match(g(root, "log", "-1", "--format=%s"), /content: test/);

  const committedFiles = g(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n").filter(Boolean);
  assert.deepEqual(committedFiles, ["content.js"], "the partially-staged unrelated file must not appear in the commit at all");
  // Both the staged hunk and the unstaged edit must still be sitting exactly where they
  // were — untouched by publish, not folded into HEAD, not unstaged, not discarded.
  assert.match(g(root, "diff", "--cached", "README_UNRELATED.txt"), /line two \(staged\)/);
  assert.match(g(root, "diff", "README_UNRELATED.txt"), /line three \(unstaged\)/);
});
