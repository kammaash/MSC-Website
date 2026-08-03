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

## Design
Both branch pages use the same layout/structure and the same red palette:
`#a51915` primary · `#7f120f` dark · `#e8541b` orange accent · `#ffd9c4` peach ·
warm greys (`#26201d`, `#4a423c`, `#6b615b`, `#fbf3f2`).

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
  replace with the actual boards and grade ranges offered at each branch
- **Affiliations** — placeholder note only
- **Photography** — striped tiles (gallery, news, hero) await real photos
- **Logos** — `assets/` still holds the logos copied from the source project;
  replace with MSC branch logos

## Before go-live
1. **Forms** are front-end only (button flips to "✓ Enquiry received").
   Point them at a real endpoint (Formspree / Google Form / CRM / email).
2. **Mobile** — layout is desktop-first (~1240–1280px grids). Test on phones and
   add breakpoints as a fast follow.
3. Serve over HTTPS (enable "Enforce HTTPS" in GitHub Pages once the cert issues).

## DNS (domain currently at Squarespace)
Keep the domain registered at Squarespace; change only the DNS records:
- Delete Squarespace's default A records and their `www` CNAME.
- `CNAME`: `www` → `kammaash.github.io`
- Apex `A` records for `msceducation.net`:
  `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`

## Local preview
```sh
python3 -m http.server 8899
# http://localhost:8899
```
