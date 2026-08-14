"use strict";
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, execFile } = require("node:child_process");
const { extractContent, replaceContent } = require("./lib/content-io.js");
const { applyPatch } = require("./lib/patch.js");
const { signParams } = require("./lib/cloudinary.js");

const CONTENT_FILES = [
  "index.html", "montessori-acamp.html", "montessori-vidyanagar.html",
  "acamp-subpage.html", "vidyanagar-subpage.html", "content.js",
];
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".css": "text/css", ".png": "image/png",
  ".gif": "image/gif", ".md": "text/plain; charset=utf-8",
};
const INJECT = '<script src="/editor/lib/paths.js"></script>' +
  '<script src="/editor/client/draft.js"></script>' +
  '<script src="/editor/client/editor-client.js"></script>';

// Only a bare, single-segment .js filename directly under editor/lib/ or editor/client/ is
// ever servable. Dots are permitted in the name (e.g. "editor-client.min.js") so a future
// bundle doesn't break silently, but no nested subdirectory and no ".." segment anywhere.
function editorPathAllowed(relToEditorLower) {
  if (relToEditorLower.split("/").some((seg) => seg === "..")) return false;
  return /^(lib|client)\/[a-z0-9_.-]+\.js$/.test(relToEditorLower);
}

// True if `pLower` (an already-lowercased absolute path, forward-slash-normalised) lies
// inside the editor directory (`edLower`, also lowercased/normalised) AND does not satisfy
// the allowlist above. Shared by both authority checks below (pre- and
// post-symlink-resolution) so the identical rule applies to both.
function isForbiddenEditorPath(pLower, edLower) {
  const inEditor = pLower === edLower || pLower.startsWith(edLower + "/");
  if (!inEditor) return false;
  const relToEditor = pLower === edLower ? "" : pLower.slice(edLower.length + 1);
  return !editorPathAllowed(relToEditor);
}

// Cloudinary upload signing: only these keys may ever be signed, and only for a
// timestamp close to "now" — otherwise this endpoint is an open signing oracle.
const SIGNABLE_KEYS = ["timestamp", "folder", "public_id", "eager"];
const SIGN_TIMESTAMP_SKEW_SECONDS = 120;

// `!secrets` alone lets 42, [], "x", {} — anything truthy — through: they all reach
// signParams(params, undefined), which happily returns a signature computed over the
// literal string "undefined" and a 200 with `apiKey` silently missing from the JSON body.
// Cloudinary then fails the upload with an error that has nothing to do with the real
// cause. Require the actual shape the signing code needs.
function hasValidCloudinarySecrets(secrets) {
  return !!secrets && typeof secrets === "object" &&
    typeof secrets.cloudinaryApiSecret === "string" && secrets.cloudinaryApiSecret !== "" &&
    typeof secrets.cloudinaryApiKey === "string" && secrets.cloudinaryApiKey !== "";
}

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type || "text/plain; charset=utf-8" });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    req.on("data", (c) => {
      len += c.length;
      if (len > 5e6) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      // Concatenate as bytes first, THEN decode once — decoding each chunk separately
      // (e.g. `buf += c`) corrupts any multi-byte UTF-8 character split across a
      // chunk boundary into U+FFFD.
      const raw = Buffer.concat(chunks).toString("utf8");
      // A genuinely empty body (no bytes at all) is not malformed — resolve to {} so
      // callers with all-optional fields (like /api/publish) can tell "no body" apart
      // from "body present but rejected" (oversized above, or unparseable below).
      if (raw.length === 0) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Redacts the absolute local filesystem paths out of text PRODUCED BY GIT ITSELF (or by
// execFileSync's own ".message", which embeds the failing command line) before it reaches an
// unauthenticated-by-network-topology-alone client. git's stderr routinely names the exact
// checkout path — e.g. "fatal: Unable to create '/private/var/.../site/.git/index.lock': File
// exists." (a stale lock after a crash) or "hook failed in /private/var/.../site" (a pre-commit
// hook) — and execFileSync errors from a non-zero exit carry `.status`, not `.code`, so the
// outer catch's `e.code` genericisation (added for fs/OS errors) never applies to them; they
// fall straight through with the raw path intact.
//
// This REDACTS, it does not suppress: round 1's finding 5 was precisely that swallowing git's
// stderr told collaborators "Nothing to publish" when their commit had actually failed for an
// unrelated reason — the message itself (WHY it failed) is genuinely useful and must keep
// flowing to the client. Only the absolute local path is replaced with a neutral placeholder;
// everything else in git's own words survives untouched.
//
// `root` is replaced before `os.homedir()` (not the reverse): on a checkout living under the
// user's home directory (a common layout), replacing the longer, more specific `root` first
// consumes it entirely, so the shorter `homedir` pass afterward only catches occurrences
// elsewhere in the text — replacing homedir first would instead leave a dangling
// "your home folder/MSC-Website/site/..." for any text that still contained the full root path.
// split/join, not a regex: `root` and homedir are arbitrary user-controlled-by-installation
// strings that may contain regex metacharacters (parentheses, dots — real on macOS temp paths
// like ".../T/msc-pub-XXXX/site").
function redactPaths(text, root) {
  let out = String(text);
  if (root) out = out.split(root).join("the site folder");
  const home = os.homedir();
  if (home && typeof home === "string" && home !== "") out = out.split(home).join("your home folder");
  return out;
}

// Pure: where the Cloudinary secret file lives for a given homedir, or null if `homedir`
// isn't usable as a base path at all. Exported so tests (and loadSecrets below) share one
// definition of "where" instead of two that could drift.
function secretsPathFor(homedir) {
  // os.homedir() can return "" (observed with HOME="") or, on some platforms, throw —
  // callers pass through whatever they got. A non-absolute value must NOT be joined with
  // path.join, because path.join("", ".msc-editor", "secrets.json") silently resolves to
  // a path RELATIVE TO THE SERVER'S CWD — which, for this project, is inside the served
  // repository (the same tree Fix 1 exists to keep the secret out of).
  if (typeof homedir !== "string" || !path.isAbsolute(homedir)) return null;
  return path.join(homedir, ".msc-editor", "secrets.json");
}

// Pure: given a homedir string, returns the parsed secrets object, or null if uploads
// should be disabled. Exported and called from the boot block below with os.homedir() —
// this is the function fix-round-3 (moving the secret to ~/.msc-editor/secrets.json) was
// named after, and until now it lived entirely inside `if (require.main === module)`,
// unreachable from any unit test: reverting the path, or deleting the stale-file warning,
// both left the full suite green.
//
// Must NEVER crash regardless of what's at (or isn't at, or instead of) that path — unset
// HOME, a nonexistent homedir, a homedir that's a symlink, ".msc-editor" existing as a
// plain FILE, "secrets.json" existing as a DIRECTORY, mode 000, malformed JSON, JSON `null`,
// a bare number — every one of those must fall back to uploads-disabled, never throw.
function loadSecrets(homedir) {
  const secretsPath = secretsPathFor(homedir);
  if (!secretsPath) {
    console.warn(
      "WARNING: could not determine a usable home directory (os.homedir() returned " +
      JSON.stringify(homedir) + ") — uploads disabled. Set HOME and run: npm run setup"
    );
    return null;
  }
  let raw;
  try {
    raw = fs.readFileSync(secretsPath, "utf8");
  } catch (e) {
    // ENOENT ("nothing configured yet") is the ONLY case that should disable silently —
    // it's the expected state on a fresh checkout before `npm run setup` has run. Anything
    // else (EACCES, EISDIR, ENOTDIR, ...) is a misconfiguration the collaborator should
    // know about, not indistinguishable from "not set up". Name the problem, never the
    // file's contents.
    if (e.code !== "ENOENT") {
      console.warn("WARNING: could not read " + secretsPath + " (" + e.code + ") — uploads disabled.");
    }
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.warn("WARNING: " + secretsPath + " is not valid JSON — uploads disabled. Run: npm run setup");
    return null;
  }
}

// Pure: the stale-secrets warning message if a leftover editor/secrets.json still exists
// (the pre-round-3 location, inside the served tree), or null. Exported for the same
// reason as loadSecrets: this used to be inline in the boot block, unreachable from a test.
function staleSecretsWarning(editorDir) {
  const stalePath = path.join(editorDir, "secrets.json");
  if (!fs.existsSync(stalePath)) return null;
  return "WARNING: found " + stalePath + " — this location is inside the served website " +
    "tree and was never safe. Delete it and run: npm run setup";
}

function createServer({ root, config, templates, secrets, token }) {
  // paths.js lives in the repo's editor/ dir, not the (possibly tmp) site root under test.
  const editorDir = __dirname;
  const editorParent = path.dirname(editorDir);
  // Realpath'd, not just path.resolve'd: `real` (the value this is ultimately compared
  // against, below) is always realpath'd, so if editorDir itself were ever reached via a
  // symlink (e.g. under `node --preserve-symlinks` with a symlinked repo checkout) a
  // non-realpath'd edLower would silently never match `real` again, turning the entire
  // post-realpath allowlist check into a permanent no-op.
  const edLower = fs.realpathSync(editorDir).toLowerCase().split(path.sep).join("/");
  // Realpath the two possible `base` directories once, up front. os.tmpdir() (used by
  // every test fixture, and by any real symlinked path) is itself a symlink on macOS
  // (/var -> /private/var), so a plain string join would not match what
  // fs.realpathSync(fp) later returns for a file underneath it — comparing a realpath'd
  // `real` against a non-realpath'd base string would falsely reject legitimate files.
  const rootReal = fs.realpathSync(root);
  const editorParentReal = fs.realpathSync(editorParent);
  // Per-boot secret. A foreign page cannot read it (CORS blocks reading the response
  // body of a cross-origin request), so it cannot drive the API even though the port
  // is reachable. Generated even if the caller forgets to pass one.
  const AUTH_TOKEN = token || crypto.randomUUID();
  const TOKEN_SCRIPT = "<script>window.__EDITOR_TOKEN=" + JSON.stringify(AUTH_TOKEN) + ";</script>";

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        // Uniform guard for every /api/* endpoint, present and future: origin, token,
        // then (for POSTs) content-type. A text/plain POST is a CORS "simple request"
        // (no preflight), so the content-type check alone defeats that bypass; the
        // token defeats it even if content-type were spoofed to application/json.
        const port = req.socket.localPort;
        const origin = req.headers.origin;
        if (origin && origin !== "http://localhost:" + port && origin !== "http://127.0.0.1:" + port) {
          return send(res, 403, "Forbidden origin");
        }
        if (req.headers["x-editor-token"] !== AUTH_TOKEN) {
          return send(res, 403, "Forbidden");
        }
        if (req.method === "POST") {
          // Compare only the media type, not the raw header: `startsWith` would accept
          // "application/json-evil"; parse off any `; charset=...` parameters (which real
          // browsers do send) and require an exact match.
          const ct = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
          if (ct !== "application/json") {
            return send(res, 415, "Content-Type must be application/json");
          }
        }
      }

      if (req.method === "POST" && url.pathname === "/api/save") {
        const body = await readJson(req);
        if (!CONTENT_FILES.includes(body.file)) return send(res, 400, "Unknown file: " + body.file);
        // A patch that isn't the `{ ops: [...] }` shape (missing entirely, `ops` not an
        // array, or `patch` itself not an object) must be rejected here. Left unchecked,
        // applyPatch's own `(patch && patch.ops) || []` silently treats it as "zero ops" —
        // a 200 "success" that rewrites the file with nothing changed. Because
        // replaceContent always re-serialises the whole CONTENT block, that no-op still
        // produces a large spurious diff (reformatting) with no actual edit behind it.
        if (body.patch === null || typeof body.patch !== "object" || Array.isArray(body.patch) ||
            !Array.isArray(body.patch.ops)) {
          return send(res, 400, "Invalid patch: expected { ops: [...] }");
        }
        const fp = path.join(root, body.file);
        const src = fs.readFileSync(fp, "utf8");
        const { data } = extractContent(src);
        applyPatch(data, body.patch, templates); // throws => nothing written
        fs.writeFileSync(fp, replaceContent(src, data));
        return send(res, 200, JSON.stringify({ ok: true }), "application/json");
      }

      if (req.method === "POST" && url.pathname === "/api/publish") {
        // An absent/empty body is fine (readJson resolves it to {}, so the default message
        // is used); a body that IS present but gets rejected (oversized, malformed JSON)
        // must 400 rather than silently proceeding with the default message.
        let body;
        try { body = await readJson(req); }
        catch (e) { return send(res, 400, "Invalid publish request: " + (e.message || e)); }
        const msg = (body.message || "content: update via editor").slice(0, 200);
        const existing = CONTENT_FILES.filter((f) => fs.existsSync(path.join(root, f)));
        // Was unwrapped until fix round 5: a failure here (e.g. a stale `.git/index.lock` left
        // behind by a crashed prior run — realistic, not contrived) fell straight through to
        // the outer catch. execFileSync's non-zero-exit errors carry `.status`, not `.code`, so
        // that catch's `e.code` genericisation never caught them either — the raw absolute
        // path in git's stderr reached the client unredacted. Same redacted-500 shape as the
        // commit and push failures just below, for the same reason.
        try { git(root, ["add", "--", ...existing]); }
        catch (e) { return send(res, 500, "Publish failed: " + redactPaths(e.stderr || e.message, root)); }
        let hasStagedChanges = true;
        try { git(root, ["diff", "--cached", "--quiet"]); hasStagedChanges = false; } catch { /* exit !=0 => staged changes */ }
        if (!hasStagedChanges) return send(res, 409, "Nothing to publish (no changes).");
        try { git(root, ["commit", "-m", msg]); }
        catch (e) { return send(res, 500, "Publish failed: " + redactPaths(e.stderr || e.message, root)); }
        if (config.push === true && process.env.EDITOR_NO_PUSH !== "1") {
          try { git(root, ["pull", "--rebase"]); git(root, ["push"]); }
          catch (e) {
            try { git(root, ["rebase", "--abort"]); } catch {}
            return send(res, 409, "Published locally, but sync failed: " +
              redactPaths(e.stderr || e.message, root) + "\nYour changes are committed; ask the site admin to resolve.");
          }
        }
        return send(res, 200, JSON.stringify({ ok: true }), "application/json");
      }

      if (req.method === "POST" && url.pathname === "/api/sign") {
        if (!hasValidCloudinarySecrets(secrets)) return send(res, 503, "Uploads not configured — run: npm run setup");
        const body = await readJson(req);
        // A JSON body of literal `null` (or a non-object) makes `body.paramsToSign` throw
        // before the `|| {}` fallback ever runs — guard the body's own shape first, then
        // paramsToSign's, so a hostile/malformed body 400s instead of leaking a raw
        // "Cannot read properties of null" TypeError.
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          return send(res, 400, "Invalid request body");
        }
        const paramsToSign = body.paramsToSign;
        if (paramsToSign !== undefined && paramsToSign !== null &&
            (typeof paramsToSign !== "object" || Array.isArray(paramsToSign))) {
          return send(res, 400, "paramsToSign must be an object");
        }
        const params = paramsToSign || {};
        for (const k of Object.keys(params)) {
          if (!SIGNABLE_KEYS.includes(k)) return send(res, 400, "Unsupported sign parameter: " + k);
        }
        const ts = params.timestamp;
        if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > SIGN_TIMESTAMP_SKEW_SECONDS) {
          return send(res, 400, "timestamp missing or too far from server clock");
        }
        const shared = extractContent(fs.readFileSync(path.join(root, "content.js"), "utf8")).data;
        return send(res, 200, JSON.stringify({
          signature: signParams(params, secrets.cloudinaryApiSecret),
          apiKey: secrets.cloudinaryApiKey,
          cloudName: shared.cloudName,
        }), "application/json");
      }

      // ---- static ----
      const raw = decodeURIComponent(url.pathname);
      const rel = raw === "/" ? "index.html" : raw.replace(/^\//, "");

      // Outer layer: block any dot-prefixed path segment (.git, .env, ...), regardless of
      // casing or which branch below gets taken.
      if (rel.split("/").some((seg) => seg.startsWith("."))) return send(res, 403, "Forbidden");

      // `base` only picks which directory to START resolving from — it is NOT the security
      // decision. On a case-INSENSITIVE filesystem (macOS APFS, the deploy target here) a
      // request like "/EDITOR/secrets.json" fails this case-sensitive test, falls into the
      // `root` branch below, and — because in production root === path.dirname(editorDir) —
      // still resolves ON DISK into the real editor/ directory. So the actual access
      // decision (below) is made from the RESOLVED path, never from this branch or the URL.
      const base = rel.startsWith("editor/") ? editorParent : root;
      const baseReal = rel.startsWith("editor/") ? editorParentReal : rootReal;
      const baseResolved = path.resolve(base);
      const fp = path.resolve(base, rel);
      if (fp !== baseResolved && !fp.startsWith(baseResolved + path.sep)) return send(res, 403, "Forbidden");

      // AUTHORITY, part 1 — pre-symlink, existence-independent. Runs on `fp` (the literal
      // joined path, not yet touched by the filesystem) before any fs call, so status codes
      // never leak whether a particular file inside editor/ exists. Catches a case-varied
      // URL that names a non-allowlisted editor/ file directly (e.g. "/EDITOR/secrets.json"
      // — case-insensitive, never a case-sensitive prefix test), whether or not that file
      // is actually there.
      //
      // This alone is NOT sufficient: it does not follow symlinks, so a symlink whose own
      // NAME happens to match the allowlist (e.g. editor/lib/evil.js) would pass here even
      // though it points somewhere else entirely, and a symlink/hard-link OUTSIDE editor/
      // that happens to point INTO editor/ (e.g. a root-level "/leak.json" -> editor/x, or a
      // root-level directory symlink "/pub" -> editor/) is invisible to a check on `fp`
      // alone, since `fp` itself never lies under editorDir textually. Part 2 below (on the
      // realpath'd, symlink-resolved path) closes both of those; the two together mean
      // neither check has to be perfect alone.
      const fpLower = fp.toLowerCase().split(path.sep).join("/");
      if (isForbiddenEditorPath(fpLower, edLower)) return send(res, 403, "Forbidden");

      let real;
      try { real = fs.realpathSync(fp); }
      catch { return send(res, 404, "Not found"); } // missing file or broken symlink — not a crash

      // AUTHORITY, part 2 — post-symlink. First, containment: re-run it against the
      // symlink-RESOLVED path (using the correspondingly realpath'd base computed above,
      // since os.tmpdir() is itself a symlink on macOS — comparing realpath'd `real` against
      // a non-realpath'd base string would falsely reject legitimate tmp-rooted files). A
      // symlink living under `base` but pointing outside it must not be followed.
      if (real !== baseReal && !real.startsWith(baseReal + path.sep)) return send(res, 403, "Forbidden");

      // Second, the SAME editor allowlist as part 1, now evaluated against the RESOLVED
      // path — this is the actual fix for round 2's central defect (the allowlist was only
      // ever checked against `fp`, never against `real`, so a symlink resolving into
      // editor/ from anywhere — root-level file symlink, root-level directory symlink, or a
      // same-directory symlink under editor/lib/ pointing at ../secrets.json — passed
      // straight through). A hard link cannot be caught by any path-based check, including
      // this one — realpath does not (and by design cannot) resolve a hard link, since a
      // hard-linked file genuinely IS a normal file, indistinguishable on disk from any
      // other, in whatever directory it was linked into.
      //
      // This is an ACCEPTED residual risk, not a closed one, and moving the secret to
      // ~/.msc-editor/secrets.json (Fix round 3) does NOT close it: `ln
      // ~/.msc-editor/secrets.json <repo>/harmless.txt` then `GET /harmless.txt` still
      // serves the secret — moving the file only changes where the link has to point, not
      // whether one can be made. The reason this is still acceptable is the OTHER half of
      // the original reasoning, which does hold: creating that hard link requires local
      // filesystem write access to the served tree in the first place, and an attacker who
      // already has that can simply open ~/.msc-editor/secrets.json directly — the hard
      // link gains them nothing they didn't already have. See secrets-location.test.js for
      // the demonstration (not a code guard, since none is possible here).
      const realLower = real.toLowerCase().split(path.sep).join("/");
      if (isForbiddenEditorPath(realLower, edLower)) return send(res, 403, "Forbidden");

      // AUTHORITY, part 3 — the SAME dot-segment rule as the outer check above (which runs
      // on `rel`, derived from the URL — i.e. PRE-resolution), re-run here against the
      // RESOLVED path. Without this, a symlink whose URL name contains no dot segment but
      // which resolves INTO a dotfile/dotdir sails straight through: a symlinked directory
      // pointing at .git, a case-varied symlink directory, an absolute symlink straight at
      // .git/config, or a symlink at .env. Since `/api/publish` runs `git pull` (line ~159),
      // such a symlink can arrive via an ordinary `git pull` from a collaborator, not just a
      // locally-planted attack — a strictly lower bar than the hard-link vector above.
      // Computed relative to `baseReal` (not the absolute path) so a repo legitimately
      // checked out UNDER a dotted directory (e.g. "~/.local/share/MSC-Website") is not
      // falsely blocked; `real === baseReal` is handled directly rather than slicing, which
      // would otherwise cut at the wrong offset.
      const relReal = real === baseReal ? "" : real.slice(baseReal.length + 1);
      if (relReal.split(path.sep).some((seg) => seg.startsWith("."))) return send(res, 403, "Forbidden");

      if (!fs.statSync(real).isFile()) return send(res, 404, "Not found");
      const ext = path.extname(real).toLowerCase();
      let body = fs.readFileSync(real);
      if (ext === ".html") body = Buffer.from(body.toString("utf8").replace("</body>", TOKEN_SCRIPT + INJECT + "</body>"));
      return send(res, 200, body, MIME[ext] || "application/octet-stream");
    } catch (e) {
      // Errors thrown by our own validators (content-io.js, patch.js — "Unknown or
      // non-text path", "Text may not contain CONTENT:BEGIN...", etc.) are plain
      // `new Error(...)` with no `.code`, and their messages are deliberate, useful
      // feedback — safe to send as-is. Node's own fs/OS errors (ENOENT, EACCES, EISDIR,
      // ENOTDIR, ...) always carry `.code`, and their `.message` embeds the absolute local
      // path that failed (e.g. "EACCES: permission denied, open '/private/var/.../x'") —
      // never send that to an unauthenticated caller. Log the real error for the
      // collaborator running the server; send a generic message to the client.
      if (e && e.code) {
        console.error("Unexpected error handling " + req.method + " " + url.pathname + ":", e);
        return send(res, 400, "Unexpected server error — see the editor server's terminal output for details.");
      }
      return send(res, 400, String(e.message || e));
    }
  });
}

module.exports = {
  createServer, CONTENT_FILES, readJson,
  loadSecrets, secretsPathFor, staleSecretsWarning, hasValidCloudinarySecrets,
};

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  const templates = JSON.parse(fs.readFileSync(path.join(__dirname, "collections.json"), "utf8"));
  // The Cloudinary secret lives OUTSIDE the repository entirely — a credential inside the
  // served web root is reachable by construction (case-varied URLs, symlinks, even hard
  // links; see the static-handler comments above). ~/.msc-editor/secrets.json can never be
  // requested over HTTP and can never be committed by accident.
  const secretsPath = secretsPathFor(os.homedir());
  const secrets = loadSecrets(os.homedir());
  // A stray secrets.json from before this fix would have been inside the served tree.
  // Warn loudly, but never read, migrate, or delete it automatically — leave that to the
  // collaborator, deliberately, so nothing here ever touches a credential file on their
  // say-so alone.
  const staleWarning = staleSecretsWarning(__dirname);
  if (staleWarning) console.warn(staleWarning);
  const token = crypto.randomUUID();
  const srv = createServer({ root, config, templates, secrets, token });
  // A second editor process (or anything else already bound to the port) must not crash
  // with a raw stack trace in front of non-technical staff — name the actual problem.
  srv.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.error(
        "Port " + config.port + " is already in use — is the editor already running? " +
        "Close it, or change \"port\" in editor/config.json."
      );
      process.exit(1);
    }
    throw e;
  });
  srv.listen(config.port, "127.0.0.1", () => {
    const url = "http://localhost:" + config.port + "/";
    console.log("Editor running at " + url);
    // Must use the SAME check /api/sign uses (hasValidCloudinarySecrets), not just `!secrets`.
    // `!secrets` alone is true only for null/undefined, so a truthy-but-wrong-shaped secrets
    // file (e.g. `42`, or `{"cloudinaryApiKey":"k"}` missing the secret) prints nothing here —
    // implying uploads work — while /api/sign still 503s on every request. The two gates must
    // agree, or boot output actively misleads the collaborator about upload readiness.
    if (!hasValidCloudinarySecrets(secrets)) {
      console.log("(uploads disabled — no " + (secretsPath || "usable home directory") + "; run: npm run setup)");
    }
    if (process.env.EDITOR_NO_PUSH === "1") console.log("(EDITOR_NO_PUSH=1 — publish will commit but NOT push)");
    if (process.platform === "darwin") execFile("open", [url]);
  });
}
