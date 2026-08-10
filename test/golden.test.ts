import highsLoader from 'highs'
import { beforeAll, expect, test } from 'vitest'

import { arrangeStack, autoArrange } from '../src/components/LayoutCanvas'
import { analyseFloor } from '../src/layout/congestion'
import { useLayoutStore } from '../src/layout/layoutStore'
import { modulesFromPlan } from '../src/layout/modules'
import { routePaths } from '../src/layout/paths'
import { deriveRoutes } from '../src/layout/routes'
import type { Route } from '../src/layout/routes'
import { storageModules } from '../src/layout/storage'
import { scoreFloor } from '../src/layout/tidy'
import { floorRole } from '../src/layout/types'
import type { FactoryModule } from '../src/layout/types'
import { interpretSolution } from '../src/solver/interpret'
import type { PlanResult } from '../src/solver/interpret'
import { toLpFormat } from '../src/solver/lp'
import { buildModel } from '../src/solver/model'
import { decodePlanCode } from '../src/state/planCode'
import { applyPlan } from '../src/state/planFile'
import { selectPlanRequest, usePlannerStore } from '../src/state/plannerStore'
import { BUS_MODE, DENSE_COMPACT, MULTI_FLOOR } from './fixtures/plans'
import busGolden from './golden/bus-mode.json'
import denseGolden from './golden/dense-compact.json'
import multiGolden from './golden/multi-floor.json'
import { roundMetres, roundScore } from './golden/round'
import type { Golden } from './golden/round'

/**
 * Three committed plans, arranged by the real engine and diffed against three
 * committed answers.
 *
 * The regeneration rule, which is what makes any of this worth anything: the
 * goldens become a baseline at the moment of the first green run of this suite.
 * After that a golden diff is a finding and not a regeneration trigger. Running
 * `npm run goldens` to make this file go green destroys the only evidence that
 * the engine changed its answers.
 *
 * `solveSeeded`, `deriveModules` and `observe` below are copies of the bodies in
 * `tools/regen-goldens.ts`, and they are deliberately not extracted into a
 * shared module. The rounding is shared, because D-05 requires both sides to
 * round identically or the gate reddens on arithmetic rather than on behaviour.
 * The observation is duplicated on purpose: a comparison against a golden that
 * was written by the same code that reads it can only ever say the code agrees
 * with itself. Two independent readings of the pipeline mean a change made on
 * one side and not the other shows up as a red test.
 */

/**
 * Local, because the committed fixtures are address bar fragments rather than
 * plan codes. `fromBase64Url` in `src/state/shareLink.ts` is not exported, and
 * this is the same DOM typed idiom it uses, matching `test/planCode.wire.test.ts`.
 * A node `Buffer` here would fail `npm run typecheck`: `test` sits inside the
 * tsconfig include and no `@types/node` is installed.
 */
const fromFragment = (fragment: string): string => {
  const base64 = fragment
    .replace(/^2\./, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  )
}

type Highs = Awaited<ReturnType<typeof highsLoader>>
let highs: Highs

beforeAll(async () => {
  // Loaded directly rather than through the app's solver entry point, which
  // reaches its WASM through a Vite `?url` asset import and so hands the loader
  // a served URL where node needs a path it can open. Same bootstrap as
  // `test/solver.test.ts`.
  highs = await highsLoader()
})

/**
 * Solves whatever is currently in the planner store, through the app's own
 * selector so each fixture's tier, alternates, caps and surplus rule are
 * honoured without this file restating any of them.
 */
function solveSeeded(): PlanResult {
  const request = selectPlanRequest(usePlannerStore.getState())
  const { problem, registry } = buildModel(request)
  const lp = toLpFormat(problem)
  const solution = highs.solve(lp, { output_flag: false, log_to_console: false })

  const columns: Record<string, number> = {}
  for (const [id, col] of Object.entries(solution.Columns)) {
    columns[id] = 'Primal' in col ? (col.Primal ?? 0) : 0
  }
  return interpretSolution(request, registry, columns, solution.ObjectiveValue, lp)
}

/**
 * The module list LayoutPanel builds, in the order it builds it.
 *
 * Production before storage, because the golden's module list reads in input
 * order and D-10 wants that order pinned. Arranging is unaffected either way:
 * arrangeOnto re-sorts by id before it packs.
 */
function deriveModules(result: PlanResult): FactoryModule[] {
  const surplusByItem: Record<string, number> = {}
  for (const entry of result.surplus) surplusByItem[entry.item] = entry.rate

  return [
    ...modulesFromPlan(result),
    ...storageModules(
      useLayoutStore.getState().reserves,
      usePlannerStore.getState().tier,
      surplusByItem,
    ),
  ]
}

/**
 * Lexicographic rather than localeCompare, because a golden is committed on one
 * machine and compared on another and localeCompare answers to ICU.
 */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Reads the arrangement back out of the stores and shapes it into a golden.
 *
 * Every floor is walked, not only the active one, exactly as LayoutPanel does,
 * so a tangle on the floor nobody is looking at is still under the gate. Every
 * array is sorted before it is returned: Object.values over the placement map
 * follows insertion order, which is arrange order, and a golden that fails on
 * iteration order rather than on behaviour is a golden nobody will trust.
 */
function observe(
  modules: FactoryModule[],
  modulesById: Map<string, FactoryModule>,
  routes: Route[],
): Golden {
  const layout = useLayoutStore.getState()
  const floorIndex = new Map(layout.floors.map((floor, i) => [floor.id, i]))

  const paths: Golden['paths'] = []
  const congestion: Golden['congestion'] = []
  const scores: Golden['scores'] = []

  for (const floor of layout.floors) {
    const onFloor = routePaths({
      routes,
      modulesById,
      placements: layout.placements,
      floorId: floor.id,
      overrides: layout.routeOverrides,
    })

    for (const path of onFloor) {
      paths.push({
        floorId: floor.id,
        routeId: path.route.id,
        external: path.external,
        drawn: path.drawn,
        points: path.points.map((point) => ({
          x: roundMetres(point.x),
          y: roundMetres(point.y),
        })),
      })
    }

    const analysis = analyseFloor(
      floor,
      onFloor,
      Object.values(layout.placements).filter((p) => p.floorId === floor.id),
      modulesById,
    )
    congestion.push({
      floorId: floor.id,
      crossings: analysis.crossings.length,
      laneClashes: analysis.laneClashes.length,
      overBlocks: analysis.overBlocks.length,
      runs: analysis.runs,
      length: roundMetres(analysis.length),
      score: roundScore(analysis.score),
    })

    scores.push({
      floorId: floor.id,
      // Recomputed from the final placements rather than read off the
      // tournament, per D-04: one legible scalar beside the coordinates,
      // bought without instrumenting anything.
      score: roundScore(
        scoreFloor({
          routes,
          modulesById,
          placements: layout.placements,
          floor,
          overrides: layout.routeOverrides,
        }),
      ),
    })
  }

  const orderOf = (floorId: string) => floorIndex.get(floorId) ?? -1

  return {
    // Left in derivation order on purpose, which is the one array here that is
    // not sorted: D-10 wants the module list to read the way the app built it.
    modules: modules.map((module) => ({
      id: module.id,
      label: module.label,
      machines: module.machines,
      footprint: {
        width: roundMetres(module.machineFootprint.width),
        depth: roundMetres(module.machineFootprint.depth),
        height: roundMetres(module.machineFootprint.height),
      },
    })),
    floors: layout.floors.map((floor) => ({
      id: floor.id,
      gridWidth: floor.gridWidth,
      gridDepth: floor.gridDepth,
      role: floorRole(floor),
    })),
    // One row per placement, so two blocks that land on the same coordinates
    // stay two rows instead of collapsing into one.
    placements: Object.values(layout.placements)
      .map((placement) => ({
        moduleId: placement.moduleId,
        floorId: placement.floorId,
        x: roundMetres(placement.x),
        y: roundMetres(placement.y),
        orientation: placement.orientation,
        columns: placement.columns,
        inputSide: placement.inputSide,
        outputSide: placement.outputSide,
        ...(placement.flipped ? { flipped: true as const } : {}),
      }))
      .sort((a, b) => byText(a.moduleId, b.moduleId)),
    paths: paths.sort(
      (a, b) =>
        orderOf(a.floorId) - orderOf(b.floorId) || byText(a.routeId, b.routeId),
    ),
    congestion: congestion.sort(
      (a, b) => orderOf(a.floorId) - orderOf(b.floorId),
    ),
    scores: scores.sort((a, b) => orderOf(a.floorId) - orderOf(b.floorId)),
  }
}

/**
 * Seeds both stores from a committed fragment and solves it.
 *
 * Through the app's own import path, which runs both normalizers, so what is
 * measured is the shape the running app produces rather than one only this file
 * can build.
 */
function seedAndSolve(fragment: string): PlanResult {
  const report = applyPlan(decodePlanCode(fromFragment(fragment)))
  // A dropped target would leave a smaller plan solving cleanly and quietly
  // pinning the wrong factory.
  expect(report.warnings).toEqual([])
  return solveSeeded()
}

/** The module list and the routes over it, as LayoutPanel derives them. */
function derive(result: PlanResult): {
  modules: FactoryModule[]
  modulesById: Map<string, FactoryModule>
  routes: Route[]
} {
  const modules = deriveModules(result)
  const planner = usePlannerStore.getState()
  return {
    modules,
    modulesById: new Map(modules.map((module) => [module.id, module])),
    routes: deriveRoutes(modules, planner.targets, result.surplus, planner.tier),
  }
}

/**
 * Empties every floor, and reports what was on them before it did.
 *
 * Every floor rather than the active one alone: autoArrange is handed the whole
 * placement map (`LayoutCanvas.tsx:1509`) and settle spreads it (`:1278`), even
 * though it packs a single floor, so a block left anywhere in the stack would
 * ride into the committed arrangement.
 */
function clearEveryFloor(): string[] {
  const before = Object.keys(useLayoutStore.getState().placements)
  for (const floor of useLayoutStore.getState().floors) {
    useLayoutStore.getState().clearFloor(floor.id)
  }
  return before
}

test('the dense compact floor still arranges to its committed golden', () => {
  // 5 late game targets at tier 8 pull in a chain of 27 machine blocks plus one
  // depot, and the reserves are what put the depot there: Iron Plate is held at
  // a fixed 500 and Cable is sized from surplus.
  const result = seedAndSolve(DENSE_COMPACT)
  expect(result.status).toBe('optimal')

  const { modules, modulesById, routes } = derive(result)

  // The floor is emptied before the call and asserted empty, so the golden is a
  // function of the plan rather than of the fixture link's own P array, which
  // is the failure a golden cannot detect from the inside.
  expect(clearEveryFloor()).toEqual([])
  expect(useLayoutStore.getState().placements).toEqual({})

  const { overflow } = autoArrange(modules, {
    // compact and east are literals because ArrangeMode and Growth live in
    // uiStore and never in a plan code, so a fixture's mode is how this harness
    // arranges it and not something its link carries.
    mode: 'compact',
    growth: 'east',
    routes,
    // Also a literal. The app takes the lane from uiStore.lane, which is backed
    // by localStorage, so reading it would tie a committed golden to whichever
    // browser profile last touched the machine. 8 is that store's default and
    // it is also SERVICE_M and FOUNDATION_M.
    service: 8,
  })
  // A trayed block means the 40 by 80 floor stopped being big enough, which
  // would pin a half arranged plan rather than a packing.
  expect(overflow.map((module) => module.id)).toEqual([])

  // Pinned, so a fixture that quietly loses half its blocks fails here at the
  // top of the diff instead of as forty moved coordinates further down.
  expect(Object.keys(useLayoutStore.getState().placements).length).toBe(28)

  // packByColumns on the name seed is the packing that survived this floor, and
  // packByStage holds none of it, so this is the golden guarding the column
  // packer. See docs/golden-fixtures.md for the full candidate table.
  expect(observe(modules, modulesById, routes)).toEqual(denseGolden)
})

test('the multi floor stack still arranges to its committed golden', () => {
  // Versatile Framework, Smart Plating and Motor over three 14 by 14 production
  // floors and one 8 by 8 storage floor. The floors are small on purpose: the
  // 16 production blocks land 7, 8 and 1, so the fixture really does reach
  // floor to floor handoff, alignLifts and cross floor shaft congestion.
  const result = seedAndSolve(MULTI_FLOOR)
  expect(result.status).toBe('optimal')

  const { modules, modulesById, routes } = derive(result)

  // No clearFloor here, and the asymmetry is the point: arrangeStack starts
  // from an empty placement map of its own (`LayoutCanvas.tsx:1549`), so there
  // is nothing to clear and nothing that could steer it.
  const { overflow } = arrangeStack(modules, {
    mode: 'compact',
    growth: 'east',
    routes,
    service: 8,
  })
  expect(overflow.map((module) => module.id)).toEqual([])

  expect(Object.keys(useLayoutStore.getState().placements).length).toBe(18)

  // Read out of the store rather than off the return value, because arrangeStack
  // commits a second time through alignLifts after applyArrangement.
  expect(observe(modules, modulesById, routes)).toEqual(multiGolden)
})

test('the bus corridor still arranges to its committed golden', () => {
  // Reinforced Iron Plate and Rotor at 10 a minute each, six blocks, laid along
  // a corridor. packAsBus short circuits the candidate tournament outright
  // (`LayoutCanvas.tsx:1366`), so this is the only fixture guarding that branch.
  const result = seedAndSolve(BUS_MODE)
  expect(result.status).toBe('optimal')

  const { modules, modulesById, routes } = derive(result)

  expect(clearEveryFloor()).toEqual([])
  expect(useLayoutStore.getState().placements).toEqual({})

  const { overflow } = autoArrange(modules, {
    // bus is how this harness arranges the plan, not something the link carries.
    // Opening the committed URL in the app shows a compact arrangement, and the
    // link is not corrupt for showing one.
    mode: 'bus',
    growth: 'east',
    routes,
    service: 8,
  })
  expect(overflow.map((module) => module.id)).toEqual([])

  expect(Object.keys(useLayoutStore.getState().placements).length).toBe(6)

  expect(observe(modules, modulesById, routes)).toEqual(busGolden)
})
