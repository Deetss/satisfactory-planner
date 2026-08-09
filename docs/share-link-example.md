# Share link example

A verified example link for the README, and the fixture Phase 4 re-checks against the live site under DEPL-04.

Everything here was produced by driving the running app and reading the address bar. No part of the fragment was written or edited by hand.

## The example plan

| Field | Value |
|---|---|
| Target | Iron Plate |
| Rate | 120 per minute |
| Tech tier | 8 (the default) |
| Objective | least ore (the default) |
| Alternate recipes | none enabled (the default) |
| Layout | none, one empty Ground floor at 12 by 12 foundations |

Kept deliberately small. This link sits inline in the README where a reader can see the whole thing, and a plan carrying floors and placements runs to several hundred characters.

## The fragment

```
#2.eyJ2IjoyLCJ0Ijp7Iklyb25QbGF0ZSI6MTIwfSwibyI6MCwiciI6OCwieiI6OCwiQSI6MCwiRiI6W1siR3JvdW5kIiwxMiwxMiwwLDAsMF1dLCJQIjpbXX0
```

Length: 122 characters including the leading `#`.

It is the plain `2.` form, not the deflated `2z.` form. The plain form is base64url of the plan code text, so the same plan always produces the same characters and anyone can regenerate this example and compare it against what is written here. The deflated form that the Copy link button produces depends on the browser's compression implementation, which makes it unsuitable for writing down. Copy link exists for sending a large plan, not for documenting one.

Decoded, the fragment is:

```json
{"v":2,"t":{"IronPlate":120},"o":0,"r":8,"z":8,"A":0,"F":[["Ground",12,12,0,0,0]],"P":[]}
```

## The full link

```
https://deetss.github.io/satisfactory-planner/#2.eyJ2IjoyLCJ0Ijp7Iklyb25QbGF0ZSI6MTIwfSwibyI6MCwiciI6OCwieiI6OCwiQSI6MCwiRiI6W1siR3JvdW5kIiwxMiwxMiwwLDAsMF1dLCJQIjpbXX0
```

## What opening it must reproduce

Opening the link in a browser with no stored plan must produce all three of these:

1. The success banner reading `Opened Iron Plate from a link: 1 floor, 0 placed blocks.` The failure banner starts with `That link didn't open.` and carries the `banner--bad` class, so the two are distinguishable in the DOM as well as on screen.
2. The Produce panel showing Iron Plate at 120 per minute.
3. The header settling on **12 machines** and **48 MW draw**.

A link that raises the banner but restores nothing has not round tripped. All three were observed together, from a browser with `localStorage` cleared, before this file was written.

## Why the link is written against the deploy origin

The fragment carries the whole plan. `readFragment` in `src/state/shareLink.ts` decodes from the fragment alone and never reads the host, so the origin in front of the `#` is irrelevant to whether the plan decodes. That is what makes it sound to verify a fragment against `http://localhost:5173/` and write it down against the Pages URL.

The Pages URL is used because that is what a reader will actually click, and it is already fixed by DEPL-03. Phase 4's DEPL-04 is the check that this exact link works against the real origin once the site exists.

## Provenance

Read out of `window.location.hash` after the batched write in `src/state/urlState.ts` fired, which happens 400 ms after the last edit with no button pressed. Verified by loading the fragment in a browser with cleared storage and observing the three results above.
