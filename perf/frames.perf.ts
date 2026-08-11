/**
 * The GUARD-07 perf instrument: a throttled frame time baseline for the dense
 * fixture, recorded to `perf/baseline.json`.
 *
 * Five things a reader needs before changing anything here.
 *
 * 1. This file is never run by `npm test` and never by CI. Its `.perf.ts`
 *    suffix matches neither vitest's default include nor Playwright's default
 *    testMatch, and `playwright.config.ts` pins testMatch to that suffix. That
 *    is a correctness rule: vitest 4 excludes only `node_modules` and `.git`,
 *    so a `.spec.ts` here would be collected by `npm test` and take the Pages
 *    deploy down with it.
 * 2. It is run locally, by hand, with `npm run perf`, and `npm run build` must
 *    have been run first, because Playwright's webServer starts
 *    `npm run preview` and `vite preview` serves `dist/` rather than building
 *    it.
 * 3. `@playwright/test` is pinned to an exact version rather than a caret,
 *    alone among this repo's dependencies. The bundled Chromium moves with the
 *    package version, so a caret would let `npm update` change the browser
 *    under a baseline that reads as unchanged, silently invalidating the 20
 *    percent gate. JSON cannot carry a comment, which is why the reason for
 *    that one divergence lives here.
 * 4. A change to either arrange button's label breaks this script, deliberately
 *    and loudly. `arrangeLabel` throws rather than recording a zero, because a
 *    zero would enter the baseline as an improvement.
 * 5. `zoomP95Ms` is bounded below by driver round trip latency and is not
 *    comparable to `dragP95Ms`. The batched drive that would make it comparable
 *    was written twice and withdrawn twice, the second time after the
 *    application defect it first tripped had been fixed and the sweep still
 *    arrived short. `sweep` carries both measurements and what they leave;
 *    read it before reading a zoom number out of the baseline.
 *
 * This file is outside `tsconfig.json`'s include, matching the `scripts/`
 * precedent for node tooling, so `tsc --noEmit` never reads it and it is proven
 * by being run rather than by being typechecked.
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { test, type Browser, type Locator, type Page } from '@playwright/test'
import { DENSE_COMPACT } from '../test/fixtures/plans'

/**
 * 4x, which is PITFALLS.md's rate for this exact baseline and the conventional
 * desktop to midrange mobile stand in. 6x is available and harsher, but the
 * throttle works by making the renderer sleep, so heavier throttling multiplies
 * scheduler jitter, and on WSL2 that jitter is what the 20 percent band was
 * widened to absorb.
 */
const THROTTLE = { rate: 4 }

/**
 * Forty pointer moves, so forty store commits and forty re-renders of the two
 * large components that both subscribe to the layout store without a selector.
 * That fan out is the load being measured, not the pixel distance.
 */
const DRAG = { steps: 40 }

/**
 * `useCanvasZoom.ts:104` applies `Math.exp(-deltaY * 0.0015)` per wheel event
 * and clamps to [0.25, 4]. Sweeping the full range needs the sum of `-deltaY *
 * 0.0015` to reach `ln(16) = 2.7726`, so a total deltaY of 1848.4. Sixty events
 * of 30.8 lands on it exactly, and sixty is a plausible trackpad flick. The
 * count is part of the baseline's identity: Phase 12 must use the same one or
 * the p95 is not comparable, which is why it is written into the JSON.
 *
 * `drive` is how those sixty are delivered, and it is the identity too, because
 * it turned out to matter more than the count. See `sweep`.
 */
const WHEEL = {
  events: 60,
  delta: 30.8,
  drive:
    'one awaited driver round trip per event, then drained to a stop before ' +
    'any read. Driver latency bound, so NOT comparable to dragP95Ms. ' +
    'Batching all sixty is what would make it comparable, and it has been ' +
    'tried twice and cannot deliver its full sweep: the browser appears to ' +
    'coalesce the synthetic wheel events on the way in. See the sweep docblock.',
}

/**
 * The identity of the gestures this file drives, bumped when a drive changes
 * and not only when a constant does.
 *
 * Phase 12 reads this before it reads a p95: a baseline recorded at another
 * version is not comparable and wants a re-record rather than a diff. A
 * baseline carrying no `version` at all predates the field, which means version
 * 1, whose zoom numbers came off an unsettled sweep with nothing behind them.
 *
 * Two versions have ever been recorded and they are not comparable to each
 * other. A third was written and withdrawn, so the number is spent.
 *
 * 1. Awaited drive, one driver round trip per wheel event, and the surface read
 *    as soon as the last of them resolved. Nothing checked that the sweep had
 *    moved the zoom at all, so the 16.7 to 16.8 ms every run recorded (1/60 s
 *    to three digits) could as easily have been a sampler on an idle page as a
 *    measurement of one. Three runs exist at this version, the last of them at
 *    `e4b81b7`.
 * 2. Awaited drive still, and the version this file is at. What version 2 added
 *    is that every read is taken after the page has been waited to a stop, and
 *    that the sweep has to demonstrably reach the 4x clamp or the run fails, so
 *    the measured window spans the whole drain. The sweep is therefore proven
 *    to have happened, but its p95 is still bounded below by a round trip per
 *    event and is not a number about the app. One baseline exists at this
 *    version, `47e9467`, and it is the committed one.
 * 3. Batched drive, twice attempted and twice withdrawn, most recently at a
 *    fixed application. Nothing was ever recorded at version 3 and nothing
 *    should be: a batch cannot deliver its full sweep, because the browser
 *    coalesces the synthetic wheel events on the way in and the deltas of the
 *    merged ones do not arrive. That is a property of how this harness injects
 *    input rather than of the application, so no change under `src/` reaches
 *    it. `sweep` carries both measurements. Reviving a batched drive means
 *    solving the coalescing first and calling the result version 4.
 *
 * `dragP95Ms` and `arrangeMs` are unaffected by any of these changes but share
 * the version, because a version per metric is a version nobody checks.
 */
const GESTURE_VERSION = 2

/** Best of three per metric, so ordinary scheduling noise cannot set the bar. */
const RUNS = 3

/** Preferred first. `All floors` only exists when the plan has more than one floor. */
const ARRANGE_LABELS = ['All floors', 'This floor']

/**
 * The fewest frames a recorded p95 may be computed from.
 *
 * Three, which is far under what a nearest-rank p95 wants, and deliberately so.
 * The drag blocks the main thread in roughly 900 ms chunks, which starves the
 * rAF sampler, so a small sample there is the signal rather than a fault, and a
 * bar set at the textbook twenty would refuse to record the gesture this
 * baseline most wants recorded. The narrower job this constant has is to stop a
 * sample that is not a measurement from becoming a number: an empty sample used
 * to yield 0, and `best` is a `Math.min` across runs, so one degenerate run sets
 * the bar for all three and a zero reads as a perfect score. Every sample size
 * is written into the baseline beside its p95, so the bar can be raised later
 * against real counts rather than against a guess.
 */
const MIN_SAMPLES = 3

interface Metrics {
  zoomP95Ms: number
  dragP95Ms: number
  arrangeMs: number
}

/**
 * A run also carries how many frames each p95 was computed from, because a p95
 * over a handful of frames is a maximum wearing a percentile's name and the
 * number alone does not say which it is.
 */
interface Run extends Metrics {
  dragFrames: number
  zoomFrames: number
}

/**
 * The 95th percentile, never the median. The median hides exactly the tail that
 * reads as stutter, which is the thing this baseline exists to catch.
 *
 * Throws rather than falling back to a zero, for the reason point 4 of the
 * header gives for `arrangeLabel`. `best` is a `Math.min`, so a zero from one
 * degenerate run is not outvoted by the two honest ones, it becomes the
 * recorded best, and Phase 12's 20 percent band against a zero either divides
 * by zero or calls every real measurement an infinite regression.
 */
function p95(frames: number[], gesture: string): number {
  if (frames.length < MIN_SAMPLES) {
    throw new Error(
      `The ${gesture} sampled ${frames.length} frames, fewer than the ` +
        `${MIN_SAMPLES} a percentile needs. That is not a fast gesture, it is a ` +
        'gesture that did not run, and a number taken from it would enter the ' +
        'baseline as an improvement.',
    )
  }
  const sorted = [...frames].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!
}

/**
 * The installed version, not the range in `package.json`. A drifted lockfile
 * would otherwise report the pin it broke.
 */
function playwrightVersion(): string {
  try {
    const pkg = readFileSync('node_modules/@playwright/test/package.json', 'utf8')
    return JSON.parse(pkg).version
  } catch {
    return 'unknown'
  }
}

/**
 * The sampler's state, parked on the page's `window` because the frame loop
 * outlives the `evaluate` that starts it and the one that stops it.
 */
interface Sampler {
  __frames: number[]
  __sampling: boolean
  __frame: number
}

/**
 * Playwright exposes no frame duration API, so the sampler is injected and read
 * back out of the page.
 */
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Sampler
    w.__frames = []
    w.__sampling = true
    let last = performance.now()
    const tick = (now: number) => {
      w.__frames.push(now - last)
      last = now
      if (w.__sampling) w.__frame = requestAnimationFrame(tick)
    }
    w.__frame = requestAnimationFrame(tick)
  })
}

/**
 * Cancels the pending frame rather than only clearing the flag, because a
 * callback already scheduled when the flag drops still runs, and if the next
 * `startSampling` beats it to the page it re-arms against the new flag and the
 * next gesture is sampled by two chains at once, one of them measuring from a
 * timestamp taken during the previous gesture.
 */
async function stopSampling(page: Page): Promise<number[]> {
  const frames = await page.evaluate(() => {
    const w = window as unknown as Sampler
    w.__sampling = false
    cancelAnimationFrame(w.__frame)
    return w.__frames
  })
  // The gap between injection and the first callback is not a frame time.
  return frames.slice(1)
}

/**
 * How many consecutive animation frames the surface has to hold one width
 * before the drain is called finished.
 *
 * One would not do. A frame can pass with none of the queued events applied,
 * and calling that settled is the same early read in a slower disguise. Three
 * costs three idle frames at the tail of the zoom sample, which sort to the
 * bottom, so the p95 still comes off the drain.
 */
const STABLE_FRAMES = 3

/**
 * The budget for one drain.
 *
 * Generous, because the drain is the thing being measured: sixty wheel events,
 * each a full canvas re-render, at a 4x CPU throttle. Bounded anyway, because
 * an unbounded wait on a page that has stopped producing frames is the fifteen
 * minute test timeout, which names nothing.
 */
const SETTLE_TIMEOUT_MS = 120_000

/**
 * Wait until the page has finished applying the wheel events already dispatched
 * at it.
 *
 * `page.mouse.wheel` resolves when the driver has dispatched the event, not
 * when the renderer has processed it, so even an awaited drive can resolve its
 * last events with the renderer still behind, and a read taken then is a read
 * of a partial sweep. A batch is the same fault at full volume: the first run
 * of the batched drive read the surface at 20 of 60 events applied, and the two
 * probe events that followed drained 16 and then 12 more on their way past,
 * each read landing on an exact integer count. Awaiting the dispatch, however
 * it is done, is not the wait; this is.
 *
 * On the awaited drive this file uses, the queue is short and the wait costs a
 * few idle frames. It is kept at that price because a read that is correct and
 * a read that is correct by accident look identical, and because it is what
 * makes a shortfall attributable. With the wait in place, each single-event
 * clamp probe was seen to apply exactly 1.000 event, in both batched attempts,
 * which is what rules the queue out and sends the missing events somewhere
 * else. `sweep` says where each attempt sent them.
 *
 * The wait is the width holding still across `STABLE_FRAMES` consecutive
 * frames, polled inside the page so the measured window carries no driver round
 * trips. `getBoundingClientRect` in a rAF callback moves the frame's layout
 * earlier rather than adding one: queued input is applied ahead of rAF, so that
 * layout was already owed.
 *
 * It proves a drained queue only while the events still move the surface. That
 * holds for the whole measured sweep in, which multiplies the zoom by
 * exp(2.772) and so lands 0.07 percent short of the 16x the clamps allow,
 * leaving not one of its sixty events a no-op. The sweep out saturates at the
 * 0.25 clamp after thirty, so its settle proves the clamp was reached and
 * leaves the remaining thirty free to still be queued. Those are applied at the
 * head of the measured window and cost next to nothing there: `setZoom` to the
 * zoom the state already holds bails out instead of re-rendering.
 */
async function settle(surface: Locator, gesture: string): Promise<void> {
  const outcome = await surface.evaluate(
    (el, { timeoutMs, stableFrames }) =>
      new Promise<{ settled: boolean; width: number; frames: number }>((resolve) => {
        let width = el.getBoundingClientRect().width
        let frames = 0
        let stable = 0
        let done = false
        let backstop = 0
        const finish = (settled: boolean) => {
          done = true
          clearTimeout(backstop)
          resolve({ settled, width, frames })
        }
        // rAF is the clock, so a deadline checked only inside it is no bound at
        // all on a page that has stopped producing frames.
        backstop = window.setTimeout(() => finish(false), timeoutMs)
        const tick = () => {
          if (done) return
          frames++
          const next = el.getBoundingClientRect().width
          stable = next === width ? stable + 1 : 0
          width = next
          if (stable >= stableFrames) finish(true)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    { timeoutMs: SETTLE_TIMEOUT_MS, stableFrames: STABLE_FRAMES },
  )
  if (!outcome.settled) {
    throw new Error(
      `The ${gesture} never stopped moving the zoom. The surface was ` +
        `${outcome.width} px and still changing after ${outcome.frames} frames ` +
        `and ${SETTLE_TIMEOUT_MS} ms. Everything measured past this point would ` +
        'be a sweep that is still running.',
    )
  }
}

/**
 * One wheel burst of `WHEEL.events`, one awaited driver round trip per event,
 * and not over until the page has applied all of it.
 *
 * Read `zoomP95Ms` with the following caveat or do not read it at all.
 *
 * Awaiting each event puts a full driver round trip between every pair of them,
 * so the main thread sits idle in the gaps and the sampler collects idle
 * frames. The number is bounded below by that round trip and lands on the 60 Hz
 * interval: every run ever recorded came out at 16.7 to 16.8 ms, which is
 * 1/60 s to three digits, and the 124 to 126 zoom frames recorded beside them
 * over 60 events are the arithmetic proof of the idleness. It is at least as
 * much a measurement of the driver as of the app, and it is therefore NOT
 * comparable to `dragP95Ms`, which comes off a single
 * `mouse.move(x, y, { steps: 40 })` that the driver dispatches back to back
 * with the main thread saturating. A zoom p95 is comparable only to another
 * zoom p95 taken at the same `gesture.version`.
 *
 * A batched drive, all sixty dispatched before any is awaited, is what would
 * make the comparison fair. It has been written twice and withdrawn twice, and
 * the two attempts failed for two different reasons. Read both before writing
 * it a third time.
 *
 * The first attempt found an application defect. `useCanvasZoom` multiplied a
 * ref assigned during render and handed the product to `setZoom`, which is
 * async and batched, so every event processed before React re-rendered read the
 * same stale zoom and the last write won. Measured here with `settle` proving
 * the queue drained: 45.000 of 60 events applied, landing at zoom 1.99910 where
 * 3.9972 was owed. Fifteen events moved nothing. The awaited drive was never
 * immune to that, only too slow to trip it, since a round trip per event left
 * React time to re-render and the ref was fresh every time. `1419fce` gave the
 * handler an accumulator it owns and writes synchronously.
 *
 * The second attempt ran against that fixed handler and applied 49.000 of 60,
 * failing the same post-condition. In both attempts each single-event clamp
 * probe applied exactly 1.000 event, so `settle` was never the missing piece
 * and the queue was fully drained at every read.
 *
 * What that leaves, stated as the inference it is rather than as a measurement.
 * After `1419fce` consecutive handler invocations provably compound, so the
 * stale ref cannot still be dropping events, which puts the residual loss
 * upstream of the handler: the browser coalescing the synthetic CDP wheel
 * events in its input pipeline and discarding the deltas of the ones it merges
 * rather than summing them. That is a property of how this harness injects
 * input, not a defect in the application, and no change under `src/` reaches
 * it. It also refutes the assumption this docblock used to carry, that
 * coalescing cannot change the range swept because the handler applies
 * `Math.exp(-deltaY * 0.0015)` per event and `exp` turns a sum into a product.
 * That holds only if a merged event carries the summed deltaY. Had it, the
 * second attempt would have landed on the clamp. It did not.
 *
 * 45 and 49 are two samples taken under different conditions and not a
 * controlled comparison, so the four event recovery between them is suggestive
 * and not conclusive, and neither number measures the fix. `1419fce` rests on
 * the source-level mechanism being real and the change being minimal and
 * correct, which is an argument from reading the handler and not from either of
 * these runs.
 *
 * One option is untried, and is recorded here so it is not lost. Dispatching
 * the events from inside the page, `element.dispatchEvent(new WheelEvent(
 * 'wheel', ...))` under `page.evaluate`, bypasses the browser's input pipeline
 * entirely, so there is nothing left to coalesce them. The price is that it
 * stops exercising the real input path and measures the handler and React
 * instead of the whole input-to-paint chain, which is what the drag beside it
 * measures. Whether that is the better measurement is a judgement and it
 * belongs to whoever picks this up.
 */
async function sweep(
  page: Page,
  surface: Locator,
  delta: number,
  gesture: string,
): Promise<void> {
  for (let i = 0; i < WHEEL.events; i++) {
    await page.mouse.wheel(0, delta)
  }
  await settle(surface, gesture)
}

/**
 * The budget for loading the fixture and solving it, which is the slow part:
 * HiGHS is WASM and the CPU throttle from the previous run is still on the
 * session while the next run loads.
 */
const LOAD_TIMEOUT_MS = 120_000

/** The budget for the UI that follows a returned plan, which is not slow. */
const READY_TIMEOUT_MS = 30_000

/**
 * Playwright defaults `actionTimeout` to no limit, so an unbounded wait here
 * does not fail when the fixture breaks, it hangs until the 15 minute test
 * timeout and then names a locator rather than a cause. Every readiness wait is
 * bounded for that reason, and `waitFor` carries no message of its own, hence
 * the rethrow. The timeout is set per wait rather than globally: a global
 * `actionTimeout` would also apply to the measured gestures.
 */
async function waitReady(
  locator: Locator,
  meaning: string,
  timeout = READY_TIMEOUT_MS,
): Promise<void> {
  try {
    await locator.waitFor({ timeout })
  } catch (cause) {
    throw new Error(meaning, { cause })
  }
}

/**
 * Put the app back to the state every run must start from.
 *
 * The app persists itself through two channels and a run has to be cut off from
 * both, because an arrange writes to both. localStorage carries the layout and
 * the open tab. The address bar carries a whole factory, placements included:
 * `urlState.ts` mirrors every store commit into the fragment on a 400ms
 * debounce, and `startUrlSync` reads that fragment back before anything else,
 * so clearing storage alone restores nothing. Miss the second channel and run 2
 * inherits the blocks run 1 arranged, the tray is empty, and this function
 * waits for a badge that will never render.
 *
 * The trip through `about:blank` is the reset. A reload keeps the arranged
 * fragment the last run left in the address bar, and a `goto` differing from
 * the current URL only in its fragment is a same-document navigation that would
 * not reload at all. Tearing the document down is also what discards the
 * pending debounced write, which would otherwise land after the clear and put
 * the arranged fragment back. What follows is a real load of the pristine link,
 * so runs 2 and 3 see exactly what run 1 saw.
 *
 * The clear also returns the app to the Setup tab, which is why the Layout tab
 * is selected here every time rather than once.
 */
async function openFixture(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear())
  await page.goto('about:blank', { timeout: READY_TIMEOUT_MS })
  await page.goto(`/#${DENSE_COMPACT}`, { timeout: LOAD_TIMEOUT_MS })
  // The solver runs off the initial render; this chip is the first proof it
  // returned a plan rather than an error.
  await waitReady(
    page.locator('.chip', { hasText: 'machines' }),
    'The solver never returned a plan for the dense fixture.',
    LOAD_TIMEOUT_MS,
  )
  await page.locator('.tabs__tab--layout').click({ timeout: READY_TIMEOUT_MS })
  await waitReady(
    page.locator('.layout__scroll'),
    'The Layout tab never rendered its canvas.',
  )
  // The tray count on the arrange button proves the modules were derived. The
  // fixture link carries a plan and no arrangement, so every block starts here.
  await waitReady(
    page.locator('.btngroup .btn .badge').first(),
    'The arrange button carried no tray count, so the tray was empty and the ' +
      "modules were not derived. The reset most likely left a previous run's " +
      'arranged placements in place.',
  )
}

/**
 * The arrange button to time, preferring the whole stack one.
 *
 * `All floors` renders only when the plan has more than one floor
 * (`LayoutPanel.tsx:697`), and the dense fixture is a single Ground floor, so
 * for this fixture the whole stack is that floor and `This floor` performs the
 * same arrange. Preferring `All floors` keeps the number meaning one whole
 * stack arrange if the fixture ever grows a second floor. Which label was
 * clicked goes into the baseline, so Phase 12 compares the same gesture.
 */
async function arrangeLabel(page: Page): Promise<string> {
  for (const label of ARRANGE_LABELS) {
    if ((await page.locator('.btngroup button', { hasText: label }).count()) > 0) {
      return label
    }
  }
  throw new Error(
    `No arrange button found. Looked for ${ARRANGE_LABELS.join(' and ')}. ` +
      'A renamed button must stop this script rather than record a zero.',
  )
}

/**
 * One run of all three gestures.
 *
 * The order is forced by the fixture and is not interchangeable. The link
 * carries no placements, so there is no `.tile` to drag and nothing much to
 * relayout until the arrange has run. The drag then happens before the zoom
 * sweep because the sweep ends at 4x, and the drag is specified at the reset
 * zoom so the two numbers stay independent.
 */
async function measure(page: Page, label: string): Promise<Run> {
  // Timed inside the page so the synchronous click handler and React's discrete
  // event flush are both inside the window. This is main thread block time and
  // not time to first pixel, which is the number Phase 11's pending state aims
  // at.
  const arrangeMs = await page.evaluate((wanted) => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.trim().startsWith(wanted),
    )
    if (!button) throw new Error(`no button labelled ${wanted}`)
    const t0 = performance.now()
    button.click()
    return performance.now() - t0
  }, label)

  const tile = page.locator('.tile:not(.tile--ghost)').first()
  const box = await tile.boundingBox()
  if (!box) throw new Error('the arrange placed no draggable tile')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await startSampling(page)
  await page.mouse.down()
  await page.mouse.move(box.x + 400, box.y + 200, DRAG)
  await page.mouse.up()
  const dragFrames = await stopSampling(page)
  // `mouse.down` and `mouse.move` dispatch whether or not anything listens, so
  // a drag put behind a handle, a renamed tile class, a pointer capture guard
  // or a moved listener would leave the sampler recording an idle page at 60 Hz
  // and collapse `dragP95Ms` from ~933 ms to ~16.7 ms. Phase 12 would read a 98
  // percent improvement, which is the one direction nobody investigates. The
  // locator is re-read rather than the box re-used: `.first()` follows the
  // placement map's key order, which a coordinate change does not disturb.
  const dropped = await tile.boundingBox()
  if (!dropped || (dropped.x === box.x && dropped.y === box.y)) {
    throw new Error(
      `The drag left the tile at ${box.x}, ${box.y}, so the sampled frames are ` +
        'an idle page rather than a drag.',
    )
  }
  const dragP95Ms = p95(dragFrames, 'drag')

  const scroll = await page.locator('.layout__scroll').boundingBox()
  if (!scroll) throw new Error('the layout scroll container has no box')
  // Nothing in the DOM renders the zoom level, but `.layout__surface` is sized
  // `site.width * BASE_SCALE * zoom + margin` (`LayoutCanvas.tsx:840`), so its
  // width is a faithful readout of it.
  const surface = page.locator('.layout__surface')
  await waitReady(surface, 'The layout canvas rendered no zoomable surface.')
  const surfaceWidth = async (): Promise<number> => {
    const rect = await surface.boundingBox()
    if (!rect) throw new Error('the zoom surface has no box')
    return rect.width
  }

  await page.mouse.move(scroll.x + scroll.width / 2, scroll.y + scroll.height / 2)
  const atRest = await surfaceWidth()
  // Out to the minimum first, unmeasured, so the measured sweep starts from a
  // known zoom. No modifier keys: the wheel handler bails on the shift key.
  await sweep(page, surface, WHEEL.delta, 'zoom sweep out')
  const atMin = await surfaceWidth()
  await startSampling(page)
  await sweep(page, surface, -WHEEL.delta, 'zoom sweep in')
  // Stopped after the sweep has settled, so the sample spans the whole drain.
  // Stopped before it, `zoomP95Ms` is a percentile over whichever fraction of
  // the sixty events the renderer happened to have reached.
  const zoomFrames = await stopSampling(page)
  const atMax = await surfaceWidth()
  // Two events past the end of the measured sweep, unmeasured, to find where
  // the 4x clamp actually is. Two rather than one because the sweep lands 0.07
  // percent short of the clamp (60 x 30.8 x 0.0015 is 2.772, not ln(16)), so
  // the first event still moves the zoom and only the second proves the clamp
  // is holding. `atClamp` is then the width at 4x, measured rather than
  // derived, which is what lets the check below be geometry free: the surface
  // is `site.width * BASE_SCALE * zoom + margin` and neither the site nor the
  // margin is known here. Both are settled for, and the second settle is the
  // one worth arguing about: a held clamp moves nothing, so it waits on a
  // surface that was never going to change. That is what makes it worth doing.
  // Without it the read lands before the event does, and a clamp that had
  // stopped holding would sail past unread.
  await page.mouse.wheel(0, -WHEEL.delta)
  await settle(surface, 'first clamp probe')
  const atClamp = await surfaceWidth()
  await page.mouse.wheel(0, -WHEEL.delta)
  await settle(surface, 'second clamp probe')
  const heldAtClamp = await surfaceWidth()
  // The post-condition. The sweep has to shrink the surface, grow it back past
  // where it started, and finish within one percent of the clamp, and the clamp
  // has to hold. Nothing here reads the zoom before and after and hopes: a
  // renamed `.layout__scroll`, a wheel listener moved to another element or a
  // dropped `preventDefault` all make the sweep a no-op over an idle page, and
  // an idle page at 60 Hz records 16.7 ms, which reads as a large improvement.
  const shortOfClamp = (atClamp - atMax) / atClamp
  if (
    !(
      atMin < atRest &&
      atMax > atRest &&
      heldAtClamp === atClamp &&
      shortOfClamp < 0.01
    )
  ) {
    throw new Error(
      `The wheel did not sweep the zoom. The surface measured ${atRest} px at ` +
        `rest, ${atMin} px after the sweep out, ${atMax} px after the sweep ` +
        `in, ${atClamp} px one event later and ${heldAtClamp} px the event ` +
        'after that. Expected it to shrink, then grow back past its resting ' +
        'width to within one percent of a clamp that then holds.',
    )
  }
  const zoomP95Ms = p95(zoomFrames, 'zoom sweep')

  return {
    zoomP95Ms,
    dragP95Ms,
    arrangeMs,
    dragFrames: dragFrames.length,
    zoomFrames: zoomFrames.length,
  }
}

function environment(browser: Browser) {
  return {
    playwright: playwrightVersion(),
    chromium: browser.version(),
    platform: process.platform,
    node: process.version,
    viewport: { width: 1440, height: 900 },
    cpuThrottlingRate: THROTTLE.rate,
  }
}

test('records the throttled frame time baseline for the dense fixture', async ({
  page,
  browser,
}) => {
  test.setTimeout(15 * 60_000)

  // openFixture navigates for itself; this first load only gives its
  // localStorage clear an origin to run on.
  await page.goto(`/#${DENSE_COMPACT}`, { timeout: LOAD_TIMEOUT_MS })
  const client = await page.context().newCDPSession(page)

  const runs: Run[] = []
  let label = ''
  for (let run = 0; run < RUNS; run++) {
    await openFixture(page)
    // CDP sessions are Chromium only. Sent after the navigation and before the
    // first measured gesture, so the load itself is not throttled and the
    // fixture reaches a drawn state promptly. Re-sent each run because each run
    // reloads the document.
    await client.send('Emulation.setCPUThrottlingRate', THROTTLE)
    label = await arrangeLabel(page)
    runs.push(await measure(page, label))
  }

  // `Metrics` rather than `Run`: the smallest of three sample sizes is not a
  // property of anything, so the counts stay in the runs they were taken from.
  const best: Metrics = {
    zoomP95Ms: Math.min(...runs.map((r) => r.zoomP95Ms)),
    dragP95Ms: Math.min(...runs.map((r) => r.dragP95Ms)),
    arrangeMs: Math.min(...runs.map((r) => r.arrangeMs)),
  }

  // `environment` is written first and read first, then `gesture`. Phase 12
  // compares both before it reads a number: a different Chromium, platform,
  // viewport, throttle rate or gesture version invalidates the comparison
  // outright, and is not a regression to be explained.
  const baseline = {
    environment: environment(browser),
    recordedAt: new Date().toISOString(),
    fixture: 'dense-compact',
    gesture: {
      // First in the block and read before anything under it. A missing
      // `version` means version 1, whose zoom sweep measured driver latency.
      version: GESTURE_VERSION,
      wheelEvents: WHEEL.events,
      wheelDelta: WHEEL.delta,
      wheelDrive: WHEEL.drive,
      dragSteps: DRAG.steps,
      arrangeButton: label,
    },
    runs,
    best,
    gate: { maxRegressionPct: 20 },
  }

  writeFileSync('perf/baseline.json', `${JSON.stringify(baseline, null, 2)}\n`)
})
