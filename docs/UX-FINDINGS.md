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
| UX-003 | first run | both | S3 | presentation | At 1440 the main pane renders one line, a `div.graph-empty` reading `Add a target item and rate to see the production graph.`, and nothing on the screen states what the tool is or what a plan is for: the only naming anywhere is the `Factory Planner` header. At 390 that line is not rendered at all, because the setup panel is the mounted pane and the graph pane never mounts, so `document.body.innerText` on the bare URL runs `Factory Planner`, `PRODUCE`, `nothing yet`, `OPTIMIZE FOR` and on to `Reset everything` with no orientation sentence anywhere in it. The phone first run therefore carries neither half of the orientation and the desktop one carries only the what to do first half. | On the bare URL with no plan, the first screen names what the tool does and what to do first, and that copy is present in `document.body.innerText` at 390 as well as at 1440. | docs/audit/before-first-run-1440.png, docs/audit/before-first-run-390.png. Replay from a cleared profile: evaluate `localStorage.clear()`, navigate to `about:blank`, then to `http://localhost:4173/` with no fragment, and read the main pane and `document.body.innerText` at each viewport. | `src/components/FactoryGraph.tsx` (the `graph-empty` line, which is the only orientation present and which 390 never mounts), `src/App.tsx` (which pane is mounted at each width) | open |
| UX-004 | first run | both | S3 | presentation | No control on the bare URL first run loads a plan the visitor did not supply. `document.body.innerText` contains no occurrence of `example` at either viewport, and the Tab walk reaches every interactive control on the surface, 16 stops at 1440 and 17 at 390, none of which loads one: the item search box, the three optimise options, the byproducts checkbox, six panel headings, `Reset everything`, and the tab strip. A visitor arriving without a share link has to already know a Satisfactory item name before anything at all appears on screen. | The bare URL first run offers one control that loads a worked plan through the existing v2 decoder, so a visitor who knows no item names reaches a populated factory in one action. | docs/audit/before-first-run-1440.png, docs/audit/before-first-run-390.png. Replay from a cleared profile: clear localStorage, load `about:blank`, open `http://localhost:4173/`, then Tab from the top of the document and read every stop. | `src/components/SetupPanel.tsx` (the Produce panel, where a load control would sit beside the picker) | open |
| UX-005 | first run | 1440 | S4 | presentation | At 1440 the tab carrying `tabs__tab--active` is `tabs__tab--setup`, and that tab computes `display: none`, so the three tabs that do render, Graph, Layout and Breakdown, all render unmarked while the graph pane is on screen. Measured on both first run situations at 1440: on the bare URL and on the DENSE_COMPACT arrival, filtering `.tabs__tab` down to those whose computed `display` is not `none` returns Graph, Layout and Breakdown with the active class on none of the three. Does not reproduce at 390, where the Setup tab renders at 98px wide and does carry the active class. | At 1440 the tab matching the rendered pane carries `tabs__tab--active`, so a visitor can read their current view off the strip. | docs/audit/before-first-run-1440.png, in which the strip renders Graph, Layout and Breakdown with none of them highlighted while the graph empty state is displayed. Replay from a cleared profile: clear localStorage, load `about:blank`, open `http://localhost:4173/` at 1440 by 900 and read the strip. | `src/App.tsx` (`mainView` falls back from `setup` to `graph` for the pane while the active class stays on the hidden `setup` tab) | open |
| UX-006 | first run | both | S3 | presentation | Eleven buttons on the first run surface carry their only explanation in a `title` attribute, which does not fire on touch. On the bare URL at both viewports: `Ore` with `Use the least weighted raw resources`, `Power` with `Draw the fewest MW`, and `Machines` with `Build the fewest machines`. On the DENSE_COMPACT arrival at both viewports, those three plus `Fit all to limits` with `Scale every target together until your resource limits bind, keeping the ratio between them`, `Even output`, `Even resources`, and five `Max` buttons all carrying `Set to the most your resource limits allow`. No SVG `title` on this surface carries an instruction: the only one in the document is react-flow's `Mini Map`. Every one of those controls is itself reachable by tap, so what is hover only here is the explanation and not the control, which is why this is not the rubric's hover only control case. | Each of those explanations is readable without a pointer hover, so its text is present in `document.body.innerText` or in an accessible description a touch user can reach. | Replay from a cleared profile at either viewport: clear localStorage, load `about:blank`, open `http://localhost:4173/` for the first three, then the DENSE_COMPACT fragment at docs/golden-fixtures.md:27 for all eleven, and read `[...document.querySelectorAll('button[title]')]`. No PNG: a still frame cannot show a tooltip that never fires. | `src/components/SetupPanel.tsx` (the optimise options and the target row `Max` buttons) | open |
| UX-007 | first run | both | S2 | presentation | The item search box shows nothing at all when it takes keyboard focus while empty, which is the state every first run visitor is in before they type. Keyboard focused and empty it computes `outline-style: none` and `border-top-color: rgb(42, 56, 70)`, the identical pair it computes blurred, and the full page render is indistinguishable from `docs/audit/before-first-run-1440.png`. The rate fields on a share link arrival behave the same way: keyboard focused while holding the value `2`, the first one computes `outline-style: none` and `border-top-color: rgb(42, 56, 70)` at 1440 and again at 390. The one state that does change is the search box with a query typed, which computes `rgb(255, 159, 28)` while focused and returns to `rgb(42, 56, 70)` when blurred, so the indicator appears only after the visitor has already guessed right. Every other keyboard focusable control on this surface computes `outline: solid 2px rgb(255, 159, 28)` when keyboard focused. | With the item search box keyboard focused and empty, and with a rate field keyboard focused, each computes either a non `none` `outline-style` or a `border-top-color` differing from its own blurred value, so a second person Tabbing through the panel can see which control holds focus at every stop. | docs/audit/UX-007-1440.png, docs/audit/UX-007-390.png, both captured with the empty search box keyboard focused. Replay from a cleared profile: clear localStorage, load `about:blank`, open `http://localhost:4173/`, press Tab twice, and read `getComputedStyle(document.activeElement).outlineStyle` and `.borderTopColor` against the same pair read before the Tab. | `src/styles.css` (`.input:focus` at :793 sets `outline: none`, which removes the global `:focus-visible` outline at :41 that every other control uses) | open |
| UX-008 | first run | both | S2 | presentation | With a query typed into the item search box one character at a time and two results rendered, `ArrowDown` moves nothing and `Enter` adds nothing: focus stays on the input, no result is marked, and the Produce summary still reads `nothing yet`. The input carries `enterkeyhint="search"`, and the results are a plain `ul.picker__results` of buttons with no `role`, no `aria-expanded` and no `aria-activedescendant` on the input, so nothing advertises the path that does work, which is Tab into the first `button.picker__result` and then Enter. Taking that path then drops focus: `document.activeElement` becomes `document.body`, the results list unmounts, and no live region announces the add, so the next Tab resumes at the rate field of the row just created and the search box is 16 further Tab presses away, or one Shift+Tab backwards. Measured at both viewports. | With results rendered, ArrowDown marks a result and Enter adds the marked one, and after an add `document.activeElement` is a named element rather than `document.body`, so a second person can add two targets in a row without leaving the keyboard or guessing. | docs/audit/UX-008-1440.png, docs/audit/UX-008-390.png. Replay from a cleared profile: clear localStorage, load `about:blank`, open `http://localhost:4173/`, Tab twice to the search box, type `iron plate`, press ArrowDown then Enter and read `.panel__summary`, then press Tab and Enter and read `document.activeElement`. | `src/components/ItemPicker.tsx` (the picker's key handling, and where focus goes once a target is added) | open |
| UX-009 | first run | both | S3 | presentation | Nothing on the first run screen says where the plan lives. On the bare URL at both viewports `document.body.innerText` contains no occurrence of `storage`, `browser`, `address bar`, `lose` or `lost`. The only copy that addresses it is a `p.panel__note` inside the `Share & save` panel, which is collapsed on arrival and reads `The address bar already holds a link to everything on screen, plan and floors both. Copy link compresses it to about half the length for sending; the file is what to use when even that is too long, or when you want it on disk.` Opening that panel on the bare URL first run offers nothing actionable either, because `Copy link` and `Export file` are both `disabled` there. On the DENSE_COMPACT arrival at both viewports the same note is still the only such copy and is still collapsed, and it never states that the plan is also held in localStorage or that clearing browser data loses it. | The first run screen states, without the visitor opening a panel, that the plan travels in the URL and that browser storage is not a durable copy of it. | docs/audit/before-first-run-1440.png, docs/audit/before-first-run-390.png. Replay from a cleared profile: clear localStorage, load `about:blank`, open `http://localhost:4173/`, read `document.body.innerText`, then click the `Share & save` heading and read its `p.panel__note` and the disabled state of its buttons. | `src/components/PlanFilePanel.tsx` (the Share & save note), `src/components/FactoryGraph.tsx` (the empty state, where a first run line would sit) | open |
| UX-010 | first run | both | S2 | presentation | On the DENSE_COMPACT arrival the five target rate fields have no accessible name. The accessibility snapshot renders each as a bare `spinbutton` carrying only its value, `2`, `2`, `5`, `1` and `2`, while the remove button beside each is correctly named, `Remove Heavy Modular Frame` and the same pattern for the other four. In the DOM all twelve `input.input--rate` in the document have `aria-label` null, `aria-labelledby` null, no `id`, no wrapping `label` and no `title`, at both viewports. The item name is rendered in a sibling above the field rather than associated with it, and the five `Max` buttons beside them are all named just `Max`, so a keyboard user in forms mode meets five unlabelled numeric fields and five identically named buttons and can only tell them apart by moving one stop further to the remove button that follows. | Each rate field carries an accessible name naming its item, so the accessibility snapshot renders it as a named `spinbutton` rather than a bare one, and the same holds for each `Max` button. | docs/audit/UX-010-1440.png, docs/audit/UX-010-390.png. Replay from a cleared profile: clear localStorage, load `about:blank`, open the DENSE_COMPACT fragment at docs/golden-fixtures.md:27, wait for the `117 machines` chip, and take an accessibility snapshot of the Produce panel. | `src/components/SetupPanel.tsx` (the target row, where the rate input and the `Max` button need names taken from the item) | open |

## Deferred (engine)

Empty. Engine caused rows move here from the table above, each naming the
`.planning/codebase/CONCERNS.md` entry it corresponds to.

Nothing routed here from plan 06-01. Contrast and motion are decided entirely
by `src/styles.css`, so both rows that plan wrote are `presentation` and neither
needed a CONCERNS.md entry.

Nothing routed here from plan 06-02 either, and that is a result rather than an
omission. All eight first run rows are `presentation`: every one of them is copy
that is absent, a focus style that does not paint, a key that is not handled, or
a name that is not set, and not one of them is the solver, the packer or the
route pathing computing something the interface then reported faithfully. The
numbers the DENSE_COMPACT arrival showed, 117 machines, 883.11 MW draw and 1
surplus, were not questioned by this plan and are not what any of these rows is
about. No CONCERNS.md entry was needed and none was added, so AUDIT-04's cross
reference is still unexercised going into 06-03.

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
| first run, bare URL | UX-003 UX-004 UX-006 UX-007 UX-008 UX-009 | UX-003 UX-004 UX-005 UX-006 UX-007 UX-008 UX-009 |
| first run, share link | UX-006 UX-007 UX-009 UX-010 | UX-005 UX-006 UX-007 UX-009 UX-010 |
| setup |  |  |
| layout |  |  |
| results |  |  |

| dimension | first run | setup | layout | results |
|---|---|---|---|---|
| keyboard reachability | UX-008 UX-010 |  |  |  |
| focus visibility and management | UX-007 UX-008 |  |  |  |
| contrast | nothing found | UX-001 | UX-001 | UX-001 |
| motion | UX-002 | UX-002 | UX-002 | UX-002 |
| pointer alternatives | UX-006 |  |  |  |

The `contrast` and `motion` rows are complete as of plan 06-01 and are not
revisited. Both dimensions are stylesheet wide, so they were measured once as a
single global pass across all four surfaces at both viewports rather than four
times per surface, and no later plan re-measures them. `nothing found` in the
first run contrast cell is a measured result: 155 text pairs were sampled at
each viewport and the only pair below AA was a disabled control, which WCAG
1.4.3 exempts outright as an inactive user interface component.

The `first run` column was filled by plan 06-02 from a Tab walk at each viewport
on each of the two AUDIT-02 situations. Every interactive control on the surface
was reached, 16 stops at 1440 and 17 at 390 on the bare URL, so nothing is
listed for being unreachable. `UX-008` appears in two dimensions on purpose: the
picker cannot be operated with the keys it advertises, which is a reachability
result, and choosing a result drops focus onto `document.body`, which is a
management one. `UX-010` sits under reachability rather than focus because a
control a keyboard user can reach but cannot identify is a reachability result,
which is the reading D-09 uses.

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
| FIRST-01 | confirmed | UX-003 | The predicted gap reproduces and is worse at the phone width. At 1440 the only orientation is the single `graph-empty` line telling the visitor what to do first; nothing states what the tool is. At 390 that line is never mounted, so there is no orientation of either kind. |
| FIRST-02 | confirmed | UX-004 | No control loads an example. `document.body.innerText` contains no occurrence of `example` at either viewport and the Tab walk reaches no such control among the 16 stops at 1440 or the 17 at 390. |
| FIRST-03 | confirmed | UX-009 | No localStorage fragility warning exists anywhere in the app. The nearest copy is the `Share & save` note about the address bar, which is collapsed on arrival, never mentions storage or loss, and sits beside two disabled buttons on the bare URL first run. |
| FIRST-04 | not reproduced | none | Read the note before citing this verdict. The predicted problem is about a link carrying placements, and the only committed fixture that opens is DENSE_COMPACT, which carries `0 placed blocks` by design, so that case was not exercised and no row claims it. What was observed at both viewports is that the arrival path selects no tab at all: the view after the DENSE_COMPACT arrival is the same `setup` default the bare URL lands on, which at 1440 renders the graph pane and at 390 renders the setup panel, and never the layout tab. That is consistent with the import path not deciding the landing tab, but a placement carrying link could still behave differently and this audit cannot say. Settling it needs a fixture with a non empty `P` array, which `npm run goldens` would have to produce. |
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
