# Edit-Mode Media Slots — Design

**Approved:** 2026-08-15 (in chat), after the media library drawer shipped.

> **Amended 2026-08-15 by `2026-08-15-youtube-video-hosting-design.md`:** videos are
> now YouTube-hosted (paste-link, unlisted), not Cloudinary. Everything here about
> *video* delivery URLs, `posterUrl`, `data-media-poster` on video slots, and the
> `<video>`/`load()` handling is superseded; image and slot-mechanics decisions
> stand. The implementation plan for the remaining work is
> `docs/superpowers/plans/2026-08-15-youtube-videos-and-media-slots.md`.

## Goal

When the site is in edit mode: (1) the custom pen/dot cursor gets out of the way,
(2) every *designated* media component is selectable — click it to change its
photo/video from the media library, or drag a library tile onto it — and (3) media
can only ever land in those designated slots, so the site's structure and styling
cannot be affected by any editing action.

## Decisions

- **Cursor:** while `editing` is true, `window.MonteCursor.apply("Native")` — `apply`,
  never `set`, so the visitor-facing localStorage preference is untouched. Exit/Resume
  toggles it back. Pages without cursor.js are unaffected.
- **Slot contract:** an element opts in with `data-media-slot="<content path>"` +
  `data-media-kind="image"|"video"` (+ optional `data-media-poster="<content path>"`
  for videos). The path names a plain string URL value in CONTENT (or `shared:` content).
  Placing media *only* writes that string — a drop can never create or move elements.
  Logos and feature icons carry no annotation and are untouchable by construction.
- **Scope (this iteration):** the three main pages — index.html (hero portrait),
  montessori-acamp.html (hero photo, founder photo, showcase video, gallery photos),
  montessori-vidyanagar.html (hero photo, showcase video). The two subpages keep the
  same mechanism available for a follow-up (their block mappings need per-item path
  stamping first) — explicit non-goal now.
- **URL convention** (matches montessori-vidyanagar.html's existing gallery mapping):
  image delivery `https://res.cloudinary.com/<cloud>/image/upload/f_auto,q_auto,w_1600/<id>`,
  video delivery `<cdn>/video/upload/q_auto/<id>.mp4`,
  poster `<cdn>/video/upload/so_0,f_jpg,q_auto,w_800/<id>.jpg`. One authority:
  `editor/lib/media-urls.js` (UMD like paths.js, unit-tested in node, servable via the
  lib allowlist).
- **Empty slots:** the CONTENT value is `""`. Image templates map `""` to the existing
  1×1 transparent GIF data URI in their computed vals (no visual change on the live
  site); the vidyanagar showcase video gets `src="{{ showcaseVideo }}"` with `""`
  (renders the same empty black box as today). In edit mode, a slot whose value is
  `""` gets a dashed outline so it reads as "drop media here".
- **Select → change:** in edit mode slots get a hover outline; click selects (persistent
  outline) and opens the drawer on the matching tab in pick mode; clicking a tile applies
  it. **Drag:** drawer tiles are draggable; dragstart highlights every kind-matching slot
  (`body.ed-dragging-<kind>` + CSS); drop applies; drops anywhere else are inert. The
  dataTransfer payload (custom type `application/x-msc-media-<kind>`) carries
  `{record, cloudName}` as JSON.
- **Apply = the existing pipeline:** `applyLocal(path, url)` then `draft.set(path, url)`
  (apply-first invariant, same as text edits), poster path too if present, then
  `rerender()` + `update()`. Saves and publishes ride /api/save and /api/publish
  unchanged. After applying to a video slot, call `load()` on the re-rendered element.
- **check-paths** learns `data-media-slot` / `data-media-poster`: every static
  (non-interpolated) slot path must resolve to a string, same discipline as `data-edit`.

## New/changed interfaces

- `editor/lib/media-urls.js` → `{ deliveryUrl(cloudName, record), posterUrl(cloudName, record) }`
  (UMD: `window.EditorMediaUrls` / module.exports).
- `editor-client.js` adds to `window.EditorUI`: `getLocal(path)` (read mirror of
  `applyLocal`) — apiFetch/describeApiError already exported.
- `media.js` exposes `window.EditorMedia = { openPicker(kind, onPick) }`; tiles get
  `draggable` + dataTransfer payload; pick mode banner with cancel.
- New `editor/client/media-slots.js`: hover/click selection, empty-slot marking,
  drop targets, `applyToSlot(el, record, cloudName)`. Injected last; bails without
  `window.EditorUI`.

## Testing

TDD throughout. Unit tests for media-urls; source-level tests (existing house style)
for the cursor toggle, picker/drag wiring, slot module invariants (no bare fetch, no
innerHTML with record data, apply-before-record); check-paths test for a bad slot path;
injection-order tests updated; full suite + live editor smoke at the end.
