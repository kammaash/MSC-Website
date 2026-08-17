/*
  SHARED CONTENT — facts that appear on more than one page, plus the growing
  collections (news, galleries). Loaded before support.js on every page.
  Edited by the local editor (npm run edit); hand-edits must keep valid JSON.

  site  the chrome that repeats on every school page: the tagline under each
        wordmark, the "call us" prompt above the phone, the footer motto and
        the school names. Kept here rather than in each page's own CONTENT so
        that renaming a school (or fixing a typo in the motto) is one edit
        instead of four.

  nav   the sticky menu shared by all four school pages. Only `label` is
        editable copy; `key` is the destination and is deliberately NOT
        exposed to the editor, because changing it would break a link rather
        than reword one.

        `key` is read the same way on every page:
          "#anchor"   a section on that branch's main page
          "route"     a route on that branch's detail page (…-subpage.html)
        Each page turns a key into a real href in its own renderVals(), which
        is why the two branch pages and the two subpages can share one menu
        without sharing a URL scheme. See buildMenus() in any of them.
*/
/* CONTENT:BEGIN */
window.SHARED_CONTENT = {
  "cloudName": "REPLACE_AFTER_SETUP",
  "contact": {
    "phone": "+91 XXXXX XXXXX",
    "email": "info@msceducation.net",
    "acampAddress": "A-Camp, Kurnool, Andhra Pradesh, India — full address to be added",
    "vidyanagarAddress": "Vidyanagar, Kurnool, Andhra Pradesh, India — full address to be added"
  },
  "site": {
    "tagline": "Help the child to help himself",
    "callPrompt": "Don't hesitate to call",
    "motto": "Empathy · Respect · Discipline",
    "groupName": "Montessori Schools",
    "acampName": "Montessori School, A-Camp",
    "vidyanagarName": "Montessori School, Vidyanagar",
    "acampShortName": "Montessori A-Camp",
    "vidyanagarShortName": "Montessori Vidyanagar"
  },
  "nav": {
    "menus": [
      { "label": "Home", "key": "#top", "items": [] },
      { "label": "About", "key": "#about", "items": [
        { "label": "Core Values", "key": "core-values" },
        { "label": "Founder's Message", "key": "founders-message" },
        { "label": "From Principal's Desk", "key": "principals-desk" },
        { "label": "Team Montessori", "key": "team-monte" },
        { "label": "Affiliations", "key": "affiliations" },
        { "label": "Documents", "key": "documents" }
      ] },
      { "label": "School Life", "key": "house", "items": [] },
      { "label": "Academics", "key": "#academics", "items": [
        { "label": "Pre-Primary Program", "key": "pre-primary" },
        { "label": "Primary School", "key": "primary" },
        { "label": "Secondary School", "key": "secondary" },
        { "label": "Assessment Policy", "key": "assessment" }
      ] },
      { "label": "Activities", "key": "#life", "items": [
        { "label": "School Calendar", "key": "calendar" },
        { "label": "Co-Curricular Activity", "key": "co-curricular" },
        { "label": "Physical Education", "key": "physical-education" },
        { "label": "Clubs & Societies", "key": "clubs" },
        { "label": "Events", "key": "events" }
      ] },
      { "label": "Campus & Facilities", "key": "#campus", "items": [
        { "label": "The Campus", "key": "the-campus" },
        { "label": "Classrooms", "key": "ac-classrooms" },
        { "label": "Labs", "key": "science-labs" },
        { "label": "Library", "key": "library" },
        { "label": "Swimming Pool", "key": "swimming-pool" },
        { "label": "Sports", "key": "sports-arena" },
        { "label": "Music", "key": "music" },
        { "label": "Infirmary", "key": "infirmary" }
      ] },
      { "label": "Transport", "key": "transport", "items": [] },
      { "label": "Gallery", "key": "#gallery", "items": [
        { "label": "Photo Gallery", "key": "photo-gallery" },
        { "label": "Videos", "key": "videos" }
      ] },
      { "label": "News Room", "key": "#news", "items": [
        { "label": "Events", "key": "events-news" },
        { "label": "Latest News", "key": "latest-news" },
        { "label": "Awards & Achievements", "key": "awards" },
        { "label": "Circulars & Downloads", "key": "circulars" }
      ] },
      { "label": "Admission", "key": "#admissions", "items": [
        { "label": "Admission Procedure", "key": "procedure" },
        { "label": "Admission Form", "key": "form" },
        { "label": "Brochure", "key": "brochure" },
        { "label": "School Fee", "key": "fee" }
      ] }
    ]
  },
  "news": { "acamp": [], "vidyanagar": [] },
  "galleries": { "acamp": [], "vidyanagar": [] }
};
/* CONTENT:END */
