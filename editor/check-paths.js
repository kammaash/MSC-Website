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

// Names the shape of a value for an error message, so a failure reads as English
// ("resolves to an array") rather than as a typeof result ("resolves to object").
function describe(value) {
  if (Array.isArray(value)) return "an array";
  if (value === null) return "null";
  const t = typeof value;
  return (["a", "e", "i", "o", "u"].includes(t[0]) ? "an " : "a ") + t;
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

    for (const m of stripComments(src).matchAll(/data-(edit|list|media-slot|media-poster)="([^"{]+)"/g)) {
      const attr = m[1];
      const raw = m[2];
      const isShared = raw.startsWith("shared:");
      const scope = isShared ? shared : data;
      const p = isShared ? raw.slice(7) : raw;
      checked++;
      if (scope === null) { errors.push(`${page}: ${raw} — ${sharedReason}`); continue; }
      const value = getPath(scope, p);
      if (value === undefined) { errors.push(`${page}: unresolved ${raw}`); continue; }
      // A data-edit path names an editable TEXT value, and lib/patch.js's validateText
      // rejects a non-string server-side — so a path that resolves to an object or an
      // array is one the editor will happily offer for editing and then refuse to save,
      // with the failure surfacing at Publish rather than at the click. "Resolves to
      // something" was too weak a check to catch that. data-list is deliberately left
      // alone: those paths resolve to arrays by definition.
      if ((attr === "edit" || attr === "media-slot" || attr === "media-poster") && typeof value !== "string") {
        errors.push(`${page}: ${raw} resolves to ${describe(value)}, but data-${attr} must name a text value`);
      }
    }
  }

  return { errors, checked };
}

module.exports = { checkPaths, stripComments, PAGES };

if (require.main === module) {
  const { errors } = checkPaths(path.join(__dirname, ".."));
  for (const e of errors) console.error(e);
  if (errors.length) { console.error(errors.length + " check-paths failure(s)"); process.exit(1); }
  console.log("check-paths: all static data-edit/data-list/data-media-slot/data-media-poster paths resolve");
}
