# Canvas invariants and gesture contract

The rules the layout canvas already depends on, written down before the UX pass
restyles it. Every plan task in Phases 8, 10 and 11 that touches the canvas
cites this document.

Every file and line anchor below was re-greppped against HEAD on 2026-08-09,
the day this file was written. Where an anchor had moved since the research
that produced these tables, the current line is written here and the correction
is noted in the row. No anchor was copied forward unchecked.

## How to read the tables

Each row is a rule, the place in the code where the rule is currently kept, and
what breaks when the rule is dropped. The consequence column is the point: none
of these rules is a style preference, and each one was paid for once already.

## Canvas invariants

| # | Invariant | Anchor | What breaks |
|---|---|---|---|
| I1 | Zoom is arithmetic, never a transform. No `transform`, no `zoom` and no CSS `scale` anywhere in the canvas ancestor chain | `LayoutCanvas.tsx:156` (`const scale = BASE_SCALE * zoom`), `:183-190` (`toMetres`), `:492-499` (`toBaseMetres`), `useCanvasZoom.ts:68-78` (the re-anchor after a zoom change) | Hit testing inverts the scale off `getBoundingClientRect()`, so every drop lands off by the ratio of the two scales, and the error grows with distance from the top left. A transform ancestor also becomes the containing block for `position: fixed`, which re-parents and clips the context menu (`.menu`, `position: fixed` at `styles.css:337`, `z-index: 60` at `:338`; the research called this `.context-menu`, the class is `.menu`) |
| I2 | `.floor__content` stays a sibling of `.floor`, and nothing above it may create a stacking context | The z ladder: `.floor` 1 at `styles.css:1375`, `.tile--ghost` 2 at `:1413`, `.floor__content` 3 at `:1423`, `.floor__grab` 4 at `:1447`, `.port` 5 at `:1558`, `.compass` 6 at `:455`, `.fitting` 4 at `:402`, `.fitting--derived` 3 at `:426`. The invariant is already stated in the comment at `:1416-1420` | Lower-floor ghosts draw over active blocks, because children of the deck are trapped in the deck's stacking context and can never rise past its shadows. See the checklist below for the four elements and the seven forbidden properties |
| I3 | `pointer-events` is opt-out then opt-in | `.floor__content: none` at `styles.css:1426` with `.tile`, `.shaft` and `.floor__grab` back to `auto` at `:1429-1432`; `.routes: none` at `:1511` with `.route__hit: stroke` at `:503` over `stroke-width: 14` at `:502`; `.compass: none` at `:464`; `.fitting--derived: none` at `:438` | A decorative overlay without `pointer-events: none` swallows every drag and every pan over its area, silently and with no error. Removing the invisible 14px `.route__hit` polyline as redundant makes belts unpickable at low zoom |
| I4 | No positional transitions on `.tile`, and no `transition: all` anywhere | `continueDrag` commits on every pointermove at `LayoutCanvas.tsx:579`; `left`, `top`, `width` and `height` are inline styles recomputed from the store at `:1147-1151`. The two safe forms already present are `styles.css:272` and `:1464`, both `transform` or `opacity` on chrome that JavaScript does not position | The block trails the finger, and the drawn position disagrees with the committed metres at the moment of drop, so collision highlighting and the lane ring flicker against a position the block is not at |
| I5 | `.routes` stays `overflow: visible` | `styles.css:1510`, paired with `.layout__scroll { padding: 44px }` at `:1319` and the comment at `:1317-1318` recording why the padding exists (research cited `:1318`, the declaration is `:1319`) | External runs and port labels are amputated at the floor edge. Forbidden alongside it: `overflow: hidden` and `contain: paint` on `.floor`, `.layout__site` and `.layout__surface` |
| I6 | `min-width: 0` on the layout flex chain is load bearing | `.layout` at `styles.css:1269`, `.layout__scroll` at `:1313` | A wide floor pushes the right side of the app off screen. Recorded in CONCERNS.md under "Layout stacking and sizing invariants" |
| I7 | No `content-visibility: auto` anywhere | Zero occurrences in `styles.css` today, confirmed by grep. `Compass.tsx:56` has an SVG `<text>` and `SideView.tsx` has six more (the research said seven; there are six, and the conclusion is unaffected) | Safari does not paint SVG text inside such a subtree. `contain: layout paint` on leaves such as `.tile` and `.port` is the allowed substitute |
| I8 | No `box-shadow` and no `filter` on `.tile`, `.route`, `.port`, `.fitting` or `.shaft`. `will-change` only inside `.tile--dragging` or `.floor--moving`, never in a static rule | `will-change` appears zero times in `styles.css` today, confirmed by grep. The one existing filter is scoped to a single run at a time: `.route__group--editing .route` at `styles.css:507` with the `drop-shadow` at `:508` | Paint cost multiplies by tile count and by the wheel event rate, and the wheel handler is unthrottled (`useCanvasZoom.ts:90-96`) |
| I9 | No `backdrop-filter` in this milestone | Zero occurrences in `styles.css` today, confirmed by grep. `.compass` already demonstrates the substitute, a solid `color-mix()` at `styles.css:463` (research cited `:462`, which is the `border-radius`) | It forces a readback of everything behind the element, and panning changes that backdrop continuously |

### The I2 stacking context checklist

Four elements sit above `.floor__content` in the tree and must never create a
stacking context:

- `.floor` (`styles.css:1373`)
- `.layout__surface` (`:1334`)
- `.layout__site` (`:1346`)
- `.deck` (`:1352`)

Seven properties create one and are therefore forbidden on all four:

1. `opacity` below 1
2. `filter`
3. `backdrop-filter`
4. `transform`
5. `will-change`
6. `isolation`
7. `mix-blend-mode`

`contain` is the eighth to watch: `contain: paint` and `contain: strict` both
create one, and `contain: paint` additionally breaks I5.

## Gesture contract

| # | Rule | Anchor | What breaks |
|---|---|---|---|
| G1 | One-finger pan is native browser scroll and stays native. `touch-action: pan-x pan-y` on `.layout__scroll`, `.layout__surface` and `.floor` | `styles.css:1322`, `:1341` and `:1385`, with the comment at `:1337-1340` recording that blocking pan on the surface killed panning everywhere once already | Panning dies across the whole canvas, because the surface covers it and every touch lands there first |
| G2 | Pinch is ours, on `.layout__scroll`, through a non-passive `touchmove` | `useCanvasZoom.ts:118-124` for the handler, `:175` for the `{ passive: false }` registration among the listener block at `:173-177` | The browser takes the gesture and zooms the whole page instead of the canvas |
| G3 | Any new draggable sets `touch-action: none` on itself, never on a canvas ancestor | `.floor__grab` at `styles.css:1463`, `.tile` at `:2004`, `.elevation__floorgroup--draggable` at `:1662` | Dragging the new element pans the view instead of moving the element |
| G4 | Mouse pan is opt-in per event target through `data-pan`, matched on the target itself | `useCanvasZoom.ts:144-146`, with the reasoning at `:130-143`: React listens at its root, an ancestor of the scroll container, so a child's `stopPropagation` runs after the pan has already started | Mouse panning stops working over any new full-bleed background that forgets the attribute |
| G5 | `WRITE_DELAY_MS` has a floor of 400 | `urlState.ts:24`, with the comment at `:19-23` | Safari throws `SecurityError` after 100 `replaceState` calls in 30 seconds, mid-drag. It is a browser rate limit, not a feel knob |
| G6 | No input rule with a font size below 16px | `styles.css:782`, with the comment already present at `:781` | iOS Safari zooms the page on focus. The specific risk is a type scale introducing `--text-sm: 14px` and applying it to `.input` |
| G7 | No `100vh` and no bare `100dvh`. The `height: 100%` chain stays | Zero `vh` units in `styles.css` today, confirmed by grep. New full-height overlays use `100svh` with a `height: 100%` fallback; anything pinned uses `env(safe-area-inset-*)`, which appears once at `:158` | Modernising the existing chain is a pure regression on iOS |
| G8 | Canvas hit targets scale by a zoom-aware threshold, not by uniform enlargement | The existing pattern is `ARROW_ROOM_PX = 14` at `RouteLayer.tsx:40`, applied at `:171` against `arrow.length * scale` | Uniformly fattened handles overlap each other at low zoom and the wrong run gets picked |
| G9 | Route geometry and tone are never verified by snapshot. `.route--out` and `.route--in` stay after `.route` in source order | `styles.css:1523` (`.route`), `:1531` (`.route--out`), `:1535` (`.route--in`). Equal specificity, so last wins | A snapshot passes on broken output: CONCERNS.md records that the accessibility tree looks fine while arrows point backwards. Measure the computed `stroke` and the segment dot products instead, which is Phase 12's VER-04 |

## What this document obliges later plans to do

Two obligations, both on plans rather than on code:

1. Every canvas plan task in Phases 8, 10 and 11 cites this document by name in
   its context, so the rules are read before the restyle rather than after the
   regression.
2. A task that adds any property to `.floor`, `.layout__surface`,
   `.layout__site`, `.deck`, `.floor__content` or `.routes` answers the I2
   question explicitly in its verification step: does this property create a
   stacking context, and if it does, why is that safe here.

Phase 8 splits `src/styles.css` into `src/styles/`. That split moves most of the
CSS anchors in these tables. Phase 8 re-anchors this document as part of the
split rather than trusting the line numbers it inherits.

## Hostile floor names

A floor name arrives decoded from the share fragment. It is free text, it is
uncapped, and whoever wrote the link controls it. Nothing in Phase 5 renders a
floor name, so this is documented here rather than defended here.

It becomes a Phase 10 and Phase 11 obligation: any sized container that displays
a floor name has to survive a very long one and a name made entirely of
combining characters, without pushing the layout off screen and without
overflowing into a neighbouring control. The floor label already appears on
`.deck__label` (`styles.css:1358`), so the risk is live the moment that label is
restyled with a width the old one did not have.

## Provenance

Consolidated from `.planning/research/SUMMARY.md` "Standing Guards" and from
`.planning/phases/05-guard-rails/05-RESEARCH.md` "GUARD-06 doc content". Every
anchor was re-greppped against HEAD on 2026-08-09 before it was written down.
Four anchors had drifted and are corrected in place, each noted in its row:
the context menu class is `.menu` and not `.context-menu`, the `.layout__scroll`
padding is at `:1319`, the `.compass` `color-mix()` is at `:463`, and the
`SideView.tsx` SVG `<text>` count is six and not seven.
