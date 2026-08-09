/**
 * A compact encoding of a whole factory, plan and layout together, short enough
 * to live in an address bar.
 *
 * The save file is verbose JSON on purpose: it's meant to be read and diffed.
 * A link has a length budget, so the same data goes through three squeezes
 * here, in order of how much they win:
 *
 * 1. Class names lose their fixed affixes. `Recipe_IngotIron_C` is `IngotIron`.
 * 2. Records become tuples. A placement is eight values, not eight keys and
 *    eight values repeated once per block.
 * 3. Floor ids become positions, so a `floor-1754580000000` timestamp doesn't
 *    appear once per block placed on it.
 *
 * On a 24 block, three floor plan that takes 5.8 kB of save-file JSON down to
 * about 1.3 kB, and a deflated link from roughly 1,500 characters to 800.
 *
 * Anything that doesn't match an expected affix is escaped rather than mangled,
 * so the encoding is lossless for names this build has never seen.
 */

import { linkKey, splitLinkKey } from '../layout/congestion'
import type {
  Fitting,
  FloorRole,
  LayoutState,
  Orientation,
  Placement,
  RouteOverride,
  Side,
} from '../layout/types'
import { planName, type PlanFile } from './planFile'
import type { PlannerSnapshot } from './plannerStore'
import { DEFAULT_BUFFER_MINUTES, type Reserve } from '../layout/storage'

/** Bump only for a change that older codes can't be read through. */
export const PLAN_CODE_VERSION = 2

/**
 * A 24 block, three floor plan is about 1.3 kB of code, so this is roughly 750
 * times the largest plan anyone has built. It bounds hostile input rather than
 * limiting anything a user can reach.
 */
export const MAX_PLAN_CODE_CHARS = 1_000_000

/**
 * Wire order, and not the same order as `SIDES` in `../layout/types`.
 *
 * Index 0 is north here and west there. Every placement in every link already
 * sent carries a face as an index into this list, so replacing it with the
 * shared constant would rotate the manifolds of every plan in the wild by one
 * quarter turn. It stays local and it stays in this order.
 */
const SIDES: Side[] = ['north', 'east', 'south', 'west']
const OBJECTIVES: PlannerSnapshot['objective'][] = [
  'resources',
  'power',
  'machines',
]
const RESERVE_MODES: Reserve['mode'][] = ['fixed', 'excess']

/**
 * Marks a name that didn't match its expected affixes and so travels whole.
 * `=` can't start a class name, which is what makes this unambiguous.
 */
const VERBATIM = '='

const affix = (prefix: string) => {
  const pattern = new RegExp(`^${prefix}_(.+)_C$`)
  return {
    pack: (id: string) => {
      const match = pattern.exec(id)
      return match ? match[1] : VERBATIM + id
    },
    unpack: (code: string) =>
      code.startsWith(VERBATIM) ? code.slice(1) : `${prefix}_${code}_C`,
  }
}

const item = affix('Desc')
const recipe = affix('Recipe')
const build = affix('Build')

/** Separates a generator's building from its fuel inside one module code. */
const FUEL = '|'

/**
 * Module ids are structured (`recipe:`, `storage:`, `generator:building:fuel`),
 * so the kind collapses to a single leading character.
 */
function packModule(id: string): string {
  if (id.startsWith('recipe:')) return `r${recipe.pack(id.slice(7))}`
  if (id.startsWith('storage:')) return `s${item.pack(id.slice(8))}`
  if (id.startsWith('generator:')) {
    const [generator, fuel] = id.slice(10).split(':')
    return `g${build.pack(generator)}${FUEL}${item.pack(fuel ?? '')}`
  }
  return VERBATIM + id
}

function unpackModule(code: string): string {
  const body = code.slice(1)
  switch (code[0]) {
    case 'r':
      return `recipe:${recipe.unpack(body)}`
    case 's':
      return `storage:${item.unpack(body)}`
    case 'g': {
      const [generator, fuel] = body.split(FUEL)
      return `generator:${build.unpack(generator ?? '')}:${item.unpack(fuel ?? '')}`
    }
    default:
      return code.startsWith(VERBATIM) ? code.slice(1) : code
  }
}

/**
 * Splits a route id back into its parts. Ids are built as
 * `${from ?? 'in'}->${to ?? 'out'}:${item}`, and module ids contain colons, so
 * the item is taken from the last one.
 */
function splitRouteId(
  routeId: string,
): { from: string; to: string; item: string } | null {
  const arrow = routeId.indexOf('->')
  if (arrow < 0) return null
  const colon = routeId.lastIndexOf(':')
  if (colon < arrow) return null
  return {
    from: routeId.slice(0, arrow),
    to: routeId.slice(arrow + 2, colon),
    item: routeId.slice(colon + 1),
  }
}

const packMap = (map: Record<string, number>, pack: (key: string) => string) =>
  Object.fromEntries(Object.entries(map).map(([key, value]) => [pack(key), value]))

const unpackMap = (
  map: Record<string, number> | undefined,
  unpack: (key: string) => string,
) =>
  Object.fromEntries(
    Object.entries(map ?? {}).map(([key, value]) => [unpack(key), value]),
  )

type FloorCode = [
  string,
  number,
  number,
  number,
  number,
  number,
  /** 1 when the floor is dedicated to storage. Absent means production. */
  number?,
]
type PlacementCode = [
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  /** 1 when the machines are mirrored. Absent means not. */
  number?,
]
type ReserveCode = [string, number, number, number]
/** A hand-carried link as its three parts, so no key has to be parsed twice. */
type ManualCode = [string, string, string]
/**
 * A hand-drawn run: its two module codes, its item, each end as a side index
 * and a distance along that face (-1 when the end was left to the router), then
 * the corners as a flat list of metres.
 */
type DrawnCode = [
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  number[],
]

/** A fitting: kind, floor index, the run it sits on, and where. */
type FittingCode = [number, number, string, string, string, number, number]

interface PlanCode {
  v: number
  /** Targets, keyed by packed item. */
  t: Record<string, number>
  o: number
  r: number
  a?: string[]
  c?: Record<string, number>
  /** Absent means surplus is allowed, which is the default. */
  u?: 0
  g?: string[]
  m?: Record<string, number>
  z: number
  /** Index of the active floor. */
  A: number
  F: FloorCode[]
  P: PlacementCode[]
  R?: ReserveCode[]
  M?: ManualCode[]
  D?: DrawnCode[]
  T?: FittingCode[]
}

/** Drops a key when its value carries no information, to save the characters. */
const some = <T>(value: T[] | Record<string, unknown>, key: string) =>
  (Array.isArray(value) ? value.length : Object.keys(value).length) > 0
    ? { [key]: value }
    : {}

export function encodePlanCode(file: PlanFile): string {
  const { plan, layout } = file
  const floorAt = new Map(layout.floors.map((floor, index) => [floor.id, index]))

  const code: PlanCode = {
    v: PLAN_CODE_VERSION,
    t: packMap(plan.targets, item.pack),
    o: Math.max(0, OBJECTIVES.indexOf(plan.objective)),
    r: plan.tier,
    ...some(plan.unlockedAlternates.map(recipe.pack), 'a'),
    ...some(packMap(plan.resourceCaps, item.pack), 'c'),
    ...(plan.allowSurplus ? {} : { u: 0 as const }),
    ...some(plan.powerGenerators.map(build.pack), 'g'),
    ...some(packMap(plan.machineOverrides, recipe.pack), 'm'),
    z: layout.snapMetres,
    A: floorAt.get(layout.activeFloorId) ?? 0,
    F: layout.floors.map((floor) => {
      const code: FloorCode = [
        floor.name,
        floor.gridWidth,
        floor.gridDepth,
        floor.elevation,
        floor.originX,
        floor.originY,
      ]
      // Only a dedicated floor spends a character on saying so.
      if (floor.role === 'storage') code[6] = 1
      return code
    }),
    // A placement on a floor that no longer exists can't be drawn, so it isn't
    // worth the characters it would cost every reader of the link.
    P: Object.values(layout.placements)
      .filter((placement) => floorAt.has(placement.floorId))
      .map((placement): PlacementCode => {
        const code: PlacementCode = [
          packModule(placement.moduleId),
          floorAt.get(placement.floorId) ?? 0,
          placement.x,
          placement.y,
          placement.orientation / 90,
          placement.columns,
          Math.max(0, SIDES.indexOf(placement.inputSide)),
          Math.max(0, SIDES.indexOf(placement.outputSide)),
        ]
        // Appended only when true, so an unmirrored block costs nothing.
        if (placement.flipped) code[8] = 1
        return code
      }),
    ...some(
      layout.reserves.map((reserve): ReserveCode => [
        item.pack(reserve.item),
        Math.max(0, RESERVE_MODES.indexOf(reserve.mode)),
        reserve.quantity,
        reserve.bufferMinutes,
      ]),
      'R',
    ),
    ...some(
      layout.manualLinks.flatMap((key): ManualCode[] => {
        const parts = splitLinkKey(key)
        if (!parts) return []
        return [
          [packModule(parts.from), packModule(parts.to), item.pack(parts.item)],
        ]
      }),
      'M',
    ),
    ...some(
      Object.entries(layout.routeOverrides).flatMap(
        ([routeId, override]): DrawnCode[] => {
          const parts = splitRouteId(routeId)
          if (!parts) return []
          return [
            [
              parts.from === 'in' ? '' : packModule(parts.from),
              parts.to === 'out' ? '' : packModule(parts.to),
              item.pack(parts.item),
              override.from ? Math.max(0, SIDES.indexOf(override.from.side)) : -1,
              override.from?.along ?? 0,
              override.to ? Math.max(0, SIDES.indexOf(override.to.side)) : -1,
              override.to?.along ?? 0,
              override.waypoints.flatMap((point) => [point.x, point.y]),
            ],
          ]
        },
      ),
      'D',
    ),
    ...some(
      layout.fittings.flatMap((fitting): FittingCode[] => {
        const parts = splitRouteId(fitting.routeId)
        const floor = floorAt.get(fitting.floorId)
        if (!parts || floor === undefined) return []
        return [
          [
            fitting.kind === 'merger' ? 1 : 0,
            floor,
            parts.from === 'in' ? '' : packModule(parts.from),
            parts.to === 'out' ? '' : packModule(parts.to),
            item.pack(parts.item),
            fitting.x,
            fitting.y,
          ],
        ]
      }),
      'T',
    ),
  }

  return JSON.stringify(code)
}

const number = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const pick = <T>(list: T[], index: unknown, fallback: T): T =>
  typeof index === 'number' && index >= 0 && index < list.length
    ? list[index]
    : fallback

/**
 * An end the router was left to decide travels as an empty module slot. A slot
 * holding something other than a string is a damaged link, and reads as that
 * same open end rather than crashing the decoder.
 */
const endModule = (value: unknown, open: string) =>
  typeof value === 'string' && value !== '' ? unpackModule(value) : open

/**
 * Reads a code back into the save-file shape. Every field is treated as
 * untrusted, because a link is the one input a stranger controls: the planner
 * stores run their own normalizers over the result, and this only has to hand
 * them something of the right shape.
 */
export function decodePlanCode(text: string): PlanFile {
  if (text.length > MAX_PLAN_CODE_CHARS) {
    throw new Error('That link is too large to open.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That link is damaged, most likely cut short in transit.')
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error("That link doesn't contain a plan.")
  }

  const code = parsed as Partial<PlanCode>
  if (number(code.v, 0) > PLAN_CODE_VERSION) {
    throw new Error(
      `That link was made by a newer version of the planner (v${String(code.v)}).`,
    )
  }

  const floorCodes = Array.isArray(code.F) ? code.F : []
  const floors = floorCodes.map((floor, index) => ({
    id: `floor-${index + 1}`,
    name: typeof floor?.[0] === 'string' ? floor[0] : `Level ${index + 1}`,
    gridWidth: number(floor?.[1], 12),
    gridDepth: number(floor?.[2], 12),
    elevation: index === 0 ? 0 : number(floor?.[3], 8),
    originX: number(floor?.[4], 0),
    originY: number(floor?.[5], 0),
    role: (floor?.[6] === 1 ? 'storage' : 'production') as FloorRole,
  }))

  const placements: Record<string, Placement> = {}
  for (const entry of Array.isArray(code.P) ? code.P : []) {
    if (typeof entry?.[0] !== 'string') continue
    const moduleId = unpackModule(entry[0])
    const floor = floors[number(entry[1], 0)] ?? floors[0]
    if (!floor) continue

    placements[moduleId] = {
      moduleId,
      floorId: floor.id,
      x: number(entry[2], 0),
      y: number(entry[3], 0),
      orientation: ((number(entry[4], 0) * 90) % 360) as Orientation,
      columns: Math.max(1, number(entry[5], 1)),
      inputSide: pick(SIDES, entry[6], 'west'),
      outputSide: pick(SIDES, entry[7], 'east'),
      ...(entry[8] === 1 ? { flipped: true } : {}),
    }
  }

  const reserves: Reserve[] = (Array.isArray(code.R) ? code.R : [])
    .filter((entry) => typeof entry?.[0] === 'string')
    .map((entry) => ({
      item: item.unpack(entry[0]),
      mode: pick(RESERVE_MODES, entry[1], 'fixed'),
      quantity: number(entry[2], 0),
      bufferMinutes: number(entry[3], DEFAULT_BUFFER_MINUTES),
    }))

  const targets = unpackMap(code.t, item.unpack)
  const plan: PlannerSnapshot = {
    targets,
    objective: pick(OBJECTIVES, code.o, 'resources'),
    tier: number(code.r, 8),
    unlockedAlternates: (Array.isArray(code.a) ? code.a : [])
      .filter((value): value is string => typeof value === 'string')
      .map(recipe.unpack),
    resourceCaps: unpackMap(code.c, item.unpack),
    allowSurplus: code.u !== 0,
    powerGenerators: (Array.isArray(code.g) ? code.g : [])
      .filter((value): value is string => typeof value === 'string')
      .map(build.unpack),
    machineOverrides: unpackMap(code.m, recipe.unpack),
  }

  const manualLinks = (Array.isArray(code.M) ? code.M : [])
    .filter(
      (entry) =>
        typeof entry?.[0] === 'string' &&
        typeof entry[1] === 'string' &&
        typeof entry[2] === 'string',
    )
    .map((entry) =>
      linkKey({
        fromModuleId: unpackModule(entry[0]),
        toModuleId: unpackModule(entry[1]),
        item: item.unpack(entry[2]),
      }),
    )

  const routeOverrides: Record<string, RouteOverride> = {}
  for (const entry of Array.isArray(code.D) ? code.D : []) {
    if (typeof entry?.[2] !== 'string') continue
    const from = endModule(entry[0], 'in')
    const to = endModule(entry[1], 'out')
    const flat = Array.isArray(entry[7]) ? entry[7] : []

    const waypoints: { x: number; y: number }[] = []
    for (let i = 0; i + 1 < flat.length; i += 2) {
      waypoints.push({ x: number(flat[i], 0), y: number(flat[i + 1], 0) })
    }

    const end = (sideIndex: unknown, along: unknown) =>
      typeof sideIndex === 'number' && sideIndex >= 0
        ? { side: pick(SIDES, sideIndex, 'west'), along: number(along, 0) }
        : undefined

    routeOverrides[`${from}->${to}:${item.unpack(entry[2])}`] = {
      from: end(entry[3], entry[4]),
      to: end(entry[5], entry[6]),
      waypoints,
    }
  }

  const fittings: Fitting[] = []
  for (const [index, entry] of (Array.isArray(code.T) ? code.T : []).entries()) {
    if (typeof entry?.[4] !== 'string') continue
    const floor = floors[number(entry[1], 0)] ?? floors[0]
    if (!floor) continue
    const from = endModule(entry[2], 'in')
    const to = endModule(entry[3], 'out')
    fittings.push({
      // Rebuilt rather than carried: an id only has to be unique here.
      id: `fit-${index}`,
      kind: entry[0] === 1 ? 'merger' : 'splitter',
      floorId: floor.id,
      routeId: `${from}->${to}:${item.unpack(entry[4])}`,
      x: number(entry[5], 0),
      y: number(entry[6], 0),
    })
  }

  const layout: LayoutState = {
    floors,
    activeFloorId: (floors[number(code.A, 0)] ?? floors[0])?.id ?? 'floor-1',
    placements,
    snapMetres: number(code.z, 8),
    reserves,
    manualLinks,
    routeOverrides,
    fittings,
  }

  return {
    kind: 'satisfactory-planner',
    version: 1,
    savedAt: '',
    name: planName(targets),
    plan,
    layout,
  }
}
