"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { extractContent } = require("./lib/content-io.js");
const { getPath } = require("./lib/paths.js");
const { parseAttrSpec } = require("./lib/attr-spec.js");

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

    const markup = stripComments(src);

    // Resolves one content path and reports it, shared or page-local. `label` is what
    // the error names the path as (a bare path for data-edit; the path plus the
    // attribute it feeds for data-edit-attr, since a single element can bind several
    // and "unresolved hero.b" alone would not say which one). `mustBeText` is false
    // only for data-list, whose paths resolve to arrays by definition.
    const resolve = (raw, label, mustBeText, attrName) => {
      const isShared = raw.startsWith("shared:");
      const scope = isShared ? shared : data;
      const p = isShared ? raw.slice(7) : raw;
      checked++;
      if (scope === null) { errors.push(`${page}: ${raw} — ${sharedReason}`); return; }
      const value = getPath(scope, p);
      if (value === undefined) { errors.push(`${page}: unresolved ${label}`); return; }
      // A data-edit path names an editable TEXT value, and lib/patch.js's validateText
      // rejects a non-string server-side — so a path that resolves to an object or an
      // array is one the editor will happily offer for editing and then refuse to save,
      // with the failure surfacing at Publish rather than at the click. "Resolves to
      // something" was too weak a check to catch that.
      if (mustBeText && typeof value !== "string") {
        errors.push(`${page}: ${raw} resolves to ${describe(value)}, but ${attrName} must name a text value`);
      }
    };

    for (const m of markup.matchAll(/data-(edit|list|media-slot)="([^"{]+)"/g)) {
      const attr = m[1];
      const raw = m[2];
      resolve(raw, raw, attr === "edit" || attr === "media-slot", "data-" + attr);
    }

    // data-edit-attr carries attribute:path pairs rather than a bare path, so it needs
    // its own pass. Two things are validated, not one: the SHAPE of the spec (via the
    // same parser the browser uses — including its allowlist, which is what keeps a
    // `src:` or `href:` binding from ever reaching a deployed page) and then each
    // path it names. As with data-edit, a value containing "{{" is built per-item at
    // render time and cannot be resolved statically, so it is left to the renderer.
    for (const m of markup.matchAll(/data-edit-attr="([^"]+)"/g)) {
      const raw = m[1];
      if (raw.includes("{{")) continue;
      let pairs;
      try {
        pairs = parseAttrSpec(raw);
      } catch (err) {
        errors.push(`${page}: data-edit-attr="${raw}" — ${err.message}`);
        continue;
      }
      for (const { attr, path: p } of pairs) resolve(p, `${p} (${attr})`, true, "data-edit-attr");
    }
  }

  return { errors, checked };
}

module.exports = { checkPaths, stripComments, PAGES };

if (require.main === module) {
  const { errors } = checkPaths(path.join(__dirname, ".."));
  for (const e of errors) console.error(e);
  if (errors.length) { console.error(errors.length + " check-paths failure(s)"); process.exit(1); }
  console.log("check-paths: all static data-edit/data-edit-attr/data-list/data-media-slot paths resolve");
}
