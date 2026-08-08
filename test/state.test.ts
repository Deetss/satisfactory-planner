import { expect, test } from 'vitest'

import { linkKey } from '../src/layout/congestion'
import type { LayoutState } from '../src/layout/types'
import { decodePlanCode, encodePlanCode } from '../src/state/planCode'
import { planName, type PlanFile } from '../src/state/planFile'
import { normalizePlan } from '../src/state/plannerStore'

// Section one: the normalize guards.

/**
 * The store keeps its DEFAULTS private, so the expected startup plan is
 * written out here rather than imported. If a default moves, this literal is
 * the second place to change.
 */
const DEFAULT_PLAN = {
  targets: {},
  objective: 'resources',
  tier: 8,
  unlockedAlternates: [],
  resourceCaps: {},
  allowSurplus: true,
  powerGenerators: [],
  machineOverrides: {},
}

test('normalizePlan returns the default plan for anything that is not a record', () => {
  expect(normalizePlan(null)).toEqual(DEFAULT_PLAN)
  expect(normalizePlan('nonsense')).toEqual(DEFAULT_PLAN)
})

test('normalizePlan drops or replaces every wrong-typed field', () => {
  const plan = normalizePlan({
    tier: 'nine',
    objective: 'chaos',
    allowSurplus: 'yes',
    resourceCaps: null,
    unlockedAlternates: 'nope',
    powerGenerators: [1, 'ok'],
    machineOverrides: { r: Number.NaN },
    targets: { good: 5, bad: 'x' },
  })

  expect(plan.tier).toBe(8)
  expect(plan.objective).toBe('resources')
  expect(plan.allowSurplus).toBe(true)
  expect(plan.resourceCaps).toEqual({})
  expect(plan.unlockedAlternates).toEqual([])
  expect(plan.powerGenerators).toEqual(['ok'])
  expect(plan.machineOverrides).toEqual({})
  expect(plan.targets).toEqual({ good: 5 })
})

test('normalizePlan clamps the tier to the tiers that exist', () => {
  expect(normalizePlan({ tier: 99 }).tier).toBe(9)
  expect(normalizePlan({ tier: -5 }).tier).toBe(0)
  expect(normalizePlan({ tier: 8.6 }).tier).toBe(9)
  expect(normalizePlan({ tier: 0 }).tier).toBe(0)
})

// Section two: a fully populated v2 round trip.

const IRON = 'recipe:Recipe_IngotIron_C'
const PLATE = 'recipe:Recipe_IronPlate_C'
const COAL = 'generator:Build_GeneratorCoal_C:Desc_Coal_C'
const DEPOT = 'storage:Desc_IronPlate_C'

/**
 * The decoder rebuilds floor ids, fitting ids and route keys rather than
 * carrying them, so this fixture uses the forms it produces. Anything else
 * would make the comparison below pass on a shape the app never sees.
 */
const layout: LayoutState = {
  floors: [
    {
      id: 'floor-1',
      name: 'Ground',
      role: 'production',
      elevation: 0,
      gridWidth: 16,
      gridDepth: 12,
      originX: 0,
      originY: 0,
    },
    {
      id: 'floor-2',
      name: 'Store',
      role: 'storage',
      elevation: 9,
      gridWidth: 10,
      gridDepth: 10,
      originX: 24,
      originY: -8,
    },
  ],
  activeFloorId: 'floor-2',
  placements: {
    [IRON]: {
      moduleId: IRON,
      floorId: 'floor-1',
      x: 8,
      y: 16,
      orientation: 270,
      columns: 3,
      inputSide: 'south',
      outputSide: 'west',
    },
    [PLATE]: {
      moduleId: PLATE,
      floorId: 'floor-1',
      x: 40,
      y: 0,
      orientation: 90,
      columns: 2,
      inputSide: 'west',
      outputSide: 'east',
      flipped: true,
    },
    [COAL]: {
      moduleId: COAL,
      floorId: 'floor-1',
      x: 0,
      y: 48,
      orientation: 0,
      columns: 1,
      inputSide: 'north',
      outputSide: 'south',
    },
    [DEPOT]: {
      moduleId: DEPOT,
      floorId: 'floor-2',
      x: 16,
      y: 8,
      orientation: 180,
      columns: 4,
      inputSide: 'east',
      outputSide: 'north',
    },
  },
  snapMetres: 4,
  reserves: [
    { item: 'Desc_IronPlate_C', mode: 'excess', quantity: 0, bufferMinutes: 30 },
    { item: 'Desc_Cement_C', mode: 'fixed', quantity: 500, bufferMinutes: 10 },
  ],
  manualLinks: [
    linkKey({ fromModuleId: IRON, toModuleId: DEPOT, item: 'Desc_IronIngot_C' }),
    linkKey({ fromModuleId: PLATE, toModuleId: DEPOT, item: 'Desc_IronPlate_C' }),
  ],
  routeOverrides: {
    [`${IRON}->${PLATE}:Desc_IronIngot_C`]: {
      from: { side: 'east', along: 12 },
      to: { side: 'west', along: 4 },
      waypoints: [
        { x: 20, y: 20 },
        { x: 20, y: 36 },
      ],
    },
    [`in->${IRON}:Desc_OreIron_C`]: {
      to: { side: 'north', along: 6 },
      waypoints: [],
    },
    [`${PLATE}->out:Desc_IronPlate_C`]: {
      from: { side: 'south', along: 2 },
      waypoints: [{ x: 64, y: 8 }],
    },
  },
  fittings: [
    {
      id: 'fit-0',
      routeId: `${IRON}->${PLATE}:Desc_IronIngot_C`,
      kind: 'splitter',
      floorId: 'floor-1',
      x: 24,
      y: 24,
    },
    {
      id: 'fit-1',
      routeId: `in->${IRON}:Desc_OreIron_C`,
      kind: 'merger',
      floorId: 'floor-1',
      x: 4,
      y: 4,
    },
  ],
}

const fixture: PlanFile = {
  kind: 'satisfactory-planner',
  version: 1,
  savedAt: '2026-08-08T12:00:00.000Z',
  name: 'A name the decoder throws away',
  plan: {
    targets: { Desc_IronPlate_C: 60, Desc_Cement_C: 15 },
    objective: 'machines',
    tier: 6,
    unlockedAlternates: ['Recipe_Alternate_PureIronIngot_C'],
    resourceCaps: { Desc_OreIron_C: 480, Desc_Stone_C: 240 },
    allowSurplus: false,
    powerGenerators: ['Build_GeneratorCoal_C'],
    machineOverrides: { Recipe_IngotIron_C: 12 },
  },
  layout,
}

test('a fully populated plan and layout survive a v2 round trip', () => {
  const back = decodePlanCode(encodePlanCode(fixture))

  expect(back.plan).toEqual(fixture.plan)
  expect(back.layout).toEqual(fixture.layout)
})

test('a round trip drops the save time and re-derives the name, by contract', () => {
  const back = decodePlanCode(encodePlanCode(fixture))

  expect(back.savedAt).toBe('')
  expect(back.name).toBe(planName(fixture.plan.targets))
  expect(back.name).not.toBe(fixture.name)
})

// Section three: the edges of the round trip.

/** The fixture's layout stripped back to one floor, with one part swapped in. */
const only = (patch: Partial<LayoutState>): LayoutState => ({
  ...layout,
  floors: [layout.floors[0]],
  activeFloorId: 'floor-1',
  placements: {},
  reserves: [],
  manualLinks: [],
  routeOverrides: {},
  fittings: [],
  ...patch,
})

const roundTrip = (patch: Partial<LayoutState>) =>
  decodePlanCode(encodePlanCode({ ...fixture, layout: only(patch) })).layout

test('fractional metres come back exactly, not merely close', () => {
  const back = roundTrip({
    floors: [{ ...layout.floors[0], originY: 1 / 3 }],
    placements: {
      [IRON]: { ...layout.placements[IRON], x: 0.1 + 0.2 },
    },
  })

  expect(back.placements[IRON].x).toBe(0.1 + 0.2)
  expect(back.floors[0].originY).toBe(1 / 3)
})

test('a placement on a floor that is gone costs the link nothing', () => {
  const back = roundTrip({
    placements: {
      [IRON]: layout.placements[IRON],
      [DEPOT]: { ...layout.placements[DEPOT], floorId: 'floor-9' },
    },
  })

  expect(Object.keys(back.placements)).toEqual([IRON])
})

test('a layout with no floors decodes to none, and the active floor falls back', () => {
  const back = roundTrip({ floors: [], activeFloorId: 'floor-7' })

  expect(back.floors).toEqual([])
  expect(back.activeFloorId).toBe('floor-1')
})

test('a module id matching no expected affix travels verbatim', () => {
  const odd = 'bus-corridor:main'
  const back = roundTrip({
    placements: {
      [odd]: { ...layout.placements[IRON], moduleId: odd },
    },
  })

  expect(Object.keys(back.placements)).toEqual([odd])
  expect(back.placements[odd].moduleId).toBe(odd)
})
