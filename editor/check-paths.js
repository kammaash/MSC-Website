"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { extractContent } = require("./lib/content-io.js");
const { getPath } = require("./lib/paths.js");

const PAGES = ["index.html", "montessori-acamp.html", "montessori-vidyanagar.html", "acamp-subpage.html", "vidyanagar-subpage.html"];

// content-io throws this exact message when a file has no CONTENT block at all.
// That is the only skippable failure: every other throw (duplicate markers, a
// malformed declaration, a JSON syntax error) means the block IS there and is
// broken, which must fail loudly — a trailing comma or a single-quoted string
// inside the markers is still valid JS, so the page renders fine in the browser
// and nothing else would ever notice that the editor can no longer save it.
const NO_BLOCK = /markers missing or out of order/;

// Only real markup is scanned for paths. Prose in an HTML comment, a CSS or JS
// block comment, or a whole-line // comment may legitimately quote an example
// data-edit value, and validating those would fail the build over documentation.
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "");
}

// Returns { errors, checked }: `errors` is the list of human-readable failures
// (empty means the page set is clean) and `checked` counts the literal paths
// that were actually resolved, so a run that silently validated nothing is
// distinguishable from a run that validated everything.
function checkPaths(root, pages = PAGES) {
  const errors = [];
  let checked = 0;

  // Shared content is optional: content.js does not exist until Task 5. A file
  // that exists but cannot be read or parsed is a different matter, so keep the
  // reason and report it if a `shared:` path actually needs it.
  let shared = null;
  let sharedReason = "content.js not found";
  try {
    shared = extractContent(fs.readFileSync(path.join(root, "content.js"), "utf8")).data;
  } catch (err) {
    sharedReason = err.code === "ENOENT" ? "content.js not found" : "content.js unreadable or unparseable — " + err.message;
  }

  for (const page of pages) {
    let src;
    try {
      src = fs.readFileSync(path.join(root, page), "utf8");
    } catch (err) {
      errors.push(`${page}: cannot be read — ${err.message}`);
      continue;
    }

    let data;
    try {
      data = extractContent(src).data;
    } catch (err) {
      if (NO_BLOCK.test(err.message)) continue; // page not extracted yet
      errors.push(`${page}: CONTENT block is present but unparseable — ${err.message}`);
      continue;
    }

    for (const m of stripComments(src).matchAll(/data-(?:edit|list)="([^"{]+)"/g)) {
      const raw = m[1];
      const isShared = raw.startsWith("shared:");
      const scope = isShared ? shared : data;
      const p = isShared ? raw.slice(7) : raw;
      checked++;
      if (scope === null) { errors.push(`${page}: ${raw} — ${sharedReason}`); continue; }
      if (getPath(scope, p) === undefined) errors.push(`${page}: unresolved ${raw}`);
    }
  }

  return { errors, checked };
}

module.exports = { checkPaths, stripComments, PAGES };

if (require.main === module) {
  const { errors } = checkPaths(path.join(__dirname, ".."));
  for (const e of errors) console.error(e);
  if (errors.length) { console.error(errors.length + " check-paths failure(s)"); process.exit(1); }
  console.log("check-paths: all static data-edit/data-list paths resolve");
}
