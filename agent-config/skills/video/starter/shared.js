// Shared film library. Everything animated is a pure function of timeline time.
(function () {
  const BPM = 96, BEAT = 60 / BPM; // 0.625 s
  const FPS_SRC = 30;
  const tl = gsap.timeline({ paused: true, defaults: { overwrite: false } });
  const FILM = { W: 1920, H: 1080, BPM, BEAT, tl, scenes: {}, clips: [], duration: 80,
    beat: (n) => +(n * BEAT).toFixed(4),
    // Exact rectangles where the carried rule must be at each act boundary.
    HAND: {
      start:  { x: 120, y: 800, w: 980, h: 12 },  // under the wordmark (scene 1)
      b1:     { x: 120, y: 214, w: 1680, h: 12 }, // Act 1 -> 2: top edge of the Admin page (scene 9 start)
      b2:     { x: 0,   y: 1068, w: 1920, h: 12, opacity: 0.22 }, // Act 2 -> 3: empty track at the bottom; it stays there, unfilled, through Act 3 and scene 23
      end:    { x: 620, y: 690, w: 680, h: 12 },  // scene 25: under the Tach wordmark on the end card (filled: Tach measures)
    },
  };
  // --- footage clips: src frame = f(t), linear between keys [[t, srcSeconds], ...]; clamps outside.
  FILM.clip = function (img, seq, keys) { FILM.clips.push({ img, seq, keys, last: -1 }); return img; };
  FILM.srcTime = (keys, t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, s0] = keys[i - 1], [t1, s1] = keys[i]; return s0 + (s1 - s0) * (t - t0) / (t1 - t0); }
    return keys[keys.length - 1][1];
  };
  FILM.sync = function (t) {
    const pending = [];
    for (const c of FILM.clips) {
      const info = FILM.index[c.seq]; const s = FILM.srcTime(c.keys, t) - info.t0;
      const f = Math.max(1, Math.round(s * FPS_SRC) + 1);
      if (f !== c.last) { c.last = f; c.img.src = `footage/${c.seq}/${String(f).padStart(5, '0')}.jpg`; }
      pending.push(c.img.decode ? c.img.decode().catch(() => {}) : Promise.resolve());
    }
    return Promise.all(pending);
  };
  // --- rule: the persistent actor. place(rect) sets exact geometry; tween with FILM.ruleTo.
  FILM.rule = null;
  FILM.ruleSet = (r, at = 0) => tl.set(FILM.rule, { x: r.x, y: r.y, width: r.w, height: r.h, scaleX: 1, opacity: r.opacity ?? 1 }, at);
  FILM.ruleTo = (r, at, dur, ease = 'expo.inOut') => tl.to(FILM.rule, { x: r.x, y: r.y, width: r.w, height: r.h, opacity: r.opacity ?? 1, duration: dur, ease }, at);
  // --- scene registry. build(ctx) adds tweens to the master timeline at absolute seconds.
  FILM.scene = function (n, def) { FILM.scenes[n] = def; };
  FILM.el = function (html, parent) { const d = document.createElement('div'); d.innerHTML = html.trim(); const e = d.firstChild; (parent || document.getElementById('stage')).appendChild(e); return e; };
  FILM.visible = function (el, from, to) { tl.set(el, { display: 'block' }, from); tl.set(el, { display: 'none' }, to); };
  FILM.img = function (parent, cls, style) { const i = document.createElement('img'); i.className = cls || ''; if (style) Object.assign(i.style, style); parent.appendChild(i); return i; };
  // Footage pane: a bordered pane with an img inside. Returns {pane, img}.
  // opts.crop = {x,y,w,h} in SOURCE pixels (terminal panes are 760x960, dashboards 1160x960); the pane shows exactly that
  // region scaled to rect.w (rect.h should equal crop.h * rect.w / crop.w). No crop = whole pane stretched to rect.
  FILM.pane = function (parent, seq, keys, rect, opts = {}) {
    const p = FILM.el(`<div class="pane" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px"></div>`, parent);
    const img = FILM.img(p); FILM.clip(img, seq, keys);
    if (opts.crop) { const c = opts.crop, k = rect.w / c.w, info = FILM.index[seq];
      Object.assign(img.style, { width: info.w * k + 'px', height: info.h * k + 'px', left: -c.x * k + 'px', top: -c.y * k + 'px' }); }
    return { pane: p, img };
  };
  // Deterministic typing: reveals text[0..n] in el.textContent between at and at+dur (plain text only).
  FILM.typeText = function (el, text, at, dur, ease = 'none') {
    const o = { n: 0 }; el.textContent = '';
    tl.to(o, { n: text.length, duration: dur, ease, onUpdate: () => { el.textContent = text.slice(0, Math.round(o.n)); } }, at);
    return el;
  };
  window.FILM = FILM;
  // --- render hooks
  window.__ready = (async () => {
    FILM.index = await (await fetch('footage/index.json')).json();
    await document.fonts.ready;
    await Promise.all(['700 100px "Barlow Condensed"', '600 100px "Barlow Condensed"', '400 20px "IBM Plex Sans"', '700 20px "IBM Plex Sans"', '400 20px "IBM Plex Mono"', '500 20px "IBM Plex Mono"'].map((f) => document.fonts.load(f)));
    return true;
  })();
  window.__seek = async (t) => {
    tl.time(t, false);
    const s = document.getElementById('stage'); s.style.display = 'none'; s.getBoundingClientRect(); s.style.display = ''; // full repaint: removes raster-history noise
    await FILM.sync(t); return true; };
})();
