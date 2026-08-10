import { expect, test } from 'vitest'

import { decodePlanCode, PLAN_CODE_VERSION } from '../src/state/planCode'

/**
 * Six v2 share strings frozen against what they mean.
 *
 * The encoder is deliberately absent from this file. A round trip stays green
 * while an encoder and a decoder rotate together, and that rotation is the
 * whole failure these cases exist to catch, so each case is three literals:
 * the share string, the wire text, and the decoded result. No value on either
 * side of any assertion below is computed at test time.
 *
 * Provenance: case 1 is the fragment recorded in `docs/share-link-example.md`,
 * already observed decoding in a live browser with storage cleared. Cases 2 to
 * 6 were authored here and are confirmed in a browser once at this phase's
 * gate.
 */

/**
 * Local, so the frozen thing is the bytes rather than the app's opinion of the
 * bytes. `fromBase64Url` in `src/state/shareLink.ts:45` is not exported, and
 * this is the same DOM typed idiom it uses. A node `Buffer` here would fail
 * `npm run typecheck` outright: `test` sits inside the tsconfig include and no
 * `@types/node` is installed.
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

/**
 * The decoder rebuilds floor ids, fitting ids and route keys rather than
 * carrying them, so every expected object below is written in the forms it
 * produces: `floor-N`, `fit-N`, and from, arrow, to, colon, item. Anything
 * else would make these comparisons pass on a shape the app never sees.
 */
const IRON = 'recipe:Recipe_IngotIron_C'
const PLATE = 'recipe:Recipe_IronPlate_C'
const ROD = 'recipe:Recipe_IronRod_C'
const SCREW = 'recipe:Recipe_Screw_C'
const DEPOT = 'storage:Desc_IronPlate_C'

// Section one: six frozen fragments.

const FRAGMENT_1 =
  '2.eyJ2IjoyLCJ0Ijp7Iklyb25QbGF0ZSI6MTIwfSwibyI6MCwiciI6OCwieiI6OCwiQSI6MCwiRiI6W1siR3JvdW5kIiwxMiwxMiwwLDAsMF1dLCJQIjpbXX0'

const CODE_1 =
  '{"v":2,"t":{"IronPlate":120},"o":0,"r":8,"z":8,"A":0,' +
  '"F":[["Ground",12,12,0,0,0]],"P":[]}'

const EXPECTED_1 = {
  plan: {
    targets: { Desc_IronPlate_C: 120 },
    objective: 'resources',
    tier: 8,
    unlockedAlternates: [],
    resourceCaps: {},
    allowSurplus: true,
    powerGenerators: [],
    machineOverrides: {},
  },
  layout: {
    floors: [
      {
        id: 'floor-1',
        name: 'Ground',
        role: 'production',
        elevation: 0,
        gridWidth: 12,
        gridDepth: 12,
        originX: 0,
        originY: 0,
      },
    ],
    activeFloorId: 'floor-1',
    placements: {},
    snapMetres: 8,
    reserves: [],
    manualLinks: [],
    routeOverrides: {},
    fittings: [],
  },
}

test('the documented empty layout link still opens on one Ground floor', () => {
  // Nine optional keys are absent here, and `u` is the one that inverts:
  // `allowSurplus` reads absence as true. A decoder that started defaulting it
  // to false would silently forbid byproducts on every link ever sent.
  expect(fromFragment(FRAGMENT_1)).toBe(CODE_1)

  const back = decodePlanCode(CODE_1)

  expect(back.plan).toEqual(EXPECTED_1.plan)
  expect(back.layout).toEqual(EXPECTED_1.layout)
})

const FRAGMENT_2 =
  '2.eyJ2IjoyLCJ0Ijp7Iklyb25QbGF0ZSI6NjAsIkNlbWVudCI6MTV9LCJvIjoyLCJyIjo2LCJhIjpbIkFsdGVybmF0ZV9QdXJlSXJvbkluZ290Il0sImMiOnsiT3JlSXJvbiI6NDgwLCJTdG9uZSI6MjQwfSwidSI6MCwiZyI6WyJHZW5lcmF0b3JDb2FsIl0sIm0iOnsiSW5nb3RJcm9uIjoxMn0sInoiOjQsIkEiOjEsIkYiOltbIkdyb3VuZCIsMTYsMTIsMCwwLDBdLFsiU3RvcmUiLDEwLDEwLDksMjQsLThdXSwiUCI6W119'

const CODE_2 =
  '{"v":2,"t":{"IronPlate":60,"Cement":15},"o":2,"r":6,' +
  '"a":["Alternate_PureIronIngot"],"c":{"OreIron":480,"Stone":240},"u":0,' +
  '"g":["GeneratorCoal"],"m":{"IngotIron":12},"z":4,"A":1,' +
  '"F":[["Ground",16,12,0,0,0],["Store",10,10,9,24,-8]],"P":[]}'

const EXPECTED_2 = {
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
  layout: {
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
        role: 'production',
        elevation: 9,
        gridWidth: 10,
        gridDepth: 10,
        originX: 24,
        originY: -8,
      },
    ],
    activeFloorId: 'floor-2',
    placements: {},
    snapMetres: 4,
    reserves: [],
    manualLinks: [],
    routeOverrides: {},
    fittings: [],
  },
}

test('a link that leaves every scalar off its default still means the same plan', () => {
  // `o` is an index into the objective list, so an insert at the front of that
  // list would make this link open on power instead of machines. `u:0` is the
  // only value the surplus slot ever carries, and the second floor is what
  // makes `A:1` mean anything at all.
  expect(fromFragment(FRAGMENT_2)).toBe(CODE_2)

  const back = decodePlanCode(CODE_2)

  expect(back.plan).toEqual(EXPECTED_2.plan)
  expect(back.layout).toEqual(EXPECTED_2.layout)
})

const FRAGMENT_3 =
  '2.eyJ2IjoyLCJ0Ijp7IlNjcmV3IjoyNDB9LCJvIjowLCJyIjo4LCJ6Ijo4LCJBIjowLCJGIjpbWyJHcm91bmQiLDIwLDIwLDAsMCwwXV0sIlAiOltbInJJbmdvdElyb24iLDAsMCwwLDAsMSwwLDFdLFsicklyb25QbGF0ZSIsMCwyNCwwLDEsMiwxLDJdLFsicklyb25Sb2QiLDAsMCwyNCwyLDMsMiwzXSxbInJTY3JldyIsMCwyNCwyNCwzLDQsMywwXV19'

const CODE_3 =
  '{"v":2,"t":{"Screw":240},"o":0,"r":8,"z":8,"A":0,' +
  '"F":[["Ground",20,20,0,0,0]],' +
  '"P":[["rIngotIron",0,0,0,0,1,0,1],' +
  '["rIronPlate",0,24,0,1,2,1,2],' +
  '["rIronRod",0,0,24,2,3,2,3],' +
  '["rScrew",0,24,24,3,4,3,0]]}'

const EXPECTED_3 = {
  plan: {
    targets: { Desc_Screw_C: 240 },
    objective: 'resources',
    tier: 8,
    unlockedAlternates: [],
    resourceCaps: {},
    allowSurplus: true,
    powerGenerators: [],
    machineOverrides: {},
  },
  layout: {
    floors: [
      {
        id: 'floor-1',
        name: 'Ground',
        role: 'production',
        elevation: 0,
        gridWidth: 20,
        gridDepth: 20,
        originX: 0,
        originY: 0,
      },
    ],
    activeFloorId: 'floor-1',
    placements: {
      [IRON]: {
        moduleId: IRON,
        floorId: 'floor-1',
        x: 0,
        y: 0,
        orientation: 0,
        columns: 1,
        inputSide: 'north',
        outputSide: 'east',
      },
      [PLATE]: {
        moduleId: PLATE,
        floorId: 'floor-1',
        x: 24,
        y: 0,
        orientation: 90,
        columns: 2,
        inputSide: 'east',
        outputSide: 'south',
      },
      [ROD]: {
        moduleId: ROD,
        floorId: 'floor-1',
        x: 0,
        y: 24,
        orientation: 180,
        columns: 3,
        inputSide: 'south',
        outputSide: 'west',
      },
      [SCREW]: {
        moduleId: SCREW,
        floorId: 'floor-1',
        x: 24,
        y: 24,
        orientation: 270,
        columns: 4,
        inputSide: 'west',
        outputSide: 'north',
      },
    },
    snapMetres: 8,
    reserves: [],
    manualLinks: [],
    routeOverrides: {},
    fittings: [],
  },
}

test('four placements still face the same way round the compass', () => {
  // The codec keeps its own side list in wire order, north east south west,
  // which is not the order `src/layout/types.ts` uses. Merging the two would
  // make index 1 here decode to north instead of east, turning every manifold
  // in every link already sent by a quarter turn.
  expect(fromFragment(FRAGMENT_3)).toBe(CODE_3)

  const back = decodePlanCode(CODE_3)

  expect(back.plan).toEqual(EXPECTED_3.plan)
  expect(back.layout).toEqual(EXPECTED_3.layout)
})

const FRAGMENT_4 =
  '2.eyJ2IjoyLCJ0Ijp7Iklyb25QbGF0ZSI6NjB9LCJvIjowLCJyIjo4LCJ6Ijo4LCJBIjowLCJGIjpbWyJHcm91bmQiLDEyLDEyLDAsMCwwXSxbIkRlcG90Iiw4LDgsOSwwLDAsMV1dLCJQIjpbWyJySW5nb3RJcm9uIiwwLDAsMCwwLDEsMCwxXSxbInNJcm9uUGxhdGUiLDEsOCw4LDAsMSwzLDEsMV1dfQ'

const CODE_4 =
  '{"v":2,"t":{"IronPlate":60},"o":0,"r":8,"z":8,"A":0,' +
  '"F":[["Ground",12,12,0,0,0],["Depot",8,8,9,0,0,1]],' +
  '"P":[["rIngotIron",0,0,0,0,1,0,1],' +
  '["sIronPlate",1,8,8,0,1,3,1,1]]}'

const EXPECTED_4 = {
  plan: {
    targets: { Desc_IronPlate_C: 60 },
    objective: 'resources',
    tier: 8,
    unlockedAlternates: [],
    resourceCaps: {},
    allowSurplus: true,
    powerGenerators: [],
    machineOverrides: {},
  },
  layout: {
    floors: [
      {
        id: 'floor-1',
        name: 'Ground',
        role: 'production',
        elevation: 0,
        gridWidth: 12,
        gridDepth: 12,
        originX: 0,
        originY: 0,
      },
      {
        id: 'floor-2',
        name: 'Depot',
        role: 'storage',
        elevation: 9,
        gridWidth: 8,
        gridDepth: 8,
        originX: 0,
        originY: 0,
      },
    ],
    activeFloorId: 'floor-1',
    placements: {
      [IRON]: {
        moduleId: IRON,
        floorId: 'floor-1',
        x: 0,
        y: 0,
        orientation: 0,
        columns: 1,
        inputSide: 'north',
        outputSide: 'east',
      },
      [DEPOT]: {
        moduleId: DEPOT,
        floorId: 'floor-2',
        x: 8,
        y: 8,
        orientation: 0,
        columns: 1,
        inputSide: 'west',
        outputSide: 'east',
        flipped: true,
      },
    },
    snapMetres: 8,
    reserves: [],
    manualLinks: [],
    routeOverrides: {},
    fittings: [],
  },
}

test('the two optional trailing slots still mean storage and mirrored', () => {
  // Half of this case is the absences. The Ground floor and the ingot block
  // both stop one slot short, and a decoder that stopped reading absence as
  // production and as not mirrored would flip both of them on every old link.
  expect(fromFragment(FRAGMENT_4)).toBe(CODE_4)

  const back = decodePlanCode(CODE_4)

  expect(back.plan).toEqual(EXPECTED_4.plan)
  expect(back.layout).toEqual(EXPECTED_4.layout)
})

const FRAGMENT_5 =
  '2.eyJ2IjoyLCJ0Ijp7Iklyb25QbGF0ZSI6NjB9LCJvIjowLCJyIjo4LCJ6Ijo4LCJBIjowLCJGIjpbWyJHcm91bmQiLDE2LDE2LDAsMCwwXV0sIlAiOltbInJJbmdvdElyb24iLDAsMCwwLDAsMSwwLDFdLFsicklyb25QbGF0ZSIsMCwyNCwwLDAsMSwzLDFdXSwiRCI6W1sickluZ290SXJvbiIsInJJcm9uUGxhdGUiLCJJcm9uSW5nb3QiLDEsNCwzLDEyLFsxNiw4LDE2LDI0XV0sWyIiLCIiLCJPcmVJcm9uIiwtMSwwLC0xLDAsW11dXX0'

const CODE_5 =
  '{"v":2,"t":{"IronPlate":60},"o":0,"r":8,"z":8,"A":0,' +
  '"F":[["Ground",16,16,0,0,0]],' +
  '"P":[["rIngotIron",0,0,0,0,1,0,1],["rIronPlate",0,24,0,0,1,3,1]],' +
  '"D":[["rIngotIron","rIronPlate","IronIngot",1,4,3,12,[16,8,16,24]],' +
  '["","","OreIron",-1,0,-1,0,[]]]}'

const EXPECTED_5 = {
  plan: {
    targets: { Desc_IronPlate_C: 60 },
    objective: 'resources',
    tier: 8,
    unlockedAlternates: [],
    resourceCaps: {},
    allowSurplus: true,
    powerGenerators: [],
    machineOverrides: {},
  },
  layout: {
    floors: [
      {
        id: 'floor-1',
        name: 'Ground',
        role: 'production',
        elevation: 0,
        gridWidth: 16,
        gridDepth: 16,
        originX: 0,
        originY: 0,
      },
    ],
    activeFloorId: 'floor-1',
    placements: {
      [IRON]: {
        moduleId: IRON,
        floorId: 'floor-1',
        x: 0,
        y: 0,
        orientation: 0,
        columns: 1,
        inputSide: 'north',
        outputSide: 'east',
      },
      [PLATE]: {
        moduleId: PLATE,
        floorId: 'floor-1',
        x: 24,
        y: 0,
        orientation: 0,
        columns: 1,
        inputSide: 'west',
        outputSide: 'east',
      },
    },
    snapMetres: 8,
    reserves: [],
    manualLinks: [],
    routeOverrides: {
      'recipe:Recipe_IngotIron_C->recipe:Recipe_IronPlate_C:Desc_IronIngot_C': {
        from: { side: 'east', along: 4 },
        to: { side: 'west', along: 12 },
        waypoints: [
          { x: 16, y: 8 },
          { x: 16, y: 24 },
        ],
      },
      'in->out:Desc_OreIron_C': {
        from: undefined,
        to: undefined,
        waypoints: [],
      },
    },
    fittings: [],
  },
}

test('two hand drawn runs still keep their ends, their corners and their key', () => {
  // The second override is the open one: empty module slots mean the router
  // picks the ends, and -1 in a side slot means the same about the face. A
  // decoder that read an empty string as a module id would key that run under
  // `->:Desc_OreIron_C` and lose the drawing.
  expect(fromFragment(FRAGMENT_5)).toBe(CODE_5)

  const back = decodePlanCode(CODE_5)

  expect(back.plan).toEqual(EXPECTED_5.plan)
  expect(back.layout).toEqual(EXPECTED_5.layout)
})

const FRAGMENT_6 =
  '2.eyJ2IjoyLCJ0Ijp7Iklyb25QbGF0ZSI6NjB9LCJvIjowLCJyIjo4LCJ6Ijo4LCJBIjowLCJGIjpbWyJHcm91bmQiLDEyLDEyLDAsMCwwXSxbIlVwcGVyIiwxMiwxMiw5LDAsMF1dLCJQIjpbXSwiUiI6W1siSXJvblBsYXRlIiwwLDUwMCwxNV0sWyJPcmVJcm9uIiwxLDBdXSwiVCI6W1sxLDAsInJJbmdvdElyb24iLCJySXJvblBsYXRlIiwiSXJvbkluZ290IiwxMiw0XSxbMCwxLCIiLCIiLCJPcmVJcm9uIiw2LDZdXX0'

const CODE_6 =
  '{"v":2,"t":{"IronPlate":60},"o":0,"r":8,"z":8,"A":0,' +
  '"F":[["Ground",12,12,0,0,0],["Upper",12,12,9,0,0]],"P":[],' +
  '"R":[["IronPlate",0,500,15],["OreIron",1,0]],' +
  '"T":[[1,0,"rIngotIron","rIronPlate","IronIngot",12,4],' +
  '[0,1,"","","OreIron",6,6]]}'

const EXPECTED_6 = {
  plan: {
    targets: { Desc_IronPlate_C: 60 },
    objective: 'resources',
    tier: 8,
    unlockedAlternates: [],
    resourceCaps: {},
    allowSurplus: true,
    powerGenerators: [],
    machineOverrides: {},
  },
  layout: {
    floors: [
      {
        id: 'floor-1',
        name: 'Ground',
        role: 'production',
        elevation: 0,
        gridWidth: 12,
        gridDepth: 12,
        originX: 0,
        originY: 0,
      },
      {
        id: 'floor-2',
        name: 'Upper',
        role: 'production',
        elevation: 9,
        gridWidth: 12,
        gridDepth: 12,
        originX: 0,
        originY: 0,
      },
    ],
    activeFloorId: 'floor-1',
    placements: {},
    snapMetres: 8,
    reserves: [
      {
        item: 'Desc_IronPlate_C',
        mode: 'fixed',
        quantity: 500,
        bufferMinutes: 15,
      },
      {
        item: 'Desc_OreIron_C',
        mode: 'excess',
        quantity: 0,
        bufferMinutes: 60,
      },
    ],
    manualLinks: [],
    routeOverrides: {},
    fittings: [
      {
        id: 'fit-0',
        routeId:
          'recipe:Recipe_IngotIron_C->recipe:Recipe_IronPlate_C:Desc_IronIngot_C',
        kind: 'merger',
        floorId: 'floor-1',
        x: 12,
        y: 4,
      },
      {
        id: 'fit-1',
        routeId: 'in->out:Desc_OreIron_C',
        kind: 'splitter',
        floorId: 'floor-2',
        x: 6,
        y: 6,
      },
    ],
  },
}

test('two reserves and two fittings still hold their modes and their kinds', () => {
  // The second reserve stops one slot short, so its buffer comes from the
  // decoder's default of 60 minutes rather than from the wire. The fitting
  // discriminator is a bare 1 for a merger, so inverting it would turn every
  // recorded merger in the wild into a splitter without changing a byte.
  expect(fromFragment(FRAGMENT_6)).toBe(CODE_6)

  const back = decodePlanCode(CODE_6)

  expect(back.plan).toEqual(EXPECTED_6.plan)
  expect(back.layout).toEqual(EXPECTED_6.layout)
})

// Section two: the codec version and the three wire arrays.

/**
 * The three arrays are module private, so there is no `toEqual` to write
 * against them. Each is pinned by decoding a hand written code that carries
 * every index of it, which fixes the order and the length together without
 * exporting anything.
 */
const SIDES_AT_EVERY_INDEX =
  '{"v":2,"t":{},"o":0,"r":8,"z":8,"A":0,"F":[["G",12,12,0,0,0]],' +
  '"P":[["rA",0,0,0,0,1,0,0],["rB",0,0,0,0,1,1,1],' +
  '["rC",0,0,0,0,1,2,2],["rD",0,0,0,0,1,3,3]]}'

const SIDE_PAST_THE_END =
  '{"v":2,"t":{},"o":0,"r":8,"z":8,"A":0,"F":[["G",12,12,0,0,0]],' +
  '"P":[["rE",0,0,0,0,1,4,4]]}'

const OBJECTIVE_AT_0 = '{"v":2,"t":{},"o":0,"r":8,"z":8,"A":0,"F":[],"P":[]}'
const OBJECTIVE_AT_1 = '{"v":2,"t":{},"o":1,"r":8,"z":8,"A":0,"F":[],"P":[]}'
const OBJECTIVE_AT_2 = '{"v":2,"t":{},"o":2,"r":8,"z":8,"A":0,"F":[],"P":[]}'
const OBJECTIVE_PAST_THE_END =
  '{"v":2,"t":{},"o":3,"r":8,"z":8,"A":0,"F":[],"P":[]}'

const RESERVE_MODES_AT_EVERY_INDEX =
  '{"v":2,"t":{},"o":0,"r":8,"z":8,"A":0,"F":[["G",12,12,0,0,0]],"P":[],' +
  '"R":[["Water",0,0,0],["Coal",1,0,0]]}'

const RESERVE_MODE_PAST_THE_END =
  '{"v":2,"t":{},"o":0,"r":8,"z":8,"A":0,"F":[["G",12,12,0,0,0]],"P":[],' +
  '"R":[["Water",2,0,0]]}'

test('the codec version is still 2, which is what old links are read through', () => {
  // A bump says older codes cannot be read any more, and every v2 link in the
  // wild is an older code.
  expect(PLAN_CODE_VERSION).toBe(2)
})

test('the wire order of the side list is frozen at north, east, south, west', () => {
  // The layout engine's side list starts at west, so a dedupe of the two would
  // make index 1 below decode to north instead of east. All four indices are
  // asserted on both slots because the decoder falls back rather than throwing
  // on an index it cannot reach, so a shortened list would decode index 3
  // correctly by luck on one slot alone.
  const placements = decodePlanCode(SIDES_AT_EVERY_INDEX).layout.placements

  expect(placements['recipe:Recipe_A_C'].inputSide).toBe('north')
  expect(placements['recipe:Recipe_A_C'].outputSide).toBe('north')
  expect(placements['recipe:Recipe_B_C'].inputSide).toBe('east')
  expect(placements['recipe:Recipe_B_C'].outputSide).toBe('east')
  expect(placements['recipe:Recipe_C_C'].inputSide).toBe('south')
  expect(placements['recipe:Recipe_C_C'].outputSide).toBe('south')
  expect(placements['recipe:Recipe_D_C'].inputSide).toBe('west')
  expect(placements['recipe:Recipe_D_C'].outputSide).toBe('west')
})

test('a fifth side appended to the list would change what index 4 means', () => {
  // Index 4 is past the end today, so it lands on the two documented
  // fallbacks. Appending a side would give it a value instead, which is the
  // only way an append is observable from outside the module.
  const placements = decodePlanCode(SIDE_PAST_THE_END).layout.placements

  expect(placements['recipe:Recipe_E_C'].inputSide).toBe('west')
  expect(placements['recipe:Recipe_E_C'].outputSide).toBe('east')
})

test('the wire order of the objective list is frozen at resources, power, machines', () => {
  expect(decodePlanCode(OBJECTIVE_AT_0).plan.objective).toBe('resources')
  expect(decodePlanCode(OBJECTIVE_AT_1).plan.objective).toBe('power')
  expect(decodePlanCode(OBJECTIVE_AT_2).plan.objective).toBe('machines')
})

test('a fourth objective appended to the list would change what index 3 means', () => {
  expect(decodePlanCode(OBJECTIVE_PAST_THE_END).plan.objective).toBe('resources')
})

test('the wire order of the reserve mode list is frozen at fixed, excess', () => {
  const reserves = decodePlanCode(RESERVE_MODES_AT_EVERY_INDEX).layout.reserves

  expect(reserves[0].mode).toBe('fixed')
  expect(reserves[1].mode).toBe('excess')
})

test('a third reserve mode appended to the list would change what index 2 means', () => {
  const reserves = decodePlanCode(RESERVE_MODE_PAST_THE_END).layout.reserves

  expect(reserves[0].mode).toBe('fixed')
})
