"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
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

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type || "text/plain; charset=utf-8" });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => { buf += c; if (buf.length > 5e6) reject(new Error("Body too large")); });
    req.on("end", () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function createServer({ root, config, templates, secrets }) {
  // paths.js lives in the repo's editor/ dir, not the (possibly tmp) site root under test.
  const editorDir = __dirname;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
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
        try { git(root, ["commit", "-m", msg]); }
        catch { return send(res, 409, "Nothing to publish (no changes)."); }
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
      const base = rel.startsWith("editor/") ? path.dirname(editorDir) : root;
      const fp = path.resolve(base, rel);
      if (fp !== path.resolve(base) && !fp.startsWith(path.resolve(base) + path.sep)) return send(res, 403, "Forbidden");
      if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return send(res, 404, "Not found");
      const ext = path.extname(fp).toLowerCase();
      let body = fs.readFileSync(fp);
      if (ext === ".html") body = Buffer.from(body.toString("utf8").replace("</body>", INJECT + "</body>"));
      return send(res, 200, body, MIME[ext] || "application/octet-stream");
    } catch (e) {
      return send(res, 400, String(e.message || e));
    }
  });
}

module.exports = { createServer, CONTENT_FILES };

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  const templates = JSON.parse(fs.readFileSync(path.join(__dirname, "collections.json"), "utf8"));
  let secrets = null;
  try { secrets = JSON.parse(fs.readFileSync(path.join(__dirname, "secrets.json"), "utf8")); } catch {}
  const srv = createServer({ root, config, templates, secrets });
  srv.listen(config.port, () => {
    const url = "http://localhost:" + config.port + "/";
    console.log("Editor running at " + url);
    if (!secrets) console.log("(uploads disabled — no editor/secrets.json; run: npm run setup)");
    if (process.env.EDITOR_NO_PUSH === "1") console.log("(EDITOR_NO_PUSH=1 — publish will commit but NOT push)");
    if (process.platform === "darwin") execFile("open", [url]);
  });
}
