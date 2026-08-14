# Editing the MSC website

## One-time setup (ask the site admin to walk you through it)
1. Install [GitHub Desktop](https://desktop.github.com) (includes git) and [Node.js LTS](https://nodejs.org).
2. Get added as a collaborator on github.com/kammaash/MSC-Website; clone it with GitHub Desktop.
3. In Terminal, from the MSC-Website folder: `npm run setup` (the admin gives you the three Cloudinary values — Dashboard → API Keys).
   - This saves the values to a file in your **user folder** (`~/.msc-editor/secrets.json`), not
     inside the website folder itself, and it is never uploaded or committed to GitHub. You only
     need to do this once per computer.

## Editing
1. In Terminal, from the MSC-Website folder: `npm run edit` — your browser opens the site in editing mode.
2. Click any outlined text to change it. Enter finishes, Escape cancels.
3. **News:** open a school page, use "+ Add" under News. **Photos:** "+ Add" under Gallery, pick the file — it uploads and appears. **Videos** also go through "+ Add" under Gallery for now — see the note below.
4. ↑ ↓ reorder items; ✕ deletes (asks first).
5. Press **Publish**. The live site updates in about a minute. **Discard** throws away unsaved changes.

### Important: the editor only works one way
Editing mode only appears when the site is opened through `npm run edit`. If you open one of the
website's `.html` files directly, or the site is served any other way, you will see the ordinary
public site with no editing controls at all — no outlines, no "+ Add", nothing. That is
deliberate: the version of the site that actually goes live carries no editing code in it at all,
so there is nothing for a website visitor to ever click on or discover.

### Discard has a limit
**Discard** (or reloading the page) only throws away changes that have not been saved yet. Once
you press **Publish** and it has started saving files, those already-saved changes cannot be
undone by discarding or reloading — the on-screen warning at that point says the same thing. If a
Publish partly succeeds and something looks wrong afterward, stop and tell the admin rather than
trying to reload your way out of it; see "Made a mistake that's live?" below.

### The first Publish will look alarming — that's expected
The very first time anyone publishes after this editor is set up, GitHub will show a **very
large** number of changed lines, even if you only edited one sentence. This is not a mistake and
nothing is broken: saving reformats each page's content data slightly (consistent spacing), so
files that were previously written in a more compact style end up reflowing across many lines with
no actual wording changes. After that first publish, later diffs go back to being small and
proportional to what was actually edited.

## If something goes wrong
- **"could not be sent to the live site"** — your changes are saved and safe on your computer,
  but they have not reached the live site. Usually someone else edited at the same time.
  Pressing Publish again will not help — tell the admin. Nothing is lost.
- **"Publish failed"** (anything else) — nothing reached the live site, but your work is saved.
  Press Publish again; it is safe to retry and will not duplicate or delete anything. If it
  keeps failing, tell the admin.
- Made a mistake that's live? Tell the admin — every publish can be undone with one click on GitHub.
- Videos currently upload to Cloudinary, the same as photos — a "Publish to YouTube" option does
  not exist yet. It's built but switched off on purpose until Google approves a compliance
  review of the school's YouTube integration; nothing you do in the editor is affected either way.
