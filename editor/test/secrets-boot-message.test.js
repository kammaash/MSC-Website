"use strict";
// Fix round 5, Fix B: the boot block (`if (require.main === module)`, server.js) used to gate
// its "(uploads disabled — ...)" console line on `!secrets`, while /api/sign gates the actual
// 503 on `hasValidCloudinarySecrets(secrets)`. `!secrets` is false for ANY truthy value — `42`,
// `{}`, `{"cloudinaryApiKey":"k"}` missing the secret — so a wrong-SHAPED-but-truthy secrets
// file printed nothing at boot (implying uploads work) while /api/sign still 503s on every
// request. The fix makes both gates call the same function; this file proves the boot line
// itself, not just the function it now calls (which secrets-boot.test.js already covers as a
// pure unit — this is the one thing that file's extraction could NOT reach: the print
// statement stayed inside `require.main === module`, so no unit test can call it directly).
//
// This can only be observed by actually running server.js as the ENTRY module (`require.main
// === module`), which does three things a normal `require("../server.js")` never triggers:
// reads editor/config.json for a port, calls `srv.listen(...)`, and — on darwin — shells out to
// `open <url>`. The fixture below neutralises all three without touching the real repo: a
// throwaway COPY of server.js + the lib/*.js it requires, its OWN config.json (port 0, so it
// can never collide with a real editor instance or another test), and a fake `open` placed
// first on PATH so the real macOS `open` command is never invoked (no browser window pops up
// during `npm test`). HOME points at a disposable fixture directory the whole time — the real
// $HOME/.msc-editor/secrets.json is never read.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REAL_EDITOR_DIR = path.join(__dirname, "..");
const REAL_LIB_FILES = ["content-io.js", "patch.js", "cloudinary.js", "paths.js"];

// Builds a throwaway copy of editor/{server.js,lib/*.js} plus its own config.json (port 0,
// push:false) and collections.json ({}), a fake `open` on its own bin dir, and a fixture $HOME
// containing the given secrets content at .msc-editor/secrets.json (or no file at all, if
// `secretsContent` is undefined). Returns everything needed to spawn it and clean it up.
function buildFixture(secretsContent) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "msc-boot-msg-"));
  const editorCopy = path.join(tmp, "editor");
  const libCopy = path.join(editorCopy, "lib");
  fs.mkdirSync(libCopy, { recursive: true });
  fs.copyFileSync(path.join(REAL_EDITOR_DIR, "server.js"), path.join(editorCopy, "server.js"));
  for (const f of REAL_LIB_FILES) {
    fs.copyFileSync(path.join(REAL_EDITOR_DIR, "lib", f), path.join(libCopy, f));
  }
  fs.writeFileSync(path.join(editorCopy, "config.json"), JSON.stringify({ port: 0, push: false }));
  fs.writeFileSync(path.join(editorCopy, "collections.json"), "{}");

  const fakeBin = path.join(tmp, "fakebin");
  fs.mkdirSync(fakeBin);
  const fakeOpen = path.join(fakeBin, "open");
  fs.writeFileSync(fakeOpen, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(fakeOpen, 0o755);

  const fixtureHome = path.join(tmp, "home");
  if (secretsContent !== undefined) {
    fs.mkdirSync(path.join(fixtureHome, ".msc-editor"), { recursive: true });
    fs.writeFileSync(path.join(fixtureHome, ".msc-editor", "secrets.json"), secretsContent);
  } else {
    fs.mkdirSync(fixtureHome, { recursive: true });
  }

  return {
    editorServerPath: path.join(editorCopy, "server.js"),
    fakeBin, fixtureHome,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

// Runs the fixture's server.js as a real child process entry module, collects stdout for a
// short fixed window (long enough for the synchronous boot-time console lines, which are all
// emitted inside the `srv.listen` callback before this process does anything else), then kills
// it. There is no "ready" line to poll for beyond "Editor running at", which itself is one of
// the lines already printed by the time we'd see it — using a short wait plus that line as a
// sanity check is simpler and just as reliable as a port-probing loop here, since nothing async
// happens between listen's callback firing and the last console line inside it.
function runBoot(fixture) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture.editorServerPath], {
      cwd: path.dirname(fixture.editorServerPath),
      env: { ...process.env, HOME: fixture.fixtureHome, PATH: fixture.fakeBin + path.delimiter + process.env.PATH, EDITOR_NO_PUSH: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => { out += c.toString(); });
    child.stderr.on("data", (c) => { err += c.toString(); });
    const timer = setTimeout(() => {
      child.kill();
      if (!out.includes("Editor running at")) {
        reject(new Error("child never printed its boot line. stdout: " + out + " stderr: " + err));
      } else {
        resolve(out);
      }
    }, 1500);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

test("Fix B: a truthy-but-wrong-shaped secrets file now prints the uploads-disabled boot line (previously silent)", async () => {
  const fixture = buildFixture(JSON.stringify({ cloudinaryApiKey: "k" })); // missing the secret
  try {
    const out = await runBoot(fixture);
    assert.match(out, /uploads disabled/, `expected the uploads-disabled line, got stdout: ${out}`);
  } finally {
    fixture.cleanup();
  }
});

test("Fix B: a bare-number secrets file (JSON `42`, truthy but not an object) also prints the boot line", async () => {
  const fixture = buildFixture("42");
  try {
    const out = await runBoot(fixture);
    assert.match(out, /uploads disabled/, `expected the uploads-disabled line, got stdout: ${out}`);
  } finally {
    fixture.cleanup();
  }
});

test("Fix B: a correctly-shaped secrets file prints no uploads-disabled line (positive control)", async () => {
  const fixture = buildFixture(JSON.stringify({ cloudinaryApiKey: "key123", cloudinaryApiSecret: "secret123" }));
  try {
    const out = await runBoot(fixture);
    assert.doesNotMatch(out, /uploads disabled/, `did not expect the uploads-disabled line, got stdout: ${out}`);
  } finally {
    fixture.cleanup();
  }
});

test("Fix B: no secrets file at all still prints the boot line (unconfigured — the ordinary fresh-checkout case)", async () => {
  const fixture = buildFixture(undefined);
  try {
    const out = await runBoot(fixture);
    assert.match(out, /uploads disabled/, `expected the uploads-disabled line, got stdout: ${out}`);
  } finally {
    fixture.cleanup();
  }
});
