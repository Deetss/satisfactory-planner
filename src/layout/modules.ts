import {
  buildings,
  generators as allGenerators,
  itemName,
} from '../data/gameData'
import type { PlanResult } from '../solver/interpret'
import type { FactoryModule } from './types'

/** Fallback when a building has no clearance data to derive a size from. */
const DEFAULT_FOOTPRINT = { width: 8, depth: 8, height: 8 }

/**
 * One module per recipe in the plan, which is the block-per-part shape a
 * modular factory is actually built in. Ids are derived from the recipe so a
 * placement survives re-solving at a different rate.
 */
export function modulesFromPlan(result: PlanResult): FactoryModule[] {
  const modules: FactoryModule[] = []

  for (const group of result.machineGroups) {
    const building = buildings[group.building]
    modules.push({
      id: `recipe:${group.recipe}`,
      recipe: group.recipe,
      label: group.recipeName,
      building: group.building,
      buildingName: group.buildingName,
      machines: group.wholeMachines,
      clock: group.clock,
      power: group.powerAtClock,
      inputs: group.inputs.map((i) => ({ item: i.item, rate: i.rate })),
      outputs: group.outputs.map((o) => ({ item: o.item, rate: o.rate })),
      machineFootprint: building?.footprint
        ? {
            width: building.footprint.width,
            depth: building.footprint.depth,
            height: building.footprint.height ?? DEFAULT_FOOTPRINT.height,
          }
        : DEFAULT_FOOTPRINT,
    })
  }

  for (const group of result.generatorGroups) {
    const gen = allGenerators[group.generator]
    const fuel = gen?.fuels.find((f) => f.item === group.fuel)
    const inputs = [{ item: group.fuel, rate: group.fuelRate }]
    if (gen?.supplemental && group.waterRate > 0) {
      inputs.push({ item: gen.supplemental.item, rate: group.waterRate })
    }

    modules.push({
      id: `generator:${group.generator}:${group.fuel}`,
      recipe: null,
      label: `${group.generatorName} (${itemName(group.fuel)})`,
      building: group.generator,
      buildingName: group.generatorName,
      machines: group.wholeCount,
      clock: 1,
      // Generators produce power rather than draw it.
      power: -group.power,
      inputs,
      outputs: fuel?.byproduct
        ? [{ item: fuel.byproduct.item, rate: fuel.byproduct.rate * group.count }]
        : [],
      machineFootprint: gen?.footprint
        ? {
            width: gen.footprint.width,
            depth: gen.footprint.depth,
            height: gen.footprint.height ?? DEFAULT_FOOTPRINT.height,
          }
        : DEFAULT_FOOTPRINT,
    })
  }

  return modules
}

export { defaultColumns } from './pack'
