import { expect, test } from 'vitest'

import { linkKey } from '../src/layout/congestion'
import type { LayoutState } from '../src/layout/types'
import {
  decodePlanCode,
  encodePlanCode,
  MAX_PLAN_CODE_CHARS,
} from '../src/state/planCode'
import { planName, type PlanFile } from '../src/state/planFile'
import { normalizePlan } from '../src/state/plannerStore'
import { inflateBounded } from '../src/state/shareLink'

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

// Section four: hostile input.

test('a code of exactly the maximum length is still parsed', () => {
  expect(() => decodePlanCode('x'.repeat(MAX_PLAN_CODE_CHARS))).toThrow(
    'That link is damaged, most likely cut short in transit.',
  )
})

test('a code one character over the maximum is refused before it is parsed', () => {
  expect(() => decodePlanCode('x'.repeat(MAX_PLAN_CODE_CHARS + 1))).toThrow(
    'That link is too large to open.',
  )
})

const VALID_CODE = encodePlanCode(fixture)

/**
 * Three families of damage, every one of them derived from a single valid
 * code and none of them random, so a failure here reproduces exactly.
 */
function malformedCodes(): { label: string; text: string }[] {
  const variants: { label: string; text: string }[] = []

  for (let eighth = 0; eighth < 8; eighth++) {
    const cut = Math.floor((VALID_CODE.length * eighth) / 8)
    variants.push({
      label: `truncated at ${cut}`,
      text: VALID_CODE.slice(0, cut),
    })
  }

  const parsed = JSON.parse(VALID_CODE) as Record<string, unknown>
  const arrayKeys = Object.keys(parsed).filter((key) =>
    Array.isArray(parsed[key]),
  )
  for (const key of arrayKeys) {
    for (const swap of [7, 'wrong', {}]) {
      variants.push({
        label: `${key} is ${JSON.stringify(swap)}`,
        text: JSON.stringify({ ...parsed, [key]: swap }),
      })
    }
  }

  const placement = (parsed.P as unknown[])[0] as unknown[]
  const corrupted: [string, unknown][] = [
    ['a placement missing its trailing slots', placement.slice(0, 3)],
    [
      'a placement holding an array where a number belongs',
      placement.map((slot, index) => (index === 2 ? [1, 2] : slot)),
    ],
    [
      'a placement holding a string where a floor index belongs',
      placement.map((slot, index) => (index === 1 ? 'floor' : slot)),
    ],
  ]
  for (const [label, entry] of corrupted) {
    variants.push({ label, text: JSON.stringify({ ...parsed, P: [entry] }) })
  }

  return variants
}

test('the fuzz set covers every family it claims to', () => {
  // 8 truncations, 8 array-valued keys swapped 3 ways, and 3 corrupted tuples.
  // Pinned so a change to the fixture cannot quietly shrink the coverage.
  expect(malformedCodes().length).toBe(35)
})

test('no malformed code crashes the decoder', () => {
  const failures: string[] = []

  for (const { label, text } of malformedCodes()) {
    try {
      const decoded = decodePlanCode(text)
      if (typeof decoded.plan !== 'object' || decoded.plan === null) {
        failures.push(`${label}: plan is not an object`)
      }
      if (typeof decoded.layout !== 'object' || decoded.layout === null) {
        failures.push(`${label}: layout is not an object`)
      }
    } catch (cause) {
      // A TypeError means an unguarded property read, which is the crash the
      // decoder's bounds exist to rule out. Any other Error is a refused link,
      // which the banner already reports.
      if (cause instanceof TypeError) {
        failures.push(`${label}: ${String(cause)}`)
      } else if (!(cause instanceof Error)) {
        failures.push(`${label}: threw a non-Error`)
      }
    }
  }

  expect(failures).toEqual([])
})

test('a code from a newer planner is refused by version, not by shape', () => {
  const parsed = JSON.parse(VALID_CODE) as Record<string, unknown>

  expect(() => decodePlanCode(JSON.stringify({ ...parsed, v: 99 }))).toThrow(
    'That link was made by a newer version of the planner (v99).',
  )
})

/** Every numeric slot carries 1e400, which JSON.parse yields as Infinity. */
const INFINITE_CODE =
  '{"v":2,"t":{"IronPlate":1e400},"o":0,"r":1e400,"z":1e400,"A":0,' +
  '"F":[["Ground",1e400,1e400,0,1e400,1e400]],' +
  '"P":[["rIngotIron",0,1e400,1e400,1e400,1e400,1e400,1e400]],' +
  '"R":[["IronPlate",0,1e400,1e400]],' +
  '"D":[["rIngotIron","rIronPlate","IronIngot",1e400,1e400,1e400,1e400,[1e400,1e400]]],' +
  '"T":[[0,0,"rIngotIron","rIronPlate","IronIngot",1e400,1e400]]}'

const numbersIn = (value: unknown): number[] =>
  typeof value === 'number'
    ? [value]
    : typeof value === 'object' && value !== null
      ? Object.values(value).flatMap(numbersIn)
      : []

test('an Infinity in the layout falls back to its default', () => {
  const back = decodePlanCode(INFINITE_CODE)

  expect(back.plan.tier).toBe(8)
  expect(back.layout.snapMetres).toBe(8)
  expect(back.layout.floors[0].gridWidth).toBe(12)
  expect(back.layout.floors[0].gridDepth).toBe(12)
  expect(back.layout.floors[0].originX).toBe(0)
  expect(back.layout.floors[0].originY).toBe(0)
  expect(back.layout.placements[IRON].x).toBe(0)
  expect(back.layout.placements[IRON].y).toBe(0)
  expect(back.layout.placements[IRON].orientation).toBe(0)
  expect(back.layout.placements[IRON].columns).toBe(1)
  expect(numbersIn(back.layout).every(Number.isFinite)).toBe(true)
})

test('an Infinity in the target map is dropped before it reaches the store', () => {
  const back = decodePlanCode(INFINITE_CODE)

  // The decoder only renames the keys of a map, so its values never meet the
  // finiteness guard the tuple slots get. normalizePlan is what holds the line
  // here, which is why the startup path now runs through it.
  expect(back.plan.targets).toEqual({ Desc_IronPlate_C: Infinity })
  expect(normalizePlan(back.plan).targets).toEqual({})
})

const POLLUTING_CODE =
  '{"v":2,"t":{"=__proto__":{"polluted":1}},"o":0,"r":6,"z":8,"A":0,"F":[],"P":[]}'

test('a prototype-shaped key in the target map never reaches Object.prototype', () => {
  const ownNamesBefore = Object.getOwnPropertyNames(Object.prototype).length
  const back = decodePlanCode(POLLUTING_CODE)

  // Object.fromEntries creates own data properties, so the key lands in the
  // map itself rather than running Object.prototype's __proto__ setter.
  expect(Object.keys(back.plan.targets)).toEqual(['__proto__'])
  expect(Object.getPrototypeOf(back.plan.targets)).toBe(Object.prototype)
  expect(Object.getOwnPropertyNames(Object.prototype).length).toBe(
    ownNamesBefore,
  )
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})

// Section five: the inflate bound.

/** The same format buildShareUrl writes, so these bytes are a real fragment. */
async function deflateRaw(text: string): Promise<Uint8Array> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

test('inflateBounded resolves at the decoded length and rejects one below it', async () => {
  const text = 'a short known string'
  const bytes = await deflateRaw(text)

  await expect(inflateBounded(bytes, text.length)).resolves.toBe(text)
  await expect(inflateBounded(bytes, text.length - 1)).rejects.toThrow(
    'That link expands to more than the planner will open.',
  )
})

test('inflateBounded refuses a fragment that expands to millions of characters', async () => {
  const bomb = await deflateRaw('a'.repeat(2_000_000))

  // Well under the fragment cap, so this really is an expansion rather than a
  // large link that would have been refused on its own length.
  expect(bomb.length).toBeLessThan(10_000)
  await expect(inflateBounded(bomb, 1000)).rejects.toThrow(
    'That link expands to more than the planner will open.',
  )
})
