"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");
const { extractContent, replaceContent } = require("./lib/content-io.js");
const { signParams } = require("./lib/cloudinary.js");

// The only part of setup that writes anything to disk — kept out of the interactive
// readline flow below (require.main block) so it is require-able and unit-testable without
// a TTY. Takes `homedir` and `contentPath` explicitly rather than reaching for
// os.homedir()/a hardcoded content.js path itself, so every test can point this at a
// disposable tmp fixture; the real ~/.msc-editor and the real content.js are never at risk
// from a test run, only from the require.main block below (which a test never executes).
//
// Writes nothing at all — no directory, no file, no content.js edit — unless all three
// values are non-blank after trimming. A half-written secrets.json, or a cloudName silently
// set to whitespace, is worse than refusing outright and asking the collaborator to re-run.
function writeCredentials({ homedir, contentPath, cloudName, apiKey, apiSecret }) {
  const name = typeof cloudName === "string" ? cloudName.trim() : "";
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  const secret = typeof apiSecret === "string" ? apiSecret.trim() : "";
  if (!name || !key || !secret) throw new Error("All three values are required.");

  signParams({ timestamp: 1 }, secret); // sanity: signing works before anything is written

  // OUTSIDE the repo — a credential inside the served web root is reachable by
  // construction (case-varied URLs, symlinks, hard links; see editor/server.js). This is
  // the only location editor/server.js ever reads from.
  const secretsDir = path.join(homedir, ".msc-editor");
  // `recursive: true` skips applying `mode` entirely when the directory already exists
  // (e.g. re-running setup to rotate credentials) — chmod explicitly afterward rather than
  // trusting mkdir to have applied it, per Node's documented behaviour.
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(secretsDir, 0o700);

  const secretsPath = path.join(secretsDir, "secrets.json");
  fs.writeFileSync(
    secretsPath,
    JSON.stringify({ cloudinaryApiKey: key, cloudinaryApiSecret: secret }, null, 2),
    { mode: 0o600 },
  );
  // Same reasoning as the directory above: writeFileSync's `mode` option only applies to a
  // freshly-created file, so a re-run that overwrites an existing (possibly looser) file
  // would silently keep its old permissions without this explicit chmod.
  fs.chmodSync(secretsPath, 0o600);

  // cloudName lives in content.js's CONTENT block, shared by every page — go through
  // extractContent/replaceContent like every other writer in this codebase (editor/server.js's
  // /api/save), never string-patch the file. That's what keeps the rest of content.js
  // (formatting, comments, everything outside the markers) byte-for-byte untouched.
  const src = fs.readFileSync(contentPath, "utf8");
  const { data } = extractContent(src);
  data.cloudName = name;
  fs.writeFileSync(contentPath, replaceContent(src, data));

  return { secretsPath };
}

module.exports = { writeCredentials };

if (require.main === module) {
  (async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("MSC editor setup — Cloudinary credentials (Dashboard → API Keys):");
    const cloudName = await rl.question("Cloud name: ");
    const apiKey = await rl.question("API key: ");
    const apiSecret = await rl.question("API secret: ");
    rl.close();
    try {
      const { secretsPath } = writeCredentials({
        homedir: os.homedir(),
        contentPath: path.join(__dirname, "..", "content.js"),
        cloudName,
        apiKey,
        apiSecret,
      });
      console.log("Wrote " + secretsPath + " (outside the repo) and set cloudName in content.js.");
      console.log("Next: npm run edit");
    } catch (e) {
      // Never print the values back — only the failure reason.
      console.error(e.message);
      process.exit(1);
    }
  })();
}
