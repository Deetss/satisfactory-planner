import { expect, test } from 'vitest'

import { gameData } from '../src/data/gameData'
import { chooseTransport, deriveRoutes } from '../src/layout/routes'
import { planReserve, storageModules } from '../src/layout/storage'
import { planMining } from '../src/solver/mining'
import { cleanRate } from '../src/solver/rates'
import { defaultColumns, packByStage, productionStages } from '../src/layout/pack'
import {
  FOUNDATION_M,
  moduleFootprint,
  rectsOverlap,
  sideAnchor,
} from '../src/layout/types'
import type { FactoryModule } from '../src/layout/types'

function mod(
  id: string,
  machines: number,
  footprint: { width: number; depth: number },
  inputs: string[] = [],
  outputs: string[] = [],
): FactoryModule {
  return {
    id,
    recipe: id,
    label: id,
    building: 'Build_ConstructorMk1_C',
    buildingName: 'Constructor',
    machines,
    clock: 1,
    power: machines * 4,
    inputs: inputs.map((item) => ({ item, rate: 60 })),
    outputs: outputs.map((item) => ({ item, rate: 60 })),
    machineFootprint: { height: 6, ...footprint },
  }
}

test('belt choice picks the smallest tier that carries the rate', () => {
  // Mk.1 is 60/min, Mk.2 is 120/min.
  expect(chooseTransport('Desc_OreIron_C', 60, 9).option?.throughput).toBe(60)
  expect(chooseTransport('Desc_OreIron_C', 61, 9).option?.throughput).toBe(120)
  expect(chooseTransport('Desc_OreIron_C', 1200, 9).lines).toBe(1)
})

test('rates above the best unlocked belt split across parallel lines', () => {
  // At tier 8 the best belt is Mk.5 (780/min); Mk.6 needs tier 9.
  const atEight = chooseTransport('Desc_OreIron_C', 1500, 8)
  expect(atEight.option?.throughput).toBe(780)
  expect(atEight.lines).toBe(2)
  expect(atEight.needsSplit).toBe(true)
  expect(atEight.lines * atEight.option!.throughput).toBeGreaterThanOrEqual(1500)

  // The same rate fits one Mk.6 belt once tier 9 is unlocked.
  const atNine = chooseTransport('Desc_OreIron_C', 1500, 9)
  expect(atNine.option?.throughput).toBe(1200)
  expect(atNine.lines).toBe(2)
})

test('parallel lines always cover the rate', () => {
  for (const rate of [1, 59, 60, 61, 779, 781, 2400, 5000]) {
    for (const tier of [0, 4, 8, 9]) {
      const choice = chooseTransport('Desc_OreIron_C', rate, tier)
      expect(choice.option, `tier ${tier} should have a belt`).not.toBeNull()
      expect(
        choice.lines * choice.option!.throughput,
        `${rate}/min at tier ${tier}`,
      ).toBeGreaterThanOrEqual(rate - 1e-9)
    }
  }
})

test('fluids need a pipe, and none exists below tier 3', () => {
  expect(chooseTransport('Desc_Water_C', 100, 0).option).toBeNull()
  expect(chooseTransport('Desc_Water_C', 100, 3).option?.throughput).toBe(300)
  expect(chooseTransport('Desc_Water_C', 1325.2, 8).lines).toBe(3)
})

test('block shapes stay within the aspect cap instead of becoming strips', () => {
  // A Constructor is exactly 8 m wide, so a single column wastes no width and
  // would win on pure area while being absurdly long.
  const constructor = { width: 8, depth: 10 }
  for (const machines of [4, 12, 24, 55, 100]) {
    const module = mod('m', machines, constructor)
    const columns = defaultColumns(module)
    const { width, depth } = moduleFootprint(module, columns, 0)
    const aspect = Math.max(width, depth) / Math.min(width, depth)
    expect(aspect, `${machines} machines packed ${width}x${depth}`).toBeLessThanOrEqual(3)
  }
})

test('footprints round up to whole foundations so blocks tile flush', () => {
  // 3 Smelters at 5 m wide span 15 m, which has to occupy 16 m of foundation.
  const smelter = mod('s', 3, { width: 5, depth: 10 })
  const { width, depth } = moduleFootprint(smelter, 3, 0)
  expect(width % FOUNDATION_M).toBe(0)
  expect(depth % FOUNDATION_M).toBe(0)
  expect(width).toBe(16)
})

test('production stages order upstream blocks before what they feed', () => {
  const smelt = mod('smelt', 2, { width: 8, depth: 10 }, ['ore'], ['ingot'])
  const rod = mod('rod', 2, { width: 8, depth: 10 }, ['ingot'], ['rod'])
  const screw = mod('screw', 2, { width: 8, depth: 10 }, ['rod'], ['screw'])

  const stages = productionStages([screw, rod, smelt])
  expect(stages.get('smelt')).toBe(0)
  expect(stages.get('rod')).toBe(1)
  expect(stages.get('screw')).toBe(2)
})

test('a production loop does not hang the stage walk', () => {
  // Fuel chains genuinely feed back into themselves.
  const a = mod('a', 1, { width: 8, depth: 10 }, ['z'], ['y'])
  const b = mod('b', 1, { width: 8, depth: 10 }, ['y'], ['z'])
  const stages = productionStages([a, b])
  expect(stages.size).toBe(2)
})

test('packing places stages left to right and never overlaps', () => {
  const smelt = mod('smelt', 6, { width: 8, depth: 10 }, ['ore'], ['ingot'])
  const rod = mod('rod', 9, { width: 8, depth: 10 }, ['ingot'], ['rod'])
  const screw = mod('screw', 12, { width: 8, depth: 10 }, ['rod'], ['screw'])
  const modules = [smelt, rod, screw]

  const { packed, width, depth } = packByStage(modules)
  expect(packed).toHaveLength(3)

  const at = (id: string) => packed.find((p) => p.module.id === id)!
  expect(at('smelt').x).toBeLessThan(at('rod').x)
  expect(at('rod').x).toBeLessThan(at('screw').x)

  for (const p of packed) {
    expect(p.x % FOUNDATION_M).toBe(0)
    expect(p.y % FOUNDATION_M).toBe(0)
    expect(p.x + p.width).toBeLessThanOrEqual(width)
    expect(p.y + p.depth).toBeLessThanOrEqual(depth)
  }

  for (let i = 0; i < packed.length; i++) {
    for (let j = i + 1; j < packed.length; j++) {
      const a = packed[i]
      const b = packed[j]
      expect(
        rectsOverlap(
          { x: a.x, y: a.y, width: a.width, depth: a.depth },
          { x: b.x, y: b.y, width: b.width, depth: b.depth },
        ),
        `${a.module.id} overlaps ${b.module.id}`,
      ).toBe(false)
    }
  }
})

test('routes cover demand and attribute unmet demand to an outside source', () => {
  const smelt = mod('smelt', 1, { width: 8, depth: 10 }, ['Desc_OreIron_C'], ['Desc_IronIngot_C'])
  const rod = mod('rod', 1, { width: 8, depth: 10 }, ['Desc_IronIngot_C'], ['Desc_IronRod_C'])

  const routes = deriveRoutes([smelt, rod], { Desc_IronRod_C: 60 }, [], 9)

  // Ore has no producer here, so it comes from outside into the smelter.
  const ore = routes.find((r) => r.item === 'Desc_OreIron_C')
  expect(ore?.from).toBeNull()
  expect(ore?.to).toBe('smelt')

  // The ingot handoff is module to module.
  const ingot = routes.find((r) => r.item === 'Desc_IronIngot_C')
  expect(ingot?.from).toBe('smelt')
  expect(ingot?.to).toBe('rod')

  // Finished rod leaves the factory.
  const out = routes.find((r) => r.item === 'Desc_IronRod_C' && r.to === null)
  expect(out?.rate).toBeCloseTo(60, 6)

  // No route should have both ends outside the factory.
  expect(routes.filter((r) => r.from === null && r.to === null)).toHaveLength(0)
})

test('every derived route gets a transport decision', () => {
  const smelt = mod('smelt', 1, { width: 8, depth: 10 }, ['Desc_OreIron_C'], ['Desc_IronIngot_C'])
  const routes = deriveRoutes([smelt], { Desc_IronIngot_C: 30 }, [], 9)

  expect(routes.length).toBeGreaterThan(0)
  for (const route of routes) {
    expect(route.rate).toBeGreaterThan(0)
    expect(route.transport.lines).toBeGreaterThanOrEqual(1)
    expect(route.fluid).toBe(gameData.items[route.item]?.form !== 'solid')
  }
})

test('a fixed reserve sizes containers from the item stack size', () => {
  // An Industrial Storage Container is 48 slots; Iron Plate stacks 200.
  const plan = planReserve(
    { item: 'Desc_IronPlate_C', mode: 'fixed', quantity: 1000, bufferMinutes: 60 },
    9,
  )
  expect(plan.perContainer).toBe(48 * 200)
  expect(plan.containers).toBe(1)
  expect(plan.actualCapacity).toBe(9600)

  // Ten containers' worth needs ten containers, not nine.
  const bigger = planReserve(
    { item: 'Desc_IronPlate_C', mode: 'fixed', quantity: 96001, bufferMinutes: 60 },
    9,
  )
  expect(bigger.containers).toBe(11)
  expect(bigger.actualCapacity).toBeGreaterThanOrEqual(96001)
})

test('excess mode sizes the buffer from the surplus rate and duration', () => {
  const reserve = {
    item: 'Desc_IronPlate_C' as const,
    mode: 'excess' as const,
    quantity: 0,
    bufferMinutes: 60,
  }
  // 120/min of surplus for an hour is 7,200 units.
  const plan = planReserve(reserve, 9, 120)
  expect(plan.target).toBe(7200)
  expect(plan.containers).toBe(1)

  // Double the window, double the storage.
  expect(planReserve({ ...reserve, bufferMinutes: 120 }, 9, 120).target).toBe(14400)

  // No surplus means nothing to store, so no containers.
  const none = planReserve(reserve, 9, 0)
  expect(none.target).toBe(0)
  expect(none.containers).toBe(0)
})

test('a fixed reserve ignores surplus, and excess ignores the fixed quantity', () => {
  const base = { item: 'Desc_IronPlate_C', bufferMinutes: 60 }
  expect(
    planReserve({ ...base, mode: 'fixed', quantity: 500 }, 9, 999).target,
  ).toBe(500)
  expect(
    planReserve({ ...base, mode: 'excess', quantity: 500 }, 9, 10).target,
  ).toBe(600)
})

test('fluid reserves use buffers by volume, not slots', () => {
  const plan = planReserve(
    { item: 'Desc_Water_C', mode: 'fixed', quantity: 3000, bufferMinutes: 60 },
    9,
  )
  // Industrial Fluid Buffer holds 2400 m3.
  expect(plan.perContainer).toBe(2400)
  expect(plan.containers).toBe(2)
})

test('storage is blocked before the container is unlocked', () => {
  // Fluid buffers arrive at tier 3.
  const early = planReserve(
    { item: 'Desc_Water_C', mode: 'fixed', quantity: 100, bufferMinutes: 60 },
    0,
  )
  expect(early.blocked).not.toBeNull()
  expect(early.containers).toBe(0)
})

test('reserves become placeable blocks with a real footprint', () => {
  const modules = storageModules(
    [{ item: 'Desc_IronPlate_C', mode: 'fixed', quantity: 20000, bufferMinutes: 60 }],
    9,
  )
  expect(modules).toHaveLength(1)
  expect(modules[0].id).toBe('storage:Desc_IronPlate_C')
  expect(modules[0].machines).toBe(3)
  expect(modules[0].power).toBe(0)
  // A depot is fed by tapping a line, so it declares no throughput.
  expect(modules[0].inputs).toHaveLength(0)
  expect(modules[0].outputs).toHaveLength(0)

  const { width, depth } = moduleFootprint(modules[0], 2, 0)
  expect(width % FOUNDATION_M).toBe(0)
  expect(depth % FOUNDATION_M).toBe(0)
})

test('mining plans match hand-computed node counts', () => {
  // Miner Mk.3 on a normal node is 240/min; pure doubles it.
  const iron = planMining('Desc_OreIron_C', 2400, 9)!
  expect(iron.extractorName).toBe('Miner Mk.3')
  expect(iron.perNode.normal).toBe(240)
  expect(iron.perNode.pure).toBe(480)
  expect(iron.perNode.impure).toBe(120)
  expect(iron.nodes.normal).toBe(10)
  expect(iron.nodes.pure).toBe(5)
  expect(iron.normalNodeClock).toBeCloseTo(1, 6)

  // 900/min over 4 normal nodes runs each at 93.75%.
  const limestone = planMining('Desc_Stone_C', 900, 9)!
  expect(limestone.nodes.normal).toBe(4)
  expect(limestone.normalNodeClock).toBeCloseTo(0.9375, 6)
})

test('overclocking to 250% cuts the nodes needed', () => {
  const plan = planMining('Desc_OreIron_C', 2400, 9)!
  // 240 x 2.5 = 600/min a node, so 2400 needs 4 rather than 10.
  expect(plan.nodesOverclocked.normal).toBe(4)
  expect(plan.nodesOverclocked.pure).toBe(2)
})

test('miner tier is gated by tech tier', () => {
  // Mk.3 needs tier 8; Mk.2 needs tier 4.
  expect(planMining('Desc_OreIron_C', 240, 9)!.extractorName).toBe('Miner Mk.3')
  expect(planMining('Desc_OreIron_C', 240, 7)!.extractorName).toBe('Miner Mk.2')
  expect(planMining('Desc_OreIron_C', 240, 0)!.extractorName).toBe('Miner Mk.1')

  // Mk.1 on a normal node is 60/min, so 240 needs four nodes.
  expect(planMining('Desc_OreIron_C', 240, 0)!.nodes.normal).toBe(4)
})

test('water comes from pumps with no purity, oil from an extractor', () => {
  const water = planMining('Desc_Water_C', 1539.8, 9)!
  expect(water.nodeBased).toBe(false)
  expect(water.perNode.normal).toBe(120)
  expect(water.nodes.normal).toBe(13)

  const oil = planMining('Desc_LiquidOil_C', 300, 9)!
  expect(oil.perNode.normal).toBe(120)
  expect(oil.nodes.normal).toBe(3)
})

test('an extractor not yet unlocked reports what it needs', () => {
  // Oil needs tier 5.
  const early = planMining('Desc_LiquidOil_C', 100, 1)!
  expect(early.blocked).toContain('tier')
  expect(early.nodes.normal).toBe(0)
})

test('rate cleaning snaps solver noise without touching real fractions', () => {
  // Noise around a whole number snaps to it.
  expect(cleanRate(480.000000001)).toBe(480)
  expect(cleanRate(479.999999999)).toBe(480)
  expect(cleanRate(480.0001)).toBe(480)
  expect(cleanRate(12.000001)).toBe(12)

  // Genuinely fractional rates survive: 12.5/min and 0.75/min are real.
  expect(cleanRate(12.5)).toBe(12.5)
  expect(cleanRate(0.75)).toBe(0.75)
  expect(cleanRate(1 / 3)).toBeCloseTo(0.333333, 6)

  // Machine counts must not round up through a ceil.
  expect(Math.ceil(cleanRate(12.000001))).toBe(12)
  expect(Math.ceil(cleanRate(12.4))).toBe(13)

  expect(cleanRate(0)).toBe(0)
  expect(cleanRate(Number.NaN)).toBe(0)
})

test('a bounded floor places what fits and reports the rest', () => {
  // 8x8 foundations is 64x64 m.
  const bounds = { width: 64, depth: 64 }
  const modules = [
    mod('a', 8, { width: 8, depth: 10 }, ['ore'], ['x']),
    mod('b', 8, { width: 8, depth: 10 }, ['x'], ['y']),
    mod('c', 8, { width: 8, depth: 10 }, ['y'], ['z']),
    mod('d', 8, { width: 8, depth: 10 }, ['z'], ['w']),
  ]

  const { packed, overflow } = packByStage(modules, { bounds })

  // Nothing placed may cross the floor edge.
  for (const p of packed) {
    expect(p.x + p.width, `${p.module.id} runs off the width`).toBeLessThanOrEqual(bounds.width)
    expect(p.y + p.depth, `${p.module.id} runs off the depth`).toBeLessThanOrEqual(bounds.depth)
  }
  // Anything that didn't fit is accounted for, not dropped.
  expect(packed.length + overflow.length).toBe(modules.length)
})

test('a block bigger than the whole floor always overflows', () => {
  const huge = mod('huge', 40, { width: 18, depth: 20 })
  const { packed, overflow } = packByStage([huge], {
    bounds: { width: 16, depth: 16 },
  })
  expect(packed).toHaveLength(0)
  expect(overflow).toHaveLength(1)
})

test('a generous floor fits everything with nothing left over', () => {
  const modules = [
    mod('a', 4, { width: 8, depth: 10 }, ['ore'], ['x']),
    mod('b', 4, { width: 8, depth: 10 }, ['x'], ['y']),
  ]
  const { packed, overflow } = packByStage(modules, {
    bounds: { width: 400, depth: 400 },
  })
  expect(overflow).toHaveLength(0)
  expect(packed).toHaveLength(2)
  // Production order still runs left to right.
  expect(packed.find((p) => p.module.id === 'a')!.x).toBeLessThan(
    packed.find((p) => p.module.id === 'b')!.x,
  )
})

test('manifold anchors sit on the midpoint of the chosen face', () => {
  const rect = { x: 16, y: 24, width: 32, depth: 40 }
  expect(sideAnchor(rect, 'west')).toEqual({ x: 16, y: 44 })
  expect(sideAnchor(rect, 'east')).toEqual({ x: 48, y: 44 })
  expect(sideAnchor(rect, 'north')).toEqual({ x: 32, y: 24 })
  expect(sideAnchor(rect, 'south')).toEqual({ x: 32, y: 64 })
})
