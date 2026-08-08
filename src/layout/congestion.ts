/**
 * How tangled a layout is.
 *
 * A plan that solves perfectly can still be unbuildable: belts crossing each
 * other need a lift or a floor-hole, two runs sharing a lane can't both exist,
 * and a belt over a machine blocks the machine's own ports. These are the
 * things a rate table can't tell you and a top-down view only hints at.
 */

import { isFluid, itemName } from '../data/gameData'
import type { Point, RoutePath } from './paths'
import { pathLength } from './paths'
import type { FactoryModule, Floor, Placement, Rect } from './types'
import { placementRect, sideAnchor } from './types'
import { num } from '../format'

/** Runs closer than this in a shared lane are treated as the same lane. */
const LANE_TOLERANCE_M = 1

/** A crossing needs both segments to extend past the meeting point. */
const EPSILON = 1e-6

export interface Segment {
  from: Point
  to: Point
  horizontal: boolean
  routeId: string
  item: string
  fluid: boolean
}

export interface Crossing {
  x: number
  y: number
  /** The two runs meeting here. */
  a: string
  b: string
  label: string
}

export interface LaneClash {
  /** Runs sharing a stretch of the same lane. */
  routes: string[]
  overlap: number
  label: string
}

export interface BlockCrossing {
  moduleId: string
  routeId: string
  label: string
}

export interface FloorCongestion {
  floorId: string
  floorName: string
  crossings: Crossing[]
  laneClashes: LaneClash[]
  overBlocks: BlockCrossing[]
  /** Total belt and pipe length on this floor, in metres. */
  length: number
  runs: number
  /** Worst first, for a heading that says how bad it is. */
  score: number
}

/** Straight pieces of every run, tagged with which run they belong to. */
export function segmentsOf(paths: RoutePath[]): Segment[] {
  const segments: Segment[] = []
  for (const path of paths) {
    for (let i = 1; i < path.points.length; i++) {
      const from = path.points[i - 1]
      const to = path.points[i]
      if (Math.abs(from.x - to.x) < EPSILON && Math.abs(from.y - to.y) < EPSILON) {
        continue
      }
      segments.push({
        from,
        to,
        horizontal: Math.abs(from.y - to.y) < EPSILON,
        routeId: path.route.id,
        item: path.route.item,
        fluid: path.route.fluid,
      })
    }
  }
  return segments
}

const span = (a: number, b: number) => ({
  low: Math.min(a, b),
  high: Math.max(a, b),
})

/**
 * Points where one run passes over another.
 *
 * Only perpendicular pairs count. Two runs meeting end to end at a shared
 * corner aren't crossing, so the meeting point has to be strictly inside both
 * segments rather than at either end.
 */
export function findCrossings(segments: Segment[]): Crossing[] {
  const crossings: Crossing[] = []
  const seen = new Set<string>()

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]
      const b = segments[j]
      if (a.routeId === b.routeId) continue
      if (a.horizontal === b.horizontal) continue

      const h = a.horizontal ? a : b
      const v = a.horizontal ? b : a
      const hx = span(h.from.x, h.to.x)
      const vy = span(v.from.y, v.to.y)
      const y = h.from.y
      const x = v.from.x

      // Strictly inside both, so shared corners don't register as tangles.
      if (x <= hx.low + EPSILON || x >= hx.high - EPSILON) continue
      if (y <= vy.low + EPSILON || y >= vy.high - EPSILON) continue

      const key = `${a.routeId}|${b.routeId}|${x.toFixed(2)},${y.toFixed(2)}`
      if (seen.has(key)) continue
      seen.add(key)

      crossings.push({
        x,
        y,
        a: a.routeId,
        b: b.routeId,
        label: `${itemName(a.item)} over ${itemName(b.item)}`,
      })
    }
  }

  return crossings
}

/**
 * Stretches where two runs share a lane. Unlike a crossing this can't be fixed
 * with a lift: one of them has to move.
 */
export function findLaneClashes(segments: Segment[]): LaneClash[] {
  const clashes: LaneClash[] = []
  const seen = new Set<string>()

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]
      const b = segments[j]
      if (a.routeId === b.routeId) continue
      if (a.horizontal !== b.horizontal) continue

      // Same lane means the same offset on the axis they don't travel along.
      const offsetA = a.horizontal ? a.from.y : a.from.x
      const offsetB = b.horizontal ? b.from.y : b.from.x
      if (Math.abs(offsetA - offsetB) > LANE_TOLERANCE_M) continue

      const alongA = a.horizontal
        ? span(a.from.x, a.to.x)
        : span(a.from.y, a.to.y)
      const alongB = b.horizontal
        ? span(b.from.x, b.to.x)
        : span(b.from.y, b.to.y)

      // Two runs of the same item sharing a lane is a manifold, which is how
      // you're meant to feed a row of machines. Only different materials in one
      // lane are a problem, since one belt can't carry both.
      if (a.item === b.item) continue

      const overlap =
        Math.min(alongA.high, alongB.high) - Math.max(alongA.low, alongB.low)
      // Belts merging at a manifold touch by design; only a real shared run
      // is a problem worth reporting.
      if (overlap <= LANE_TOLERANCE_M) continue

      const key = [a.routeId, b.routeId].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)

      clashes.push({
        routes: [a.routeId, b.routeId],
        overlap,
        label: `${itemName(a.item)} and ${itemName(
          b.item,
        )} in one lane for ${num(overlap)} m`,
      })
    }
  }

  return clashes.sort((x, y) => y.overlap - x.overlap)
}

const crossesRect = (segment: Segment, rect: Rect): boolean => {
  const x = span(segment.from.x, segment.to.x)
  const y = span(segment.from.y, segment.to.y)
  return (
    x.low < rect.x + rect.width - EPSILON &&
    x.high > rect.x + EPSILON &&
    y.low < rect.y + rect.depth - EPSILON &&
    y.high > rect.y + EPSILON
  )
}

/**
 * Runs passing over a block they don't belong to. In game the belt has to go
 * over or under the machine, and either way it's in the way of that machine's
 * own ports.
 */
export function findBlocksCrossed(
  segments: Segment[],
  paths: RoutePath[],
  placements: Placement[],
  modulesById: Map<string, FactoryModule>,
): BlockCrossing[] {
  const endpoints = new Map<string, Set<string>>()
  for (const path of paths) {
    const own = new Set<string>()
    if (path.route.from) own.add(path.route.from)
    if (path.route.to) own.add(path.route.to)
    endpoints.set(path.route.id, own)
  }

  const found: BlockCrossing[] = []
  const seen = new Set<string>()

  for (const placement of placements) {
    const module = modulesById.get(placement.moduleId)
    if (!module) continue
    const rect = placementRect(module, placement)

    for (const segment of segments) {
      // A run's own endpoints are supposed to touch their block.
      if (endpoints.get(segment.routeId)?.has(placement.moduleId)) continue
      if (!crossesRect(segment, rect)) continue

      const key = `${placement.moduleId}|${segment.routeId}`
      if (seen.has(key)) continue
      seen.add(key)

      found.push({
        moduleId: placement.moduleId,
        routeId: segment.routeId,
        // Naming the building as well as the recipe, because "Iron Ingot over
        // Iron Plate" reads as two items rather than a belt over a block.
        label: `${itemName(segment.item)} runs over the ${module.machines}x ${
          module.buildingName
        } (${module.label})`,
      })
    }
  }

  return found
}

export function analyseFloor(
  floor: Floor,
  paths: RoutePath[],
  placements: Placement[],
  modulesById: Map<string, FactoryModule>,
): FloorCongestion {
  const segments = segmentsOf(paths)
  const crossings = findCrossings(segments)
  const laneClashes = findLaneClashes(segments)
  const overBlocks = findBlocksCrossed(
    segments,
    paths,
    placements,
    modulesById,
  )

  return {
    floorId: floor.id,
    floorName: floor.name,
    crossings,
    laneClashes,
    overBlocks,
    length: paths.reduce((sum, p) => sum + pathLength(p.points), 0),
    runs: paths.length,
    // A shared lane can't be built at all, so it outweighs a crossing, which
    // only costs a lift.
    score: crossings.length + laneClashes.length * 3 + overBlocks.length * 2,
  }
}

export interface FloorLink {
  fromFloorId: string
  toFloorId: string
  fromModuleId: string
  toModuleId: string
  item: string
  rate: number
  /** Floors climbed; negative goes down. */
  rise: number
  fluid: boolean
  /**
   * Filling a stockpile rather than feeding production. A depot taps a line
   * whenever it suits, so it carries no rate and is always done by hand.
   */
  depot?: boolean
}

/**
 * Runs whose ends sit on different floors. Each one is a lift or a riser you
 * have to find room for at both ends.
 */
export function findFloorLinks(
  routes: { id: string; item: string; rate: number; fluid: boolean; from: string | null; to: string | null }[],
  placements: Record<string, Placement>,
  floors: Floor[],
): FloorLink[] {
  const index = new Map(floors.map((f, i) => [f.id, i]))
  const links: FloorLink[] = []

  for (const route of routes) {
    if (!route.from || !route.to) continue
    const from = placements[route.from]
    const to = placements[route.to]
    if (!from || !to || from.floorId === to.floorId) continue

    const fromIndex = index.get(from.floorId)
    const toIndex = index.get(to.floorId)
    if (fromIndex === undefined || toIndex === undefined) continue

    links.push({
      fromFloorId: from.floorId,
      toFloorId: to.floorId,
      fromModuleId: route.from,
      toModuleId: route.to,
      item: route.item,
      rate: route.rate,
      rise: toIndex - fromIndex,
      fluid: route.fluid,
    })
  }

  return links
}

/** Plan-view width a lift or riser column needs, in metres. */
const SHAFT_CLEARANCE_M = 2

export interface Shaft {
  id: string
  /** Representative link, for labelling. */
  link: FloorLink
  /** Everything moving between this pair of blocks, all sharing the column. */
  links: FloorLink[]
  /** Position of the column in base coordinates, in metres. */
  x: number
  y: number
  /**
   * Where the run lands at the far end, in base coordinates. A lift is vertical,
   * so this is the face it has to reach once it arrives, which is what says
   * which side of the upper floor the belt comes down on.
   */
  toX: number | null
  toY: number | null
  /** Floor indices it passes through, low to high inclusive. */
  low: number
  high: number
  /** Carried by hand, so it needs no lift and can't be fouled by one. */
  manual: boolean
}

/**
 * Identifies one cross-floor connection, so a decision about it survives a
 * re-solve. Module ids and item classes never contain `>` or `#`.
 */
export const linkKey = (link: {
  fromModuleId: string
  toModuleId: string
  item: string
}) => `${link.fromModuleId}>${link.toModuleId}#${link.item}`

/** Splits a key back into its parts, for encoding a plan compactly. */
export function splitLinkKey(
  key: string,
): { from: string; to: string; item: string } | null {
  const hash = key.lastIndexOf('#')
  if (hash < 0) return null
  const arrow = key.slice(0, hash).indexOf('>')
  if (arrow < 0) return null
  return {
    from: key.slice(0, arrow),
    to: key.slice(arrow + 1, hash),
    item: key.slice(hash + 1),
  }
}

/** Where a floor's local coordinates sit in the base. */
function originOf(floors: Floor[], floorId: string) {
  const floor = floors.find((f) => f.id === floorId)
  return { x: floor?.originX ?? 0, y: floor?.originY ?? 0 }
}

/**
 * A cross-floor run as the vertical column it really is.
 *
 * The column stands at the source block's output face, which is where a lift
 * would go, and occupies that spot on every floor between the two ends.
 * Positions are in base coordinates, not floor-local ones, because floors can
 * be offset from each other and a column is vertical through all of them.
 */
/**
 * Stockpiles that sit on a different floor from whatever fills them.
 *
 * A reserve block declares no inputs, because a depot is filled by tapping a
 * line rather than by being plumbed into one, so nothing else here would ever
 * notice that the line is a floor away. These say so: a rise or a drop the
 * player makes by hand, costing no lift and fouling nothing.
 */
export function findDepotFeeds(
  modules: FactoryModule[],
  placements: Record<string, Placement>,
  floors: Floor[],
): FloorLink[] {
  const index = new Map(floors.map((f, i) => [f.id, i]))
  const feeds: FloorLink[] = []

  const placedOn = (moduleId: string) => placements[moduleId]?.floorId

  for (const depot of modules) {
    if (!depot.id.startsWith('storage:')) continue
    const depotFloor = placedOn(depot.id)
    if (!depotFloor) continue

    const item = depot.id.slice('storage:'.length)

    // The biggest producer is the line worth walking to.
    const source = modules
      .filter((m) => placedOn(m.id) && m.outputs.some((o) => o.item === item))
      .sort(
        (a, b) =>
          (b.outputs.find((o) => o.item === item)?.rate ?? 0) -
          (a.outputs.find((o) => o.item === item)?.rate ?? 0),
      )[0]
    if (!source) continue

    const sourceFloor = placedOn(source.id)
    if (!sourceFloor || sourceFloor === depotFloor) continue

    const fromIndex = index.get(sourceFloor)
    const toIndex = index.get(depotFloor)
    if (fromIndex === undefined || toIndex === undefined) continue

    feeds.push({
      fromFloorId: sourceFloor,
      toFloorId: depotFloor,
      fromModuleId: source.id,
      toModuleId: depot.id,
      item,
      // A depot fills when it fills; there's no rate to carry.
      rate: 0,
      rise: toIndex - fromIndex,
      fluid: isFluid(item),
      depot: true,
    })
  }

  return feeds
}

export function planShafts(
  links: FloorLink[],
  placements: Record<string, Placement>,
  modulesById: Map<string, FactoryModule>,
  floors: Floor[],
  /** Links the player will carry by hand, which occupy no column. */
  manual: ReadonlySet<string> = new Set(),
): Shaft[] {
  const index = new Map(floors.map((f, i) => [f.id, i]))
  const shafts: Shaft[] = []

  // One column per pair of blocks, however many items move between them, so
  // the links are grouped before any column is placed.
  const byPair = new Map<string, FloorLink[]>()
  for (const link of links) {
    const id = `${link.fromModuleId}->${link.toModuleId}`
    const group = byPair.get(id)
    if (group) group.push(link)
    else byPair.set(id, [link])
  }

  for (const [id, group] of byPair) {
    const link = group[0]
    const placement = placements[link.fromModuleId]
    const module = modulesById.get(link.fromModuleId)
    const fromIndex = index.get(link.fromFloorId)
    const toIndex = index.get(link.toFloorId)
    if (!placement || !module || fromIndex === undefined || toIndex === undefined) {
      continue
    }

    const anchor = sideAnchor(
      placementRect(module, placement),
      placement.outputSide,
    )

    const landingPlacement = placements[link.toModuleId]
    const landingModule = modulesById.get(link.toModuleId)
    const landing =
      landingPlacement && landingModule
        ? (() => {
            const at = sideAnchor(
              placementRect(landingModule, landingPlacement),
              landingPlacement.inputSide,
            )
            const origin = originOf(floors, landingPlacement.floorId)
            return { x: at.x + origin.x, y: at.y + origin.y }
          })()
        : null
    // Base coordinates. A floor shifted sideways puts its blocks somewhere
    // their floor-local position doesn't describe, and everything a column is
    // measured against (other blocks, other columns, the elevation) is in base.
    const origin = originOf(floors, link.fromFloorId)

    shafts.push({
      id,
      link,
      links: group,
      x: anchor.x + origin.x,
      y: anchor.y + origin.y,
      toX: landing?.x ?? null,
      toY: landing?.y ?? null,
      low: Math.min(fromIndex, toIndex),
      high: Math.max(fromIndex, toIndex),
      // A column is only spared if every item moving through it is hand-carried.
      manual: group.every((l) => l.depot === true || manual.has(linkKey(l))),
    })
  }

  return shafts
}

export interface ShaftClash {
  shaftId: string
  /** A machine in the way, or another column wanting the same spot. */
  kind: 'block' | 'shaft'
  floorId: string
  label: string
}

const contains = (rect: Rect, x: number, y: number, pad: number) =>
  x > rect.x - pad &&
  x < rect.x + rect.width + pad &&
  y > rect.y - pad &&
  y < rect.y + rect.depth + pad

/**
 * Where the vertical runs go wrong: a column through a machine on a floor in
 * between, or two columns fighting for one spot.
 */
export function findShaftClashes(
  shafts: Shaft[],
  placements: Record<string, Placement>,
  modulesById: Map<string, FactoryModule>,
  floors: Floor[],
): ShaftClash[] {
  const index = new Map(floors.map((f, i) => [f.id, i]))
  const clashes: ShaftClash[] = []

  for (const shaft of shafts) {
    // Nothing is built for a hand-carried transfer, so nothing can be in its
    // way and it can't be in anything else's.
    if (shaft.manual) continue
    for (const placement of Object.values(placements)) {
      const floorIndex = index.get(placement.floorId)
      if (floorIndex === undefined) continue
      if (floorIndex < shaft.low || floorIndex > shaft.high) continue

      // Each end is supposed to touch its own block.
      if (placement.moduleId === shaft.link.fromModuleId) continue
      if (placement.moduleId === shaft.link.toModuleId) continue

      const module = modulesById.get(placement.moduleId)
      if (!module) continue

      // The shaft is in base coordinates, so the block has to be too.
      const origin = originOf(floors, placement.floorId)
      const rect = placementRect(module, placement)
      const inBase = { ...rect, x: rect.x + origin.x, y: rect.y + origin.y }
      if (!contains(inBase, shaft.x, shaft.y, 0)) continue

      clashes.push({
        shaftId: shaft.id,
        kind: 'block',
        floorId: placement.floorId,
        label: `${itemName(shaft.link.item)} lift rises through the ${
          module.machines
        }x ${module.buildingName} (${module.label})`,
      })
    }
  }

  for (let i = 0; i < shafts.length; i++) {
    for (let j = i + 1; j < shafts.length; j++) {
      const a = shafts[i]
      const b = shafts[j]
      if (a.manual || b.manual) continue
      // The same material leaving the same block is one lift with a splitter at
      // the top, not two lifts wanting one spot. They also share an output face,
      // so no amount of moving could ever separate them.
      if (
        a.link.fromModuleId === b.link.fromModuleId &&
        a.link.item === b.link.item
      ) {
        continue
      }
      // Columns only fight if they'd share a floor as well as a spot.
      if (a.high < b.low || b.high < a.low) continue
      if (Math.hypot(a.x - b.x, a.y - b.y) > SHAFT_CLEARANCE_M) continue

      clashes.push({
        shaftId: a.id,
        kind: 'shaft',
        floorId: a.link.fromFloorId,
        label: `${itemName(a.link.item)} and ${itemName(
          b.link.item,
        )} lifts want the same shaft`,
      })
    }
  }

  return clashes
}

