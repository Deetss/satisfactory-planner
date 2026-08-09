/**
 * How to organise a stack of floors so material can actually get between them.
 *
 * The measurements live in `congestion.ts`; this decides what to do about them.
 * Four things go wrong between floors, and they're worth different amounts:
 *
 * - A block on the wrong floor. Everything it trades with is one floor up, so
 *   moving it there deletes several lifts at once. Nothing else comes close.
 * - A lift that skips a floor. It's a column through a floor neither end is on,
 *   so it fouls machines that have nothing to do with it. Landing the material
 *   one floor at a time is how a stack is meant to work.
 * - A lift that lands nowhere near what it feeds, so a belt crosses the whole
 *   upper floor after climbing. Lining the two blocks up costs one move.
 * - A lift with something in its way, which is the only one the planner used to
 *   have an opinion about.
 */

import { itemName } from '../data/gameData'
import {
  SHAFT_CLEARANCE_M,
  linkKey,
  type FloorCongestion,
  type Shaft,
  type ShaftClash,
} from './congestion'
import type { Route } from './routes'
import { complexityOf, scoreFloor, tangled } from './tidy'
import type {
  FactoryModule,
  Floor,
  Placement,
  Rect,
  RouteOverride,
  Side,
} from './types'
import {
  FOUNDATION_M,
  SIDES,
  placementRect,
  rectsOverlap,
  sideAnchor,
} from './types'

export type FixKind = 'floor' | 'align' | 'face' | 'move' | 'hand'

export interface Fix {
  kind: FixKind
  /** Block the change applies to, which isn't always the one that's at fault. */
  moduleId: string
  patch: Partial<Placement>
  /** Metres the block travels, for ordering and for the label. */
  distance: number
  label: string
  /**
   * Cross-floor links to mark as hand-carried, for a `hand` fix. Every item in
   * the column is listed: sparing the lift only works if nothing is left on it.
   */
  links?: string[]
}

export interface Advice {
  id: string
  /** What kind of problem this is, so the panel can group and order it. */
  kind: 'floor' | 'skip' | 'blocked' | 'landing' | 'tangle'
  /** Lifts this removes or shortens. Bigger is worth doing first. */
  weight: number
  what: string
  /** Which floor it's on, so the list can be read floor by floor. */
  floorId?: string
  /** Ordered: take the first unless you have a reason not to. */
  fixes: Fix[]
}

/** How far a block may be nudged before moving it stops being a small fix. */
const SEARCH_RADIUS_M = FOUNDATION_M * 5

/** A landing further than this from its column drags a belt across the floor. */
const LANDING_SLACK_M = FOUNDATION_M * 2

const COMPASS: Record<Side, string> = {
  north: 'north',
  east: 'east',
  south: 'south',
  west: 'west',
}

const contains = (rect: Rect, x: number, y: number, pad: number) =>
  x > rect.x - pad &&
  x < rect.x + rect.width + pad &&
  y > rect.y - pad &&
  y < rect.y + rect.depth + pad

/** Where a floor's local coordinates sit in the base. */
const originOf = (floors: Floor[], floorId: string) => {
  const floor = floors.find((f) => f.id === floorId)
  return { x: floor?.originX ?? 0, y: floor?.originY ?? 0 }
}

export interface AdviceInput {
  shafts: Shaft[]
  clashes: ShaftClash[]
  /**
   * Every handoff, not just the ones that currently cross floors. Moving a
   * block turns some of its same-floor runs into lifts, and advice that only
   * counted the existing lifts would happily trade two for three.
   */
  routes: { from: string | null; to: string | null; item: string }[]
  placements: Record<string, Placement>
  modulesById: Map<string, FactoryModule>
  floors: Floor[]
  /** Links the player carries by hand, which need nothing built. */
  manual: ReadonlySet<string>
  /** Hand-drawn runs, since a fix has to be scored against what's drawn. */
  overrides: Record<string, RouteOverride>
  /** Per-floor congestion, so tangles don't have to be measured twice. */
  congestion: FloorCongestion[]
}

/** Block-to-block handoffs touching a module, ignoring hand-carried ones. */
function partnersOf(input: AdviceInput, moduleId: string): string[] {
  return input.routes.flatMap((route) => {
    if (!route.from || !route.to) return []
    const other =
      route.from === moduleId
        ? route.to
        : route.to === moduleId
          ? route.from
          : null
    if (!other || !input.placements[other]) return []
    const key = linkKey({
      fromModuleId: route.from,
      toModuleId: route.to,
      item: route.item,
    })
    return input.manual.has(key) ? [] : [other]
  })
}

/**
 * Lifts a move would remove, minus the ones it would create.
 *
 * Positive is a saving. This is the only number that says whether moving a
 * block between floors is worth doing, because a block always trades with
 * something on the floor it's leaving.
 */
function netLifts(
  input: AdviceInput,
  moduleId: string,
  targetFloorId: string,
): number {
  const placement = input.placements[moduleId]
  if (!placement) return 0

  let net = 0
  for (const other of partnersOf(input, moduleId)) {
    const otherFloor = input.placements[other]?.floorId
    if (!otherFloor) continue
    const crossed = otherFloor !== placement.floorId
    const crosses = otherFloor !== targetFloorId
    if (crossed && !crosses) net++
    if (!crossed && crosses) net--
  }
  return net
}

/** Everything placed, as a base-coordinate rect with the floor it's on. */
function blockersOf({ placements, modulesById, floors }: AdviceInput) {
  const index = new Map(floors.map((f, i) => [f.id, i]))
  return Object.values(placements).flatMap((placement) => {
    const module = modulesById.get(placement.moduleId)
    const floorIndex = index.get(placement.floorId)
    if (!module || floorIndex === undefined) return []
    const origin = originOf(floors, placement.floorId)
    const rect = placementRect(module, placement)
    return [
      {
        moduleId: placement.moduleId,
        floorId: placement.floorId,
        floorIndex,
        local: rect,
        rect: { ...rect, x: rect.x + origin.x, y: rect.y + origin.y },
      },
    ]
  })
}

type Blocker = ReturnType<typeof blockersOf>[number]

const nameOf = (input: AdviceInput, moduleId: string) => {
  const module = input.modulesById.get(moduleId)
  return module ? `${module.machines}x ${module.buildingName} (${module.label})` : moduleId
}

const shortName = (input: AdviceInput, moduleId: string) =>
  input.modulesById.get(moduleId)?.label ?? moduleId

const floorName = (input: AdviceInput, floorId: string) =>
  input.floors.find((f) => f.id === floorId)?.name ?? floorId

/**
 * Somewhere on `floorId` this block fits without overlapping anything, nearest
 * to where it would rather be.
 *
 * Searched on the foundation grid, since that's what a floor is built from and
 * a block half a foundation off costs a row of filler either side.
 */
function freeSpot(
  input: AdviceInput,
  blockers: Blocker[],
  moduleId: string,
  floorId: string,
  prefer: { x: number; y: number } | null,
  /** Spots other suggestions have already taken, in base metres. */
  claimed: Claim[] = [],
): { x: number; y: number } | null {
  const module = input.modulesById.get(moduleId)
  const placement = input.placements[moduleId]
  const floor = input.floors.find((f) => f.id === floorId)
  if (!module || !placement || !floor) return null

  const rect = placementRect(module, placement)
  const origin = originOf(input.floors, floorId)
  const width = floor.gridWidth * FOUNDATION_M
  const depth = floor.gridDepth * FOUNDATION_M
  const neighbours = [
    ...blockers
      .filter((b) => b.floorId === floorId && b.moduleId !== moduleId)
      .map((b) => b.rect),
    ...claimed
      .filter((c) => c.floorId === floorId && c.moduleId !== moduleId)
      .map((c) => c.rect),
  ]
  const want = prefer ?? { x: placement.x, y: placement.y }

  let best: { x: number; y: number; distance: number } | null = null

  for (let x = 0; x + rect.width <= width + 1e-9; x += FOUNDATION_M) {
    for (let y = 0; y + rect.depth <= depth + 1e-9; y += FOUNDATION_M) {
      const distance = Math.hypot(x - want.x, y - want.y)
      if (best && distance >= best.distance) continue
      const inBase = { ...rect, x: x + origin.x, y: y + origin.y }
      if (neighbours.some((other) => rectsOverlap(inBase, other))) continue
      best = { x, y, distance }
    }
  }

  return best ? { x: best.x, y: best.y } : null
}

/** A spot one suggestion has taken, so the next one can't take it too. */
interface Claim {
  moduleId: string
  floorId: string
  rect: Rect
}

/** Where a block would sit, in base metres, if it moved as a fix describes. */
function claimOf(input: AdviceInput, fix: Fix): Claim | null {
  const module = input.modulesById.get(fix.moduleId)
  const placement = input.placements[fix.moduleId]
  if (!module || !placement) return null

  const floorId = fix.patch.floorId ?? placement.floorId
  const rect = placementRect(module, placement)
  const origin = originOf(input.floors, floorId)
  return {
    moduleId: fix.moduleId,
    floorId,
    rect: {
      ...rect,
      x: (fix.patch.x ?? placement.x) + origin.x,
      y: (fix.patch.y ?? placement.y) + origin.y,
    },
  }
}

/**
 * Blocks whose traffic is mostly with another floor.
 *
 * Counted as links rather than rate: a lift costs the same whatever goes up it,
 * so the question is how many of them a move deletes and how many it creates.
 */
function adviseOnHomes(input: AdviceInput, blockers: Blocker[]): Advice[] {
  const advice: Advice[] = []

  for (const [moduleId, placement] of Object.entries(input.placements)) {
    const partners = partnersOf(input, moduleId)
    if (partners.length < 2) continue

    // Floors this block already trades with, each scored by what moving there
    // would actually save once the links left behind are paid for.
    const candidates = [
      ...new Set(
        partners
          .map((other) => input.placements[other]?.floorId)
          .filter((id): id is string => Boolean(id) && id !== placement.floorId),
      ),
    ]
      .map((floorId) => ({ floorId, net: netLifts(input, moduleId, floorId) }))
      .sort((a, b) => b.net - a.net)

    const best = candidates[0]
    // One lift traded for another is a lateral move, not an improvement.
    if (!best || best.net < 2) continue

    const spot = freeSpot(input, blockers, moduleId, best.floorId, null)
    if (!spot) continue

    advice.push({
      id: `home|${moduleId}|${best.floorId}`,
      kind: 'floor',
      weight: best.net + 10,
      what: `${nameOf(input, moduleId)} trades mostly with ${floorName(
        input,
        best.floorId,
      )}`,
      fixes: [
        {
          kind: 'floor',
          moduleId,
          patch: { floorId: best.floorId, ...spot },
          distance: 0,
          label: `move it to ${floorName(input, best.floorId)}, dropping ${
            best.net
          } lift${best.net === 1 ? '' : 's'}`,
        },
      ],
    })
  }

  return advice
}

/**
 * Lifts climbing more than one floor.
 *
 * The column stands in the same spot on every floor in between, so it fouls
 * machines on floors that have nothing to do with either end. Bringing one end
 * within a floor of the other is the fix; where that isn't possible, hand
 * carrying at least means nothing is built through the middle.
 */
function adviseOnSkips(input: AdviceInput, blockers: Blocker[]): Advice[] {
  const advice: Advice[] = []

  for (const shaft of input.shafts) {
    if (shaft.manual) continue
    const climbed = shaft.high - shaft.low
    if (climbed < 2) continue

    const { fromModuleId, toModuleId } = shaft.link
    const index = new Map(input.floors.map((f, i) => [f.id, i]))
    const fromIndex = index.get(shaft.link.fromFloorId) ?? 0
    const toIndex = index.get(shaft.link.toFloorId) ?? 0
    const up = Math.sign(shaft.link.rise)

    // Land the material one floor at a time by bringing an end alongside the
    // other, not merely one floor closer: on a three-floor climb, closer still
    // skips a floor. Both ends are offered, since which is easier to move is a
    // build decision, best net first.
    const moves = ([
      [fromModuleId, toIndex - up],
      [toModuleId, fromIndex + up],
    ] as const).flatMap(([moduleId, target]) => {
      const floor = input.floors[target]
      if (!floor || input.placements[moduleId]?.floorId === floor.id) return []
      const spot = freeSpot(input, blockers, moduleId, floor.id, null)
      if (!spot) return []

      const net = netLifts(input, moduleId, floor.id)
      const cost =
        net < 0
          ? `, costing ${-net} lift${net === -1 ? '' : 's'} elsewhere`
          : net > 0
            ? `, dropping ${net} lift${net === 1 ? '' : 's'}`
            : ''
      return [
        {
          fix: {
            kind: 'floor' as const,
            moduleId,
            patch: { floorId: floor.id, ...spot },
            distance: 0,
            label: `put ${shortName(input, moduleId)} on ${floor.name}${cost}`,
          },
          net,
        },
      ]
    })

    const fixes: Fix[] = moves
      .sort((a, b) => b.net - a.net)
      .map((move) => move.fix)

    fixes.push({
      kind: 'hand',
      moduleId: fromModuleId,
      patch: {},
      distance: 0,
      label: 'carry it by hand instead',
      links: shaft.links.map(linkKey),
    })

    advice.push({
      id: `skip|${shaft.id}`,
      kind: 'skip',
      weight: 5 + climbed,
      what: `${itemName(shaft.link.item)} climbs ${climbed} floors, through ${
        climbed - 1
      } it doesn't stop at`,
      fixes,
    })
  }

  return advice
}

/**
 * Lifts that land a long way from the block they feed.
 *
 * A column stands at the source's shipping face, so what it feeds has to be
 * reached by belt once the material is up. That belt crosses the upper floor,
 * which is a tangle the floor's own analysis can't see, because one end of the
 * run isn't on it.
 */
function adviseOnLandings(input: AdviceInput, blockers: Blocker[]): Advice[] {
  const advice: Advice[] = []

  for (const shaft of input.shafts) {
    if (shaft.manual || shaft.toX === null || shaft.toY === null) continue
    const run = Math.hypot(shaft.toX - shaft.x, shaft.toY - shaft.y)
    if (run <= LANDING_SLACK_M) continue

    const landingId = shaft.link.toModuleId
    const landing = input.placements[landingId]
    if (!landing) continue

    const fixes: Fix[] = []

    // Slide the block it feeds until its own feed face sits under the column.
    // The shift is a base-metre delta, which is safe to add to a floor-local
    // position: the floor's origin is the same before and after.
    const shifted = {
      x: Math.max(0, Math.round((landing.x + shaft.x - shaft.toX) / FOUNDATION_M) * FOUNDATION_M),
      y: Math.max(0, Math.round((landing.y + shaft.y - shaft.toY) / FOUNDATION_M) * FOUNDATION_M),
    }
    if (fits(input, blockers, landingId, landing.floorId, shifted)) {
      fixes.push({
        kind: 'align',
        moduleId: landingId,
        patch: shifted,
        distance: Math.hypot(shifted.x - landing.x, shifted.y - landing.y),
        label: `slide ${shortName(input, landingId)} under the lift`,
      })
    }

    // Failing that, move the source so its column comes up where it's wanted.
    const source = input.placements[shaft.link.fromModuleId]
    if (source) {
      const moved = {
        x: Math.max(0, Math.round((source.x + shaft.toX - shaft.x) / FOUNDATION_M) * FOUNDATION_M),
        y: Math.max(0, Math.round((source.y + shaft.toY - shaft.y) / FOUNDATION_M) * FOUNDATION_M),
      }
      if (fits(input, blockers, shaft.link.fromModuleId, source.floorId, moved)) {
        fixes.push({
          kind: 'align',
          moduleId: shaft.link.fromModuleId,
          patch: moved,
          distance: Math.hypot(moved.x - source.x, moved.y - source.y),
          label: `move ${shortName(input, shaft.link.fromModuleId)} under it instead`,
        })
      }
    }

    if (fixes.length === 0) continue

    advice.push({
      id: `landing|${shaft.id}`,
      kind: 'landing',
      weight: 1 + run / 100,
      what: `${itemName(shaft.link.item)} lands ${Math.round(
        run,
      )} m from the ${shortName(input, landingId)} it feeds`,
      fixes: fixes.sort((a, b) => a.distance - b.distance),
    })
  }

  return advice
}

/** Whether a block would sit clear of its neighbours and inside its floor. */
function fits(
  input: AdviceInput,
  blockers: Blocker[],
  moduleId: string,
  floorId: string,
  at: { x: number; y: number },
): boolean {
  const module = input.modulesById.get(moduleId)
  const placement = input.placements[moduleId]
  const floor = input.floors.find((f) => f.id === floorId)
  if (!module || !placement || !floor) return false

  const rect = placementRect(module, placement)
  if (at.x + rect.width > floor.gridWidth * FOUNDATION_M + 1e-9) return false
  if (at.y + rect.depth > floor.gridDepth * FOUNDATION_M + 1e-9) return false

  const origin = originOf(input.floors, floorId)
  const inBase = { ...rect, x: at.x + origin.x, y: at.y + origin.y }
  return !blockers.some(
    (b) =>
      b.floorId === floorId &&
      b.moduleId !== moduleId &&
      rectsOverlap(inBase, b.rect),
  )
}

/**
 * Ways out of a blocked lift, cheapest first.
 *
 * A column starts at the source block's shipping face, so the cheapest fix is
 * usually to ship out of a different face: nothing moves and the column lands
 * somewhere else entirely. Failing that, shifting the source block a foundation
 * or two is enough, because a lift only needs one clear line rather than a clear
 * floor. Carrying it by hand is always available and is the honest answer for a
 * trickle nobody would build a lift for.
 */
function adviseOnBlocked(input: AdviceInput, blockers: Blocker[]): Advice[] {
  const blocked = new Set(input.clashes.map((c) => c.shaftId))
  if (blocked.size === 0) return []

  const index = new Map(input.floors.map((f, i) => [f.id, i]))
  const advice: Advice[] = []

  for (const shaft of input.shafts) {
    if (!blocked.has(shaft.id) || shaft.manual) continue

    const placement = input.placements[shaft.link.fromModuleId]
    const module = input.modulesById.get(shaft.link.fromModuleId)
    const floor = input.floors[index.get(shaft.link.fromFloorId) ?? -1]
    if (!placement || !module || !floor) continue

    const origin = originOf(input.floors, shaft.link.fromFloorId)
    const ends = new Set([shaft.link.fromModuleId, shaft.link.toModuleId])

    /** Nothing on any floor the lift passes through, and no other column. */
    const columnClear = (x: number, y: number, ignore: Set<string>) => {
      for (const blocker of blockers) {
        if (blocker.floorIndex < shaft.low || blocker.floorIndex > shaft.high) {
          continue
        }
        if (ignore.has(blocker.moduleId)) continue
        if (contains(blocker.rect, x, y, 0)) return false
      }
      for (const other of input.shafts) {
        if (other.id === shaft.id || other.manual) continue
        if (other.high < shaft.low || shaft.high < other.low) continue
        if (Math.hypot(other.x - x, other.y - y) <= SHAFT_CLEARANCE_M) {
          return false
        }
      }
      return true
    }

    const fixes: Fix[] = []
    const rect = placementRect(module, placement)

    // 1. Another face, which costs nothing at all.
    for (const side of SIDES) {
      if (side === placement.outputSide) continue
      const anchor = sideAnchor(rect, side)
      if (!columnClear(anchor.x + origin.x, anchor.y + origin.y, ends)) continue
      fixes.push({
        kind: 'face',
        moduleId: shaft.link.fromModuleId,
        patch: { outputSide: side },
        distance: 0,
        label: `ship out its ${COMPASS[side]} face`,
      })
      break
    }

    // 2. A short move, nearest first, keeping the block on its floor and clear
    //    of its neighbours.
    const steps = Math.round(SEARCH_RADIUS_M / FOUNDATION_M)
    const candidates: { x: number; y: number; distance: number }[] = []
    for (let sx = -steps; sx <= steps; sx++) {
      for (let sy = -steps; sy <= steps; sy++) {
        if (sx === 0 && sy === 0) continue
        const dx = sx * FOUNDATION_M
        const dy = sy * FOUNDATION_M
        candidates.push({
          x: placement.x + dx,
          y: placement.y + dy,
          distance: Math.hypot(dx, dy),
        })
      }
    }
    candidates.sort((a, b) => a.distance - b.distance)

    for (const candidate of candidates) {
      if (candidate.x < 0 || candidate.y < 0) continue
      if (!fits(input, blockers, shaft.link.fromModuleId, floor.id, candidate)) {
        continue
      }

      const moved = { ...rect, x: candidate.x, y: candidate.y }
      const anchor = sideAnchor(moved, placement.outputSide)
      if (!columnClear(anchor.x + origin.x, anchor.y + origin.y, ends)) continue

      const dx = candidate.x - placement.x
      const dy = candidate.y - placement.y
      const bearing = [
        dy < 0 ? 'north' : dy > 0 ? 'south' : '',
        dx > 0 ? 'east' : dx < 0 ? 'west' : '',
      ]
        .filter(Boolean)
        .join('-')
      fixes.push({
        kind: 'move',
        moduleId: shaft.link.fromModuleId,
        patch: { x: candidate.x, y: candidate.y },
        distance: candidate.distance,
        label: `move it ${Math.round(candidate.distance)} m ${bearing}`,
      })
      break
    }

    fixes.push({
      kind: 'hand',
      moduleId: shaft.link.fromModuleId,
      patch: {},
      distance: 0,
      label: 'carry it by hand instead',
      links: shaft.links.map(linkKey),
    })

    advice.push({
      id: `blocked|${shaft.id}`,
      kind: 'blocked',
      weight: 8,
      what: `${itemName(shaft.link.item)} out of the ${module.machines}x ${
        module.buildingName
      } has no clear column`,
      fixes,
    })
  }

  return advice
}

/** Above this many belt segments, searching every candidate costs too much. */
const SEARCH_LIMIT = 400

/**
 * Belts that cross, share a lane, or run over a machine, each with the change
 * that measurably clears it.
 *
 * Every candidate is scored on the floor it would produce, not on a rule of
 * thumb, and only offered if the floor comes out better. That's the difference
 * between a suggestion and a guess: "move it 8 m north" is worth reading only
 * when something has actually checked that moving it 8 m north helps.
 */
function adviseOnTangles(input: AdviceInput, blockers: Blocker[]): Advice[] {
  const advice: Advice[] = []

  for (const congestion of input.congestion) {
    if (congestion.score === 0) continue
    const floor = input.floors.find((f) => f.id === congestion.floorId)
    if (!floor) continue

    const context = {
      routes: input.routes as Route[],
      modulesById: input.modulesById,
      placements: input.placements,
      floor,
      overrides: input.overrides,
    }
    if (complexityOf(context) > SEARCH_LIMIT) continue

    const culprits = [...tangled(context)].filter(
      (id) => input.placements[id]?.floorId === floor.id,
    )

    // Each suggestion is measured against the floor the ones before it would
    // produce, not against the floor as it stands. Measured independently they
    // all assume the others stay put, so taking two could easily be worse than
    // taking either: two blocks both step aside into the same lane.
    let working = input.placements

    for (const moduleId of culprits) {
      const placement = working[moduleId]
      if (!placement) continue

      const before = scoreFloor({ ...context, placements: working })
      let best: { fix: Fix; score: number } | null = null
      const consider = (patch: Partial<Placement>, make: () => Fix) => {
        const trial = {
          ...context,
          placements: { ...working, [moduleId]: { ...placement, ...patch } },
        }
        const score = scoreFloor(trial)
        if (score < (best?.score ?? before) - 1e-9) best = { fix: make(), score }
      }

      // Turning a manifold costs nothing at all, so it's tried first and wins
      // ties against anything that moves the block.
      for (const inputSide of SIDES) {
        for (const outputSide of SIDES) {
          if (
            inputSide === placement.inputSide &&
            outputSide === placement.outputSide
          ) {
            continue
          }
          consider({ inputSide, outputSide }, () => ({
            kind: 'face',
            moduleId,
            patch: { inputSide, outputSide },
            distance: 0,
            label:
              inputSide === placement.inputSide
                ? `ship out its ${COMPASS[outputSide]} face`
                : outputSide === placement.outputSide
                  ? `feed it from the ${COMPASS[inputSide]} face`
                  : `feed ${COMPASS[inputSide]}, ship ${COMPASS[outputSide]}`,
          }))
        }
      }

      // Then a short move, near before far, since a belt in the way usually
      // needs the block out of one lane rather than somewhere else entirely.
      for (const step of [FOUNDATION_M, FOUNDATION_M * 2, FOUNDATION_M * 3]) {
        for (const [dx, dy] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ] as const) {
          const at = {
            x: placement.x + dx * step,
            y: placement.y + dy * step,
          }
          if (at.x < 0 || at.y < 0) continue
          if (!fits(input, blockers, moduleId, floor.id, at)) continue
          const bearing = dy < 0 ? 'north' : dy > 0 ? 'south' : dx > 0 ? 'east' : 'west'
          consider(at, () => ({
            kind: 'move',
            moduleId,
            patch: at,
            distance: step,
            label: `move it ${step} m ${bearing}`,
          }))
        }
      }

      if (!best) continue
      const winner: { fix: Fix; score: number } = best
      working = {
        ...working,
        [moduleId]: { ...placement, ...winner.fix.patch },
      }
      // Score is crossings weighted at 100 with belt length as the tiebreak, so
      // whole points of it are tangles cleared.
      const cleared = Math.round((before - winner.score) / 100)

      advice.push({
        id: `tangle|${floor.id}|${moduleId}`,
        kind: 'tangle',
        floorId: floor.id,
        weight: 6 + cleared,
        what:
          cleared > 0
            ? `${nameOf(input, moduleId)} is in the way of ${cleared} tangle${
                cleared === 1 ? '' : 's'
              }`
            : `${nameOf(input, moduleId)} can be moved to shorten its belts`,
        fixes: [winner.fix],
      })
    }
  }

  return advice
}

/**
 * Everything worth changing about how the floors are organised, best first.
 *
 * One suggestion per block at most: several of these can be true of the same
 * block at once, and offering three ways to move it in one list reads as three
 * separate problems rather than one.
 */
export function adviseOnFloors(input: AdviceInput): Advice[] {
  const blockers = blockersOf(input)

  const all = [
    ...adviseOnHomes(input, blockers),
    ...adviseOnSkips(input, blockers),
    ...adviseOnBlocked(input, blockers),
    ...adviseOnTangles(input, blockers),
    ...adviseOnLandings(input, blockers),
  ].sort((a, b) => b.weight - a.weight)

  const seen = new Set<string>()
  const kept: Advice[] = []
  for (const entry of all) {
    const touches = entry.fixes.map((f) => f.moduleId)
    if (touches.some((id) => seen.has(id))) continue
    touches.forEach((id) => seen.add(id))
    kept.push(entry)
  }

  // Each suggestion was worked out against the floors as they are, so two can
  // pick the same empty cell. Taking them all is meant to be one step, so the
  // leading fix of each is re-checked in order against what the ones before it
  // would occupy, and moved on or dropped if the spot has gone.
  const claimed: Claim[] = []
  return kept.flatMap((entry) => {
    const leading = entry.fixes[0]
    if (!leading || leading.kind === 'hand') return [entry]

    const wanted = claimOf(input, leading)
    if (!wanted) return [entry]

    const clashes = claimed.some(
      (c) => c.floorId === wanted.floorId && rectsOverlap(c.rect, wanted.rect),
    )
    if (!clashes) {
      claimed.push(wanted)
      return [entry]
    }

    const spot = freeSpot(
      input,
      blockers,
      leading.moduleId,
      wanted.floorId,
      { x: leading.patch.x ?? 0, y: leading.patch.y ?? 0 },
      claimed,
    )
    if (!spot) {
      const rest = entry.fixes.slice(1)
      return rest.length > 0 ? [{ ...entry, fixes: rest }] : []
    }

    const moved: Fix = { ...leading, patch: { ...leading.patch, ...spot } }
    const reclaimed = claimOf(input, moved)
    if (reclaimed) claimed.push(reclaimed)
    return [{ ...entry, fixes: [moved, ...entry.fixes.slice(1)] }]
  })
}
