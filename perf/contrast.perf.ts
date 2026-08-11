/**
 * The AUDIT-05 contrast and reduced motion instrument: every text colour pair
 * and every non zero motion duration the app renders, measured once across four
 * surfaces at two viewports and printed to stdout as markdown ready rows.
 *
 * Seven things a reader needs before changing anything here.
 *
 * 1. This file is never run by `npm test` and never by CI. Its `.perf.ts`
 *    suffix matches neither vitest's default include nor Playwright's default
 *    testMatch, and `playwright.config.ts` pins testMatch to that suffix. That
 *    is a correctness rule and not a style one: there is no `vitest.config.ts`
 *    at the repo root, so `npm test` is bare `vitest run` over the whole repo
 *    minus `node_modules` and `.git`, and a `.spec.ts` or `.test.ts` here would
 *    be collected, fail on its first `@playwright/test` import, and take the
 *    Pages deploy down with it, because `.github/workflows/deploy.yml` runs
 *    `npm test` before `npm run build`.
 * 2. Run it alone, `npx playwright test perf/contrast.perf.ts`, and never with
 *    `npm run perf`. That script is bare `playwright test` with no path, so it
 *    would also run `frames.perf.ts` and rewrite `perf/baseline.json` as a side
 *    effect of an audit. That file is at a gesture version the instrument has
 *    moved past and needs a controlled re-record, not a drive by one.
 * 3. `npm run build` must have been run first, because Playwright's webServer
 *    starts `npm run preview` and `vite preview` serves `dist/` rather than
 *    building it.
 * 4. It writes no file. `frames.perf.ts` ends in a `writeFileSync` and this one
 *    deliberately does not: its output is read off stdout and hand placed into
 *    `docs/UX-FINDINGS.md`, because a finding is a judgement and a script that
 *    wrote rows directly would be asserting one.
 * 5. A broken instrument throws rather than recording a benign looking value,
 *    which is the same rule `frames.perf.ts` states for `arrangeLabel` and
 *    `p95`. A surface that yields zero sampled pairs throws. It must never
 *    report "no contrast failures", because an empty sample and a clean surface
 *    are the two results this pass exists to keep apart.
 * 6. SVG text is sampled on purpose. It is the reason the phase declined
 *    `@axe-core/playwright`, whose contrast rule skips it, and this app renders
 *    informational text inside SVG in `Compass.tsx` and in seven places in
 *    `SideView.tsx`. Those elements are painted by `fill` rather than by
 *    `color`, so both are read and the SVG one wins inside the SVG namespace.
 *    Decorative canvas graphics are excluded by construction rather than by a
 *    blocklist: nothing without a non empty text node of its own is ever
 *    sampled, so tile bodies, route polylines, the grid and the compass rose
 *    artwork cannot enter the sample while the letters drawn over them can.
 * 7. This file is outside `tsconfig.json`'s include, matching the `scripts/`
 *    and `perf/` precedent for node tooling, so `tsc --noEmit` never reads it
 *    and it is proven by being run rather than by being typechecked.
 */
import { test, devices, type Locator, type Page } from '@playwright/test'
import { DENSE_COMPACT } from '../test/fixtures/plans'

/**
 * The two audited viewports, and both are written into the output because a
 * ratio without the viewport it was read at is not reproducible.
 *
 * Desktop matches `playwright.config.ts` exactly so these numbers sit beside
 * the perf baseline's. That config block is not edited: the phone is applied
 * with `test.use` per describe instead.
 */
const DESKTOP = { width: 1440, height: 900 }

/**
 * The phone descriptor, and the height is the load bearing half of it.
 *
 * `devices['iPhone 14']` is 390 by 664 CSS pixels at deviceScaleFactor 3. The
 * phase context left the descriptor and the height to discretion, so this is
 * the choice, and 664 is recorded in the inventory because MOB-01's "controls
 * and results co-visible" reading is a claim about the height and not about the
 * width.
 *
 * `defaultBrowserType` is deliberately dropped from the spread. Taking the
 * whole descriptor would force WebKit, whose binary is installed here but
 * cannot launch without root installed system libraries, and D-06's real touch
 * context is a prerequisite of the layout touch plan rather than of this pass.
 * What this pass measures is computed colour, computed font size and computed
 * duration, and those are decided by the stylesheet against the viewport, the
 * device pixel ratio and the pointer media state, all three of which are
 * carried over. `isMobile` and `hasTouch` are kept for exactly that reason: they
 * are what make `pointer: coarse` and `hover: none` match, so a rule gated on
 * them resolves the same way it would on the device.
 */
const IPHONE = devices['iPhone 14']
const PHONE = {
  viewport: IPHONE.viewport,
  deviceScaleFactor: IPHONE.deviceScaleFactor,
  isMobile: IPHONE.isMobile,
  hasTouch: IPHONE.hasTouch,
  userAgent: IPHONE.userAgent,
}

/**
 * The budget for loading the fixture and solving it, which is the slow part:
 * HiGHS is WASM and the dense fixture is 117 machines.
 */
const LOAD_TIMEOUT_MS = 120_000

/** The budget for the UI that follows a returned plan, which is not slow. */
const READY_TIMEOUT_MS = 30_000

/** WCAG 2.x AA, normal text and large text. */
const AA_NORMAL = 4.5
const AA_LARGE = 3

/** WCAG's own definition of large: 24px, or 18.66px at 700 or heavier. */
const LARGE_PX = 24
const LARGE_BOLD_PX = 18.66
const BOLD_WEIGHT = 700

/**
 * Playwright defaults `actionTimeout` to no limit, so an unbounded wait here
 * does not fail when a surface breaks, it hangs until the test timeout and then
 * names a locator rather than a cause. `waitFor` carries no message of its own,
 * hence the rethrow.
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
 * Cut the app off from both persistence channels, which is what "cleared
 * profile" means here and is copied from `frames.perf.ts:445-467`.
 *
 * localStorage carries the layout and the open tab. The address bar carries a
 * whole factory: `urlState.ts` mirrors every store commit into the fragment on
 * a 400 ms debounce and `startUrlSync` reads it back before anything else, so
 * clearing storage alone restores nothing. The trip through `about:blank` is
 * the second cut, and it is not optional: a `goto` that differs from the
 * current URL only in its fragment is a same document navigation that would not
 * reload at all, and tearing the document down is also what discards the
 * pending debounced write that would otherwise land after the clear.
 */
async function reset(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear())
  await page.goto('about:blank', { timeout: READY_TIMEOUT_MS })
}

/** The bare origin with nothing carried in: no fragment and no stored state. */
async function openFirstRun(page: Page): Promise<void> {
  await reset(page)
  await page.goto('/', { timeout: LOAD_TIMEOUT_MS })
  await waitReady(
    page.locator('.app__panel--setup'),
    'The bare origin never rendered the setup panel, so the first run surface was never reached.',
    LOAD_TIMEOUT_MS,
  )
}

/**
 * The dense fixture, landing on Setup. The chip is the first proof the solver
 * returned a plan rather than an error, which is the same oracle
 * `frames.perf.ts` uses and the one `docs/golden-fixtures.md` documents.
 */
async function openSetup(page: Page): Promise<void> {
  await reset(page)
  await page.goto(`/#${DENSE_COMPACT}`, { timeout: LOAD_TIMEOUT_MS })
  await waitReady(
    page.locator('.chip', { hasText: 'machines' }),
    'The solver never returned a plan for the dense fixture.',
    LOAD_TIMEOUT_MS,
  )
}

async function openLayout(page: Page): Promise<void> {
  await openSetup(page)
  await page.locator('.tabs__tab--layout').click({ timeout: READY_TIMEOUT_MS })
  await waitReady(
    page.locator('.layout__scroll'),
    'The Layout tab never rendered its canvas.',
  )
}

/**
 * The elevation, which is the same surface drawn the other way and is a
 * separate state rather than a separate surface.
 *
 * It is driven because `SideView.tsx` is where seven of this app's nine SVG
 * text sites live, and a pass that stopped at the plan view would have measured
 * the compass and reported the layout surface as covered. That is the exact
 * failure the coverage matrix exists to make visible, so it is closed here
 * rather than recorded as a blank cell: contrast is one global pass and no
 * later plan re-measures it.
 */
async function openElevation(page: Page): Promise<void> {
  await page
    .locator('.btngroup button', { hasText: 'Side' })
    .click({ timeout: READY_TIMEOUT_MS })
  await waitReady(
    page.locator('.elevation'),
    'The Side toggle never rendered the elevation, so the SideView SVG text was never measured.',
  )
}

async function openGraph(page: Page): Promise<void> {
  await openSetup(page)
  await page.locator('.tabs__tab--graph').click({ timeout: READY_TIMEOUT_MS })
  await waitReady(
    page.locator('.app__panel--graph'),
    'The Graph tab never rendered its panel.',
  )
}

async function openBreakdown(page: Page): Promise<void> {
  await page.locator('.tabs__tab--breakdown').click({ timeout: READY_TIMEOUT_MS })
  await waitReady(
    page.locator('.app__panel--breakdown'),
    'The Breakdown tab never rendered its panel.',
  )
  await waitReady(
    page.locator('.chip', { hasText: 'machines' }),
    'The breakdown rendered without a solved plan behind it.',
  )
}

/** One sampled text element, as it comes back out of the page. */
interface Pair {
  selector: string
  sample: string
  color: string
  background: string
  fg: [number, number, number]
  bg: [number, number, number]
  fontPx: number
  fontWeight: number
  svg: boolean
  backdrop: string
  disabled: boolean
}

/**
 * Walk every element that renders text and return its foreground and background
 * as opaque sRGB triples.
 *
 * Compositing happens in the page because that is where the ancestor chain and
 * the opacity chain are, and the WCAG arithmetic happens in node because that
 * is what makes the ratio auditable in one place. Both alpha sources are
 * handled: a translucent background (the compass is a `color-mix` against
 * transparent) is composited down its ancestor stack, and a translucent
 * foreground (blocks on an inactive floor render at opacity 0.5) is composited
 * over its own resolved backdrop.
 */
async function samplePairs(page: Page): Promise<Pair[]> {
  return page.evaluate(() => {
    const SVG_NS = 'http://www.w3.org/2000/svg'
    type Rgba = [number, number, number, number]

    /**
     * Chromium resolves colours to `rgb()`, `rgba()` or, for a `color-mix`, to
     * `color(srgb ...)` with fractional channels. All three are parsed rather
     * than only the first, because the compass panel background is the third
     * and silently dropping it would report the compass letters against the
     * page instead of against the disc they sit on.
     */
    const parseColor = (input: string | null): Rgba | null => {
      if (!input) return null
      const s = input.trim()
      if (s === 'transparent' || s === 'none') return [0, 0, 0, 0]
      const rgb = /^rgba?\(([^)]+)\)$/.exec(s)
      if (rgb) {
        const n = rgb[1]!.split(/[,\s/]+/).filter(Boolean).map(Number)
        if (n.length < 3 || n.slice(0, 3).some(Number.isNaN)) return null
        return [n[0]!, n[1]!, n[2]!, n[3] === undefined ? 1 : n[3]]
      }
      const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(s)
      if (srgb) {
        const n = srgb[1]!.split(/[\s/]+/).filter(Boolean).map(Number)
        if (n.length < 3 || n.slice(0, 3).some(Number.isNaN)) return null
        return [n[0]! * 255, n[1]! * 255, n[2]! * 255, n[3] === undefined ? 1 : n[3]]
      }
      return null
    }

    /** Source over, top on bottom, both premultiplied out to an opaque triple. */
    const over = (top: Rgba, bottom: [number, number, number]): [number, number, number] => [
      top[0] * top[3] + bottom[0] * (1 - top[3]),
      top[1] * top[3] + bottom[1] * (1 - top[3]),
      top[2] * top[3] + bottom[2] * (1 - top[3]),
    ]

    const classesOf = (el: Element): string => {
      const raw = el.className
      const text = typeof raw === 'string' ? raw : ((raw as SVGAnimatedString)?.baseVal ?? '')
      return text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((c) => `.${c}`)
        .join('')
    }

    const selectorOf = (el: Element): string =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classesOf(el)}`

    /** Zero anywhere in the chain means the element is not on screen at all. */
    const chainOpacity = (el: Element): number => {
      let out = 1
      let node: Element | null = el
      while (node) {
        const value = Number.parseFloat(getComputedStyle(node).opacity)
        out *= Number.isNaN(value) ? 1 : value
        if (out === 0) return 0
        node = node.parentElement
      }
      return out
    }

    /**
     * The HTML backdrop: the first ancestor painting a non transparent
     * background, composited down through any translucent layers above it. The
     * browser canvas is the floor, because an element over nothing is drawn
     * over the canvas and not over an undefined value.
     */
    const htmlBackdrop = (el: Element): { rgb: [number, number, number]; via: string } => {
      const layers: { color: Rgba; via: string }[] = []
      let node: Element | null = el
      while (node) {
        const parsed = parseColor(getComputedStyle(node).backgroundColor)
        if (parsed && parsed[3] > 0) {
          layers.push({ color: parsed, via: selectorOf(node) })
          if (parsed[3] >= 1) break
        }
        node = node.parentElement
      }
      const canvas = parseColor(getComputedStyle(document.documentElement).backgroundColor)
      let base: [number, number, number] =
        canvas && canvas[3] >= 1 ? [canvas[0], canvas[1], canvas[2]] : [255, 255, 255]
      let via = 'canvas'
      // Bottom upward, so a translucent layer lands on what is actually below it.
      for (let i = layers.length - 1; i >= 0; i--) {
        base = over(layers[i]!.color, base)
        via = layers[i]!.via
      }
      return { rgb: base, via }
    }

    /**
     * The SVG backdrop, tried before the HTML one for SVG text.
     *
     * An HTML ancestor walk would miss it: `.elevation__block text` is painted
     * over a sibling `rect` filled `#24425a`, and reporting that label against
     * the panel behind the drawing would be a fabricated ratio, not a
     * conservative one. So a filled sibling shape whose box contains the text's
     * box wins, and only when there is none does the HTML chain answer.
     */
    const svgBackdrop = (
      el: Element,
    ): { rgb: [number, number, number]; via: string } | null => {
      const box = el.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) return null
      let node: Element | null = el.parentElement
      while (node && node.namespaceURI === SVG_NS) {
        for (const shape of Array.from(node.children)) {
          if (shape === el) continue
          if (!/^(rect|circle|ellipse|polygon|path)$/.test(shape.tagName)) continue
          const fill = parseColor(getComputedStyle(shape).fill)
          if (!fill || fill[3] === 0) continue
          const shapeBox = shape.getBoundingClientRect()
          const contains =
            shapeBox.left <= box.left &&
            shapeBox.right >= box.right &&
            shapeBox.top <= box.top &&
            shapeBox.bottom >= box.bottom
          if (!contains) continue
          const under = htmlBackdrop(node).rgb
          return { rgb: over(fill, under), via: selectorOf(shape) }
        }
        node = node.parentElement
      }
      return null
    }

    /** Text this element paints itself, rather than text a descendant paints. */
    const ownText = (el: Element): string => {
      let out = ''
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? ''
      }
      return out.replace(/\s+/g, ' ').trim()
    }

    /**
     * WCAG 1.4.3 exempts text that is part of an inactive user interface
     * component from the contrast minimum outright. This app dims a disabled
     * control to opacity 0.45, which lands its label at a ratio that reads as a
     * failure and is not one, so the state is carried out of the page and the
     * threshold is applied against it rather than the number being reported
     * bare. The pair is still measured and still enters the inventory, because
     * the exemption is a reason not to call it a failure and not a reason to
     * stop looking at it.
     */
    const isDisabled = (el: Element): boolean => {
      if (el.closest('[aria-disabled="true"]')) return true
      try {
        return el.matches(':disabled') || el.closest(':disabled') !== null
      } catch {
        return false
      }
    }

    const out: {
      selector: string
      sample: string
      color: string
      background: string
      fg: [number, number, number]
      bg: [number, number, number]
      fontPx: number
      fontWeight: number
      svg: boolean
      backdrop: string
      disabled: boolean
    }[] = []

    for (const el of Array.from(document.querySelectorAll('*'))) {
      const text = ownText(el)
      if (!text) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      const box = el.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      const opacity = chainOpacity(el)
      if (opacity === 0) continue

      const isSvg = el.namespaceURI === SVG_NS
      // Inside the SVG namespace the paint is `fill`; `color` is only ever the
      // inherited value there and would report the wrong ink.
      const inkSource = isSvg && style.fill && style.fill !== 'none' ? style.fill : style.color
      const ink = parseColor(inkSource)
      if (!ink) continue

      const backdrop = (isSvg ? svgBackdrop(el) : null) ?? htmlBackdrop(el)
      // The chain opacity fades the ink toward the backdrop, so it is folded in
      // as alpha rather than reported as a separate number nobody multiplies.
      const fg = over([ink[0], ink[1], ink[2], ink[3] * opacity], backdrop.rgb)

      out.push({
        selector: selectorOf(el),
        sample: text.slice(0, 48),
        color: inkSource,
        background: style.backgroundColor,
        fg: [fg[0], fg[1], fg[2]],
        bg: backdrop.rgb,
        fontPx: Number.parseFloat(style.fontSize) || 0,
        fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
        svg: isSvg,
        backdrop: backdrop.via,
        disabled: isDisabled(el),
      })
    }

    return out
  })
}

/** One element still animating with reduced motion asked for. */
interface Motion {
  selector: string
  transitionMs: number
  animationMs: number
  property: string
  moves: boolean
}

/**
 * The transitioned properties that actually move something on screen, as
 * opposed to recolouring it in place.
 *
 * The distinction is the whole severity of the motion finding and not a detail.
 * `prefers-reduced-motion` exists for vestibular triggers, and a 120 ms
 * background-color crossfade is not one, while a rotation is. A pass that
 * reported one count for both would leave a reader unable to tell an app that
 * ignores the preference harmlessly from one that spins things at a user who
 * asked it not to.
 */
const MOVING_PROPERTIES = /transform|translate|rotate|scale|top|left|right|bottom|margin|width|height|inset/

/**
 * What still moves once the browser has been told not to move things.
 *
 * The emulation is Playwright's, never an in page hack, and it is read back
 * through `matchMedia` before anything is collected. Without that read back a
 * zero result is ambiguous: an app that honours reduce and an emulation that
 * never took produce the same empty list, and only one of them is a pass.
 */
async function sampleMotion(page: Page): Promise<{ matched: boolean; moving: Motion[] }> {
  const matched = await page.evaluate(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const moving = await page.evaluate(() => {
    const seconds = (list: string): number => {
      let max = 0
      for (const raw of list.split(',')) {
        const value = raw.trim()
        const n = Number.parseFloat(value)
        if (Number.isNaN(n)) continue
        max = Math.max(max, value.endsWith('ms') ? n / 1000 : n)
      }
      return max
    }
    const classesOf = (el: Element): string => {
      const raw = el.className
      const text = typeof raw === 'string' ? raw : ((raw as SVGAnimatedString)?.baseVal ?? '')
      return text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((c) => `.${c}`)
        .join('')
    }
    const out: { selector: string; transitionMs: number; animationMs: number; property: string }[] =
      []
    // `::before` and `::after` are scanned alongside the element itself,
    // because `querySelectorAll` cannot reach a pseudo-element and this app's
    // only genuine movement lives in one: the disclosure chevron at
    // `.panel__head::after` rotates 45deg to -135deg over 120 ms. A sweep that
    // skipped pseudo-elements would have reported the app as colour-only and
    // been wrong about the one thing the motion dimension is asking after.
    const pseudos = [null, '::before', '::after']
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const box = el.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      for (const pseudo of pseudos) {
        const style = getComputedStyle(el, pseudo)
        if (pseudo && style.content === 'none') continue
        const transition = seconds(style.transitionDuration)
        const animation = seconds(style.animationDuration)
        if (transition === 0 && animation === 0) continue
        out.push({
          selector: `${el.tagName.toLowerCase()}${classesOf(el)}${pseudo ?? ''}`,
          transitionMs: Math.round(transition * 1000),
          animationMs: Math.round(animation * 1000),
          property: `${style.transitionProperty}${
            animation > 0 ? ` animation ${style.animationName}` : ''
          }`,
        })
      }
    }
    return out
  })
  return {
    matched,
    moving: moving.map((m) => ({ ...m, moves: MOVING_PROPERTIES.test(m.property) })),
  }
}

/** WCAG 2.x relative luminance over an opaque sRGB triple. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (raw: number): number => {
    const c = raw / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(
  fg: [number, number, number],
  bg: [number, number, number],
): number {
  const a = luminance(fg)
  const b = luminance(bg)
  const [light, dark] = a >= b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

function isLarge(fontPx: number, fontWeight: number): boolean {
  return fontPx >= LARGE_PX || (fontPx >= LARGE_BOLD_PX && fontWeight >= BOLD_WEIGHT)
}

const rgbText = ([r, g, b]: [number, number, number]): string =>
  `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`

interface Measured extends Pair {
  ratio: number
  large: boolean
  threshold: number
  passes: boolean
}

interface SurfaceResult {
  surface: string
  viewport: string
  states: string[]
  pairs: Measured[]
  motion: { matched: boolean; moving: Motion[] }
}

/** Every surface and viewport combination, pooled for the inventory at the end. */
const results: SurfaceResult[] = []

/**
 * One state of one surface: how to reach it, and the name it is reported under.
 *
 * A surface is not always one screen. The layout surface is the plan view and
 * the elevation, and results is the graph and the breakdown, and in both cases
 * measuring one of the two and calling the surface done is the false tick D-17
 * says the stopping rule cannot catch. So a surface takes a list of states,
 * every one of them is driven, and the pairs are pooled under one heading.
 */
interface SurfaceState {
  name: string
  go: (page: Page) => Promise<void>
}

async function measureSurface(
  page: Page,
  surface: string,
  viewport: string,
  states: SurfaceState[],
): Promise<void> {
  const pairs: Measured[] = []
  const moving: Motion[] = []
  let matched = true

  for (const state of states) {
    await state.go(page)
    const raw = await samplePairs(page)
    if (raw.length === 0) {
      throw new Error(
        `Zero text pairs were sampled in the ${state.name} state of the ` +
          `${surface} surface at ${viewport}. That is a broken instrument and ` +
          'not a clean surface: an empty sample must never be reported as no ' +
          'contrast failures.',
      )
    }
    for (const pair of raw) {
      const ratio = contrastRatio(pair.fg, pair.bg)
      const large = isLarge(pair.fontPx, pair.fontWeight)
      const threshold = large ? AA_LARGE : AA_NORMAL
      // A disabled control has no contrast minimum under 1.4.3, so it can never
      // be a failure here. It is still measured and still inventoried.
      const passes = pair.disabled || ratio >= threshold
      pairs.push({ ...pair, ratio, large, threshold, passes })
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const motion = await sampleMotion(page)
    await page.emulateMedia({ reducedMotion: null })
    matched = matched && motion.matched
    moving.push(...motion.moving)
  }

  results.push({
    surface,
    viewport,
    states: states.map((s) => s.name),
    pairs,
    motion: { matched, moving },
  })

  const failures = pairs.filter((p) => !p.passes)
  const svgPairs = pairs.filter((p) => p.svg)
  const worstBySelector = new Map<string, Measured>()
  for (const fail of failures) {
    const seen = worstBySelector.get(fail.selector)
    if (!seen || fail.ratio < seen.ratio) worstBySelector.set(fail.selector, fail)
  }
  console.log(`\n### ${surface} at ${viewport}`)
  console.log(`states driven: ${states.map((s) => s.name).join(', ')}`)
  console.log(
    `sampled ${pairs.length} text pairs, ${svgPairs.length} of them SVG text, ` +
      `${failures.length} below AA across ${worstBySelector.size} distinct selectors`,
  )
  for (const fail of worstBySelector.values()) {
    const instances = failures.filter((f) => f.selector === fail.selector).length
    console.log(
      `  FAIL ${fail.ratio.toFixed(3)} (needs ${fail.threshold.toFixed(1)}) ` +
        `${fail.selector} ${fail.fontPx}px/${fail.fontWeight} ` +
        `${rgbText(fail.fg)} on ${rgbText(fail.bg)} at ${viewport}, ` +
        `${instances} instances :: "${fail.sample}"`,
    )
  }
  const svgSelectors = [...new Set(svgPairs.map((p) => p.selector))]
  console.log(`  SVG text selectors reached: ${svgSelectors.join(' ') || 'none'}`)
  const exempt = pairs.filter((p) => p.disabled && p.ratio < p.threshold)
  const exemptSelectors = [...new Set(exempt.map((p) => p.selector))]
  console.log(
    `  below AA but exempt under 1.4.3 as inactive components: ${exempt.length} ` +
      `instances across ${exemptSelectors.length} selectors ` +
      `${exemptSelectors.join(' ') || '(none)'}`,
  )
  const movers = moving.filter((m) => m.moves)
  console.log(
    `  reduced motion: matchMedia matched ${matched}, ` +
      `${moving.length} elements still carry a non zero duration, ` +
      `${movers.length} of them on a property that moves rather than recolours ` +
      `(${[...new Set(movers.map((m) => m.selector))].join(' ') || 'none'})`,
  )
}

/** The four surfaces, in the order AUDIT-01 lists them, and their states. */
const SURFACES: { surface: string; states: SurfaceState[] }[] = [
  { surface: 'first run', states: [{ name: 'bare origin', go: openFirstRun }] },
  { surface: 'setup', states: [{ name: 'dense fixture', go: openSetup }] },
  {
    surface: 'layout',
    states: [
      { name: 'plan view', go: openLayout },
      { name: 'elevation', go: openElevation },
    ],
  },
  {
    surface: 'results',
    states: [
      { name: 'graph', go: openGraph },
      { name: 'breakdown', go: openBreakdown },
    ],
  },
]

async function driveAll(page: Page, viewport: string): Promise<void> {
  // The surfaces navigate for themselves; this first load only gives the
  // localStorage clear inside `reset` an origin to run on.
  await page.goto('/', { timeout: LOAD_TIMEOUT_MS })
  for (const { surface, states } of SURFACES) {
    await measureSurface(page, surface, viewport, states)
  }
}

test.describe('desktop', () => {
  test.use({ viewport: DESKTOP })

  test('measures contrast and reduced motion at 1440x900', async ({ page }) => {
    test.setTimeout(10 * 60_000)
    await driveAll(page, '1440x900')
  })
})

test.describe('phone', () => {
  test.use(PHONE)

  test('measures contrast and reduced motion at 390x664', async ({ page }) => {
    test.setTimeout(10 * 60_000)
    await driveAll(page, '390x664')
  })
})

/**
 * The inventory, deduplicated by colour pair rather than by element, which is
 * what makes it the thing Phase 8's TOK-06 consumes as its contrast floor: a
 * token change moves a pair, and forty elements sharing one pair are one row of
 * work rather than forty.
 */
test.afterAll(() => {
  if (results.length === 0) return

  const byPair = new Map<
    string,
    {
      fg: [number, number, number]
      bg: [number, number, number]
      ratio: number
      fonts: Set<string>
      surfaces: Set<string>
      selectors: Set<string>
      large: boolean
      threshold: number
      svg: boolean
      disabled: boolean
    }
  >()

  for (const result of results) {
    for (const pair of result.pairs) {
      const key = `${rgbText(pair.fg)}|${rgbText(pair.bg)}|${pair.threshold}`
      const entry = byPair.get(key) ?? {
        fg: pair.fg,
        bg: pair.bg,
        ratio: pair.ratio,
        fonts: new Set<string>(),
        surfaces: new Set<string>(),
        selectors: new Set<string>(),
        large: pair.large,
        threshold: pair.threshold,
        svg: false,
        disabled: true,
      }
      entry.fonts.add(`${pair.fontPx}px/${pair.fontWeight}`)
      entry.surfaces.add(result.surface)
      entry.selectors.add(pair.selector)
      entry.svg = entry.svg || pair.svg
      // A pair is only exempt if every element wearing it is inactive. One
      // enabled instance makes the whole pair answerable to the threshold.
      entry.disabled = entry.disabled && pair.disabled
      byPair.set(key, entry)
    }
  }

  const rows = [...byPair.values()].sort((a, b) => a.ratio - b.ratio)

  console.log('\n\n## Contrast and motion inventory')
  console.log(`\nViewports: 1440 by 900, and 390 by 664 from devices['iPhone 14'].`)
  console.log(`Unique colour pairs: ${rows.length}.`)
  console.log(
    '\n| pair | surface | foreground | background | font | ratio | AA normal | AA large |',
  )
  console.log('|---|---|---|---|---|---|---|---|')
  rows.forEach((row, index) => {
    const label = `${row.svg ? 'svg text ' : ''}${[...row.selectors].slice(0, 2).join(' ')}${
      row.disabled ? ' (disabled, 1.4.3 exempt)' : ''
    }`
    const verdict = (threshold: number): string =>
      row.disabled ? 'exempt' : row.ratio >= threshold ? 'pass' : 'fail'
    console.log(
      `| P${String(index + 1).padStart(2, '0')} ${label} | ${[...row.surfaces].join(', ')} | ` +
        `${rgbText(row.fg)} | ${rgbText(row.bg)} | ${[...row.fonts].join(', ')} | ` +
        `${row.ratio.toFixed(3)} | ${verdict(AA_NORMAL)} | ${verdict(AA_LARGE)} |`,
    )
  })

  console.log('\n\n## Reduced motion')
  for (const result of results) {
    const names = [...new Set(result.motion.moving.map((m) => m.selector))]
    console.log(
      `${result.surface} at ${result.viewport}: matchMedia matched ` +
        `${result.motion.matched}, ${result.motion.moving.length} moving elements, ` +
        `${names.length} distinct selectors`,
    )
    for (const name of names.slice(0, 12)) {
      const worst = result.motion.moving
        .filter((m) => m.selector === name)
        .reduce((a, b) => (a.transitionMs + a.animationMs >= b.transitionMs + b.animationMs ? a : b))
      console.log(
        `  ${name} transition ${worst.transitionMs}ms animation ${worst.animationMs}ms on ${worst.property}`,
      )
    }
  }
})
