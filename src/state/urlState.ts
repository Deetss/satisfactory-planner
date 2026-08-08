/**
 * Keeps the address bar equal to what's on screen, so the link in it always
 * rebuilds the whole factory: plan, floors, placements and all.
 *
 * Two stores make up a plan, and neither can write the fragment on its own
 * without importing the other. So nothing inside them touches the URL: this
 * subscribes to both from outside and writes for them.
 */

import { useLayoutStore } from '../layout/layoutStore'
import { usePlannerStore } from './plannerStore'
import { consumePlanFragment, currentFragment } from './shareLink'

/** Whether there's a factory here worth putting in the address. */
const worthLinking = () =>
  Object.keys(usePlannerStore.getState().targets).length > 0 ||
  Object.keys(useLayoutStore.getState().placements).length > 0

/**
 * Writes are batched because a drag commits on every pointermove, and Safari
 * throws once replaceState is called more than 100 times in 30 seconds. One
 * write per window keeps that ceiling out of reach.
 */
const WRITE_DELAY_MS = 400

let timer: number | null = null
let lastWritten = ''

function write() {
  timer = null
  const fragment = currentFragment()
  if (fragment === lastWritten) return
  lastWritten = fragment
  window.history.replaceState(null, '', `#${fragment}`)
}

function schedule() {
  if (timer !== null) return
  timer = window.setTimeout(write, WRITE_DELAY_MS)
}

/**
 * Reads the link in the address, then starts mirroring edits back into it.
 * Subscribing only afterwards matters: the load's own commits would otherwise
 * be mistaken for edits and overwrite the link mid-import.
 */
export async function startUrlSync(): Promise<void> {
  await consumePlanFragment()

  lastWritten = window.location.hash.replace(/^#/, '')
  usePlannerStore.subscribe(schedule)
  useLayoutStore.subscribe(schedule)

  // A plan restored from this browser's own storage has to be written out now.
  // Waiting for an edit would leave the address bar empty next to a full
  // factory, and there'd be nothing to copy.
  if (!lastWritten && worthLinking()) write()

  // Pasting a link into a running app only changes the fragment, which is a
  // same-document navigation: no reload, so nothing would read it otherwise.
  window.addEventListener('hashchange', () => {
    const fragment = window.location.hash.replace(/^#/, '')
    if (fragment === lastWritten) return
    lastWritten = fragment
    void consumePlanFragment()
  })
}
