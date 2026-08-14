"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { extractContent } = require("./lib/content-io.js");
const { getPath } = require("./lib/paths.js");

const root = path.join(__dirname, "..");
const PAGES = ["index.html", "montessori-acamp.html", "montessori-vidyanagar.html", "acamp-subpage.html", "vidyanagar-subpage.html"];

let shared = null;
try { shared = extractContent(fs.readFileSync(path.join(root, "content.js"), "utf8")).data; } catch {}

let failures = 0;
for (const page of PAGES) {
  const src = fs.readFileSync(path.join(root, page), "utf8");
  let data = null;
  try { data = extractContent(src).data; } catch { continue; } // page not extracted yet
  for (const m of src.matchAll(/data-(?:edit|list)="([^"{]+)"/g)) {
    const raw = m[1];
    const isShared = raw.startsWith("shared:");
    const scope = isShared ? shared : data;
    const p = isShared ? raw.slice(7) : raw;
    if (scope === null) { console.error(`${page}: ${raw} — content.js missing or unparseable`); failures++; continue; }
    if (getPath(scope, p) === undefined) { console.error(`${page}: unresolved ${raw}`); failures++; }
  }
}
if (failures) { console.error(failures + " unresolved data-edit/data-list path(s)"); process.exit(1); }
console.log("check-paths: all static data-edit/data-list paths resolve");
