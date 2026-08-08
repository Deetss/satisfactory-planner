/**
 * The polish pass after a floor has been packed.
 *
 * Packing decides where blocks go from the graph alone: which stage feeds
 * which, and roughly how tall each column wants to be. What it can't see is the
 * belts, because those don't exist until the blocks are down. So a floor can
 * come out of the packer in perfectly sensible stage order and still have two
 * runs crossing, or one passing over a block that happens to sit in the way.
 *
 * Turning the manifolds fixes some of that without moving anything, which is
 * what `tuneFaces` does. What's left needs a block to actually shift, and this
 * is that step: take the blocks caught in a tangle, try them a few foundations
 * off where they are, and keep any move that measurably improves the floor.
 *
 * Every candidate is scored on the floor it would produce, cumulatively, so the
 * second move is judged against a floor that already has the first. Scoring them
 * independently and applying them together is how you end up with two fixes that
 * each looked good and together made it worse.
 */

import { placementRect, FOUNDATION_M } from './types'
import type { FactoryModule, Floor, Placement, RouteOverride } from './types'
import type { Route } from './routes'
import { scoreFloor, tangled } from './tidy'

/** How far a block may be tried from where the packer put it. */
const REACH = FOUNDATION_M * 4

interface Options {
  routes: Route[]
  modulesById: Map<string, FactoryModule>
  placements: Record<string, Placement>
  floor: Floor
  overrides: Record<string, RouteOverride>
  /** Clear ground to keep between blocks, in metres. */
  service: number
  /** Ground held back at the floor's boundary, in metres. */
  edge: number
}

/** Candidate offsets, nearest first, so a small move wins a tie. */
function offsets(): { dx: number; dy: number }[] {
  const steps = [1, 2, 3, 4].map((n) => n * FOUNDATION_M)
  const out: { dx: number; dy: number }[] = []
  for (const step of steps) {
    out.push({ dx: 0, dy: -step }, { dx: 0, dy: step })
    out.push({ dx: -step, dy: 0 }, { dx: step, dy: 0 })
  }
  return out
}

/**
 * Moves the blocks caught in a tangle, where moving them helps.
 *
 * Returns a new placement map. Blocks that aren't in a tangle are never touched:
 * shifting a block whose belts are already fine can only cost length, and the
 * search runs against the real crossing count, which is expensive enough to be
 * worth aiming at the blocks that deserve it.
 */
export function nudgeTangled(options: Options): Record<string, Placement> {
  const { modulesById, floor, service, edge } = options
  const bounds = {
    width: floor.gridWidth * FOUNDATION_M,
    depth: floor.gridDepth * FOUNDATION_M,
  }

  let placements = { ...options.placements }
  const culprits = [...tangled({ ...options, placements })]
  if (culprits.length === 0) return placements

  const fits = (moduleId: string, candidate: Placement) => {
    const module = modulesById.get(moduleId)
    if (!module) return false
    const rect = placementRect(module, candidate)

    // The same border the packers left, or a nudge would quietly undo it.
    if (
      rect.x < edge - 1e-9 ||
      rect.y < edge - 1e-9 ||
      rect.x + rect.width > bounds.width - edge + 1e-9 ||
      rect.y + rect.depth > bounds.depth - edge + 1e-9
    )
      return false

    for (const other of Object.values(placements)) {
      if (other.moduleId === moduleId) continue
      if (other.floorId !== candidate.floorId) continue
      const neighbour = modulesById.get(other.moduleId)
      if (!neighbour) continue
      const box = placementRect(neighbour, other)
      // The lane belongs to both blocks, so it only has to be there once.
      const gap = service
      if (
        rect.x < box.x + box.width + gap - 1e-9 &&
        box.x < rect.x + rect.width + gap - 1e-9 &&
        rect.y < box.y + box.depth + gap - 1e-9 &&
        box.y < rect.y + rect.depth + gap - 1e-9
      )
        return false
    }

    return true
  }

  for (const moduleId of culprits) {
    const placement = placements[moduleId]
    if (!placement || placement.floorId !== floor.id) continue

    let best = scoreFloor({ ...options, placements })
    let winner: Placement | null = null

    for (const { dx, dy } of offsets()) {
      if (Math.abs(dx) > REACH || Math.abs(dy) > REACH) continue
      const candidate = { ...placement, x: placement.x + dx, y: placement.y + dy }
      if (!fits(moduleId, candidate)) continue

      const score = scoreFloor({
        ...options,
        placements: { ...placements, [moduleId]: candidate },
      })
      if (score < best - 1e-9) {
        best = score
        winner = candidate
      }
    }

    if (winner) placements = { ...placements, [moduleId]: winner }
  }

  return placements
}
