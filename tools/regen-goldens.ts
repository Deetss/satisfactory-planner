// Regenerates the golden fixtures: the three share links, the three arrangements
// they produce, and the document that describes them.
//
// The output is committed and shipped with the repo, the way the extracted game
// data and the icons are, so the suite has a baseline to diff against without
// anyone having to produce one by hand first.
//
// The regeneration rule, which is the whole point of the script being separate:
// the goldens become a baseline at the moment of the first green suite run, and
// after that a golden diff is a finding and not a regeneration trigger. Running
// this to make a red suite go green destroys the only evidence that the engine
// changed its answers.
//
// Usage: npm run goldens
//
// It is shaped as a vitest file, with a beforeAll that loads HiGHS and one test
// that performs the whole regeneration, because that is what gets it the React
// plugin. It is .ts under tools/ rather than .mjs under scripts/ for the same
// reason: it imports LayoutCanvas.tsx. Only vitest.regen.config.ts reaches it,
// and npm test cannot, because its name is not a test file name.
//
// This file sits outside tsconfig.json's include, exactly as the two scripts/
// entries do, so tsc never reads it and node globals such as node:fs and
// import.meta.url are available here that are not available under test/. That is
// deliberate. Do not add tools to the include to close the gap: it would demand
// @types/node, which D-12 does not permit. The honest consequence is that this
// file is proven by being run, not by a typecheck.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import highsLoader from 'highs'
import { beforeAll, expect, test } from 'vitest'

import { arrangeStack, autoArrange } from '../src/components/LayoutCanvas'
import type { ArrangePlan } from '../src/components/LayoutCanvas'
import type { ArrangeMode, Growth } from '../src/layout/bus'
import { packByColumns } from '../src/layout/columns'
import { analyseFloor } from '../src/layout/congestion'
import { useLayoutStore } from '../src/layout/layoutStore'
import { modulesFromPlan } from '../src/layout/modules'
import { EDGE_M, packByStage } from '../src/layout/pack'
import type { PackedModule } from '../src/layout/pack'
import { routePaths } from '../src/layout/paths'
import { deriveRoutes } from '../src/layout/routes'
import type { Route } from '../src/layout/routes'
import { storageModules } from '../src/layout/storage'
import type { Reserve } from '../src/layout/storage'
import { flowsOf, scoreFloor } from '../src/layout/tidy'
import {
  DEFAULT_FLOOR_HEIGHT_M,
  FOUNDATION_M,
  floorRole,
} from '../src/layout/types'
import type { FactoryModule, FloorRole } from '../src/layout/types'
import { interpretSolution } from '../src/solver/interpret'
import type { PlanResult } from '../src/solver/interpret'
import { toLpFormat } from '../src/solver/lp'
import { buildModel } from '../src/solver/model'
import { decodePlanCode, encodePlanCode } from '../src/state/planCode'
import { applyPlan, buildPlanFile } from '../src/state/planFile'
import type { PlanFile } from '../src/state/planFile'
import { selectPlanRequest, usePlannerStore } from '../src/state/plannerStore'
import { currentFragment } from '../src/state/shareLink'
import { roundMetres, roundScore } from '../test/golden/round'
import type { Golden } from '../test/golden/round'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const GOLDEN_DIR = path.join(ROOT, 'test/golden')
const FIXTURE_FILE = path.join(ROOT, 'test/fixtures/plans.ts')
const DOC_FILE = path.join(ROOT, 'docs/golden-fixtures.md')

/** Where a reader is expected to paste a fixture link, fixed by DEPL-03. */
const SITE = 'https://deetss.github.io/satisfactory-planner/'

interface Fixture {
  /** The export name in test/fixtures/plans.ts. */
  name: string
  /** The stem of its golden under test/golden/. */
  stem: string
  /** Sentence for the fixture module's doc comment. */
  doc: string
  /** Which arrange entry point this fixture exists to cover. */
  arrange: 'floor' | 'stack'
  /**
   * Literals, not reads. `ArrangeMode` and `Growth` live in `uiStore` and never
   * in a plan code, so a fixture's mode is how the harness arranges it and not
   * something its link carries.
   */
  mode: ArrangeMode
  growth: Growth
  seed: Partial<PlanFile>
  /** Numbered, checkable claims for the fixtures document. */
  reproduces: string[]
}

/**
 * A plan and a stack of empty floors, with everything a fixture has no opinion
 * about left at the store's own defaults.
 *
 * Floors carry no placements: the golden is meant to be a function of the plan,
 * and a fixture that shipped its own arrangement would steer the tournament it
 * is supposed to be measuring.
 */
function planSeed(
  targets: Record<string, number>,
  floors: {
    name: string
    gridWidth: number
    gridDepth: number
    role?: FloorRole
  }[],
  reserves: Reserve[] = [],
): Partial<PlanFile> {
  return {
    plan: {
      targets,
      objective: 'resources',
      tier: 8,
      unlockedAlternates: [],
      resourceCaps: {},
      allowSurplus: true,
      powerGenerators: [],
      machineOverrides: {},
    },
    layout: {
      floors: floors.map((floor, index) => ({
        id: `floor-${index + 1}`,
        name: floor.name,
        role: floor.role ?? 'production',
        elevation: index === 0 ? 0 : DEFAULT_FLOOR_HEIGHT_M,
        gridWidth: floor.gridWidth,
        gridDepth: floor.gridDepth,
        originX: 0,
        originY: 0,
      })),
      activeFloorId: 'floor-1',
      placements: {},
      snapMetres: FOUNDATION_M,
      reserves,
      manualLinks: [],
      routeOverrides: {},
      fittings: [],
    },
  }
}

/**
 * Three fixtures chosen for code path coverage rather than as a size ladder, so
 * between them the compact tournament, the whole stack path and the bus packer
 * are all under the gate.
 */
const FIXTURES: Fixture[] = [
  {
    name: 'DENSE_COMPACT',
    stem: 'dense-compact',
    doc: [
      'A deep chain on one Ground floor, arranged compact.',
      '',
      'The densest of the three and the tournament\'s real worst case, which is',
      'why it is also the fixture the Phase 12 perf baseline drives. Covers the',
      'candidate tournament in src/components/LayoutCanvas.tsx: several seeded',
      'packings, one polish round each, and the measured best kept.',
    ].join('\n'),
    arrange: 'floor',
    mode: 'compact',
    growth: 'east',
    seed: planSeed(
      {
        // Five late-game parts at low rates. Low on purpose: the fixture wants
        // many distinct blocks, not many machines inside a few of them.
        Desc_ModularFrameHeavy_C: 2,
        Desc_Computer_C: 2,
        Desc_Motor_C: 5,
        Desc_CrystalOscillator_C: 1,
        Desc_CircuitBoardHighSpeed_C: 2,
      },
      [{ name: 'Ground', gridWidth: 40, gridDepth: 80 }],
      [
        { item: 'Desc_IronPlate_C', mode: 'fixed', quantity: 500, bufferMinutes: 60 },
        { item: 'Desc_Cable_C', mode: 'excess', quantity: 0, bufferMinutes: 30 },
      ],
    ),
    reproduces: [
      'The Produce panel listing all five targets at the rates in the table above.',
      'One Ground floor, no blocks placed, because the link carries the plan and not an arrangement.',
      'Two reserves in the Storage panel, one fixed and one sized from surplus.',
    ],
  },
  {
    name: 'MULTI_FLOOR',
    stem: 'multi-floor',
    doc: [
      'Three production floors and a dedicated storage floor, arranged as a',
      'whole stack.',
      '',
      'The floors are small on purpose, so production really does spill upward',
      'rather than all landing on the ground floor. This is the only fixture',
      'that exercises floor to floor handoff, lift alignment and cross floor',
      'shaft congestion.',
    ].join('\n'),
    arrange: 'stack',
    mode: 'compact',
    growth: 'east',
    seed: planSeed(
      {
        Desc_SpaceElevatorPart_2_C: 2,
        Desc_SpaceElevatorPart_1_C: 2,
        Desc_Motor_C: 5,
      },
      [
        { name: 'Ground', gridWidth: 14, gridDepth: 14 },
        { name: 'Level 2', gridWidth: 14, gridDepth: 14 },
        { name: 'Level 3', gridWidth: 14, gridDepth: 14 },
        { name: 'Stores', gridWidth: 8, gridDepth: 8, role: 'storage' },
      ],
      [
        { item: 'Desc_IronRod_C', mode: 'fixed', quantity: 400, bufferMinutes: 60 },
        { item: 'Desc_Wire_C', mode: 'fixed', quantity: 800, bufferMinutes: 60 },
      ],
    ),
    reproduces: [
      'Four floors in the floor list, the last of them marked as storage.',
      'No blocks placed on any floor, for the same reason as the dense fixture.',
      'The Produce panel listing Versatile Framework, Smart Plating and Motor.',
    ],
  },
  {
    name: 'BUS_MODE',
    stem: 'bus-mode',
    doc: [
      'A short chain arranged along a bus corridor rather than packed.',
      '',
      'Arrange mode lives in uiStore and cannot ride in a link, so opening this',
      'URL in the app shows a compact arrangement. Bus is how the harness',
      'arranges the plan, not something the link carries, and the link is not',
      'corrupt for showing otherwise.',
      '',
      'Covers packAsBus, which short circuits the candidate tournament outright,',
      'so it is the one fixture that guards the other branch.',
    ].join('\n'),
    arrange: 'floor',
    mode: 'bus',
    growth: 'east',
    seed: planSeed(
      {
        Desc_IronPlateReinforced_C: 10,
        Desc_Rotor_C: 10,
      },
      [{ name: 'Ground', gridWidth: 24, gridDepth: 16 }],
    ),
    reproduces: [
      'The Produce panel listing Reinforced Iron Plate and Rotor at 10 per minute each.',
      'A compact arrangement rather than a bus, which is expected and is explained above.',
      'One Ground floor, no blocks placed.',
    ],
  },
]

type Highs = Awaited<ReturnType<typeof highsLoader>>
let highs: Highs

beforeAll(async () => {
  // Loaded directly rather than through the app's solver entry point, which
  // reaches its WASM through a Vite `?url` asset import and so hands the loader
  // a served URL where node needs a path it can open. This is the same
  // bootstrap test/solver.test.ts has been using.
  highs = await highsLoader()
})

/**
 * Solves whatever is currently in the planner store, through the app's own
 * selector so the fixture's tier, alternates, caps and surplus rule are honoured
 * without this file restating any of them.
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

/** One candidate packing, as the tournament built it. */
interface Candidate {
  name: string
  /** Blocks this packing could not fit, which is what decides the field. */
  overflow: number
  /** Blocks it put exactly where they finished, so the polish never moved them. */
  matched: number
}

/** Which candidate packing survived the tournament, and by how much. */
interface Attribution {
  /** Blocks that landed on the arranged floor. */
  total: number
  /** Every candidate, best survivor count first. */
  tally: Candidate[]
}

/**
 * Reads back which packer put the blocks where they ended up.
 *
 * OQ-2 asks whether the dense golden guards `packByColumns` or the `packByStage`
 * fallback, and the tournament will not say: `ArrangeResult` carries no winning
 * seed and D-04 declines to add one so `LayoutCanvas.tsx` stays untouched before
 * its Phase 9 move. So the candidates are re-run here against the same bounds,
 * the same flows and the same lane the tournament used, and each one's raw
 * positions are matched against what actually landed.
 *
 * A match is a block the polish rounds never had to move, so the counts are a
 * plurality rather than a majority: on a tangled floor `nudgeTangled` relocates
 * most of what it is given. The candidate still holding placements at the end is
 * the one the tournament kept, and a candidate holding none of them is not.
 *
 * Observed and not asserted, as the plan asks: a run that cannot tell the
 * candidates apart says so in the document rather than failing. Pure reads of
 * pure functions, no store writes.
 */
function attribute(
  fixture: Fixture,
  modules: FactoryModule[],
  routes: Route[],
): Attribution | null {
  // Only the compact single floor path is reproducible from outside. A stack is
  // arranged floor by floor off the previous floor's overflow, and bus never
  // reaches the tournament at all.
  if (fixture.arrange !== 'floor' || fixture.mode === 'bus') return null

  const layout = useLayoutStore.getState()
  const floor = layout.floors.find((f) => f.id === layout.activeFloorId)
  if (!floor) return null

  // The same three numbers arrangeOnto derives, derived the same way. The lane
  // is the literal the arrange plan carried, and the compact border is only the
  // shortfall because the packers already leave the lane around an edge block.
  const service = 8
  const edge = Math.max(0, EDGE_M - service)
  const bounds = {
    width: Math.max(0, floor.gridWidth * FOUNDATION_M - edge * 2),
    depth: Math.max(0, floor.gridDepth * FOUNDATION_M - edge * 2),
  }
  const flows = flowsOf(routes)

  // arrangeOnto sorts by id before it packs, so an unsorted list here would hand
  // the packers a different problem than the one the tournament solved.
  const sorted = modules.slice().sort((a, b) => a.id.localeCompare(b.id))

  const matches = (packed: PackedModule[]) =>
    packed.filter((item) => {
      const placement = layout.placements[item.module.id]
      return (
        placement !== undefined &&
        placement.floorId === floor.id &&
        placement.x === item.x + edge &&
        placement.y === item.y + edge
      )
    }).length

  const tally: Candidate[] = []
  for (const seed of ['depth', 'name', 'shallow'] as const) {
    const candidate = packByColumns(sorted, { bounds, flows, service, seed })
    // Null means this seed produced nothing at all, so the tournament never saw
    // it and the document should not list it as a contender.
    if (candidate) {
      tally.push({
        name: `\`packByColumns\` on the ${seed} seed`,
        overflow: candidate.overflow.length,
        matched: matches(candidate.packed),
      })
    }
  }
  const stage = packByStage(sorted, { bounds, flows, service })
  tally.push({
    name: '`packByStage`',
    overflow: stage.overflow.length,
    matched: matches(stage.packed),
  })

  // A stable sort, so a tie keeps the tournament's own arrival order: the three
  // column seeds in the order it tries them, then the stage packer.
  tally.sort((a, b) => b.matched - a.matched)

  return {
    total: Object.values(layout.placements).filter(
      (placement) => placement.floorId === floor.id,
    ).length,
    tally,
  }
}

/** What one fixture's run produced, for the fixtures document. */
interface Recorded {
  fixture: Fixture
  fragment: string
  /** The banner the app raises on opening the link, read off the import report. */
  banner: string
  modules: number
  placed: number
  overflow: number
  floors: { name: string; gridWidth: number; gridDepth: number; role: string }[]
  packing: Attribution | null
}

function regenerate(fixture: Fixture): Recorded {
  // Seeded through the app's own import path, which runs both normalizers. A
  // bare setState would skip them and let this file produce a shape the running
  // app never produces.
  applyPlan(fixture.seed)

  // Both come off the same store state: the fragment is what the address bar
  // would hold, and the code is the text inside it that decodePlanCode reads.
  // The plain 2. form rather than the deflated one, because it is base64url of
  // the plan code text, so the same plan always yields the same characters.
  const fragment = currentFragment()
  const code = encodePlanCode(buildPlanFile(''))

  // Round tripped before anything is measured, so the golden is a function of
  // what the committed link actually carries rather than of the literal above.
  const report = applyPlan(decodePlanCode(code))
  expect(report.warnings).toEqual([])

  const result = solveSeeded()
  // A fixture that stops solving is a finding, not a branch worth capturing.
  expect(result.status).toBe('optimal')

  const modules = deriveModules(result)
  const modulesById = new Map(modules.map((module) => [module.id, module]))
  const planner = usePlannerStore.getState()
  const routes = deriveRoutes(modules, planner.targets, result.surplus, planner.tier)

  const arrangePlan: ArrangePlan = {
    mode: fixture.mode,
    growth: fixture.growth,
    routes,
    // Literal, never a read. The app takes the lane from `uiStore.lane`, which
    // is backed by localStorage, so reading it would make a committed golden
    // depend on whichever browser profile last touched the machine. 8 is that
    // store's default and it is also `SERVICE_M` and `FOUNDATION_M`.
    service: 8,
  }

  let overflow: FactoryModule[]
  if (fixture.arrange === 'stack') {
    // No clearFloor here, and the asymmetry is the point: arrangeStack starts
    // from an empty placement map of its own, so there is nothing to clear.
    overflow = arrangeStack(modules, arrangePlan).overflow
  } else {
    // autoArrange, unlike arrangeStack, reads the placements already in the
    // store and settle spreads them, so anything left behind would steer the
    // tournament and stop the golden being a function of the plan. Every floor
    // is cleared and not just the active one, because the placement map
    // autoArrange is handed covers the whole stack even though it packs one
    // floor.
    for (const floor of useLayoutStore.getState().floors) {
      useLayoutStore.getState().clearFloor(floor.id)
    }
    expect(Object.keys(useLayoutStore.getState().placements)).toEqual([])
    overflow = autoArrange(modules, arrangePlan).overflow
  }

  // Read back out of the store rather than off the return value: arrangeStack
  // commits a second time through alignLifts after applyArrangement.
  const layout = useLayoutStore.getState()

  // A trayed block means the floor is too small for the packing to survive.
  // Widen the fixture's floors rather than accepting a golden that pins a
  // half-arranged plan.
  expect(
    overflow.map((module) => module.id),
    `${fixture.name}: blocks did not fit, widen its floors`,
  ).toEqual([])

  const golden = observe(modules, modulesById, routes)
  fs.mkdirSync(GOLDEN_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(GOLDEN_DIR, `${fixture.stem}.json`),
    `${JSON.stringify(golden, null, 2)}\n`,
  )

  return {
    fixture,
    fragment,
    banner: `Opened ${report.name} from a link: ${count(report.floors, 'floor')}, ${count(
      report.placements,
      'placed block',
    )}.`,
    modules: modules.length,
    placed: Object.keys(layout.placements).length,
    overflow: overflow.length,
    floors: layout.floors.map((floor) => ({
      name: floor.name,
      gridWidth: floor.gridWidth,
      gridDepth: floor.gridDepth,
      role: floorRole(floor),
    })),
    packing: attribute(fixture, modules, routes),
  }
}

/** The app's own plural, so a quoted banner matches the one on screen. */
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** The fixture module the harness imports, strings and doc comments together. */
function fixtureModule(records: Recorded[]): string {
  const body = records
    .map((record) => {
      const doc = record.fixture.doc
        .split('\n')
        .map((line) => (line === '' ? ' *' : ` * ${line}`))
        .join('\n')
      return `/**\n${doc}\n */\nexport const ${record.fixture.name} =\n  '${record.fragment}'\n`
    })
    .join('\n')

  return `// The three golden fixture links, as plain 2. fragments.
//
// Generated by npm run goldens, together with the goldens in test/golden/ and
// docs/golden-fixtures.md. Never hand edit any of the three: they come out of
// one run, and editing one silently decouples it from the other two.

${body}`
}

/**
 * The fixtures document's answer to OQ-2: which packer this golden guards.
 *
 * Written from the tally rather than from a claim, so the margin is visible.
 * A reader who wants the dense fixture to guard the column packer and finds the
 * stage packer at the top of the table knows to widen the floor and regenerate,
 * which is the loop the plan describes.
 */
function attributionSection(record: Recorded): string {
  const { fixture, packing } = record

  if (fixture.mode === 'bus') {
    return 'Arranged by `packAsBus`, which short circuits the candidate tournament, so this golden guards the corridor rather than the packers.'
  }

  if (!packing) {
    return [
      'Arranged by `arrangeStack`, one floor at a time off the previous floor\'s',
      'overflow, so no single candidate packing can be matched against the',
      'result the way the single floor fixtures are. Nothing went to the tray,',
      'so every floor had a candidate field to choose from.',
    ].join(' ')
  }

  const table = [
    '| Candidate | Blocks it trayed | Placements it still holds |',
    '|---|---|---|',
    ...packing.tally.map(
      (candidate) =>
        `| ${candidate.name} | ${candidate.overflow} | ${candidate.matched} of ${packing.total} |`,
    ),
  ].join('\n')

  const best = packing.tally[0]
  const verdict =
    best.matched === 0
      ? [
          'Every candidate was moved off its own positions by the polish rounds,',
          'so the surviving placements cannot say which packing won. Nothing in',
          'the golden is wrong; the attribution is simply unavailable this run.',
        ].join(' ')
      : best.name.includes('packByColumns')
        ? [
            `${best.name} still holds ${best.matched} of them and \`packByStage\``,
            `holds ${packing.tally.find((c) => c.name === '`packByStage`')?.matched ?? 0},`,
            'so this golden guards the column packer rather than the stage',
            'fallback, which is what OQ-2 asked for.',
          ].join(' ')
        : [
            '`packByStage` holds more of them than any column seed, so this golden',
            'guards the stage fallback. Widen the floor\'s `gridWidth` and run',
            '`npm run goldens` again if the column packer is the path you meant',
            'to guard.',
          ].join(' ')

  return `Every candidate the tournament builds was produced and measured here against the same bounds, flows and lane it used, then matched against what actually landed on the floor.

${table}

A held placement is one the polish rounds never had to move, so these are pluralities and not majorities: \`nudgeTangled\` relocates most of a tangled floor. ${verdict}

Which seed the tournament itself picked is not reported anywhere: \`ArrangeResult\` carries no winner and D-04 declines to add one so \`LayoutCanvas.tsx\` stays untouched before its Phase 9 move. This table is a reading of the result, not a value the engine emitted.`
}

/** The fixtures document, written from the same run so it cannot drift. */
function fixtureDoc(records: Recorded[]): string {
  const sections = records.map((record) => {
    const { fixture } = record
    const url = `${SITE}#${record.fragment}`
    const floors = record.floors
      .map((floor) => `${floor.name} ${floor.gridWidth} by ${floor.gridDepth}${
        floor.role === 'storage' ? ' (storage)' : ''
      }`)
      .join(', ')

    const table = [
      '| Field | Value |',
      '|---|---|',
      `| Export | \`${fixture.name}\` in \`test/fixtures/plans.ts\` |`,
      `| Golden | \`test/golden/${fixture.stem}.json\` |`,
      `| Arranged with | \`${fixture.arrange === 'stack' ? 'arrangeStack' : 'autoArrange'}\` |`,
      `| Arrange mode | \`${fixture.mode}\`, growing \`${fixture.growth}\` |`,
      '| Service lane | 8 m |',
      `| Floors | ${floors} |`,
      `| Blocks in the plan | ${record.modules} |`,
      `| Blocks placed | ${record.placed} |`,
      `| Blocks in the tray | ${record.overflow} |`,
      `| Fragment length | ${record.fragment.length} characters |`,
    ].join('\n')

    const packer = attributionSection(record)

    const caveat =
      fixture.mode === 'bus'
        ? '\nOpening this URL shows a **compact** arrangement, not a bus. `ArrangeMode` lives in `uiStore` and cannot ride in a link, so bus is how the harness arranges this plan rather than something the link carries. The link is not corrupt.\n'
        : ''

    return `## ${fixture.name}

${fixture.doc.split('\n').filter((line) => line !== '').join(' ')}

${table}

### The fragment

\`\`\`
#${record.fragment}
\`\`\`

### The full link

\`\`\`
${url}
\`\`\`
${caveat}
### What opening it must reproduce

${fixture.reproduces.map((line, i) => `${i + 1}. ${line}`).join('\n')}

The success banner reads \`${record.banner}\` The failure banner starts with \`That link didn't open.\` and carries the \`banner--bad\` class, so the two are distinguishable in the DOM as well as on screen.

### Which packer this golden captured

${packer}
`
  })

  return `# Golden fixtures

The three committed plans behind the golden harness, and the openable links for them. Phase 6's audit drives the dense one against the live site, and Phase 12 re-runs the perf baseline on the same plan.

Generated by \`npm run goldens\`, along with \`test/fixtures/plans.ts\` and the goldens under \`test/golden/\`. Do not hand edit any of it: all of it comes out of one run, and editing one file silently decouples it from the other two.

${sections.join('\n')}
## The regeneration rule

The goldens become a baseline at the moment of the first green suite run. After that a golden diff is a finding and not a regeneration trigger.

Running \`npm run goldens\` to make a red suite go green destroys the only evidence that the engine changed its answers, which is the entire reason the regeneration lives behind its own script and its own vitest config instead of behind a flag on the suite. \`npm test\` is \`vitest run\` and cannot reach the generator, because \`tools/regen-goldens.ts\` is not a test file name and \`vitest.regen.config.ts\` is not auto loaded.

Regenerate when a golden is **meant** to change: a deliberate packer change, a refreshed \`game-data.json\`, a new fixture. Say which in the commit message.
`
}

test(
  'regenerates the fixture links, the goldens and the fixtures document',
  () => {
    const records = FIXTURES.map(regenerate)

    fs.mkdirSync(path.dirname(FIXTURE_FILE), { recursive: true })
    fs.writeFileSync(FIXTURE_FILE, fixtureModule(records))
    fs.writeFileSync(DOC_FILE, fixtureDoc(records))
  },
  // Three real solves and three real arrangements. The dense one alone runs a
  // whole candidate tournament, which is seconds rather than milliseconds.
  300_000,
)
