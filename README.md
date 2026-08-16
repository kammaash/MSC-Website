# Montessori Schools — msceducation.net

Static site for the **Montessori School Committee (MSC)**, Kurnool, Andhra Pradesh.
Two branches: **Montessori School, A-Camp** and **Montessori School, Vidyanagar**.

No build step. Deployed via GitHub Pages from `main` (root), custom domain in `CNAME`.

## Pages
- `index.html` — MSC landing page (both branches)
- `montessori-acamp.html` — Montessori School, A-Camp
- `montessori-vidyanagar.html` — Montessori School, Vidyanagar
- `acamp-subpage.html` — A-Camp detail pages (hash-routed: `#core-values`, `#library`, `#transport`, …)
- `vidyanagar-subpage.html` — Vidyanagar detail pages (same routes)

## Runtime
`support.js` renders the pages client-side; `cursor.js` is the custom cursor.
Both must ship alongside the HTML. `assets/` holds the logos (also used as favicons).

## Editing content
Page copy is no longer typed into the markup. Each page keeps its own copy as strict
JSON inside `/* CONTENT:BEGIN */ … /* CONTENT:END */` markers in its `data-dc-script`
block, and `content.js` holds the facts shared across pages (contact details, news and
gallery collections). The markup reads those values through `{{ }}` holes, so hand-edits
must keep everything between the markers valid JSON.

`npm run edit` starts a local Node server that serves this repo and injects the
click-to-edit tooling at serve time only — the deployed site carries no editor code.
The Media drawer can connect Cloudinary the first time photos are used; credentials are
stored once per machine outside the repo. `npm run setup` provides the same setup through
Terminal when preferred.
`npm test` runs the editor's test suite plus `editor/check-paths.js`, which verifies
every `data-edit` / `data-list` path in the pages still resolves. Node 22 or newer.

Collaborator instructions live in [`docs/EDITING.md`](docs/EDITING.md); this section is
only the map.

## Design
Both branch pages use the same layout/structure and the same red palette:
`#a51915` primary · `#7f120f` dark · `#e8541b` orange accent · `#ffd9c4` peach ·
warm greys (`#26201d`, `#4a423c`, `#6b615b`, `#fbf3f2`).

### Layout system
Each page's `<style>` block holds a small layout system near the bottom, followed
by its breakpoints. Layout lives in classes; typography and colour stay inline.

- `.wrap` — page gutter (1240px on `index.html`, 1280px on the branch/sub pages)
- `.g` + a modifier — every grid (`.g-2`, `.g-3`, `.g-4`, `.g-hero`, `.g-split*`, `.g-foot`)
- `.h-hero` / `.h-1` / `.h-2` — headings that scale down at each breakpoint

Breakpoints: **1024px** (tablet — splits collapse to one column), **720px**
(phone — grids go single-column, nav/top bar stack), **520px** and **420px**
(narrow phones). Adding a section? Reuse a `.g-*` class and it is responsive for
free — avoid new inline `grid-template-columns`, which no media query can override.

## ⚠️ Placeholders awaiting real data
The public internet has no reliable information on these schools, so every
uncertain fact was deliberately left blank rather than guessed. Search for these:

- **Phone numbers** — `+91 XXXXX XXXXX` on all pages
- **Addresses** — "full address to be added" (A-Camp and Vidyanagar)
- **Email** — currently `info@msceducation.net`; confirm it exists
- **Hero stats** on `index.html` — neutral placeholders, no real numbers
- **Founding history / timeline** — the "Our Approach" section replaced a fabricated
  timeline; add real history when available
- **Curriculum & grades** — pages say generic "Primary School" / "Secondary School";
  replace with the actual boards and grade ranges offered at each branch.
  (A stray "under the Cambridge pathway" survived the first scrub on both branch
  pages and has since been removed — no board is claimed anywhere now.)
- **Affiliations** — placeholder note only
- **Photography** — striped tiles (gallery, news, hero) await real photos
- **Logos** — `assets/` still holds the logos copied from the source project;
  replace with MSC branch logos

## Before go-live
1. **Forms** are front-end only (button flips to "✓ Enquiry received").
   Point them at a real endpoint (Formspree / Google Form / CRM / email).
2. Serve over HTTPS (enable "Enforce HTTPS" in GitHub Pages once the cert issues).

_Mobile breakpoints are in place — see “Layout system” above. Verified at 390px,
768px and 1440px; no horizontal overflow on any page. Worth a pass on a real
handset once there is real content (long school names, photos) to test with._

## DNS (domain currently at Squarespace)
Keep the domain registered at Squarespace; point its DNS at GitHub Pages by
replacing Squarespace's default records with the ones GitHub documents for
[apex and `www` custom domains](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site).

## Local preview
```sh
python3 -m http.server 8899
# http://localhost:8899
```
