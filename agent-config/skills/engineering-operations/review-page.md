# Operator review page

Phaedrus decides from his phone, often remotely, often in a spare moment. A
review page is a designed artifact, not a document. It uses world-class design
engineering, with colour, images and interaction, so he gets the gist at a
glance and can drill down when it is worth it. Everything he needs to decide
well is on the page.

The first screen (phone 390x844 and laptop 1280x640) holds only:
- a clear title and the artifact's ID;
- the point in one sentence, marked `data-review="point"`;
- each ask as one plain question with its choices as options, your
  recommendation marked and what each choice changes, marked
  `data-review="ask"`; when nothing is asked, one `data-review="no-ask"` line;
- what this is and why it needs him now, for someone who has forgotten the
  context;
- any context you need from him.

Progressive disclosure means layers that show rather than text that hides.
Use a diagram, a before and after, a live demo, or a comparison he can toggle,
then the evidence with sources. Walls of text behind accordions do not count.
Name the session and engineer that produced the page. Design with the product's
DESIGN.md and Claude designers, and use Mobbin for references. Move superseded
rounds to the archive.

Before the page is shared, run `review-check --screenshot first.png PAGE.html`.
It loads the page in real headless Chromium and exits 1 naming each layout,
clipping or density failure: a missing or hidden point or ask, or a block or
screen that is too dense. Fix the page, not the check. Then look at the saved
first screen as he would: is the decision obvious in five seconds?
`--viewport WxH` changes the window; a page without the markers passes
`--point SELECTOR --ask SELECTOR`.
