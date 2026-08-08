/**
 * Arranging so the belts don't cross.
 *
 * The packers decide how blocks tile a floor, which is a question of area. This
 * decides which block goes in which slot and which way round it faces, which is
 * the question of whether the belts between them can be built without stacking
 * lifts over each other.
 *
 * Two passes, because they answer different things. Ordering is done on the
 * graph before anything is placed: pulling each block towards the average
 * position of what feeds it is the standard way to untangle a layered drawing,
 * and it works here because a stage of production is exactly a layer. Facing is
 * done afterwards on the real geometry, counting the crossings you can actually
 * see, since a face only makes sense relative to where the neighbours ended up.
 */

import { analyseFloor, segmentsOf } from './congestion'
import type { Route } from './routes'
import { routePaths } from './paths'
import type {
  FactoryModule,
  Floor,
  Placement,
  Rect,
  RouteOverride,
  Side,
} from './types'
import { SIDES, placementRect } from './types'

/** A handoff between two blocks, which is all the ordering cares about. */
export interface Flow {
  from: string
  to: string
}

/**
 * Blocks within each stage, ordered so the runs between stages cross as little
 * as possible.
 *
 * Sweeps forward and back: on a forward sweep each block moves towards the
 * average position of what feeds it, on a backward sweep towards what it feeds.
 * Four sweeps is where this stops paying: the ordering settles quickly, and the
 * ones after that swap blocks whose barycentres are already equal.
 */
export function orderByFlow(
  byStage: Map<number, string[]>,
  flows: Flow[],
  passes = 4,
): Map<string, number> {
  const stageOf = new Map<string, number>()
  for (const [stage, ids] of byStage) for (const id of ids) stageOf.set(id, stage)

  const rank = new Map<string, number>()
  const reindex = () => {
    for (const ids of byStage.values()) ids.forEach((id, i) => rank.set(id, i))
  }
  reindex()

  const stages = [...byStage.keys()].sort((a, b) => a - b)

  for (let pass = 0; pass < passes; pass++) {
    // Alternating direction is what stops the ordering settling on whichever
    // end it started from.
    const back = pass % 2 === 0
    const sweep = back ? stages : [...stages].reverse()

    for (const stage of sweep) {
      const ids = byStage.get(stage) ?? []
      if (ids.length < 2) continue

      const barycentre = new Map<string, number>()
      ids.forEach((id, index) => {
        const neighbours = flows
          .filter((f) => (back ? f.to === id : f.from === id))
          .map((f) => (back ? f.from : f.to))
          // Only other layers pull: a block's own stage has no settled order to
          // be pulled towards, and using it would just chase itself.
          .filter((other) => rank.has(other) && stageOf.get(other) !== stage)

        barycentre.set(
          id,
          neighbours.length === 0
            ? index
            : neighbours.reduce((sum, n) => sum + (rank.get(n) ?? 0), 0) /
                neighbours.length,
        )
      })

      byStage.set(
        stage,
        ids
          .map((id, index) => ({ id, index }))
          // Ties keep the order they came in, so a block with nothing to line up
          // with stays where the packer wanted it.
          .sort(
            (a, b) =>
              (barycentre.get(a.id) ?? 0) - (barycentre.get(b.id) ?? 0) ||
              a.index - b.index,
          )
          .map((entry) => entry.id),
      )
      reindex()
    }
  }

  return rank
}

interface TuneOptions {
  routes: Route[]
  modulesById: Map<string, FactoryModule>
  placements: Record<string, Placement>
  floor: Floor
  overrides: Record<string, RouteOverride>
}

/** Crossings first, then length, so a tidy floor still prefers shorter belts. */
export function scoreFloor(options: TuneOptions): number {
  const { routes, modulesById, placements, floor, overrides } = options
  const paths = routePaths({
    routes,
    modulesById,
    placements,
    floorId: floor.id,
    overrides,
  })
  const on = Object.values(placements).filter((p) => p.floorId === floor.id)
  const congestion = analyseFloor(floor, paths, on, modulesById)
  return congestion.score * 100 + congestion.length / 100
}

/** Blocks caught up in a tangle, which are the only ones worth re-facing. */
export function tangled(options: TuneOptions): Set<string> {
  const { routes, modulesById, placements, floor, overrides } = options
  const paths = routePaths({
    routes,
    modulesById,
    placements,
    floorId: floor.id,
    overrides,
  })
  const on = Object.values(placements).filter((p) => p.floorId === floor.id)
  const congestion = analyseFloor(floor, paths, on, modulesById)

  const byRoute = new Map(routes.map((r) => [r.id, r]))
  const involved = new Set<string>()
  const addRoute = (routeId: string) => {
    const route = byRoute.get(routeId)
    if (route?.from) involved.add(route.from)
    if (route?.to) involved.add(route.to)
  }

  for (const crossing of congestion.crossings) {
    addRoute(crossing.a)
    addRoute(crossing.b)
  }
  for (const clash of congestion.laneClashes) clash.routes.forEach(addRoute)
  for (const over of congestion.overBlocks) {
    involved.add(over.moduleId)
    addRoute(over.routeId)
  }

  return involved
}

/**
 * Turns the manifolds of tangled blocks to face where their material actually
 * comes from and goes.
 *
 * Only the blocks already in a tangle are tried, and only they: re-facing a
 * block whose belts are fine can only make it worse, and the search is over the
 * real crossing count, which is expensive enough to be worth aiming.
 */
export function tuneFaces(
  options: TuneOptions,
  /** Faces that mustn't move, e.g. the ones a bus arrangement just set. */
  fixed: ReadonlySet<string> = new Set(),
): Record<string, Placement> {
  let placements = { ...options.placements }
  let best = scoreFloor({ ...options, placements })

  const candidates = [...tangled({ ...options, placements })].filter(
    (id) => !fixed.has(id) && placements[id]?.floorId === options.floor.id,
  )
  if (candidates.length === 0) return placements

  for (const moduleId of candidates) {
    const original = placements[moduleId]
    let chosen = original

    for (const inputSide of SIDES) {
      for (const outputSide of SIDES) {
        if (inputSide === chosen.inputSide && outputSide === chosen.outputSide) {
          continue
        }
        const trial = {
          ...placements,
          [moduleId]: { ...original, inputSide, outputSide },
        }
        const score = scoreFloor({ ...options, placements: trial })
        if (score < best - 1e-9) {
          best = score
          chosen = trial[moduleId]
        }
      }
    }

    placements = { ...placements, [moduleId]: chosen }
  }

  return placements
}

/**
 * Face pointing most directly at another point, for seeding a block's manifolds
 * before the crossing count gets a say.
 */
export function faceTowards(rect: Rect, x: number, y: number): Side {
  const dx = x - (rect.x + rect.width / 2)
  const dy = y - (rect.y + rect.depth / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west'
  return dy >= 0 ? 'south' : 'north'
}

/**
 * Points each block's feed face at its suppliers and its shipping face at its
 * consumers, which is the arrangement belts want before anything else is tried.
 */
export function faceFlows(
  placements: Record<string, Placement>,
  modulesById: Map<string, FactoryModule>,
  flows: Flow[],
  floorId: string,
): Record<string, Placement> {
  const rectOf = (moduleId: string) => {
    const module = modulesById.get(moduleId)
    const placement = placements[moduleId]
    if (!module || !placement || placement.floorId !== floorId) return null
    return placementRect(module, placement)
  }

  const centre = (ids: string[]) => {
    const rects = ids.map(rectOf).filter((r): r is Rect => r !== null)
    if (rects.length === 0) return null
    return {
      x: rects.reduce((s, r) => s + r.x + r.width / 2, 0) / rects.length,
      y: rects.reduce((s, r) => s + r.y + r.depth / 2, 0) / rects.length,
    }
  }

  const out = { ...placements }

  for (const [moduleId, placement] of Object.entries(placements)) {
    if (placement.floorId !== floorId) continue
    const rect = rectOf(moduleId)
    if (!rect) continue

    const from = centre(flows.filter((f) => f.to === moduleId).map((f) => f.from))
    const to = centre(flows.filter((f) => f.from === moduleId).map((f) => f.to))

    out[moduleId] = {
      ...placement,
      inputSide: from ? faceTowards(rect, from.x, from.y) : placement.inputSide,
      outputSide: to ? faceTowards(rect, to.x, to.y) : placement.outputSide,
    }
  }

  return out
}

/** Every block-to-block handoff in a set of runs, which is what ordering needs. */
export const flowsOf = (routes: Route[]): Flow[] =>
  routes.flatMap((route) =>
    route.from && route.to ? [{ from: route.from, to: route.to }] : [],
  )

/** Segment count, for deciding whether the expensive search is affordable. */
export const complexityOf = (options: TuneOptions): number => {
  const paths = routePaths({
    routes: options.routes,
    modulesById: options.modulesById,
    placements: options.placements,
    floorId: options.floor.id,
    overrides: options.overrides,
  })
  return segmentsOf(paths).length
}
