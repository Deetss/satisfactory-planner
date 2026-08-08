import {
  buildings,
  generators as allGenerators,
  recipes as allRecipes,
  resources as allResources,
} from '../data/gameData'
import type { VariableRegistry } from './lp'
import type { PlanRequest, VarMeta } from './model'
import { cleanRate } from './rates'

/** Rates below this are solver noise, not real production. */
const EPSILON = 1e-7

/** Slowest a machine can be clocked, as a fraction. */
export const MIN_CLOCK = 0.01

/** Fastest a machine can run, with three power shards fitted. */
export const MAX_CLOCK = 2.5

/** Each power shard raises the ceiling by this much above 100%. */
const SHARD_STEP = 0.5

/** Shard slots a machine has, which is what caps the clock at 250%. */
export const MAX_SHARDS = 3

export interface MachineGroup {
  recipe: string
  recipeName: string
  building: string
  buildingName: string
  /** Fractional machine count at 100% clock: the throughput requirement. */
  machines: number
  /** Machines actually built, honouring any preferred count. */
  wholeMachines: number
  /** Clock each machine runs at. Above 1 is overclocked. */
  clock: number
  /** MW drawn by `machines` at 100% clock. */
  power: number
  /** MW drawn by `wholeMachines` at `clock`, over or under. */
  powerAtClock: number
  /** Power shards each machine needs, 0 unless overclocked. Never above the
   * three slots a machine has; an unreachable clock is flagged instead. */
  shardsEach: number
  /** False when the preferred count can't reach the required throughput. */
  clockValid: boolean
  /** Set when a preferred count is in force rather than the default. */
  preferred: boolean
  inputs: { item: string; rate: number }[]
  outputs: { item: string; rate: number }[]
}

export interface GeneratorGroup {
  generator: string
  generatorName: string
  fuel: string
  count: number
  wholeCount: number
  power: number
  fuelRate: number
  waterRate: number
}

export interface Shortfall {
  item: string
  /** Extraction rate the target actually needs. */
  required: number
  /** Ceiling currently in force, whether user-set or the map maximum. */
  limit: number
  /** True when the limit came from the map rather than the user. */
  mapLimited: boolean
}

export interface Diagnosis {
  kind: 'limits' | 'recipes' | 'unknown'
  shortfalls: Shortfall[]
  message: string
}

export interface PlanResult {
  status: 'optimal' | 'infeasible' | 'error'
  message?: string
  /** Present when the plan is infeasible: why, and what would fix it. */
  diagnosis?: Diagnosis
  objectiveValue: number
  machineGroups: MachineGroup[]
  generatorGroups: GeneratorGroup[]
  /** Raw extraction the plan requires, per resource item. */
  extraction: { item: string; rate: number; cap: number | null }[]
  /** Unconsumed output the plan leaves behind. */
  surplus: { item: string; rate: number }[]
  totals: {
    machines: number
    powerConsumed: number
    powerConsumedUnderclocked: number
    powerProduced: number
    buildingCounts: Record<string, number>
  }
  /** Net rate per item across the whole plan. */
  netRates: Record<string, number>
  lp: string
}

export function emptyResult(lp: string): PlanResult {
  return {
    status: 'optimal',
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

/** Variable values keyed by LP variable id. */
export type ColumnValues = Record<string, number>

export function interpretSolution(
  request: PlanRequest,
  registry: VariableRegistry<VarMeta>,
  columns: ColumnValues,
  objectiveValue: number,
  lp: string,
): PlanResult {
  const machineGroups: MachineGroup[] = []
  const generatorGroups: GeneratorGroup[] = []
  const extraction: PlanResult['extraction'] = []
  const surplus: PlanResult['surplus'] = []
  const netRates: Record<string, number> = {}
  const buildingCounts: Record<string, number> = {}

  const addNet = (item: string, rate: number) => {
    netRates[item] = cleanRate((netRates[item] ?? 0) + rate)
  }

  for (const [id, meta] of registry.entries()) {
    // Snap solver noise before anything rounds or ceils this.
    const value = cleanRate(columns[id] ?? 0)
    if (value <= EPSILON) continue

    if (meta.kind === 'maximized') {
      continue
    } else if (meta.kind === 'recipe') {
      const recipe = allRecipes[meta.recipe]
      const building = buildings[recipe.building]

      const preferredCount = request.machineOverrides?.[recipe.className]
      const preferred =
        typeof preferredCount === 'number' && preferredCount >= 1
      const wholeMachines = preferred
        ? Math.round(preferredCount)
        : Math.ceil(value - EPSILON)

      const clock = value / wholeMachines
      const shardsNeeded =
        clock > 1 ? Math.ceil((clock - 1) / SHARD_STEP - 1e-9) : 0
      // Reporting more than three would state a requirement the game can't
      // meet; clockValid already marks the row as unreachable.
      const shardsEach = Math.min(shardsNeeded, MAX_SHARDS)

      machineGroups.push({
        recipe: recipe.className,
        recipeName: recipe.name,
        building: recipe.building,
        buildingName: building.name,
        machines: value,
        wholeMachines,
        clock,
        shardsEach,
        // Too few machines can't reach the throughput even flat out.
        clockValid: clock <= MAX_CLOCK + 1e-9 && clock >= MIN_CLOCK - 1e-9,
        preferred,
        power: recipe.power * value,
        // Power scales superlinearly with clock, so underclocking across more
        // machines saves power and overclocking onto fewer costs extra.
        powerAtClock:
          recipe.power * wholeMachines * clock ** building.powerExponent,
        // Multiplying a clean machine count by a clean per-machine rate can
        // still land on 480.00000000000006, so clean the product too.
        inputs: recipe.ingredients.map((i) => ({
          item: i.item,
          rate: cleanRate(i.rate * value),
        })),
        outputs: recipe.products.map((p) => ({
          item: p.item,
          rate: cleanRate(p.rate * value),
        })),
      })

      // Keyed by class rather than name so the UI can reach the icon.
      buildingCounts[building.className] =
        (buildingCounts[building.className] ?? 0) + wholeMachines

      for (const p of recipe.products) addNet(p.item, p.rate * value)
      for (const i of recipe.ingredients) addNet(i.item, -i.rate * value)
    } else if (meta.kind === 'generator') {
      const gen = allGenerators[meta.generator]
      const fuel = gen.fuels.find((f) => f.item === meta.fuel)
      if (!fuel) continue

      generatorGroups.push({
        generator: gen.className,
        generatorName: gen.name,
        fuel: meta.fuel,
        count: value,
        wholeCount: Math.ceil(value - EPSILON),
        power: gen.power * value,
        fuelRate: cleanRate(fuel.rate * value),
        waterRate: gen.supplemental ? cleanRate(gen.supplemental.rate * value) : 0,
      })

      addNet(meta.fuel, -fuel.rate * value)
      if (gen.supplemental) {
        addNet(gen.supplemental.item, -gen.supplemental.rate * value)
      }
      if (fuel.byproduct) {
        addNet(fuel.byproduct.item, fuel.byproduct.rate * value)
      }
    } else if (meta.kind === 'extract') {
      const resource = allResources[meta.item]
      extraction.push({
        item: meta.item,
        rate: value,
        cap: request.resourceCaps[meta.item] ?? resource?.maxExtraction ?? null,
      })
      addNet(meta.item, value)
    } else if (meta.kind === 'surplus') {
      surplus.push({ item: meta.item, rate: value })
    }
  }

  machineGroups.sort((a, b) => b.machines - a.machines)
  generatorGroups.sort((a, b) => b.count - a.count)
  extraction.sort((a, b) => b.rate - a.rate)
  surplus.sort((a, b) => b.rate - a.rate)

  return {
    status: 'optimal',
    objectiveValue,
    machineGroups,
    generatorGroups,
    extraction,
    surplus,
    totals: {
      machines: machineGroups.reduce((sum, g) => sum + g.wholeMachines, 0),
      powerConsumed: machineGroups.reduce((sum, g) => sum + g.power, 0),
      powerConsumedUnderclocked: machineGroups.reduce(
        (sum, g) => sum + g.powerAtClock,
        0,
      ),
      powerProduced: generatorGroups.reduce((sum, g) => sum + g.power, 0),
      buildingCounts,
    },
    netRates,
    lp,
  }
}
