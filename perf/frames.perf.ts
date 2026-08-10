/**
 * The GUARD-07 perf instrument: a throttled frame time baseline for the dense
 * fixture, recorded to `perf/baseline.json`.
 *
 * Four things a reader needs before changing anything here.
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
 * `useCanvasZoom.ts:94` applies `Math.exp(-deltaY * 0.0015)` per wheel event and
 * clamps to [0.25, 4]. Sweeping the full range needs the sum of `-deltaY *
 * 0.0015` to reach `ln(16) = 2.7726`, so a total deltaY of 1848.4. Sixty events
 * of 30.8 lands on it exactly, and sixty is a plausible trackpad flick. The
 * count is part of the baseline's identity: Phase 12 must use the same one or
 * the p95 is not comparable, which is why it is written into the JSON.
 */
const WHEEL = { events: 60, delta: 30.8 }

/** Best of three per metric, so ordinary scheduling noise cannot set the bar. */
const RUNS = 3

/** Preferred first. `All floors` only exists when the plan has more than one floor. */
const ARRANGE_LABELS = ['All floors', 'This floor']

interface Metrics {
  zoomP95Ms: number
  dragP95Ms: number
  arrangeMs: number
}

/**
 * The 95th percentile, never the median. The median hides exactly the tail that
 * reads as stutter, which is the thing this baseline exists to catch.
 */
function p95(frames: number[]): number {
  const sorted = [...frames].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
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
 * Playwright exposes no frame duration API, so the sampler is injected and read
 * back out of the page.
 */
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __sampling: boolean }
    w.__frames = []
    w.__sampling = true
    let last = performance.now()
    const tick = (now: number) => {
      w.__frames.push(now - last)
      last = now
      if (w.__sampling) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function stopSampling(page: Page): Promise<number[]> {
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __sampling: boolean }
    w.__sampling = false
    return w.__frames
  })
  // The gap between injection and the first callback is not a frame time.
  return frames.slice(1)
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
async function measure(page: Page, label: string): Promise<Metrics> {
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
  const dragP95Ms = p95(await stopSampling(page))

  const scroll = await page.locator('.layout__scroll').boundingBox()
  if (!scroll) throw new Error('the layout scroll container has no box')
  await page.mouse.move(scroll.x + scroll.width / 2, scroll.y + scroll.height / 2)
  // Out to the minimum first, unmeasured, so the measured sweep starts from a
  // known zoom. No modifier keys: the wheel handler bails on the shift key.
  for (let i = 0; i < WHEEL.events; i++) await page.mouse.wheel(0, WHEEL.delta)
  await startSampling(page)
  for (let i = 0; i < WHEEL.events; i++) await page.mouse.wheel(0, -WHEEL.delta)
  const zoomP95Ms = p95(await stopSampling(page))

  return { zoomP95Ms, dragP95Ms, arrangeMs }
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

  const runs: Metrics[] = []
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

  const best: Metrics = {
    zoomP95Ms: Math.min(...runs.map((r) => r.zoomP95Ms)),
    dragP95Ms: Math.min(...runs.map((r) => r.dragP95Ms)),
    arrangeMs: Math.min(...runs.map((r) => r.arrangeMs)),
  }

  // `environment` is written first and read first. Phase 12 compares the
  // metadata before it reads a number: a different Chromium, platform, viewport
  // or throttle rate invalidates the comparison outright, and is not a
  // regression to be explained.
  const baseline = {
    recordedAt: new Date().toISOString(),
    environment: environment(browser),
    fixture: 'dense-compact',
    gesture: {
      wheelEvents: WHEEL.events,
      wheelDelta: WHEEL.delta,
      dragSteps: DRAG.steps,
      arrangeButton: label,
    },
    runs,
    best,
    gate: { maxRegressionPct: 20 },
  }

  writeFileSync('perf/baseline.json', `${JSON.stringify(baseline, null, 2)}\n`)
})
