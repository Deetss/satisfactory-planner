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
import { analyseFloor } from '../src/layout/congestion'
import { useLayoutStore } from '../src/layout/layoutStore'
import { modulesFromPlan } from '../src/layout/modules'
import { routePaths } from '../src/layout/paths'
import { deriveRoutes } from '../src/layout/routes'
import type { Route } from '../src/layout/routes'
import { storageModules } from '../src/layout/storage'
import type { Reserve } from '../src/layout/storage'
import { scoreFloor } from '../src/layout/tidy'
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
      [{ name: 'Ground', gridWidth: 24, gridDepth: 16 }],
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
        { name: 'Ground', gridWidth: 10, gridDepth: 8 },
        { name: 'Level 2', gridWidth: 10, gridDepth: 8 },
        { name: 'Level 3', gridWidth: 10, gridDepth: 8 },
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
      [{ name: 'Ground', gridWidth: 24, gridDepth: 12 }],
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

    const packer =
      fixture.mode === 'bus'
        ? 'Arranged by `packAsBus`, which short circuits the candidate tournament, so this golden guards the corridor rather than the packers.'
        : [
            'Nothing went to the tray, so the tournament had a non-empty candidate',
            'field and this golden captures a polished packing rather than the',
            'degenerate fallback that fires only when every packer returns nothing.',
            'Which seed won is not recorded: naming it would mean adding a field to',
            '`ArrangeResult`, which D-04 declines so `LayoutCanvas.tsx` stays',
            'untouched before its Phase 9 move.',
          ].join(' ')

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
