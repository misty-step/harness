# Operator review page

The reader has a laptop and no time for a book. The first screen alone, with no
scrolling, gives the point and every ask. Detail sits behind a click; never
delete evidence to make room.

The first screen (1280x640) holds only:
- the point in one sentence, marked `data-review="point"`;
- each ask as its own short line (what, then the choice), marked
  `data-review="ask"`; when nothing is asked, one `data-review="no-ask"` line;
- short blocks: none over 35 words, about 300 words in all.

Everything else folds into `<details>` whose summary says what is inside (why,
change detail, findings, evidence with sources, method). Link each ask to its
detail by anchor.

Before the page is shared, run `review-check PAGE.html`. It loads the page in
real headless Chromium and exits 1 naming each failure: a missing or hidden
point or ask, a block or screen too dense. Fix the page, not the check.
`--screenshot first.png` saves what it saw; `--viewport WxH` changes the window;
a page without the markers passes `--point SELECTOR --ask SELECTOR`.
