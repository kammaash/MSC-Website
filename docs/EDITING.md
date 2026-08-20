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
3. **News:** open a school page and use "+ Add" under News. **Photos:** open Media → Photos, upload once, then click or drag the photo onto an outlined photo area. **Videos:** upload in YouTube Studio as **Unlisted**, then open Media → Videos → Add YouTube video and paste its Share link. The editor verifies the video before adding it.
4. ↑ ↓ reorder items; ✕ deletes (asks first) — except on a widget's very last item,
   where ✕ is disabled so the list can't end up empty (unless the widget has a designed
   empty state; see below).
5. Press **Publish**. The live site updates in about a minute. **Discard** throws away unsaved changes.

### Adding, reordering and removing sections, rows and photos
Every repeating thing on the two subpages — the content sections themselves, the rows
inside a list, the photos in a grid — and the gallery categories on the A-Camp page
carry the same **+ Add**, **↑**, **↓**, **✕** controls the news cards have always had.

**+ Add section** opens a chooser of seven kinds:
- **Paragraph**, **Heading**, **Note** — plain text, added with placeholder copy you
  click and overwrite.
- **List** — a row of bold term plus description; each row is separately editable, and
  its own **+ Add row** button underneath adds more.
- **Photo grid**, **Person** and **Video** all open the media library first — pick a
  photo, a portrait, or a video, and the block arrives already filled in. Cancel the
  picker and nothing gets added.
  - **Photo grid** arrives holding the photo you picked; **+ Add photo** under the grid
    adds more.
  - **Person** arrives with the portrait already in place; click the name and role
    afterward to fill them in.
  - **Video** opens the media library's Videos tab and adds **two** blocks together — a
    heading seeded from the video's title, and the player underneath it — because
    that's how the video pages are built. If you ever remove one, remove both.

One limitation worth knowing: a portrait, a grid photo or a video added this way has no
outline to click for swapping it later, unlike the photo areas that were already on the
page. To change one, delete the block and add a fresh one instead.

**Deleting the last one.** Delete rows one at a time and ✕ eventually runs out: on the
last remaining item it turns grey, with a tooltip explaining why — "At least one must
remain — this is the last one." That's deliberate — a list, a photo grid or a gallery
category should never be left with literally nothing to show. To empty a photo grid
completely, go up a level instead: delete the whole gallery *section* (it has its own
✕), and add a fresh one whenever you have photos again.

**The rule: does the page have a "nothing here yet" message for it?** News and the
Vidyanagar gallery both do — a school really might have no announcements some weeks,
or no gallery photos yet, and each page already shows a designed line for that:
"News and announcements coming soon." for News, and "Photos and videos coming soon."
for the gallery. So their ✕ keeps working even on the last item, clearing the widget
back to that message. Every other widget has no such line designed for it, so it always
keeps at least one item.

### Some text is shared — one edit changes it everywhere
A few things are stored once and reused, so they can never drift apart or contradict each other:

- **The big menu** is shared by the four school pages — A-Camp and Vidyanagar, and the detail
  pages behind each of them. Rename "Admission" on A-Camp and it is renamed on all four. (The
  front landing page has its own short menu of its own sections; that one is page-local.)
- **The school names, the phone number and the email address** are shared by every page that
  shows them, the landing page included.
- **The tagline "Help the child to help himself" and the "Don't hesitate to call" line** sit in
  the header of the four school pages and are shared between them.
- **The footer motto** is shared by the two school home pages. The landing page keeps its own
  wording, which orders the three words differently — that was already true and was left as it is.

Everything else — headings, paragraphs, buttons, section titles, the footer link columns — belongs
to the page you are on, so editing it there affects only that page.

### Words that open a small box instead of editing in place
Three kinds of writing can't have a cursor put in them — there is nothing on the page to click
into. Hovering each one still outlines it and shows a label; clicking opens a small panel with the
wording in a box. Change it, press **Save** (or Enter), then **Publish** as usual. **Cancel**,
Escape, or clicking anywhere else on the page closes the panel without saving.

- **The grey hint inside an empty form box** ("Parent / student name", "Phone number", "Message
  (optional)"). Click the box itself.
- **The choices in the admissions drop-down.** Click the drop-down: it will not open its list
  while you are editing — you get the panel of choices instead.
  - On the **A-Camp** page all four choices are edited here.
  - On the **landing page** and the **Vidyanagar** page the first choices are the school /
    programme names taken straight from the cards higher up that page, so they are edited *there*
    and the panel shows them greyed out. Rename the card and the drop-down follows by itself.
- **A photo's description** — the sentence screen readers read aloud and search engines index,
  which nobody sees on screen. Logos: hover the logo and click. Big photos that can be swapped
  (the picture at the top of each page): hover the photo and use the **✎ Describe** button that
  appears beside **Replace** and **Remove**.
  - Photos in a gallery have no separate description: they use their own caption, which you edit
    by clicking the caption itself.

### One thing still can't be edited
**The page name that appears in the browser tab**, and the one-line summary Google shows beneath
a search result. These live outside the part of the page the editor can reach. They are stored
with everything else, so the admin can change them in a few minutes — just ask. Nothing else on
the site needs a developer.

### Important: the editor only works one way
Editing mode only appears when the site is opened through `npm run edit`. If you open one of the
website's `.html` files directly, or the site is served any other way, you will see the ordinary
public site with no editing controls at all — no outlines, no "+ Add", nothing. That is
deliberate: the version of the site that actually goes live carries no editing code in it at all,
so there is nothing for a website visitor to ever click on or discover.

### Edit in one tab at a time
If the site is already open in another browser tab or window (yours or someone else's),
close it before you start editing. The editor doesn't check what's already on the page
before saving, so a second tab can silently overwrite or delete a change the first one just
made.

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
- **“YouTube could not be reached”** — the editor deliberately added nothing because it could
  not verify that the public page would get a working player. Check the internet connection and
  try again. Never paste a video file into Photos; videos stay on YouTube.
