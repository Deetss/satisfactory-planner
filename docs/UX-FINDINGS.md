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

## Deferred (engine)

Empty. Engine caused rows move here from the table above, each naming the
`.planning/codebase/CONCERNS.md` entry it corresponds to.
