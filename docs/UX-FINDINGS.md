# UX findings

The findings register for milestone v1.1, written before the audit that fills
it so that severity cannot be back fitted to justify work someone already
wanted to do.

This header was committed with the table empty. No finding existed when it was
written, which is the whole point of it existing.

## Purpose and boundary

This file is the only machine referenceable record of the v1.1 UX audit. Phase 6
drives the live site and appends one row per finding as it goes. Phases 10 and
11 cite finding ids in their plan tasks, so a fix is traceable to the
observation that asked for it. Phase 12 prints this file with every row in a
final state and checks it against VER-08. Nothing else is the record: a finding
that lives only in a plan, a summary or a commit message is not a finding.

Machine referenceable here means stable ids and a fixed column order, not a
parser. There is no schema file and no validator. What makes this file usable
by a later phase is that `UX-014` means one thing forever and that the columns
never move, so grep and git diff both work on it, and a human can still edit it
by hand in the middle of an audit session.

## Severity: S1 to S4

One scale, four values.

**S1, blocked or silently wrong.** On the stated viewport, the user cannot
complete a core task, or completes it and is silently handed the wrong result.

**S2, completable but at real cost.** The task can be finished, but only through
a guess, a detour or a retry.

**S3, friction with an obvious workaround.** Slower or more annoying than it
should be, and the way around it is discoverable without help.

**S4, cosmetic and consistency.** Nothing about task completion. Alignment,
spacing, wording, an inconsistent control.

S1 is deliberately worded as a claim about task completion rather than a claim
about quality. "The user cannot complete a core task" is checkable by a second
person on the stated viewport: they either finish or they do not. "This is
confusing" is not, and a scale whose top value is a taste claim is a scale whose
top value can be argued into place after the fact. Phase 12's milestone gate
bites on S1, so S1 has to be the value that is hardest to award by preference.

### Accessibility and touch use this same scale

There is no parallel accessibility scale and nothing to translate. An
accessibility or touch finding is judged from the position of a user who depends
on that input mode, and it takes the severity that position supports.

The worked case: a control reachable only by hover is S1 on touch. A touch user
cannot complete the task at all, which is exactly the situation a missing button
would create, so it gets the value a missing button would get. Judged from a
mouse it would look like S3 friction, and judging it from the mouse is the
mistake this rule exists to prevent.

## Cause: presentation, engine, mixed

Every row carries a cause.

**presentation.** The engine computes the right answer and the interface
presents it badly. Fixable inside v1.1 scope.

**engine.** The interface faithfully presents what the solver, the packer or the
route pathing computed, and what they computed is the problem. Out of scope for
v1.1 by the milestone's own boundary.

**mixed.** Both, and the presentation half is separable and worth doing alone.

An engine caused row moves to a Deferred (engine) section at the bottom of this
file, and that row names the entry in `.planning/codebase/CONCERNS.md` it
corresponds to. If no CONCERNS.md entry covers it, the row's move is what
creates one. This is AUDIT-04, and the cross reference is the point: an engine
finding that is only recorded here disappears when the milestone closes.

## The column contract

The columns are locked in this order and are not reordered, renamed or added to
once Phase 6 writes its first row:

- **id.** The finding's permanent identifier. See the id rule below.
- **surface.** Which of the four audited surfaces: first run, setup, layout, or
  results. One value, not a list.
- **viewport.** Where it was observed. `390` for the phone width, `1440` for
  desktop, or `both` when it was reproduced on each.
- **severity.** `S1`, `S2`, `S3` or `S4`, per the rubric above.
- **cause.** `presentation`, `engine` or `mixed`, per the taxonomy above.
- **observed.** What the app did. Behaviour, never an adjective.
- **expected.** What it should have done instead. Behaviour, never an adjective.
- **evidence.** How to see it again: the screenshot filename, the share link, or
  the exact click sequence from a cleared profile.
- **touches.** The files or components a fix would land in, as far as the audit
  can tell. A guess is allowed here and is not binding on the fix.
- **state.** One of the four values in the state vocabulary below.

**observed** and **expected** are behaviour and never adjectives. "The header
reads 0 machines while the Produce panel lists Iron Plate at 120 per minute" is
behaviour. "The header is confusing" is an adjective, and a second person cannot
check it.

The consequence is a rule with teeth: an S1 or S2 whose **expected** a second
person could not verify is S4 until it can be written. Severity is earned by
writing a checkable expectation, not by feeling strongly.

## The id rule

Ids are flat and sequential: `UX-001`, `UX-002`, `UX-003`, upward, assigned in
the order the audit finds them. Ids are never renumbered and never reused. A
rejected finding keeps its id and its row, so the numbering carries gaps, and a
gap is information rather than a mistake.

Flat rather than surface prefixed because requirement ids already occupy
`EDIT-`, `RES-`, `PICK-` and `MOB-`, and a surface prefixed finding scheme would
collide with them head on. `UX-` cannot collide with anything. A Phase 11 task
citing `UX-014` stays unambiguous for the life of the repo.

## The state vocabulary

Four values: `open`, `fixed`, `deferred`, `rejected`.

A row carries `open` from the moment Phase 6 writes it. `fixed` means a later
phase changed the behaviour and the finding no longer reproduces. `deferred`
means it is real, it is accepted, and it is not being done in this milestone.
`rejected` means it is not a finding after all, with the reason written into the
row rather than the row being deleted.

Four rather than three, because with only `fixed`, `deferred` and `rejected` a
freshly written finding has no legal state, and VER-08 then cannot tell an
untriaged row from a row where someone forgot to fill the column. With `open`
present, VER-08 reads as "no S1 remains open", which is checkable by grep.

## The rubric is frozen once the first row is written

From the moment Phase 6 appends its first finding, this header is closed to
edits. After that point, a severity that does not fit the rubric is a finding
about the rubric, recorded in this file as prose beneath this section, and not a
reason to reword the rubric. The same applies to the cause taxonomy, the column
order and the state vocabulary.

That is the guard the whole file exists for. A rubric that can be edited while
findings are being scored is not a rubric.

## Findings

| id | surface | viewport | severity | cause | observed | expected | evidence | touches | state |
|---|---|---|---|---|---|---|---|---|---|
| UX-001 | setup | both | S3 | presentation | The remove control's glyph paints `--bad` #d1566b on `--panel-2` #1c2733 at 14px weight 400, a measured WCAG 2.x ratio of 3.787 against the 4.5 AA minimum for normal text. Every instance comes from the single `.btn--danger` rule, so one token change closes all of them. Sampled instances: 5 on setup at 1440 and 5 at 390, 14 on layout at 1440 and 10 on results at 1440, the last two including the setup sidebar that stays on screen at desktop. The control is not rendered on layout or results at 390. | The remove glyph measures at least 4.5 against `--panel-2` when `getComputedStyle` is read in the running page, so `perf/contrast.perf.ts` reports that pair as pass rather than fail. #df6f86 measures 4.869 on the same background and keeps the hue, which is one way to reach it and not the only one. | docs/audit/UX-001-1440.png, docs/audit/UX-001-390.png. Replay from a cleared profile: clear localStorage, load about:blank, then open the DENSE_COMPACT fragment from docs/golden-fixtures.md:27 and read the five Produce rows. Measured by `npx playwright test perf/contrast.perf.ts`, pair P02 of the inventory below. | `src/styles.css` (`--bad` at :root, and `.btn--danger`) | open |
| UX-002 | first run | both | S4 | presentation | With `prefers-reduced-motion: reduce` emulated and `matchMedia('(prefers-reduced-motion: reduce)').matches` read back as true inside the page, every transition still runs its full duration. Elements still carrying a non zero duration under the preference: 19 on first run, 44 on setup, 224 on layout and 116 on results at 1440, and 19, 44, 16 and 28 at 390. `src/styles.css` contains no `@media (prefers-reduced-motion: reduce)` block at all, which is the mechanism. Exposure is 120 ms colour transitions on `.btn`, `.input`, `.select` and `.segmented__option`, plus `.panel__head::after`, the only sampled property that moves rather than recolours: it rotates 45deg to -135deg over 120 ms, at 7 instances on first run, 7 on setup, 28 on layout and 14 on results at 1440. The stylesheet declares no `@keyframes` and no sampled element carries a non zero `animation-duration`. | With the preference set, `perf/contrast.perf.ts` reports zero elements on a property that moves rather than recolours, so `.panel__head::after` reaches its rotated state within one frame instead of over 120 ms. | `npx playwright test perf/contrast.perf.ts` at both viewports, which prints the matched value beside the count, and `grep -c 'prefers-reduced-motion' src/styles.css` returning 0. No PNG: a still frame cannot show a duration. | `src/styles.css` (a new `@media (prefers-reduced-motion: reduce)` block; no existing rule is edited) | open |

## Deferred (engine)

Empty. Engine caused rows move here from the table above, each naming the
`.planning/codebase/CONCERNS.md` entry it corresponds to.

Nothing routed here from plan 06-01. Contrast and motion are decided entirely
by `src/styles.css`, so both rows that plan wrote are `presentation` and neither
needed a CONCERNS.md entry.

## Coverage matrix

The audit's stopping rule. The audit is finished when every cell below records a
result, and "nothing found here" is a result. Cells are ticked as the audit
proceeds rather than at the end, so an interrupted session shows exactly where
it stopped.

A cell holds either a space separated list of `UX-` ids or the literal text
`nothing found`. A blank cell means not yet audited and never means audited and
clean. That distinction is the whole value of the table: a falsely ticked cell
is the one failure a stopping rule cannot catch, so a cell is only filled once
that surface and viewport were actually driven from a cleared profile.

The first table is the surface situations by viewport, with first run split into
the two situations AUDIT-02 names. The second is the accessibility cross cut on
top of them.

| situation | 390 | 1440 |
|---|---|---|
| first run, bare URL |  |  |
| first run, share link |  |  |
| setup |  |  |
| layout |  |  |
| results |  |  |

| dimension | first run | setup | layout | results |
|---|---|---|---|---|
| keyboard reachability |  |  |  |  |
| focus visibility and management |  |  |  |  |
| contrast | nothing found | UX-001 | UX-001 | UX-001 |
| motion | UX-002 | UX-002 | UX-002 | UX-002 |
| pointer alternatives |  |  |  |  |

The `contrast` and `motion` rows are complete as of plan 06-01 and are not
revisited. Both dimensions are stylesheet wide, so they were measured once as a
single global pass across all four surfaces at both viewports rather than four
times per surface, and no later plan re-measures them. `nothing found` in the
first run contrast cell is a measured result: 155 text pairs were sampled at
each viewport and the only pair below AA was a disabled control, which WCAG
1.4.3 exempts outright as an inactive user interface component.

## Predicted requirement verdicts

The 27 UX requirements in `.planning/REQUIREMENTS.md` were written from research
rather than from observation, so each one is confirmed or falsified against the
running app and the answer is recorded here. The falsification half is the point:
a requirement the audit cannot reproduce deletes Phase 10 or Phase 11 work before
anyone plans it. Silence is not an option, because a later reader cannot tell
silence from not audited.

Three legal verdicts. `confirmed` means it reproduces and a finding row carries
it. `not reproduced` means the surface was driven and the predicted problem did
not occur. `not an app behaviour` means the requirement is a process criterion
rather than something the running app can be observed to do.

The mapping is deliberately many to many, since one finding can serve two
requirements and one requirement can need two findings. That is why it lives
here rather than in the `touches` column, which a many to many mapping would
corrupt. It lives in `docs/` rather than in a plan because `.gitignore:16`
excludes `.planning/`, so a table written into a plan would never enter git
history and Phase 12 could not cite it.

Verdicts are filled by the surface plans that drive each requirement, and plan
06-06 closes the section. A blank verdict means not yet driven.

| requirement | verdict | finding ids | note |
|---|---|---|---|
| PICK-01 |  |  |  |
| PICK-02 |  |  |  |
| PICK-03 |  |  |  |
| PICK-04 |  |  |  |
| PICK-05 |  |  |  |
| PICK-06 |  |  |  |
| RES-01 |  |  |  |
| RES-02 |  |  |  |
| RES-03 |  |  |  |
| RES-04 |  |  |  |
| FIRST-01 |  |  |  |
| FIRST-02 |  |  |  |
| FIRST-03 |  |  |  |
| FIRST-04 |  |  |  |
| EDIT-01 |  |  |  |
| EDIT-02 |  |  |  |
| EDIT-03 |  |  |  |
| EDIT-04 |  |  |  |
| EDIT-05 |  |  |  |
| EDIT-06 |  |  |  |
| EDIT-07 |  |  |  |
| EDIT-08 |  |  |  |
| EDIT-09 |  |  |  |
| EDIT-10 |  |  |  |
| MOB-01 |  |  |  |
| MOB-02 |  |  |  |
| MOB-03 |  |  |  |

## Contrast and motion inventory

Every text colour pair the app renders, deduplicated by colour pair rather than
by element, measured once by `perf/contrast.perf.ts` and recorded here so
Phase 8 does not re-derive it. This is TOK-06's contrast floor: a token change
moves a pair, and the forty elements sharing one pair are one piece of work
rather than forty.

Two viewports, both recorded because a ratio without the viewport it was read at
is not reproducible. Desktop is 1440 by 900, matching `playwright.config.ts` so
these numbers sit beside the perf baseline's. Phone is 390 by 664 from
`devices['iPhone 14']` at deviceScaleFactor 3. The height is written down rather
than left implicit because MOB-01's "controls and results co-visible" reading is
a claim about the height and not about the width, so a later reader needs to
know which 390 this was.

How the numbers were produced. Foreground is the computed `color`, or the
computed `fill` inside the SVG namespace, since SVG text is painted by `fill`
and reading `color` there would report inherited ink the user never sees.
Background is the first ancestor painting a non transparent background,
composited down through any translucent layer above it, except for SVG text
sitting on a filled sibling shape, where that shape is the backdrop. Element
opacity is folded into the foreground as alpha. The WCAG 2.x formula is then
applied to the resulting opaque sRGB pair.

`exempt` in a verdict column means the pair belongs to a disabled control. WCAG
1.4.3 places no contrast requirement on text that is part of an inactive user
interface component, so such a pair is measured and listed but is not a failure
and did not become a finding row. This app dims a disabled control to opacity
0.45, which is what lands P01 at 3.592.

| pair | surface | foreground | background | font | ratio | AA normal | AA large |
|---|---|---|---|---|---|---|---|
| P01 `button.btn`, `button.btn.btn--icon` (disabled) | first run, layout | rgb(115, 125, 135) | rgb(28, 39, 51) | 14px/400 | 3.592 | exempt | exempt |
| P02 `button.btn.btn--icon.btn--danger` | setup, layout, results | rgb(209, 86, 107) | rgb(28, 39, 51) | 14px/400 | 3.787 | fail | pass |
| P03 `button.segmented__option`, `div.fnode__subtitle` | first run, setup, layout, results | rgb(143, 160, 176) | rgb(28, 39, 51) | 14px/400, 10px/400, 11px/400 | 5.639 | pass | pass |
| P04 `button.segmented__option--active` | first run, setup, layout, results | rgb(255, 159, 28) | rgb(58, 55, 48) | 14px/600 | 5.816 | pass | pass |
| P05 `span.btn__key` | layout | rgb(221, 159, 72) | rgb(51, 46, 38) | 11px/400 | 5.874 | pass | pass |
| P06 `button.tabs__tab` | first run, setup, layout, results | rgb(143, 160, 176) | rgb(21, 29, 39) | 14px/400, 11px/500, 11px/600, 12px/400 | 6.325 | pass | pass |
| P07 `span.icon--fallback` blue | setup, layout, results | rgb(127, 179, 213) | rgb(27, 43, 56) | 9px/700 | 6.425 | pass | pass |
| P08 `span.icon--fallback` orange | setup, layout, results | rgb(213, 161, 127) | rgb(51, 38, 25) | 9px/700 | 6.448 | pass | pass |
| P09 svg `text.compass__mark` | layout | rgb(143, 160, 176) | rgb(19, 26, 36) | 6.5px/400 | 6.494 | pass | pass |
| P10 `button.btn--icon.btn--active` | layout | rgb(255, 159, 28) | rgb(51, 46, 38) | 14px/400 | 6.558 | pass | pass |
| P11 `button.banner__close` | setup, layout, results | rgb(161, 172, 175) | rgb(22, 40, 29) | 12px/400 | 6.686 | pass | pass |
| P12 `span.chip--warn`, `div.fnode__power` | setup, layout, results | rgb(217, 164, 65) | rgb(28, 39, 51) | 12px/400, 11px/400 | 6.730 | pass | pass |
| P13 `span.icon--fallback` violet | setup, results | rgb(199, 158, 213) | rgb(43, 31, 51) | 9px/700 | 6.892 | pass | pass |
| P14 `span.panel__summary`, `small` | first run, setup, layout, results | rgb(143, 160, 176) | rgb(13, 18, 24) | 12px/400, 14px/400, 11px/400, 12px/700, 13px/400 | 7.005 | pass | pass |
| P15 svg `text.elevation__height` | layout | rgb(143, 160, 176) | rgb(10, 15, 20) | 9px/400 | 7.168 | pass | pass |
| P16 `button.tabs__tab--active` | first run, setup, layout, results | rgb(255, 159, 28) | rgb(28, 39, 51) | 14px/400 | 7.372 | pass | pass |
| P17 `button.btn--active` | layout | rgb(255, 159, 28) | rgb(44, 36, 25) | 14px/400 | 7.416 | pass | pass |
| P18 `span.icon--fallback` green | setup, layout, results | rgb(158, 207, 143) | rgb(31, 46, 28) | 9px/700 | 8.033 | pass | pass |
| P19 `button.btn--primary` | layout | rgb(20, 32, 43) | rgb(255, 159, 28) | 14px/600 | 8.046 | pass | pass |
| P20 `span.icon--fallback` teal | setup, layout, results | rgb(127, 213, 196) | rgb(25, 48, 44) | 9px/700 | 8.142 | pass | pass |
| P21 `span.app__title` | first run, setup, layout, results | rgb(255, 159, 28) | rgb(21, 29, 39) | 15px/600 | 8.269 | pass | pass |
| P22 `span.warn` | layout | rgb(217, 164, 65) | rgb(13, 18, 24) | 12px/400 | 8.360 | pass | pass |
| P23 `span.icon--fallback` yellow | setup, layout, results | rgb(213, 203, 127) | rgb(48, 45, 25) | 9px/700 | 8.368 | pass | pass |
| P24 svg `text.compass__mark--n` | layout | rgb(255, 159, 28) | rgb(19, 26, 36) | 6.5px/600 | 8.490 | pass | pass |
| P25 `span.badge` | layout | rgb(221, 229, 237) | rgb(36, 49, 64) | 11px/600 | 10.391 | pass | pass |
| P26 svg `text.react-flow__edge-text` | setup, results | rgb(200, 210, 220) | rgb(19, 26, 34) | 10px/400 | 11.437 | pass | pass |
| P27 `span.chip`, `button.btn` | first run, setup, layout, results | rgb(221, 229, 237) | rgb(28, 39, 51) | 12px/400, 14px/400, 12px/600, 11px/400 | 11.897 | pass | pass |
| P28 `span` on the banner | setup, layout, results | rgb(221, 229, 237) | rgb(22, 40, 29) | 12px/400 | 12.177 | pass | pass |
| P29 `span.panel__title`, `span` | first run, setup, layout, results | rgb(221, 229, 237) | rgb(13, 18, 24) | 12px/600, 14px/400, 14px/500, 13px/400 | 14.779 | pass | pass |
| P30 svg `text.elevation__floor` | layout | rgb(221, 229, 237) | rgb(10, 15, 20) | 11px/400 | 15.124 | pass | pass |

Thirty pairs, one failure and one exemption. The SVG text `@axe-core/playwright`
would have skipped is P09, P15, P24, P26 and P30, which is the measured reason
the phase declined axe rather than an argument about it.

The motion half of the pass produced no table, because there is nothing to
deduplicate: every non zero duration in the app is 120 ms, and the only property
sampled that moves rather than recolours is `.panel__head::after`. Both facts are
recorded in UX-002 with their per surface counts.
