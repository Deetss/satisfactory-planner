import { expect, test } from 'vitest'

import {
  analyseFloor,
  findCrossings,
  findLaneClashes,
  findShaftClashes,
  planShafts,
  segmentsOf,
} from '../src/layout/congestion'
import {
  NORMALS,
  orthogonalPath,
  routePaths,
  simplify,
  type Point,
} from '../src/layout/paths'
import type { Route } from '../src/layout/routes'
import type { FactoryModule, Floor, Placement, Side } from '../src/layout/types'
import { SIDES } from '../src/layout/types'

const EPSILON = 1e-6

function segmentsOfPath(points: Point[]) {
  const out: { dx: number; dy: number }[] = []
  for (let i = 1; i < points.length; i++) {
    out.push({
      dx: points[i].x - points[i - 1].x,
      dy: points[i].y - points[i - 1].y,
    })
  }
  return out
}

/**
 * A run that reverses along an axis it just travelled reads as flowing
 * backwards, and puts arrowheads on segments pointing the wrong way.
 */
test('a run never doubles back, for any pair of faces or positions', () => {
  const offsets = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: -40, y: 0 },
    { x: 0, y: 40 },
    { x: 0, y: -40 },
    { x: 30, y: 30 },
    { x: -30, y: -30 },
    { x: 4, y: 4 },
    { x: 60, y: -12 },
  ]

  for (const from of SIDES) {
    for (const to of SIDES) {
      for (const offset of offsets) {
        const a = { x: 100, y: 100 }
        const b = { x: 100 + offset.x, y: 100 + offset.y }
        const path = orthogonalPath(a, from, b, to)
        const segments = segmentsOfPath(path)
        const degenerate = from === to && offset.x === 0 && offset.y === 0

        expect(
          path[0],
          `${from}->${to} at ${offset.x},${offset.y} loses its start`,
        ).toEqual(a)
        expect(
          path[path.length - 1],
          `${from}->${to} at ${offset.x},${offset.y} loses its end`,
        ).toEqual(b)

        // Two ports at one point on one face are two blocks in the same place,
        // which no layout can produce: a run leaving along a normal and
        // arriving against that same normal between identical points has
        // nowhere to go, so there is no forward direction to assert.
        if (degenerate) continue

        for (let i = 1; i < segments.length; i++) {
          const dot =
            segments[i].dx * segments[i - 1].dx +
            segments[i].dy * segments[i - 1].dy
          expect(
            dot,
            `${from}->${to} at ${offset.x},${offset.y} reverses at segment ${i}`,
          ).toBeGreaterThanOrEqual(-EPSILON)
        }
      }
    }
  }
})

test('every segment is axis-aligned and non-empty', () => {
  for (const from of SIDES) {
    for (const to of SIDES) {
      const path = orthogonalPath({ x: 0, y: 0 }, from, { x: 50, y: 25 }, to)
      for (const segment of segmentsOfPath(path)) {
        const horizontal = Math.abs(segment.dy) < EPSILON
        const vertical = Math.abs(segment.dx) < EPSILON
        expect(horizontal || vertical).toBe(true)
        expect(Math.abs(segment.dx) + Math.abs(segment.dy)).toBeGreaterThan(EPSILON)
      }
    }
  }
})

test('a run leaves along its output face and arrives against its input face', () => {
  const cases: { from: Side; to: Side }[] = []
  for (const from of SIDES) for (const to of SIDES) cases.push({ from, to })

  for (const { from, to } of cases) {
    const a = { x: 0, y: 0 }
    const b = { x: 80, y: 40 }
    const path = orthogonalPath(a, from, b, to)
    const segments = segmentsOfPath(path)

    const first = segments[0]
    const outward = NORMALS[from]
    expect(
      first.dx * outward.x + first.dy * outward.y,
      `${from}->${to} does not leave through the ${from} face`,
    ).toBeGreaterThan(0)

    const last = segments[segments.length - 1]
    const inward = NORMALS[to]
    // Arriving at a face means travelling against its outward normal.
    expect(
      last.dx * inward.x + last.dy * inward.y,
      `${from}->${to} does not arrive through the ${to} face`,
    ).toBeLessThan(0)
  }
})

test('a path keeps its endpoints', () => {
  const a = { x: 12, y: 34 }
  const b = { x: 56, y: 78 }
  const path = orthogonalPath(a, 'east', b, 'west')
  expect(path[0]).toEqual(a)
  expect(path[path.length - 1]).toEqual(b)
})

test('simplify merges collinear points but keeps a reversal visible', () => {
  const straight = simplify([
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 10, y: 0 },
  ])
  expect(straight).toHaveLength(2)

  // A doubling-back is a routing bug; merging it would hide it.
  const reversing = simplify([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 4, y: 0 },
  ])
  expect(reversing).toHaveLength(3)
})

// ---------------------------------------------------------------- congestion

const line = (
  routeId: string,
  from: Point,
  to: Point,
  item = 'Desc_IronPlate_C',
): Parameters<typeof findCrossings>[0][number] => ({
  from,
  to,
  horizontal: Math.abs(from.y - to.y) < EPSILON,
  routeId,
  item,
  fluid: false,
})

test('crossings need both runs to pass through, not just meet at a corner', () => {
  const crossing = findCrossings([
    line('a', { x: 0, y: 10 }, { x: 20, y: 10 }),
    line('b', { x: 10, y: 0 }, { x: 10, y: 20 }),
  ])
  expect(crossing).toHaveLength(1)
  expect(crossing[0]).toMatchObject({ x: 10, y: 10 })

  // Two runs turning at the same corner touch but don't cross.
  const corner = findCrossings([
    line('a', { x: 0, y: 10 }, { x: 10, y: 10 }),
    line('b', { x: 10, y: 10 }, { x: 10, y: 20 }),
  ])
  expect(corner).toHaveLength(0)

  // Pieces of one run crossing itself aren't two belts fighting.
  const same = findCrossings([
    line('a', { x: 0, y: 10 }, { x: 20, y: 10 }),
    line('a', { x: 10, y: 0 }, { x: 10, y: 20 }),
  ])
  expect(same).toHaveLength(0)
})

test('lane clashes catch two materials sharing a stretch, not a brief touch', () => {
  const rod = 'Desc_IronRod_C'
  const shared = findLaneClashes([
    line('a', { x: 0, y: 10 }, { x: 40, y: 10 }),
    line('b', { x: 20, y: 10 }, { x: 60, y: 10 }, rod),
  ])
  expect(shared).toHaveLength(1)
  expect(shared[0].overlap).toBeCloseTo(20)

  // Different lanes, however close in the other axis.
  expect(
    findLaneClashes([
      line('a', { x: 0, y: 10 }, { x: 40, y: 10 }),
      line('b', { x: 0, y: 14 }, { x: 40, y: 14 }, rod),
    ]),
  ).toHaveLength(0)

  // Meeting end to end is a manifold, not a clash.
  expect(
    findLaneClashes([
      line('a', { x: 0, y: 10 }, { x: 20, y: 10 }),
      line('b', { x: 20, y: 10 }, { x: 40, y: 10 }, rod),
    ]),
  ).toHaveLength(0)

  // Two runs of the same material in one lane is a manifold, which is how you
  // feed a row of machines.
  expect(
    findLaneClashes([
      line('a', { x: 0, y: 10 }, { x: 40, y: 10 }),
      line('b', { x: 20, y: 10 }, { x: 60, y: 10 }),
    ]),
  ).toHaveLength(0)
})

function block(id: string, machines = 1): FactoryModule {
  return {
    id,
    recipe: id,
    label: id,
    building: 'Build_ConstructorMk1_C',
    buildingName: 'Constructor',
    machines,
    clock: 1,
    power: 4,
    inputs: [],
    outputs: [],
    machineFootprint: { width: 8, depth: 8, height: 6 },
  }
}

const place = (
  moduleId: string,
  floorId: string,
  x: number,
  y: number,
): Placement => ({
  moduleId,
  floorId,
  x,
  y,
  orientation: 0,
  columns: 1,
  inputSide: 'west',
  outputSide: 'east',
})

const floor = (id: string, name: string, elevation: number): Floor => ({
  id,
  name,
  elevation,
  gridWidth: 12,
  gridDepth: 12,
  originX: 0,
  originY: 0,
})

test('a belt crossing a block it has no business touching is reported', () => {
  const modules = new Map([
    ['a', block('a')],
    ['b', block('b')],
    ['middle', block('middle')],
  ])
  const placements = [
    place('a', 'f1', 0, 0),
    place('middle', 'f1', 24, 0),
    place('b', 'f1', 48, 0),
  ]

  const route: Route = {
    id: 'a->b',
    item: 'Desc_IronPlate_C',
    rate: 60,
    fluid: false,
    from: 'a',
    to: 'b',
    transport: { option: null, lines: 1, needsSplit: false } as Route['transport'],
  }

  const paths = routePaths({
    routes: [route],
    modulesById: modules,
    placements: Object.fromEntries(placements.map((p) => [p.moduleId, p])),
    floorId: 'f1',
  })

  const report = analyseFloor(
    floor('f1', 'Ground', 0),
    paths,
    placements,
    modules,
  )
  expect(report.overBlocks.map((o) => o.moduleId)).toEqual(['middle'])
  // Its own two blocks are where it's meant to be.
  expect(report.overBlocks).toHaveLength(1)
  expect(segmentsOf(paths).length).toBeGreaterThan(0)
})

test('a lift is fouled by a machine on a floor it only passes through', () => {
  const floors = [
    floor('f1', 'Ground', 0),
    floor('f2', 'Level 2', 8),
    floor('f3', 'Level 3', 8),
  ]
  const modules = new Map([
    ['low', block('low')],
    ['high', block('high')],
    ['inTheWay', block('inTheWay', 4)],
  ])

  // The lift leaves 'low' by its east face at x = 8, y = 4, and 'inTheWay' sits
  // across that spot one floor up.
  const placements: Record<string, Placement> = {
    low: place('low', 'f1', 0, 0),
    high: place('high', 'f3', 0, 0),
    inTheWay: place('inTheWay', 'f2', 4, 0),
  }

  const links = [
    {
      fromFloorId: 'f1',
      toFloorId: 'f3',
      fromModuleId: 'low',
      toModuleId: 'high',
      item: 'Desc_IronPlate_C',
      rate: 60,
      rise: 2,
      fluid: false,
    },
  ]

  const shafts = planShafts(links, placements, modules, floors)
  expect(shafts).toHaveLength(1)
  expect(shafts[0]).toMatchObject({ x: 8, y: 4, low: 0, high: 2 })

  const clashes = findShaftClashes(shafts, placements, modules, floors)
  expect(clashes).toHaveLength(1)
  expect(clashes[0]).toMatchObject({ kind: 'block', floorId: 'f2' })

  // Move it out of the column and the lift is clear.
  const clear = { ...placements, inTheWay: place('inTheWay', 'f2', 40, 40) }
  expect(findShaftClashes(shafts, clear, modules, floors)).toHaveLength(0)
})

test('two lifts wanting one spot clash only when their floors overlap', () => {
  const floors = [
    floor('f1', 'Ground', 0),
    floor('f2', 'Level 2', 8),
    floor('f3', 'Level 3', 8),
  ]
  const modules = new Map([
    ['a', block('a')],
    ['b', block('b')],
    ['c', block('c')],
    ['d', block('d')],
  ])
  // Two source blocks in the same place on different floors put their columns
  // at the same x and y.
  const placements: Record<string, Placement> = {
    a: place('a', 'f1', 0, 0),
    b: place('b', 'f2', 0, 0),
    c: place('c', 'f2', 0, 0),
    d: place('d', 'f3', 0, 0),
  }

  const overlapping = planShafts(
    [
      { fromFloorId: 'f1', toFloorId: 'f3', fromModuleId: 'a', toModuleId: 'd', item: 'Desc_IronPlate_C', rate: 60, rise: 2, fluid: false },
      { fromFloorId: 'f2', toFloorId: 'f3', fromModuleId: 'b', toModuleId: 'd', item: 'Desc_IronRod_C', rate: 60, rise: 1, fluid: false },
    ],
    placements,
    modules,
    floors,
  )
  const clashes = findShaftClashes(overlapping, placements, modules, floors)
  expect(clashes.some((c) => c.kind === 'shaft')).toBe(true)
})
