# Add buttons for repeated widgets

Status: design, awaiting approval
Base commit: `472db02` on `youtube-media-slots`

## The problem

The editor's `+ Add / ↑ / ↓ / ✕` chrome is already generic. `decorate()` in
`editor/client/editor-client.js` walks every `[data-list]` container, stamps a menu onto each
`[data-item]` child, and inserts an Add button as the container's next sibling. Nothing in it is
specific to news or to galleries.

Only four lists opt in:

| Path | Page |
| --- | --- |
| `shared:news.acamp` | montessori-acamp.html |
| `shared:news.vidyanagar` | montessori-vidyanagar.html |
| `shared:galleries.vidyanagar` | montessori-vidyanagar.html |
| `galleryGroups.*.photos` | montessori-acamp.html |

Everything else that repeats — the event rows in News Room, the award rows, the photo grids, the
video players, the gallery categories, every content section on every subpage route — renders from
an array that a collaborator can edit the text of but can never grow or shrink. Adding an event
means asking the admin to hand-edit a 70 KB HTML file.

Three things block the obvious fix.

**The server's item contract only accepts flat objects of strings.** `validateItem` in
`editor/lib/patch.js` compares `Object.keys(item)` against a template and runs `validateText` over
every value. Every item shape in scope violates it: list rows are two-element arrays
`["Empathy", "understanding others and acting with kindness."]`, gallery rows are
`["assets/gallery/campus-1.jpg", "Campus"]`, and a subpage block is a tagged union whose variants
nest — `{embed: {src, title}}`, `{person: {src, name, title}}`.

**The collection allowlist cannot name these paths.** `requireCollection` falls back to replacing
*numeric* segments with `*`, so `pages.awards.blocks.1.list` collapses to
`pages.awards.blocks.*.list` — the route name stays literal. Covering 35 routes × 2 subpages ×
2 nested list kinds by hand is 140 declarations that must be kept in step with the content.

**A blank block renders as nothing.** Both subpage normalisers dispatch on truthiness:

```js
if (b.p) blocks.push({ isPara: true, text: b.p, p });
else if (b.h) blocks.push({ isHeading: true, text: b.h, p });
else if (b.list) …
```

A block added as `{p: ""}` matches no branch, produces no DOM, and is therefore un-editable and
un-deletable — the user would click Add and watch nothing happen.

## Scope

### In scope

| Collection | What it is | Where |
| --- | --- | --- |
| `pages.*.blocks` | a whole content section on a subpage route | both subpages, 35 routes each |
| `pages.*.blocks.*.list` | rows: Events, Awards, Clubs, Houses, Core Values, Affiliations | acamp 9 routes, vidyanagar 7 |
| `pages.*.blocks.*.gallery` | photos in a grid | acamp only — see "Vidyanagar renders no photos" |
| `galleryGroups` | a gallery *category* on the A-Camp home page | montessori-acamp.html |

The four collections that already work keep working, and pick up the new delete affordance:
`galleryGroups.*.photos` and `shared:galleries.vidyanagar` also gain the floor of one;
`shared:news.acamp` and `shared:news.vidyanagar` deliberately do not.

### Out of scope

Fixed design furniture, set once and rarely grown: `stats`, `timeline`, `schools` and `facilities`
on index.html; `academics`, `life`, `houses`, `facilities`, `steps` and `facilityChips` on the two
school pages.

`nav.menus` is excluded on different grounds. Its `key` is a link destination, not copy, and the
editor deliberately does not expose it — adding a menu entry would create an entry that points
nowhere and cannot be pointed anywhere.

The **Link block** is excluded from the block chooser for exactly that reason. `attr-spec.js`
allows `alt`, `aria-label`, `placeholder` and `title` and no others, with the stated reasoning that
a string that is harmless as alt text is not harmless as an href. A link block added in the editor
would have a permanently dead destination. That leaves **seven** kinds, not eight.

### Vidyanagar renders no photos

`vidyanagar-subpage.html` is a reduced copy of `acamp-subpage.html`. Its normaliser handles five
block kinds (`p`, `h`, `list`, `gallery`, `note`) against the A-Camp page's nine, and its gallery
branch pushes `{isGallery: true, p}` with no `images` at all. The markup behind it is a hardcoded
six-tile "photos coming soon" placeholder that never reads the `gallery` array.

So a photo added to a vidyanagar gallery block would be written to content and never displayed.

This spec takes the scope-honest option: **the chooser offers only the kinds the current page can
render**, and `pages.*.blocks.*.gallery` is wired on the A-Camp subpage only. Porting the A-Camp
gallery renderer (and the person / embed / video renderers) to the Vidyanagar subpage is a separate
piece of work — real, worth doing, and not an Add-button feature.

## Design

### 1. Recursive shape templates

`validateItem` is replaced by `validateShape(value, template, fieldPath)`, which recurses **on the
template**. Depth and breadth are therefore bounded by declarations we author; a hostile payload
cannot drive the recursion.

| Template | Accepts |
| --- | --- |
| `""` | a string, then the existing `validateText` |
| `[a, b, …]` | an array of exactly that length, elementwise |
| `{k: v, …}` | a plain object with exactly those keys, per key |
| `{"oneOf": [t1, t2, …]}` | a value matching one alternative |

`oneOf` is unambiguous: no item in this content model has `oneOf` as its only key, and the marker
is checked before the plain-object rule.

Rejection messages name the failing field path (`embed.src`, `list.0.1`) rather than the top-level
item, because a seven-way `oneOf` failure reported as "item did not match" is undebuggable.

`collections.json` gains:

```json
"galleryGroups":              { "label": "", "photos": [{ "src": "", "caption": "" }] },
"pages.*.blocks.*.list":      ["", ""],
"pages.*.blocks.*.gallery":   ["", ""],
"pages.*.blocks": { "oneOf": [
  { "p": "" },
  { "h": "" },
  { "note": "", "sub": "" },
  { "list":    [["", ""]] },
  { "gallery": [["", ""]] },
  { "person": { "src": "", "name": "", "title": "" } },
  { "embed":  { "src": "", "title": "" } }
] }
```

`{"photos": [{…}]}` and `{"list": [["", ""]]}` are exact-length array templates, which is correct:
a template is only ever matched against a **newly added** item, never against an item the user has
since grown. Every seeded collection starts with exactly one child, satisfying the floor of one
from birth — a new gallery category arrives with one photo, a new list block with one row.

The `pages.*.blocks` declaration is shared by both subpages, because `collections.json` is keyed by
content path and the two files use identical paths. The server therefore accepts all seven kinds on
either page. Restricting Vidyanagar's chooser to four is a **UI affordance**, not a security
boundary — it stops a collaborator from creating a block that page cannot draw, and nothing more.

### 2. Segment-wise wildcard matching

`requireCollection` drops the numeric-to-`*` substitution and matches the requested path against
each declared key segment by segment, where a `*` **in the declared key** matches any one segment.

The existing behaviour is a strict subset — `galleryGroups.*.photos` still matches
`galleryGroups.0.photos` — and `pages.*.blocks.*.list` now covers all 70 route/block combinations
in one line. An exact match always wins over a wildcard match, so a specific declaration can still
override a general one.

This does not weaken the allowlist. The *shape* of the path stays fixed; only the route name is
free. `addItem` still resolves the path through `getList`, so a fabricated route fails there.

### 3. Leaf rules stay in code

Shape belongs in JSON; judgement does not. `patch.js` carries a small table keyed by field path:

```js
const LEAF_RULES = {
  "embed.src": (v) => /^https:\/\/www\.youtube\.com\/embed\/[A-Za-z0-9_-]{11}$/.test(v)
    && parseVideoId(v) !== null,
};
```

Without this, an add op carrying `embed.src` writes an arbitrary string straight into an
`<iframe src>` on a published page. `validateText` blocks `<script`, which is not the relevant
threat here. The rule requires the canonical embed form and re-derives the ID through
`lib/youtube.js`'s `parseVideoId`, so nothing reaches the page that the YouTube helper cannot
positively identify.

### 4. Client templates — `editor/client/collections.js`

`onAdd`'s hardcoded `listPath.includes("galleries.")` tests are replaced by a lookup module
exposing `blankItem(listPath, kind)` and `addKindsFor(listPath, pageFile)`.

`collections.json` is deliberately 403 to the browser (`security.test.js` asserts it), so the
client cannot fetch the server's templates and must carry its own copy of the blank items. **That
is two sources of truth and it will drift.** The guard is a node test that `require`s both the
client module and `collections.json` and asserts every client blank item passes the server's
`validateShape` against its declared template. Without that test the feature has a silent failure
mode where Add succeeds locally and the whole Publish 400s.

### 5. The block chooser

A popover reusing `#ed-attr-panel`'s existing visual language — same radius, shadow, type scale and
button treatment — so it reads as the same editor rather than a third UI.

It offers **seven** kinds on the A-Camp subpage and **four** on Vidyanagar (`p`, `h`, `list`,
`note`). A-Camp's normaliser renders nine; two are withheld:

- `link`, because its href cannot be edited (see Out of scope).
- `video`, the `<video><source>` mp4 player. YouTube embeds replaced it in `6dba997`
  ("video slots switch to YouTube embeds; posterUrl retired") and no route's CONTENT carries a
  `video` block any more — the render branch is dead code kept for safety. Offering it would
  create content the project has deliberately moved away from.

Every kind seeds visible placeholder text, for the truthiness-dispatch reason above.

| Kind | Seeded as | Media picker first |
| --- | --- | --- |
| Paragraph | `{p: "Write this section here."}` | no |
| Heading | `{h: "New heading"}` | no |
| Note | `{note: "Something to highlight", sub: "A supporting line."}` | no |
| List | `{list: [["New item", "Describe it here."]]}` | no |
| Photo grid | `{gallery: [[<chosen url>, "New photo"]]}` | image |
| Person | `{person: {src: <chosen url>, name: "Name", title: "Role"}}` | image |
| Video | two blocks — see below | video |

The three media kinds open the picker **before** recording anything, because none of them can
render without a real media value: an empty `<img src="">` paints a broken image, and an empty
iframe paints a black rectangle. A cancelled picker records no op at all.

**Video adds two blocks**, an `h` heading seeded from the chosen video's title followed by the
`embed`, because that is how the videos route is authored — every player on it sits under its own
heading. This is the "if it's a widget with an article and a video, create a new full one" case.
The two blocks are appended as two `add` ops in sequence; if the second fails, the first is left in
place and the failure is reported, consistent with `doOp`'s existing apply-then-record rule.

The A-Camp gallery category (`galleryGroups`) is seeded the same way: the picker opens first, and a
new category arrives as `{label: "New category", photos: [{src: <chosen url>, caption: ""}]}`. An
empty label would render an un-clickable heading with no text to put a caret in, which is the same
failure as the blank-block problem.

**Known limitation.** A person portrait, a grid photo and a video embed carry no
`data-media-slot`, so once added they can be **removed and re-added but not swapped in place**. For
a photo or a video that is the same number of clicks either way. For a person block it also
discards the name and title typed beside the portrait. Wiring those three elements as media slots
is a small, obvious follow-up and is deliberately not bundled here — it is a media feature, not an
Add-button one.

### 6. Markup

Each subpage normaliser exposes `blocksPath` (`"pages." + route + ".blocks"`) alongside the `p`
paths it already stamps. Then:

- blocks container: `data-list="{{ blocksPath }}"`, each block root `data-item` + `position:relative`
- list block: `data-list="{{ b.p }}.list"` on the row container, `data-item` per row
- gallery block (A-Camp only): `data-list="{{ b.p }}.gallery"` on the grid, `data-item` per photo
- montessori-acamp.html: `data-list="galleryGroups"` on the group container, `data-item` per group

No new concepts reach `decorate()`; these are the same two attributes the news and gallery sections
already use.

The Add button's label comes from the same lookup module rather than `decorate()`'s current inline
`listPath.includes("galleries.")` test, so each collection names what it adds:

| Collection | Label |
| --- | --- |
| `pages.*.blocks` | `+ Add section` |
| `pages.*.blocks.*.list` | `+ Add row` |
| `pages.*.blocks.*.gallery` | `+ Add photo` |
| `galleryGroups` | `+ Add category` |
| `galleryGroups.*.photos`, `shared:galleries.*` | `+ Add photo` (unchanged) |
| `shared:news.*` | `+ Add` (unchanged) |

### 7. Delete affordance and the floor

The `.ed-menu` ✕ becomes a circled button with a red accent, matching the media overlay's existing
remove action (`.ed-slot-action[data-media-action=remove]`: `#a51915` fill, white glyph) so the two
destructive controls in the editor look like one idea.

`menuFor(listPath, index, length)` gains a `floor` argument. At `length <= floor` the button
renders **disabled with a tooltip** reading "At least one must remain — this is the last one",
rather than being hidden: a control that silently fails to appear reads as a bug, and the user
retries instead of understanding.

Floor is **1** for every collection except `shared:news.acamp` and `shared:news.vidyanagar`, which
are **0**. Both news lists ship empty (`"news": {"acamp": [], "vidyanagar": []}`) and both school
pages render a designed `newsSection.empty` line at zero posts. A floor there would let a school
add its first post and then never clear the section again, making that line unreachable.

## Error handling

Every path already exists and is reused rather than reimplemented:

- **A failed apply never reaches the draft log.** `doOp` applies to in-memory content first and
  records only on success. All new adds go through it unchanged.
- **A cancelled media picker records nothing.** The picker's cancel callback is already wired.
- **The media library is not loaded.** Existing alert, extended to the new media-backed kinds.
- **The server rejects an item.** Surfaces as a 400 at Publish with the failing field path. The
  drift-guard test in §4 is what keeps this from happening in normal use.
- **A stale index.** Unchanged: `decorate()` rebuilds all chrome from scratch on every pass rather
  than patching it, so indices can never go stale.

## Testing

**Shape validation** — tuples, nesting, `oneOf` selection, wrong key sets, wrong array lengths,
non-string leaves, `<script` in a nested leaf, and that the failure message names the field path.

**Leaf rules** — `embed.src` rejects a non-YouTube host, a `javascript:` URL, a bare video ID, a
watch URL, and a nocookie URL; accepts only the canonical embed form.

**Wildcard matching** — `pages.*.blocks.*.list` matches every real route; the existing
`galleryGroups.*.photos` still matches; an exact declaration beats a wildcard; an undeclared path
is still rejected.

**Drift guard** — every blank item in `editor/client/collections.js` validates against its
`collections.json` template.

**Rendered DOM** — render each subpage route and assert every `data-list` resolves to an array and
every `data-item` count equals that array's length. `check-paths.js` skips interpolated `{{ }}`
paths by construction, so a wrong binding inside an `sc-for` is invisible to it — this is the pass
that catches it.

**Regression** — `page-media-invariants`, `page-content-fidelity`, `list-op-equivalence`,
`security` and `check-paths` all still pass. `list-op-equivalence` matters most: it proves the
client's `applyListOp` and the server's `addItem`/`removeItem`/`moveItem` agree, and nothing here
changes either.

## Documentation

`docs/EDITING.md` gains: the block chooser and what each of the seven kinds is for; that videos are
added as a heading plus a player; that the last item of a widget cannot be deleted and why; and
that news is the one exception.

## Decisions taken

- **Scope** is content that changes over time, not fixed design furniture.
- **Block adds offer a chooser** of block kinds rather than duplicating an adjacent block.
- **The floor is one**, except news, which keeps its empty state.
- **The item contract goes recursive** rather than moving to server-side item factories or
  migrating the content to a flat shape.
- **Link is dropped** from the chooser; its href cannot be edited.
- **Vidyanagar gallery blocks are not wired**; that page has no photo renderer.
