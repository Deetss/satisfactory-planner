/**
 * Bus arrangement: blocks either side of a central corridor, in stage order
 * along one axis.
 *
 * The compact packer minimizes area, which is the thing that boxes a factory
 * in: it fills the floor evenly, so the next block has nowhere to go without
 * moving something. This lays the factory out as a line instead. Every block
 * touches one bus, and the far end of that bus is left open, so adding a stage
 * means extending in one direction and nothing already built has to move.
 */

import {
  SERVICE_M,
  defaultColumns,
  gridFootprint,
  productionStages,
  toFoundations,
} from './pack'
import type { PackedModule } from './pack'
import { orderByFlow, type Flow } from './tidy'
import { FOUNDATION_M, type FactoryModule } from './types'

/** How blocks are laid out on a floor. */
export type ArrangeMode = 'compact' | 'bus'

/** Which way the factory is free to grow. */
export type Growth = 'east' | 'south'

export const GROWTH_LABEL: Record<Growth, string> = {
  east: 'east',
  south: 'south',
}

/** Default corridor width: room for several belts and a walkway. */
export const DEFAULT_BUS_M = FOUNDATION_M * 2

export interface BusResult {
  packed: PackedModule[]
  /** Blocks that wouldn't fit, so they stay in the tray. */
  overflow: FactoryModule[]
  /** The corridor itself, for drawing and for keeping clear. */
  bus: { x: number; y: number; width: number; depth: number }
  /** Metres still free along the growth axis. */
  growthRoom: number
  width: number
  depth: number
}

interface Sized {
  module: FactoryModule
  columns: number
  width: number
  depth: number
  /** Extent along the growth axis. */
  along: number
  /** Extent across it, which is what the bus has to leave room for. */
  across: number
}

export function packAsBus(
  modules: FactoryModule[],
  options: {
    bounds: { width: number; depth: number }
    growth?: Growth
    gutter?: number
    busWidth?: number
    /** Handoffs between blocks, used to order each stage along the corridor. */
    flows?: Flow[]
    /** Clear ground kept around each block for belts and pipes. */
    service?: number
  },
): BusResult {
  const growth = options.growth ?? 'east'
  // The lane around each block already separates neighbours, so the gutter is
  // extra space on top of it.
  const gutter = options.gutter ?? 0
  const service = options.service ?? SERVICE_M
  const busWidth = toFoundations(options.busWidth ?? DEFAULT_BUS_M)
  const alongGrid = growth === 'east'

  // Everything below works in (along, across) and converts at the end, so one
  // implementation covers both growth directions.
  const alongLimit = alongGrid ? options.bounds.width : options.bounds.depth
  const acrossLimit = alongGrid ? options.bounds.depth : options.bounds.width

  const stages = productionStages(modules)
  const byStage = new Map<number, Sized[]>()

  for (const module of modules) {
    const columns = defaultColumns(module)
    const { width, depth } = gridFootprint(module, columns)
    // Only the extent along the bus carries a lane. Across it, the corridor is
    // the lane: both manifolds face it, and the outer side is open ground, so
    // reserving there would cost a foundation a belt would never use.
    const sized: Sized = {
      module,
      columns,
      width,
      depth,
      along: (alongGrid ? width : depth) + service * 2,
      across: alongGrid ? depth : width,
    }
    const stage = stages.get(module.id) ?? 0
    const list = byStage.get(stage) ?? []
    list.push(sized)
    byStage.set(stage, list)
  }

  const overflow: FactoryModule[] = []
  // Slot assignments, resolved to real coordinates once the bus offset is known.
  const placed: { item: Sized; along: number; near: boolean }[] = []

  let cursor = 0
  let maxNear = 0
  let maxFar = 0

  const fitsAcross = (near: number, far: number) =>
    near + busWidth + far <= acrossLimit + 1e-9

  /**
   * How many of a slot's blocks fit if they take the sides in this order.
   *
   * A slot holds at most one block per side. Choosing each block's side
   * independently let both land on the same side at the same offset along the
   * bus, which is two blocks in one place.
   */
  const scoreOrder = (pair: Sized[], sides: boolean[]) => {
    let near = maxNear
    let far = maxFar
    let count = 0
    for (let i = 0; i < pair.length; i++) {
      const nextNear = sides[i] ? Math.max(near, pair[i].across) : near
      const nextFar = sides[i] ? far : Math.max(far, pair[i].across)
      if (!fitsAcross(nextNear, nextFar)) continue
      near = nextNear
      far = nextFar
      count++
    }
    return { count, near, far }
  }

  // Length decides which blocks pair up in a slot; flow decides the order those
  // slots run in, so a block ends up beside the ones it trades with.
  for (const list of byStage.values()) {
    list.sort((a, b) => b.along - a.along || b.across - a.across)
  }
  if (options.flows) {
    const rank = orderByFlow(
      new Map(
        [...byStage].map(([stage, list]) => [
          stage,
          list.map((item) => item.module.id),
        ]),
      ),
      options.flows,
    )
    for (const list of byStage.values()) {
      list.sort(
        (a, b) => (rank.get(a.module.id) ?? 0) - (rank.get(b.module.id) ?? 0),
      )
    }
  }

  for (const stage of [...byStage.keys()].sort((a, b) => a - b)) {
    const items = byStage.get(stage) ?? []

    // Stages start their own slot, so the flow still reads along the bus rather
    // than interleaving stage 0 with stage 3 in one column.
    for (let i = 0; i < items.length; i += 2) {
      const pair = [items[i], items[i + 1]].filter(Boolean)
      const slot = Math.max(...pair.map((p) => p.along))

      if (cursor + slot > alongLimit + 1e-9) {
        for (const item of pair) overflow.push(item.module)
        continue
      }

      // Whichever way round fits more of the pair, preferring to load the
      // shallower side first when both work.
      const orders: boolean[][] =
        pair.length === 1
          ? [[maxNear <= maxFar]]
          : maxNear <= maxFar
            ? [
                [true, false],
                [false, true],
              ]
            : [
                [false, true],
                [true, false],
              ]

      let best = orders[0]
      let bestScore = scoreOrder(pair, best)
      for (const option of orders.slice(1)) {
        const score = scoreOrder(pair, option)
        if (score.count > bestScore.count) {
          best = option
          bestScore = score
        }
      }

      let used = false
      for (let k = 0; k < pair.length; k++) {
        const item = pair[k]
        const near = best[k]
        const nextNear = near ? Math.max(maxNear, item.across) : maxNear
        const nextFar = near ? maxFar : Math.max(maxFar, item.across)
        if (!fitsAcross(nextNear, nextFar)) {
          overflow.push(item.module)
          continue
        }
        maxNear = nextNear
        maxFar = nextFar
        placed.push({ item, along: cursor, near })
        used = true
      }
      if (used) cursor += slot + gutter
    }
  }

  // The near side hangs off the bus, so the bus sits exactly as far across as
  // the deepest block on that side.
  const busAcross = maxNear
  const packed: PackedModule[] = placed.map(({ item, along, near }) => {
    // `along` bounds the block plus a lane either side of it, so the block
    // itself is inset by one lane. Across the bus it sits flush, against the
    // corridor that serves it.
    const across = near ? busAcross - item.across : busAcross + busWidth
    return {
      module: item.module,
      x: alongGrid ? along + service : across,
      y: alongGrid ? across : along + service,
      columns: item.columns,
      width: item.width,
      depth: item.depth,
    }
  })

  const usedAlong = Math.max(0, cursor - gutter)
  const usedAcross = busAcross + busWidth + maxFar

  return {
    packed,
    overflow,
    bus: {
      x: alongGrid ? 0 : busAcross,
      y: alongGrid ? busAcross : 0,
      width: alongGrid ? usedAlong : busWidth,
      depth: alongGrid ? busWidth : usedAlong,
    },
    growthRoom: Math.max(0, alongLimit - usedAlong),
    width: alongGrid ? usedAlong : usedAcross,
    depth: alongGrid ? usedAcross : usedAlong,
  }
}
