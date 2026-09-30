// Example scene: every value is a function of timeline time. Add tweens to the master timeline at absolute seconds.
FILM.scene(1, { build({ tl, FILM }) {
  const root = FILM.el('<div class="scene" id="s01"></div>'); FILM.visible(root, 0, 3);
  const title = FILM.el('<div class="abs display" style="left:120px;top:300px;font-size:260px">Project name</div>', root);
  FILM.ruleSet({ x: 120, y: 620, w: 900, h: 12 }, 0);                 // the carried rule sits under the title at frame 0
  tl.from(title, { x: -240, opacity: 0, duration: 1.0, ease: 'expo.out' }, 0.1);
  tl.to(FILM.rule, { width: 1600, duration: 1.6, ease: 'power3.inOut' }, 0.6);
} });
