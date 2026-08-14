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

// Only these two directories under editor/ are ever servable to a browser, and only
// bare, single-segment, .js filenames within them — never editor/config.json,
// editor/collections.json, or (critically) editor/secrets.json.
const EDITOR_STATIC_RE = /^editor\/(lib|client)\/([^/]+\.js)$/;

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
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
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
          const ct = (req.headers["content-type"] || "").toLowerCase();
          if (!ct.startsWith("application/json")) {
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
        const body = await readJson(req).catch(() => ({}));
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

      // Block any dot-prefixed path segment (.git, .env, ...) everywhere, on top of the
      // traversal check below — these are layers, not replacements for one another.
      if (rel.split("/").some((seg) => seg.startsWith("."))) return send(res, 403, "Forbidden");

      let base;
      if (rel.startsWith("editor/")) {
        // Explicit allowlist: only editor/lib/<name>.js and editor/client/<name>.js are
        // ever servable. Everything else under editor/ (config.json, collections.json,
        // and especially secrets.json) is 403, whether or not the file exists.
        if (!EDITOR_STATIC_RE.test(rel)) return send(res, 403, "Forbidden");
        base = path.dirname(editorDir);
      } else {
        base = root;
      }
      const fp = path.resolve(base, rel);
      if (fp !== path.resolve(base) && !fp.startsWith(path.resolve(base) + path.sep)) return send(res, 403, "Forbidden");
      if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return send(res, 404, "Not found");
      const ext = path.extname(fp).toLowerCase();
      let body = fs.readFileSync(fp);
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
