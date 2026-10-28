# Motion

Misty Step rewrite of [Emil Kowalski's skills](https://github.com/emilkowalski/skills/tree/2d228630ba1446365f614a108cb8252f1feda202/skills),
not the upstream text or its persona. Source-to-home map and licenses: [sources.md](sources.md).

## Decide before implementing

1. **Gate.** Name the purpose (feedback, orientation, state change or explanation)
   and frequency. Keyboard shortcuts and hundred-times-a-day actions stay instant;
   frequent interactions get minimal motion. Reserve expressive motion for rare
   moments where it helps the task. Keep data still while users read or act on it.
   No surviving purpose is a valid reason to remove motion or suggest none.
2. **Reuse.** Extend existing motion tokens. CSS transitions suit retargetable state
   changes; CSS animation suits fixed sequences; WAAPI adds playback control.
   Use an existing motion library for gesture springs, shared layout or exit
   coordination only when those capabilities are needed.
3. **Tune.** Enter/exit: ease-out; movement between on-screen positions: ease-in-out;
   continuous progress: linear. Existing tokens win. Without tokens, starting
   curves are `cubic-bezier(0.23, 1, 0.32, 1)` for ease-out and
   `cubic-bezier(0.77, 0, 0.175, 1)` for ease-in-out. Starting durations: press
   feedback 100–160ms, tooltip/popover 125–200ms, dropdown 150–250ms. Keep ordinary
   UI below 300ms; explain any exception on the real interaction. These are
   starting points, not proof that the result feels right.
4. **Connect.** An anchored surface scales from its trigger; a centered modal
   stays centered. Use a small scale change with opacity rather than starting
   from zero. Retarget from the current position on repeated input; gesture
   springs carry velocity on reversal. Dismiss toward the originating edge.
   Stagger only when it aids comprehension and never delays interaction.
5. **Include.** Honor reduced motion with a quieter or instant state change;
   preserve necessary feedback. Gate decorative hover motion with
   `(hover: hover) and (pointer: fine)`. Gestures handle cancellation, lost pointer
   capture and additional touches without leaving a stuck state. A drag has a
   keyboard-operable alternative.
6. **Observe.** Run at normal speed, then slow playback and inspect frames for
   discontinuities. Interrupt and reverse midway, trigger rapidly, change content,
   then repeat with reduced motion. Screenshots show endpoints, not motion quality;
   retain a recording or frame/performance trace for a motion claim.

## Performance diagnosis

Record the symptom before changing properties or layers. Profile the animation
while navigation/loading work occurs and with realistic content on the target
browser/device. The budget is about 16.7ms at 60Hz and 8.3ms at 120Hz.

Prefer `transform` and `opacity`, with explicit transition properties. They can
avoid layout/paint; compositing still depends on browser, content and driver.
A transform is not a replacement for layout when it would distort text or leave
incorrect flow. Measure unavoidable height/layout changes rather than hiding them.

Check in order: layout/paint cost; main-thread long tasks; per-frame framework
state updates; inherited CSS variables invalidating descendants; large blur,
shadow or layer areas. CSS/WAAPI can hand eligible motion to the compositor;
`requestAnimationFrame` competes on the main thread. Library shorthand behavior
is version-dependent: verify its actual driver instead of assuming acceleration.
Add targeted, temporary `will-change` only for an observed promotion/paint issue;
remove it when idle. A desktop throttle is not proof of phone GPU performance.

## Review and opportunities

For existing motion, prefer removal, then reduction, then correcting timing,
origin and interruption before adding effects. Inventory scoped elements with
purpose, frequency, driver and properties; prioritize findings by user impact.
For an audit or plan-only request, return that inventory, evidence and exact
changes without implementing. When seeking opportunities, inspect feedback gaps,
jarring state swaps and lost spatial relationships; propose only candidates
that pass the gate above. Zero suggestions can be the right result.

## Vocabulary

Use the precise term; distinguish adjacent effects instead of prescribing one.

| Term | Meaning / distinction |
| --- | --- |
| Crossfade / morph | Opacity swap between objects / continuous change of shape. |
| Shared-element transition / layout animation | One recognizable element persists across views / geometry changes within a layout. |
| Origin-aware transition | An anchored surface grows from its trigger. |
| Reveal / mask | Expose content through a clipping boundary / through an opacity mask, which can have soft edges. |
| Stagger / orchestration | Offset repeated items / coordinate distinct motions. |
| Spring / easing | Velocity-aware physical response / a time-to-progress curve. |
| Damping / stiffness / mass | Dissipation / restoring force / inertia of a spring. |
| Rubber-banding / momentum | Increasing resistance beyond a boundary / continued movement after release. |
| Scroll-driven / scroll reveal | Progress follows scroll position / crossing a threshold starts an entrance. |
| Interruptibility | New input redirects motion from its current state. |
| Layout thrashing | Interleaved layout writes and reads force repeated synchronous layout; not a synonym for every layout animation. |
| Jank | A visible discontinuity; a trace is needed to identify missed deadlines and their cause. |
