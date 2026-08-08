/**
 * Where belts and pipes actually run, in metres on a floor.
 *
 * Kept out of the drawing code so the same geometry can be measured as well as
 * rendered: a crossing count is only meaningful if it's counted on the very
 * lines you see.
 */

import type { Route } from './routes'
import type {
  FactoryModule,
  Placement,
  Rect,
  RouteEnd,
  RouteOverride,
  Side,
} from './types'
import { placementRect, sideAnchor } from './types'

export interface Point {
  x: number
  y: number
}

/** How far a run stands off a block before turning, in metres. */
export const STUB_M = 6

/**
 * How far a run reaches past a face when the other end is off-floor.
 *
 * Short on purpose. These stubs stand for material that isn't on this floor, so
 * a long one wanders off over the deck above and reads as a belt going
 * somewhere, when what it really marks is where a belt arrives from elsewhere.
 */
export const EXTERNAL_M = 10

/** Gap between taps sharing one face, in metres (half a foundation). */
const TAP_SPACING_M = 4

/** Outward direction of each face. A run must leave along this axis. */
export const NORMALS: Record<Side, Point> = {
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 },
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
}

const isHorizontal = (side: Side) => side === 'west' || side === 'east'

const EPSILON = 1e-6

/** Length of a face, along the edge rather than through the block. */
export const faceLength = (rect: Rect, side: Side) =>
  isHorizontal(side) ? rect.depth : rect.width

/** A point on a face, `along` metres from its first corner. */
export function facepoint(rect: Rect, end: RouteEnd): Point {
  const along = Math.max(0, Math.min(faceLength(rect, end.side), end.along))
  switch (end.side) {
    case 'west':
      return { x: rect.x, y: rect.y + along }
    case 'east':
      return { x: rect.x + rect.width, y: rect.y + along }
    case 'north':
      return { x: rect.x + along, y: rect.y }
    default:
      return { x: rect.x + along, y: rect.y + rect.depth }
  }
}

/**
 * Which face a dragged point belongs to and how far along it, so dragging an end
 * slides it around the block's edge instead of tearing it off.
 */
export function nearestFaceEnd(rect: Rect, point: Point): RouteEnd {
  const distances: { side: Side; distance: number }[] = [
    { side: 'west', distance: Math.abs(point.x - rect.x) },
    { side: 'east', distance: Math.abs(point.x - (rect.x + rect.width)) },
    { side: 'north', distance: Math.abs(point.y - rect.y) },
    { side: 'south', distance: Math.abs(point.y - (rect.y + rect.depth)) },
  ]
  const side = distances.sort((a, b) => a.distance - b.distance)[0].side
  const raw = isHorizontal(side) ? point.y - rect.y : point.x - rect.x
  return {
    side,
    along: Math.max(0, Math.min(faceLength(rect, side), raw)),
  }
}

/** How far along its face an existing point sits, for seeding an override. */
export const endOf = (rect: Rect, side: Side, point: Point): RouteEnd => ({
  side,
  along: isHorizontal(side) ? point.y - rect.y : point.x - rect.x,
})

/**
 * Squares off a hand-drawn line.
 *
 * Belts only run on the axes, so a leg between two dragged corners becomes two
 * legs with a right angle between them. The first leg leaves along its face's
 * normal and the last arrives along its own, which is the part that makes a
 * drawn run meet a machine's port the way a built one would.
 */
export function orthogonalize(
  points: Point[],
  fromSide: Side | null,
  toSide: Side | null,
): Point[] {
  if (points.length < 2) return points

  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]
    const next = points[i]
    const offAxis =
      Math.abs(previous.x - next.x) > EPSILON &&
      Math.abs(previous.y - next.y) > EPSILON

    if (offAxis) {
      const first = i === 1
      const last = i === points.length - 1
      // Leaving: follow the face's own axis. Arriving: turn onto it last, so
      // the approach is perpendicular to the face rather than sliding along it.
      const departOnX = first
        ? fromSide
          ? isHorizontal(fromSide)
          : true
        : last && toSide
          ? !isHorizontal(toSide)
          : true
      out.push(departOnX ? { x: next.x, y: previous.y } : { x: previous.x, y: next.y })
    }
    out.push(next)
  }

  return simplify(out)
}

/**
 * Where two same-axis runs can cross over, or null when no single crossing
 * satisfies both ends.
 *
 * The crossing has to sit outside each stub in that face's own outward
 * direction. Anywhere else and the run overshoots a face and comes back on
 * itself, which reads as flowing backwards however it's drawn.
 */
function crossing(
  aAt: number,
  aOut: number,
  bAt: number,
  bOut: number,
): number | null {
  if (aOut === bOut) return aOut > 0 ? Math.max(aAt, bAt) : Math.min(aAt, bAt)

  // Facing each other: the crossing has to land between them, which is only
  // possible when they face inward rather than back to back.
  const low = aOut > 0 ? aAt : bAt
  const high = aOut > 0 ? bAt : aAt
  return low <= high ? (low + high) / 2 : null
}

/**
 * Orthogonal path from an output face to an input face, leaving and arriving
 * perpendicular to each one. Every turn is a genuine 90 degrees.
 */
export function orthogonalPath(
  a: Point,
  aSide: Side | null,
  b: Point,
  bSide: Side | null,
): Point[] {
  // An end outside the factory has no face of its own, so it mirrors the end
  // that does. Falling back to a fixed direction made runs jut east out of a
  // block whose faces were both pointing north.
  const aNormal = aSide
    ? NORMALS[aSide]
    : bSide
      ? { x: -NORMALS[bSide].x, y: -NORMALS[bSide].y }
      : { x: 1, y: 0 }
  const bNormal = bSide
    ? NORMALS[bSide]
    : aSide
      ? { x: -NORMALS[aSide].x, y: -NORMALS[aSide].y }
      : { x: -1, y: 0 }

  const horizontal = aNormal.x !== 0

  // Two blocks facing each other closer than twice the stub length would have
  // their stubs overshoot and cross, making the run visibly double back. Shrink
  // both stubs to meet in the middle instead.
  let stub = STUB_M
  if (aNormal.x === -bNormal.x && aNormal.y === -bNormal.y) {
    const delta = horizontal ? b.x - a.x : b.y - a.y
    const out = horizontal ? aNormal.x : aNormal.y
    // Only clamp when they actually face inward towards one another.
    if (Math.sign(delta) === Math.sign(out)) {
      stub = Math.min(STUB_M, Math.max(1, Math.abs(delta) / 2))
    }
  }

  const aStub = { x: a.x + aNormal.x * stub, y: a.y + aNormal.y * stub }
  const bStub = { x: b.x + bNormal.x * stub, y: b.y + bNormal.y * stub }

  const sameDirection = aNormal.x === bNormal.x && aNormal.y === bNormal.y
  const alignedAcross = horizontal
    ? Math.abs(aStub.y - bStub.y) < EPSILON
    : Math.abs(aStub.x - bStub.x) < EPSILON

  const middle: Point[] = []
  if (horizontal === (bNormal.x !== 0)) {
    // Same axis at both ends, so the run crosses over on the other axis.
    const cross = horizontal
      ? crossing(aStub.x, aNormal.x, bStub.x, bNormal.x)
      : crossing(aStub.y, aNormal.y, bStub.y, bNormal.y)

    // Two ports facing the same way on one line have no crossing that avoids a
    // reversal: whichever stub is further out, the run reaches it and comes
    // straight back down the line it arrived on. Send that case to the detour.
    if (cross !== null && !(sameDirection && alignedAcross)) {
      middle.push(
        horizontal ? { x: cross, y: aStub.y } : { x: aStub.x, y: cross },
        horizontal ? { x: cross, y: bStub.y } : { x: bStub.x, y: cross },
      )
    } else {
      // No crossing serves both ends, so the run detours along the
      // perpendicular axis and comes back.
      let corridor = horizontal
        ? (aStub.y + bStub.y) / 2
        : (aStub.x + bStub.x) / 2
      // Both stubs already on that line leaves no room to pass, so step off it.
      const stubAt = horizontal ? aStub.y : aStub.x
      if (Math.abs(corridor - stubAt) < EPSILON) corridor += STUB_M

      middle.push(
        horizontal ? { x: aStub.x, y: corridor } : { x: corridor, y: aStub.y },
        horizontal ? { x: bStub.x, y: corridor } : { x: corridor, y: bStub.y },
      )
    }
  } else {
    // One corner, taken by turning perpendicular the moment the run clears the
    // first face. The other corner doubles back along a face it just left.
    middle.push(
      horizontal ? { x: aStub.x, y: bStub.y } : { x: bStub.x, y: aStub.y },
    )
  }

  return simplify([a, aStub, ...middle, bStub, b])
}

/**
 * Drops repeated points and vertices that don't turn, so the longest straight
 * run is a single segment. Without this a straight stretch stays split at an
 * old corner and an arrowhead sits on whichever piece happens to be longer.
 */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (
      last &&
      Math.abs(last.x - p.x) < EPSILON &&
      Math.abs(last.y - p.y) < EPSILON
    ) {
      continue
    }
    out.push(p)
  }

  for (let i = out.length - 2; i > 0; i--) {
    const prev = out[i - 1]
    const cur = out[i]
    const next = out[i + 1]
    const cross =
      (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x)
    const dot =
      (cur.x - prev.x) * (next.x - cur.x) + (cur.y - prev.y) * (next.y - cur.y)
    // Merging a reversal too would hide it, and a reversal is a routing bug.
    if (Math.abs(cross) < EPSILON && dot > 0) out.splice(i, 1)
  }

  return out
}

/** Total length along a polyline, in metres. */
export function pathLength(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    )
  }
  return total
}

/**
 * Splits a polyline in two at half its length.
 *
 * A gradient between the endpoints doesn't work here: an orthogonal run is far
 * longer than the straight line between its ends, so most of it falls past the
 * last stop and renders flat.
 */
export function splitHalfway(points: Point[]): [Point[], Point[]] {
  const half = pathLength(points) / 2
  const first: Point[] = [points[0]]
  let walked = 0

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    const len = Math.hypot(to.x - from.x, to.y - from.y)

    if (walked + len >= half) {
      const t = len === 0 ? 0 : (half - walked) / len
      const mid = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      }
      first.push(mid)
      return [first, [mid, ...points.slice(i)]]
    }

    first.push(to)
    walked += len
  }

  return [points, [points[points.length - 1]]]
}

/**
 * The loose end of a run that doesn't finish on this floor.
 *
 * A stub with an arrowhead says a belt goes that way and nothing else, so a face
 * with four of them is four identical dashes. This carries what the stub can't
 * draw: which way the material moves, and what's at the other end.
 */
export interface RouteTerminal {
  /** The end that's loose. `from` means material arrives, `to` that it leaves. */
  which: 'from' | 'to'
  /** Another floor, a block still in the tray, or outside the factory. */
  kind: 'floor' | 'unplaced' | 'outside'
  /** Block at the far end, when the plan has one. */
  moduleId: string | null
  /** Floor that block sits on, when it's been placed. */
  floorId: string | null
  /** Block on this floor it runs to or from. */
  atModuleId: string
  /** Face it leaves this floor by, which is what groups these together. */
  side: Side
  /** Outer end of the stub, in floor-local metres. */
  point: Point
}

export interface RoutePath {
  route: Route
  /** Metres, ordered from the producing face to the consuming face. */
  points: Point[]
  /** Set when one end is off this floor or outside the factory. */
  external: boolean
  /** Drawn by hand rather than derived, so it can be reset. */
  drawn: boolean
  /** Present exactly when `external`, describing what the stub runs to. */
  terminal: RouteTerminal | null
}

/**
 * How far along a polyline a point sits, measured to its nearest projection.
 *
 * Used to decide where a new corner belongs among the ones already placed:
 * squaring off inserts corners of its own, so counting vertices would put a
 * dragged corner in the wrong part of the run.
 */
export function alongPath(points: Point[], at: Point): number {
  let walked = 0
  let best = { distance: Infinity, along: 0 }

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (length > EPSILON) {
      const t = Math.max(
        0,
        Math.min(1, ((at.x - from.x) * dx + (at.y - from.y) * dy) / (length * length)),
      )
      const projected = { x: from.x + dx * t, y: from.y + dy * t }
      const distance = Math.hypot(at.x - projected.x, at.y - projected.y)
      if (distance < best.distance) {
        best = { distance, along: walked + length * t }
      }
    }
    walked += length
  }

  return best.along
}

/**
 * Nearest point on a polyline to a loose one.
 *
 * A fitting sits on a belt, not near one, so where you click has to be pulled
 * onto the line before it's recorded. Snapping the click to the grid first and
 * the line second would leave it floating off any run that doesn't happen to
 * follow the grid.
 */
export function closestOnPath(points: Point[], at: Point): Point {
  let best = { distance: Infinity, point: points[0] ?? at }

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (length <= EPSILON) continue

    const t = Math.max(
      0,
      Math.min(1, ((at.x - from.x) * dx + (at.y - from.y) * dy) / (length * length)),
    )
    const point = { x: from.x + dx * t, y: from.y + dy * t }
    const distance = Math.hypot(at.x - point.x, at.y - point.y)
    if (distance < best.distance) best = { distance, point }
  }

  return best.point
}

/**
 * Every run touching a floor, as geometry. A run with one end on another floor
 * appears here too, stubbed at the face it leaves by, because that stretch is
 * really on this floor and takes up room on it.
 */
export function routePaths(options: {
  routes: Route[]
  modulesById: Map<string, FactoryModule>
  placements: Record<string, Placement>
  floorId: string
  /** Hand-drawn runs, keyed by route id. */
  overrides?: Record<string, RouteOverride>
}): RoutePath[] {
  const { routes, modulesById, placements, floorId, overrides = {} } = options

  const onFloor = (moduleId: string | null) =>
    moduleId !== null && placements[moduleId]?.floorId === floorId

  const touching = routes.filter(
    (route) => onFloor(route.from) || onFloor(route.to),
  )

  const endpointSide = (route: Route, end: 'from' | 'to'): Side | null => {
    const moduleId = end === 'from' ? route.from : route.to
    if (!moduleId) return null
    const placement = placements[moduleId]
    if (!placement || placement.floorId !== floorId) return null
    return end === 'from' ? placement.outputSide : placement.inputSide
  }

  const rectOf = (moduleId: string) => {
    const module = modulesById.get(moduleId)
    const placement = placements[moduleId]
    return module && placement ? placementRect(module, placement) : null
  }

  /**
   * Everything tapping each face, in the order it will sit along that face.
   *
   * Ordered by where each run is headed, so the one whose far end is furthest
   * along the face takes the tap furthest along it. Runs sharing a face then fan
   * out without crossing on the way. Ordering feeds before shipments, as this
   * used to, crossed them constantly: a feed arriving from the right and a
   * shipment leaving to the left had to swap over somewhere, and that somewhere
   * was a crossing the layout didn't need.
   *
   * A mirrored block reverses the order, which is what flip means on a block
   * that feeds and ships through one face. Ordering over every run on the floor
   * rather than only the visible ones keeps offsets from shifting when the
   * selection changes.
   */
  const faceKey = (moduleId: string, side: Side) => `${moduleId}:${side}`

  /**
   * One tap per item per direction, not one per run.
   *
   * A run exists for every producer and consumer pair, so a block fed by two
   * sources of the same plate has two runs of it. In game those merge before
   * they reach the manifold and arrive as one line, so drawing a tap each
   * covered a three-line Assembler in six connections it doesn't have.
   */
  const tapKey = (item: string, feed: boolean) =>
    `${feed ? 'in' : 'out'}|${item}`

  const faceTaps = new Map<string, { key: string; towards: number }[]>()

  /** Where a run's far end sits on the axis its near face spreads along. */
  const towards = (route: Route, end: 'from' | 'to', side: Side) => {
    const otherId = end === 'from' ? route.to : route.from
    const rect = otherId ? rectOf(otherId) : null
    // A run leaving the floor has no partner to line up with, so it goes to one
    // end rather than pushing a real pairing out of order.
    if (!rect) return Number.POSITIVE_INFINITY
    return isHorizontal(side) ? rect.y + rect.depth / 2 : rect.x + rect.width / 2
  }

  for (const route of touching) {
    for (const end of ['from', 'to'] as const) {
      const moduleId = end === 'from' ? route.from : route.to
      const side = endpointSide(route, end)
      if (!moduleId || !side) continue

      const list = faceTaps.get(faceKey(moduleId, side)) ?? []
      const key = tapKey(route.item, end === 'to')
      const reach = towards(route, end, side)
      const existing = list.find((tap) => tap.key === key)
      // Several sources merging into one line sit where the nearest of them
      // does, since that's the side the merged line comes from.
      if (existing) existing.towards = Math.min(existing.towards, reach)
      else list.push({ key, towards: reach })
      faceTaps.set(faceKey(moduleId, side), list)
    }
  }

  for (const [key, list] of faceTaps) {
    const moduleId = key.slice(0, key.lastIndexOf(':'))
    // Ties break on the tap key, so the order is the same on every render.
    list.sort((a, b) => a.towards - b.towards || a.key.localeCompare(b.key))
    if (placements[moduleId]?.flipped === true) list.reverse()
  }

  const attach = (moduleId: string, side: Side, route: Route, feed: boolean) => {
    const module = modulesById.get(moduleId)
    const placement = placements[moduleId]
    if (!module || !placement) return null

    const rect = placementRect(module, placement)
    const base = sideAnchor(rect, side)

    const taps = faceTaps.get(faceKey(moduleId, side)) ?? []
    const total = taps.length || 1
    const wanted = tapKey(route.item, feed)
    const index = Math.max(
      0,
      taps.findIndex((tap) => tap.key === wanted),
    )

    if (total <= 1) return { side, point: base }

    // Spread taps along the face, staying inside its length.
    const spacing = Math.min(
      TAP_SPACING_M,
      faceLength(rect, side) / (total + 1),
    )
    const offset = (index - (total - 1) / 2) * spacing

    return {
      side,
      point: isHorizontal(side)
        ? { x: base.x, y: base.y + offset }
        : { x: base.x + offset, y: base.y },
    }
  }

  /**
   * Free end for a run that leaves the floor or the factory entirely. Always
   * outside the face it belongs to, whether material heads out through it or
   * arrives through it, and kept short so it doesn't scroll out of view.
   */
  const beyond = (from: { side: Side; point: Point }) => {
    const normal = NORMALS[from.side]
    return {
      side: null,
      point: {
        x: from.point.x + normal.x * EXTERNAL_M,
        y: from.point.y + normal.y * EXTERNAL_M,
      },
    }
  }

  const paths: RoutePath[] = []
  for (const route of touching) {
    const fromSide = endpointSide(route, 'from')
    const toSide = endpointSide(route, 'to')
    const override = overrides[route.id]

    // A hand-placed end wins over the derived tap, but only for the end that
    // was actually placed: the other keeps tidying itself up as blocks move.
    const drawnStart = (() => {
      if (!override?.from || !route.from) return null
      const rect = rectOf(route.from)
      return rect
        ? { side: override.from.side, point: facepoint(rect, override.from) }
        : null
    })()
    const drawnEnd = (() => {
      if (!override?.to || !route.to) return null
      const rect = rectOf(route.to)
      return rect
        ? { side: override.to.side, point: facepoint(rect, override.to) }
        : null
    })()

    const start =
      drawnStart ??
      (route.from && fromSide ? attach(route.from, fromSide, route, false) : null)
    const end =
      drawnEnd ??
      (route.to && toSide ? attach(route.to, toSide, route, true) : null)

    // Material arriving from outside starts beyond the input face, not inside
    // the block: negating the normal put the source under the tile it fed, so
    // the run wrapped around to get back out.
    const a = start ?? (end ? beyond(end) : null)
    const b = end ?? (start ? beyond(start) : null)
    if (!a || !b) continue

    const waypoints = override?.waypoints ?? []
    const drawn = waypoints.length > 0 || Boolean(override?.from || override?.to)

    // Whichever end had no face on this floor is the loose one, and the other
    // end's face is the one it hangs off.
    const loose: RouteTerminal | null = (() => {
      if (start && end) return null
      const which = start ? 'to' : 'from'
      const farId = which === 'from' ? route.from : route.to
      const nearId = which === 'from' ? route.to : route.from
      const anchored = start ?? end
      if (!anchored?.side || !nearId) return null
      return {
        which,
        kind: !farId ? 'outside' : placements[farId] ? 'floor' : 'unplaced',
        moduleId: farId,
        floorId: farId ? (placements[farId]?.floorId ?? null) : null,
        atModuleId: nearId,
        side: anchored.side,
        point: which === 'from' ? a.point : b.point,
      }
    })()

    paths.push({
      route,
      points:
        waypoints.length > 0
          ? orthogonalize([a.point, ...waypoints, b.point], a.side, b.side)
          : orthogonalPath(a.point, a.side, b.point, b.side),
      external: !start || !end,
      drawn,
      terminal: loose,
    })
  }

  return paths
}
