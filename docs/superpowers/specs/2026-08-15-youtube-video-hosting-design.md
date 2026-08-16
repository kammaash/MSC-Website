# YouTube-Hosted Videos — Design

**Approved:** 2026-08-15 (in chat). Amends `2026-08-15-edit-mode-media-slots-design.md`
(video-related decisions only; everything image/slot-mechanical there stands).

## Goal

All site videos are hosted on the school's YouTube channel; Cloudinary carries images
only. ~30 GB of video never touches git, Cloudinary quota, or any upload pipeline the
editor has to run.

## The constraint that shaped this

Google locks videos uploaded via the YouTube Data API (`videos.insert`) from
**unaudited API projects to private**, with no appeal until a compliance audit passes
(support.google.com/youtube/answer/7300965) — a private video cannot be embedded, so
an automated in-editor upload would produce unplayable videos. `editor/lib/youtube.js`
already documents this. Uploading through **YouTube Studio** has no such restriction.

## Decisions

- **Upload flow:** a human uploads the video in YouTube Studio, sets it **Unlisted**,
  copies the link, and pastes it into the editor's media drawer (Videos tab → "Add
  YouTube link"). No Google API credentials, no secrets, no quota, no size limits.
  Automated API upload stays off; the code keeps a comment recording why, so the
  audit route can be revisited deliberately.
- **Record schema (`media.json`):** no new fields. `kind` is the provider:
  `kind:"image"` → `id` is a Cloudinary public_id; `kind:"video"` → `id` is the
  11-character YouTube video ID (`/^[A-Za-z0-9_-]{11}$/`, enforced by
  `validateRecord`). `media.json` is empty today — no migration.
- **Link validation and insertion:** `POST /api/youtube/add { url }`. The server
  parses the ID out of any common URL form (`watch?v=`, `youtu.be/`, `shorts/`,
  `embed/`, `live/`, bare ID, schemeless), then calls YouTube's keyless **oEmbed**
  endpoint server-side (global `fetch`, 5s timeout, injectable for tests). On success
  the server constructs and persists the video record in the same request. oEmbed 4xx
  (private / deleted / embedding disabled) → **422** with a plain-language fix. A
  network failure or malformed oEmbed response fails closed with no library write;
  this prevents an unverified/broken player from reaching the public site.
- **URL authority:** `editor/lib/media-urls.js` (UMD) derives every delivery URL from
  a record: images Cloudinary (`f_auto,q_auto,w_1600`), videos
  `https://www.youtube-nocookie.com/embed/<id>?rel=0` (privacy-enhanced host; `rel=0`
  keeps end-screen suggestions to the same channel; `modestbranding` is defunct and
  omitted). Video thumbnails: `https://i.ytimg.com/vi/<id>/mqdefault.jpg` (works for
  unlisted). No `posterUrl` — YouTube provides its own poster frame.
- **Site rendering:** showcase video slots on both school pages become `<iframe>`
  slots (`data-media-kind="video"`, 16:9, `allowfullscreen`); an empty `""` value maps
  to `about:blank` in renderVals (an empty `src=""` iframe would recursively load the
  page itself). `data-media-poster` is dropped for video slots. The vidyanagar
  gallery's `isVideo` branch renders an iframe from the item's YouTube ID. Public
  pages build embed URLs inline in their own renderVals (they cannot load editor
  libs) — same accepted duplication as the existing Cloudinary shapes.
- **Resume-playback is removed:** the localStorage playback-position feature on both
  showcase videos dies with the `<video>` element (a plain iframe can't support it;
  the IFrame API is not worth a third-party script). `videoRef` plumbing goes too.
- **Galleries are photo-only for adds:** the inline gallery upload (`__edUpload`)
  accepts `image/*` only and rejects a non-image Cloudinary response. Existing
  `kind:"video"` gallery rendering stays (now YouTube-ID-based) for hand-authored
  items; an add-video-to-gallery flow is an explicit non-goal.
- **Delete stays library-only:** removing a video record unlists it from the drawer
  and the next publish; the video itself stays on the channel (same semantics as
  Cloudinary images).
- **Config:** the dead `"youtube": { "enabled": false }` key leaves
  `editor/config.json`; the paste-link flow needs no configuration.

## Security / privacy notes

- `/api/youtube/add` sits behind the uniform `/api/*` guard (origin, token,
  content-type). Its outbound fetch goes only to `www.youtube.com/oembed` with a
  regex-validated ID — no SSRF surface, and the editor token never leaves the machine.
- Unlisted ≠ access control: anyone with the link can watch, and the IDs are visible
  in the site's HTML. Acceptable for a school's promotional content; documented so
  nobody mistakes it for restriction.

## Testing

House style: `node --test`, zero dependencies. Unit tests for `youtube.js` parsing
(every URL form + rejects) and `media-db` video-ID validation; `/api/youtube/add`
via real HTTP against `createServer` with a stubbed `oembedFetch` (success / 4xx /
network-fail / bad body); source-level tests for the drawer link flow and `__edUpload`
image-only restriction; the media-slots plan's own tests continue to cover slot
mechanics.

## Implementation

`docs/superpowers/plans/2026-08-15-youtube-videos-and-media-slots.md` — rebased onto
the media-slots plan's shipped Tasks 1–5 (`aecda7d`…`5b08da0`: cursor, Cloudinary-era
media-urls, check-paths, pick mode, media-slots client). It converts the shipped video
machinery to YouTube and **supersedes the old plan's remaining page-migration tasks**.
