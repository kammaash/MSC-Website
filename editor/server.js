"use strict";
const http = require("node:http");
const fs = require("node:fs");
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

// Cloudinary upload signing: only these keys may ever be signed, and only for a
// timestamp close to "now" — otherwise this endpoint is an open signing oracle.
const SIGNABLE_KEYS = ["timestamp", "folder", "public_id", "eager"];
const SIGN_TIMESTAMP_SKEW_SECONDS = 120;

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

function createServer({ root, config, templates, secrets, token }) {
  // paths.js lives in the repo's editor/ dir, not the (possibly tmp) site root under test.
  const editorDir = __dirname;
  const editorParent = path.dirname(editorDir);
  const edLower = path.resolve(editorDir).toLowerCase();
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
        git(root, ["add", "--", ...existing]);
        let hasStagedChanges = true;
        try { git(root, ["diff", "--cached", "--quiet"]); hasStagedChanges = false; } catch { /* exit !=0 => staged changes */ }
        if (!hasStagedChanges) return send(res, 409, "Nothing to publish (no changes).");
        try { git(root, ["commit", "-m", msg]); }
        catch (e) { return send(res, 500, "Publish failed: " + (e.stderr || e.message)); }
        if (config.push === true && process.env.EDITOR_NO_PUSH !== "1") {
          try { git(root, ["pull", "--rebase"]); git(root, ["push"]); }
          catch (e) {
            try { git(root, ["rebase", "--abort"]); } catch {}
            return send(res, 409, "Published locally, but sync failed: " +
              (e.stderr || e.message) + "\nYour changes are committed; ask the site admin to resolve.");
          }
        }
        return send(res, 200, JSON.stringify({ ok: true }), "application/json");
      }

      if (req.method === "POST" && url.pathname === "/api/sign") {
        if (!secrets) return send(res, 503, "Uploads not configured — run: npm run setup");
        const body = await readJson(req);
        const params = body.paramsToSign || {};
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

      // AUTHORITY, part 1 — the case-insensitive-filesystem bypass. This must work even if
      // the target file does NOT exist (so status codes never leak "this secret file isn't
      // even there"), so it runs on `fp` before any fs call: if the resolved path lies
      // inside the editor directory AT ALL — compared case-insensitively, never with a
      // case-sensitive prefix test — it MUST match the lib/client allowlist or it is
      // forbidden: not config.json, not collections.json, not secrets.json, not test files,
      // not check-paths.js. Independent of which URL casing or which branch got it here.
      const fpLower = fp.toLowerCase();
      const inEditorByPath = fpLower === edLower || fpLower.startsWith(edLower + path.sep);
      if (inEditorByPath) {
        // Slice the already-lowercased strings rather than calling path.relative(editorDir,
        // fp): path.relative compares segments as case-SENSITIVE strings, so on a
        // differently-cased fp (e.g. "/EDITOR/lib/paths.js" vs. editorDir's real
        // "/.../editor") it would fail to recognise them as the same directory and produce
        // a bogus "../EDITOR/lib/paths.js" — silently over-blocking a legitimately
        // allowlisted file requested with different casing.
        const relToEditor = fpLower.slice(edLower.length + 1).split(path.sep).join("/");
        if (!/^(lib|client)\/[a-z0-9_-]+\.js$/.test(relToEditor)) return send(res, 403, "Forbidden");
      }

      let real;
      try { real = fs.realpathSync(fp); }
      catch { return send(res, 404, "Not found"); } // missing file or broken symlink — not a crash

      // AUTHORITY, part 2 — the symlink escape. Re-run containment against the
      // symlink-RESOLVED path (using the correspondingly realpath'd base computed above): a
      // symlink living under `base` but pointing outside it must not be followed.
      if (real !== baseReal && !real.startsWith(baseReal + path.sep)) return send(res, 403, "Forbidden");

      if (!fs.statSync(real).isFile()) return send(res, 404, "Not found");
      const ext = path.extname(real).toLowerCase();
      let body = fs.readFileSync(real);
      if (ext === ".html") body = Buffer.from(body.toString("utf8").replace("</body>", TOKEN_SCRIPT + INJECT + "</body>"));
      return send(res, 200, body, MIME[ext] || "application/octet-stream");
    } catch (e) {
      return send(res, 400, String(e.message || e));
    }
  });
}

module.exports = { createServer, CONTENT_FILES, readJson };

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  const templates = JSON.parse(fs.readFileSync(path.join(__dirname, "collections.json"), "utf8"));
  let secrets = null;
  try { secrets = JSON.parse(fs.readFileSync(path.join(__dirname, "secrets.json"), "utf8")); } catch {}
  const token = crypto.randomUUID();
  const srv = createServer({ root, config, templates, secrets, token });
  srv.listen(config.port, "127.0.0.1", () => {
    const url = "http://localhost:" + config.port + "/";
    console.log("Editor running at " + url);
    if (!secrets) console.log("(uploads disabled — no editor/secrets.json; run: npm run setup)");
    if (process.env.EDITOR_NO_PUSH === "1") console.log("(EDITOR_NO_PUSH=1 — publish will commit but NOT push)");
    if (process.platform === "darwin") execFile("open", [url]);
  });
}
