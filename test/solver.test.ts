import highsLoader from 'highs'
import { beforeAll, expect, test } from 'vitest'

import { gameData, recipes } from '../src/data/gameData'
import { interpretSolution, type PlanResult } from '../src/solver/interpret'
import { toLpFormat } from '../src/solver/lp'
import { buildModel, type PlanRequest } from '../src/solver/model'

type Highs = Awaited<ReturnType<typeof highsLoader>>
let highs: Highs

beforeAll(async () => {
  highs = await highsLoader()
})

/** Every standard (non-alternate) recipe. */
const standardRecipes = new Set(
  Object.values(recipes)
    .filter((r) => !r.isAlternate)
    .map((r) => r.className),
)

type PlanOverrides = Partial<PlanRequest>

function plan(overrides: PlanOverrides = {}): PlanResult {
  const request: PlanRequest = {
    targets: {},
    enabledRecipes: standardRecipes,
    resourceCaps: {},
    objective: 'resources',
    allowSurplus: () => true,
    powerGeneration: null,
    ...overrides,
  }

  const { problem, registry } = buildModel(request)
  const lp = toLpFormat(problem)
  const solution = highs.solve(lp, { output_flag: false, log_to_console: false })

  if (solution.Status !== 'Optimal') {
    return {
      status: solution.Status === 'Infeasible' ? 'infeasible' : 'error',
      message: solution.Status,
      objectiveValue: 0,
      machineGroups: [],
      generatorGroups: [],
      extraction: [],
      surplus: [],
      totals: {
        machines: 0,
        powerConsumed: 0,
        powerConsumedUnderclocked: 0,
        powerProduced: 0,
        buildingCounts: {},
      },
      netRates: {},
      lp,
    }
  }

  const columns: Record<string, number> = {}
  for (const [id, col] of Object.entries(solution.Columns)) {
    columns[id] = 'Primal' in col ? (col.Primal ?? 0) : 0
  }
  return interpretSolution(request, registry, columns, solution.ObjectiveValue, lp)
}

const machinesFor = (result: PlanResult, recipeClass: string) =>
  result.machineGroups.find((g) => g.recipe === recipeClass)?.machines ?? 0

const extractionOf = (result: PlanResult, item: string) =>
  result.extraction.find((e) => e.item === item)?.rate ?? 0

test('iron ingots: 30/min is one smelter on 30 ore', () => {
  const result = plan({ targets: { Desc_IronIngot_C: 30 } })
  expect(result.status).toBe('optimal')
  expect(machinesFor(result, 'Recipe_IngotIron_C')).toBeCloseTo(1, 6)
  expect(extractionOf(result, 'Desc_OreIron_C')).toBeCloseTo(30, 6)
  expect(result.totals.powerConsumed).toBeCloseTo(4, 6)
})

test('steel ingots: 45/min is one foundry on 45 ore + 45 coal', () => {
  const result = plan({ targets: { Desc_IngotSteel_C: 45 } })
  expect(result.status).toBe('optimal')
  expect(machinesFor(result, 'Recipe_IngotSteel_C')).toBeCloseTo(1, 6)
  expect(extractionOf(result, 'Desc_OreIron_C')).toBeCloseTo(45, 6)
  expect(extractionOf(result, 'Desc_Coal_C')).toBeCloseTo(45, 6)
})

test('reinforced iron plate: 60/min matches the hand-computed chain', () => {
  const result = plan({ targets: { Desc_IronPlateReinforced_C: 60 } })
  expect(result.status).toBe('optimal')

  // 12 Assemblers -> 360 plate + 720 screws -> 180 rod -> 720 ingots.
  expect(machinesFor(result, 'Recipe_IronPlateReinforced_C')).toBeCloseTo(12, 6)
  expect(machinesFor(result, 'Recipe_IronPlate_C')).toBeCloseTo(18, 6)
  expect(machinesFor(result, 'Recipe_Screw_C')).toBeCloseTo(18, 6)
  expect(machinesFor(result, 'Recipe_IronRod_C')).toBeCloseTo(12, 6)
  expect(machinesFor(result, 'Recipe_IngotIron_C')).toBeCloseTo(24, 6)
  expect(extractionOf(result, 'Desc_OreIron_C')).toBeCloseTo(720, 6)
  expect(result.totals.powerConsumed).toBeCloseTo(468, 6)
  expect(result.surplus).toHaveLength(0)
})

test('alternates reduce ore use when the solver may pick them', () => {
  const standard = plan({ targets: { Desc_IronPlateReinforced_C: 60 } })
  const withAlternates = plan({
    targets: { Desc_IronPlateReinforced_C: 60 },
    enabledRecipes: new Set(Object.keys(recipes)),
  })

  expect(withAlternates.status).toBe('optimal')
  expect(extractionOf(withAlternates, 'Desc_OreIron_C')).toBeLessThan(
    extractionOf(standard, 'Desc_OreIron_C'),
  )
})

test('byproducts must be consumed when surplus is disallowed', () => {
  const strict = plan({
    targets: { Desc_Plastic_C: 20 },
    // Water is free and unlimited, so leaving it unbalanced is not a mistake.
    allowSurplus: (item) => item === 'Desc_Water_C',
  })

  expect(strict.status).toBe('optimal')
  expect(
    strict.surplus.find((s) => s.item === 'Desc_HeavyOilResidue_C'),
  ).toBeUndefined()

  for (const [item, net] of Object.entries(strict.netRates)) {
    if (item === 'Desc_Plastic_C' || item === 'Desc_Water_C') continue
    expect(net, `net rate of ${gameData.items[item]?.name ?? item}`).toBeCloseTo(0, 6)
  }
})

test('every item balances: production minus consumption equals target plus surplus', () => {
  const targets = { Desc_ModularFrameHeavy_C: 5 }
  const result = plan({ targets })
  expect(result.status).toBe('optimal')

  for (const [item, net] of Object.entries(result.netRates)) {
    const target = (targets as Record<string, number>)[item] ?? 0
    const surplus = result.surplus.find((s) => s.item === item)?.rate ?? 0
    expect(net, `balance for ${gameData.items[item]?.name ?? item}`).toBeCloseTo(
      target + surplus,
      6,
    )
  }
})

test('resource limits make an over-ambitious target infeasible', () => {
  const result = plan({
    targets: { Desc_IronIngot_C: 1000 },
    resourceCaps: { Desc_OreIron_C: 100 },
  })
  expect(result.status).toBe('infeasible')
})

test('coal power covers its own draw and pulls 45 water per generator', () => {
  const result = plan({
    targets: { Desc_IngotSteel_C: 45 },
    powerGeneration: { generators: ['Build_GeneratorCoal_C'] },
  })
  expect(result.status).toBe('optimal')
  expect(result.totals.powerProduced).toBeGreaterThanOrEqual(
    result.totals.powerConsumed - 1e-6,
  )

  const coal = result.generatorGroups.find(
    (g) => g.generator === 'Build_GeneratorCoal_C',
  )
  expect(coal).toBeDefined()
  expect(coal!.fuelRate / coal!.count).toBeCloseTo(15, 6)
  expect(coal!.waterRate / coal!.count).toBeCloseTo(45, 6)

  // Coal burned by the generators has to appear in the ore budget too.
  expect(extractionOf(result, 'Desc_Coal_C')).toBeCloseTo(45 + coal!.fuelRate, 6)
})

test('underclocking never costs more power than running flat out', () => {
  const result = plan({ targets: { Desc_IronPlateReinforced_C: 7 } })
  expect(result.status).toBe('optimal')
  expect(result.totals.powerConsumedUnderclocked).toBeLessThanOrEqual(
    result.totals.powerConsumed + 1e-9,
  )

  for (const group of result.machineGroups) {
    expect(group.clock).toBeGreaterThan(0)
    expect(group.clock).toBeLessThanOrEqual(1 + 1e-9)
    expect(group.wholeMachines).toBeGreaterThanOrEqual(group.machines - 1e-9)
  }
})

test('a target nothing can produce is infeasible, not silently dropped', () => {
  expect(plan({ targets: { Desc_Leaves_C: 10 } }).status).toBe('infeasible')
})

test('maximize finds the ceiling the resource limits allow', () => {
  // 60 RIP/min needs 720 ore, so 240 ore supports exactly 20/min.
  const { problem, registry } = buildModel({
    targets: { Desc_IronPlateReinforced_C: 0 },
    enabledRecipes: standardRecipes,
    resourceCaps: { Desc_OreIron_C: 240 },
    objective: 'resources',
    allowSurplus: () => true,
    powerGeneration: null,
    maximize: { Desc_IronPlateReinforced_C: 1 },
  })

  const solution = highs.solve(toLpFormat(problem), {
    output_flag: false,
    log_to_console: false,
  })
  expect(solution.Status).toBe('Optimal')

  const maximized = registry
    .entries()
    .find(([, meta]) => meta.kind === 'maximized')
  expect(maximized).toBeDefined()

  const column = solution.Columns[maximized![0]]
  const rate = column && 'Primal' in column ? (column.Primal ?? 0) : 0
  expect(rate).toBeCloseTo(20, 6)
})

test('zero targets short-circuits to an empty plan', () => {
  const result = plan({ targets: {} })
  expect(result.status).toBe('optimal')
  expect(result.machineGroups).toHaveLength(0)
})

/** Solves a balanced mix and returns the rate each item lands on. */
function balance(
  shares: Record<string, number>,
  overrides: PlanOverrides = {},
): Record<string, number> | null {
  const zeroed: Record<string, number> = { ...(overrides.targets ?? {}) }
  for (const item of Object.keys(shares)) zeroed[item] = 0

  const { problem, registry } = buildModel({
    targets: zeroed,
    enabledRecipes: standardRecipes,
    resourceCaps: {},
    objective: 'resources',
    allowSurplus: () => true,
    powerGeneration: null,
    ...overrides,
    maximize: shares,
  })

  const solution = highs.solve(toLpFormat(problem), {
    output_flag: false,
    log_to_console: false,
  })
  if (solution.Status !== 'Optimal') return null

  for (const [id, meta] of registry.entries()) {
    if (meta.kind !== 'maximized') continue
    const col = solution.Columns[id]
    const factor = col && 'Primal' in col ? (col.Primal ?? 0) : 0
    return Object.fromEntries(
      Object.entries(meta.items).map(([item, share]) => [item, share * factor]),
    )
  }
  return null
}

test('an even split divides a limited resource equally between products', () => {
  // Iron Plate costs 1.5 ore each (3 ingot -> 2 plate); Iron Rod costs 1.
  // Equal rates k: 1.5k + k = 600, so k = 240.
  const rates = balance(
    { Desc_IronPlate_C: 1, Desc_IronRod_C: 1 },
    { resourceCaps: { Desc_OreIron_C: 600 } },
  )!
  expect(rates.Desc_IronPlate_C).toBeCloseTo(240, 4)
  expect(rates.Desc_IronRod_C).toBeCloseTo(240, 4)
})

test('fitting to limits keeps the ratio between targets', () => {
  // A 3:1 plate:rod mix. 1.5(3m) + 1(1m) = 5.5m = 600, so m = 1200/11.
  const rates = balance(
    { Desc_IronPlate_C: 3, Desc_IronRod_C: 1 },
    { resourceCaps: { Desc_OreIron_C: 600 } },
  )!
  expect(rates.Desc_IronPlate_C).toBeCloseTo(3600 / 11, 4)
  expect(rates.Desc_IronRod_C).toBeCloseTo(1200 / 11, 4)
  // The ratio the user asked for is preserved exactly.
  expect(rates.Desc_IronPlate_C / rates.Desc_IronRod_C).toBeCloseTo(3, 6)
})

test('a balanced mix consumes the limited resource fully', () => {
  const rates = balance(
    { Desc_IronPlate_C: 1, Desc_IronRod_C: 1 },
    { resourceCaps: { Desc_OreIron_C: 600 } },
  )!
  // 1.5 ore a plate plus 1 ore a rod should use the whole 600 budget.
  const oreUsed = rates.Desc_IronPlate_C * 1.5 + rates.Desc_IronRod_C
  expect(oreUsed).toBeCloseTo(600, 3)
})

test('maximizing one item alone still works through the shared path', () => {
  const rates = balance(
    { Desc_IronPlateReinforced_C: 1 },
    { resourceCaps: { Desc_OreIron_C: 240 } },
  )!
  expect(rates.Desc_IronPlateReinforced_C).toBeCloseTo(20, 4)
})

test('a preferred machine count sets the clock and shard requirement', () => {
  // 60 RIP/min needs 12 rod Constructors at 100%.
  const asSolved = plan({ targets: { Desc_IronPlateReinforced_C: 60 } })
  const rod = (r: PlanResult) =>
    r.machineGroups.find((g) => g.recipe === 'Recipe_IronRod_C')!

  expect(rod(asSolved).wholeMachines).toBe(12)
  expect(rod(asSolved).clock).toBeCloseTo(1, 6)
  expect(rod(asSolved).shardsEach).toBe(0)
  expect(rod(asSolved).preferred).toBe(false)

  // Squeezing the same throughput into 6 machines doubles the clock.
  const over = rod(
    plan({
      targets: { Desc_IronPlateReinforced_C: 60 },
      machineOverrides: { Recipe_IronRod_C: 6 },
    }),
  )
  expect(over.wholeMachines).toBe(6)
  expect(over.clock).toBeCloseTo(2, 6)
  expect(over.shardsEach).toBe(2)
  expect(over.clockValid).toBe(true)
  expect(over.preferred).toBe(true)
  // A Constructor is 4 MW and power goes as clock^1.321929.
  expect(over.powerAtClock).toBeCloseTo(6 * 4 * 2 ** 1.321929, 4)

  // Spreading it over more machines underclocks and saves power.
  const under = rod(
    plan({
      targets: { Desc_IronPlateReinforced_C: 60 },
      machineOverrides: { Recipe_IronRod_C: 24 },
    }),
  )
  expect(under.clock).toBeCloseTo(0.5, 6)
  expect(under.shardsEach).toBe(0)
  expect(under.powerAtClock).toBeLessThan(rod(asSolved).powerAtClock)
})

test('too few machines is flagged rather than reported as buildable', () => {
  // 12 machines' worth into 4 needs 300%, past the 250% ceiling.
  const group = plan({
    targets: { Desc_IronPlateReinforced_C: 60 },
    machineOverrides: { Recipe_IronRod_C: 4 },
  }).machineGroups.find((g) => g.recipe === 'Recipe_IronRod_C')!

  expect(group.clock).toBeCloseTo(3, 6)
  expect(group.clockValid).toBe(false)
  // Never claim more shards than a machine has slots for.
  expect(group.shardsEach).toBeLessThanOrEqual(3)
})

test('a preferred count never changes the throughput or the ore budget', () => {
  const base = plan({ targets: { Desc_IronPlateReinforced_C: 60 } })
  const clocked = plan({
    targets: { Desc_IronPlateReinforced_C: 60 },
    machineOverrides: { Recipe_IronRod_C: 6, Recipe_Screw_C: 30 },
  })

  expect(extractionOf(clocked, 'Desc_OreIron_C')).toBeCloseTo(
    extractionOf(base, 'Desc_OreIron_C'),
    6,
  )
  // The underlying requirement is untouched; only how it's spread changes.
  for (const group of clocked.machineGroups) {
    const original = base.machineGroups.find((g) => g.recipe === group.recipe)!
    expect(group.machines).toBeCloseTo(original.machines, 6)
  }
})
