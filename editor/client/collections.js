(function (exports) {
  "use strict";
  // What each repeatable collection is, what its Add button says, what a brand-new
  // item looks like, and how many items must remain. This is the client's ONLY copy
  // of the blank-item shapes: collections.json is deliberately 403 to the browser
  // (security.test.js), so the server's templates cannot be fetched. Two sources of
  // truth WILL drift — editor/test/collections-client.test.js is the guard: every
  // shape built here must pass lib/patch.js's validateShape against the declared
  // template, or Add would succeed locally and the whole Publish would 400.
  //
  // Deliberately data-only: no DOM, no EditorMedia/EditorMediaUrls calls. Media
  // values are passed IN as {id, url, title} by the caller (editor-client.js), which
  // is what lets node tests require() this file with no browser at all.

  var BLOCKS_RE = /^(pages\.[^.]+|fallback)\.blocks$/;
  var ROWS_RE = /^(pages\.[^.]+|fallback)\.blocks\.\d+\.list$/;
  var BLOCK_GALLERY_RE = /^(pages\.[^.]+|fallback)\.blocks\.\d+\.gallery$/;
  var GROUP_PHOTOS_RE = /^galleryGroups\.\d+\.photos$/;

  function family(listPath) {
    if (BLOCKS_RE.test(listPath)) return "blocks";
    if (ROWS_RE.test(listPath)) return "rows";
    if (BLOCK_GALLERY_RE.test(listPath)) return "blockGallery";
    if (listPath === "galleryGroups") return "galleryGroups";
    if (GROUP_PHOTOS_RE.test(listPath)) return "groupPhotos";
    if (listPath.indexOf("galleries.") !== -1) return "sharedGallery";
    // The news lists, and the safe default for anything not recognised — exactly
    // the item onAdd built for every non-gallery list before this module existed.
    return "news";
  }

  var LABELS = {
    blocks: "+ Add section",
    rows: "+ Add row",
    blockGallery: "+ Add photo",
    galleryGroups: "+ Add category",
    groupPhotos: "+ Add photo",
    sharedGallery: "+ Add photo",
    news: "+ Add",
  };
  function addLabel(listPath) { return LABELS[family(listPath)]; }

  // The delete floor. 1 everywhere except news: both news lists ship empty and both
  // school pages render a designed newsSection.empty line at zero posts — a floor
  // there would make that line unreachable after the first post.
  function floorFor(listPath) { return family(listPath) === "news" ? 0 : 1; }

  // Which media the Add flow must pick BEFORE an item can exist. An empty
  // <img src=""> paints a broken image and an empty iframe a black rectangle, so
  // these families open the picker first and a cancelled pick records no op at all.
  var MEDIA_FIRST = { blockGallery: "image", galleryGroups: "image", groupPhotos: "image", sharedGallery: "image" };
  function mediaFor(listPath) { return MEDIA_FIRST[family(listPath)] || null; }

  // The block chooser's menu. Seven of the eight kinds both subpages render: link is
  // withheld because attr-spec.js (rightly) refuses href edits, so a link block added
  // here would have a permanently dead destination.
  function blockKinds() {
    return [
      { kind: "p", label: "Paragraph", media: null },
      { kind: "h", label: "Heading", media: null },
      { kind: "note", label: "Note", media: null },
      { kind: "list", label: "List", media: null },
      { kind: "gallery", label: "Photo grid", media: "image" },
      { kind: "person", label: "Person", media: "image" },
      { kind: "video", label: "Video", media: "video" },
    ];
  }

  // media = {id, url, title} from the picker, or null for text-only shapes.
  // Every seeded string is VISIBLE placeholder text on purpose: the subpage
  // normalisers dispatch on truthiness, so a block added as {p: ""} would match no
  // branch, produce no DOM, and be un-editable and un-deletable.
  function blankItem(listPath, kind, media) {
    switch (family(listPath)) {
      case "news": return { date: new Date().toISOString().slice(0, 10), title: "New post", body: "Write the announcement here." };
      case "sharedGallery": return { kind: "image", id: media.id, caption: "" };
      case "groupPhotos": return { src: media.url, caption: "" };
      case "galleryGroups": return { label: "New category", photos: [{ src: media.url, caption: "" }] };
      case "rows": return ["New item", "Describe it here."];
      case "blockGallery": return [media.url, "New photo"];
      case "blocks": break; // fall through to the kind switch below
    }
    switch (kind) {
      case "p": return { p: "Write this section here." };
      case "h": return { h: "New heading" };
      case "note": return { note: "Something to highlight", sub: "A supporting line." };
      case "list": return { list: [["New item", "Describe it here."]] };
      case "gallery": return { gallery: [[media.url, "New photo"]] };
      case "person": return { person: { src: media.url, name: "Name", title: "Role" } };
      case "video":
        // TWO blocks — a heading seeded from the video's title, then the player —
        // because that is how the videos routes are authored: every player sits
        // under its own heading. The src is the CANONICAL embed form lib/patch.js's
        // embed.src leaf rule demands (NOT media-urls' nocookie player URL, which is
        // for media SLOTS; the existing subpage embeds all use this form).
        return [
          { h: media.title || "New video" },
          { embed: { src: "https://www.youtube.com/embed/" + media.id, title: media.title || "YouTube video" } },
        ];
      default: throw new Error("No blank item for " + listPath + " kind " + kind);
    }
  }

  Object.assign(exports, { family, addLabel, floorFor, mediaFor, blockKinds, blankItem });
})(typeof module !== "undefined" ? module.exports : (window.EditorCollections = {}));
