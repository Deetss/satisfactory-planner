/**
 * Arranging a floor as columns of production, one per stage.
 *
 * The shelf packer this replaces answered the wrong question. It minimized area,
 * filling the floor left to right and wrapping at the edge, which is right for
 * luggage in a boot and wrong for a factory: a stage could be cut in half by a
 * wrap, so material that should have moved one step east instead doubled back
 * across the whole floor. Area is cheap in this game. Belt length, crossings and
 * lifts are what cost you.
 *
 * So: one column per stage, in order, and material flows east and only east.
 * Within a column a block sits at the average height of whatever it trades with,
 * which is the standard way to straighten the edges of a layered drawing, then
 * the column is legalized so nothing overlaps. The result is that a block tends
 * to end up directly across from the blocks it feeds, and the belt between them
 * is a straight line.
 *
 * One column per stage is the ideal, not a rule, because a real floor is rarely
 * the shape the ideal wants. A stage taller than the floor takes a second column
 * beside itself, and when the chain is wider than the floor, neighbouring stages
 * share a column. Both cost some of the straightness above, and both are worth it
 * against the alternative, which is giving up and packing for area.
 */

import { SERVICE_M, defaultColumns, gridFootprint, productionStages } from './pack'
import type { PackedModule } from './pack'
import { orderByFlow, type Flow } from './tidy'
import { FOUNDATION_M, type FactoryModule } from './types'

/** Barycentre sweeps. The positions settle well before this. */
const PASSES = 6

interface Sized {
  id: string
  module: FactoryModule
  columns: number
  width: number
  depth: number
  /** Production stage, which fixes the order inside a shared column. */
  stage: number
  /** Assigned as the sweeps run. */
  y: number
}

interface Column {
  items: Sized[]
  width: number
  x: number
}

export interface ColumnResult {
  packed: PackedModule[]
  overflow: FactoryModule[]
  width: number
  depth: number
}

/**
 * How a stage's blocks are ordered before the flow graph has its say.
 *
 * The barycentre sweeps only ever refine the order they were seeded with, so
 * different seeds settle into genuinely different layouts. No seed wins on
 * every floor, which is why the caller tries a few and keeps the one that
 * measures best rather than trusting any single one of these.
 */
export type ColumnSeed = 'depth' | 'name' | 'shallow'

const SEED_ORDER: Record<ColumnSeed, (a: Sized, b: Sized) => number> = {
  depth: (a, b) => b.depth - a.depth || a.id.localeCompare(b.id),
  name: (a, b) => a.id.localeCompare(b.id),
  shallow: (a, b) => a.depth - b.depth || a.id.localeCompare(b.id),
}

/**
 * Lays blocks out in stage columns, or returns null when not even one column
 * fits across the floor. A caller that gets null should fall back to packing for
 * area, since a layout that doesn't fit is worth less than an untidy one.
 */
export function packByColumns(
  modules: FactoryModule[],
  options: {
    bounds: { width: number; depth: number }
    flows?: Flow[]
    service?: number
    seed?: ColumnSeed
  },
): ColumnResult | null {
  const service = options.service ?? SERVICE_M
  const { bounds } = options
  const flows = options.flows ?? []

  const stages = productionStages(modules)
  const overflow: FactoryModule[] = []
  const byStage = new Map<number, Sized[]>()

  for (const module of modules) {
    const columns = defaultColumns(module)
    const { width, depth } = gridFootprint(module, columns)

    // A block that can't fit the floor on its own will never fit beside
    // anything, so it goes back to the tray now rather than distorting the
    // column widths on its way there.
    if (
      width + service * 2 > bounds.width + 1e-9 ||
      depth + service * 2 > bounds.depth + 1e-9
    ) {
      overflow.push(module)
      continue
    }

    const stage = stages.get(module.id) ?? 0
    const list = byStage.get(stage) ?? []
    list.push({ id: module.id, module, columns, width, depth, stage, y: 0 })
    byStage.set(stage, list)
  }

  const order = [...byStage.keys()].sort((a, b) => a - b)

  // Seed each stage's order from the flow graph, then let the sweeps refine it
  // into positions. Ordering alone leaves a block anywhere in its slot; what
  // makes a belt straight is the height it ends up at.
  const seeded = orderByFlow(
    new Map(
      order.map((stage) => [
        stage,
        (byStage.get(stage) ?? [])
          .slice()
          .sort(SEED_ORDER[options.seed ?? 'depth'])
          .map((s) => s.id),
      ]),
    ),
    flows,
  )
  for (const stage of order) {
    byStage
      .get(stage)
      ?.sort(
        (a, b) => (seeded.get(a.id) ?? 0) - (seeded.get(b.id) ?? 0),
      )
  }

  const widest = (items: Sized[]) => Math.max(...items.map((i) => i.width))

  /**
   * Splits one group of blocks into as many side-by-side columns as the floor's
   * depth demands, filling each in flow order before starting the next.
   *
   * Spilling into a second column keeps a tall stage on the floor. The old
   * behaviour was to drop whatever hung off the bottom, which sent blocks to the
   * tray while the floor beside them sat empty.
   */
  const split = (group: Sized[]): Column[] => {
    const columns: Column[] = []
    let current: Sized[] = []
    let used = service

    for (const item of group) {
      if (current.length > 0 && used + item.depth + service > bounds.depth + 1e-9) {
        columns.push({ items: current, width: widest(current), x: 0 })
        current = []
        used = service
      }
      current.push(item)
      used += item.depth + service * 2
    }
    if (current.length > 0) {
      columns.push({ items: current, width: widest(current), x: 0 })
    }
    return columns
  }

  const layOut = (groups: Sized[][]) => groups.flatMap(split)
  const spanOf = (columns: Column[]) =>
    columns.reduce((sum, c) => sum + c.width + service * 2, 0)

  let groups = order.map((stage) => byStage.get(stage) ?? [])
  let columns = layOut(groups)

  // Too wide for the floor: merge neighbouring stages into a shared column,
  // cheapest merge first, until the chain fits. A shared column means the two
  // stages inside it trade sideways instead of across a gap, which is a small
  // price next to the alternative of abandoning the flow order entirely.
  while (spanOf(columns) > bounds.width + 1e-9 && groups.length > 1) {
    const current = spanOf(columns)
    let bestIndex = -1
    let bestSpan = current

    for (let i = 0; i < groups.length - 1; i++) {
      const trial = groups.slice()
      trial.splice(i, 2, [...groups[i], ...groups[i + 1]])
      const span = spanOf(layOut(trial))
      if (span < bestSpan - 1e-9) {
        bestSpan = span
        bestIndex = i
      }
    }

    // Every merge would make it wider, which happens once the columns are full
    // top to bottom. Nothing left to gain here; the floor is simply too small.
    if (bestIndex < 0) break

    groups.splice(bestIndex, 2, [...groups[bestIndex], ...groups[bestIndex + 1]])
    columns = layOut(groups)
  }

  // Still too wide, so the last stages come off. Dropped whole columns from the
  // end rather than a block here and there, which leaves what's kept contiguous
  // in the chain instead of a scattering of whatever happened to be small.
  while (spanOf(columns) > bounds.width + 1e-9 && columns.length > 0) {
    const dropped = columns.pop()
    if (dropped) overflow.push(...dropped.items.map((i) => i.module))
  }

  if (columns.length === 0) return null

  let cursor = 0
  for (const column of columns) {
    column.x = cursor + service
    cursor += column.width + service * 2
  }

  // Initial heights: stacked from the top in flow order, so the first sweep has
  // something to average against.
  for (const column of columns) {
    let y = service
    for (const item of column.items) {
      item.y = y
      y += item.depth + service * 2
    }
  }

  const centreOf = (item: Sized) => item.y + item.depth / 2
  const positioned = new Map<string, Sized>()
  for (const column of columns) {
    for (const item of column.items) positioned.set(item.id, item)
  }

  /**
   * Places a column at the heights it wants, without overlaps.
   *
   * Blocks are taken in the order they'd like to be in and each is put as close
   * to its wish as the one above allows, which preserves the order the
   * barycentres asked for. A column pushed past the floor is slid back up as a
   * whole, so the crowding is shared rather than dumped on the last block.
   *
   * Stage outranks the barycentre. When two stages have had to share a column
   * they trade with each other inside it, and those runs can only avoid
   * crossing if they all point the same way, which means keeping the earlier
   * stage above the later one. Barycentres still order blocks within a stage,
   * which is where they do their work.
   */
  const legalize = (list: Sized[], wanted: Map<string, number>) => {
    const sorted = list
      .slice()
      .sort(
        (a, b) =>
          a.stage - b.stage ||
          (wanted.get(a.id) ?? centreOf(a)) -
            (wanted.get(b.id) ?? centreOf(b)) ||
          // Two blocks feeding the same thing want the same height, and the tie
          // has to break on where they already are. Breaking it on the input
          // order instead threw away whatever the previous sweep had worked
          // out, so the last pass decided the layout on its own.
          centreOf(a) - centreOf(b),
      )

    let top = service
    for (const item of sorted) {
      const wish = (wanted.get(item.id) ?? centreOf(item)) - item.depth / 2
      item.y = Math.max(top, wish)
      top = item.y + item.depth + service * 2
    }

    const last = sorted[sorted.length - 1]
    if (!last) return
    const bottom = last.y + last.depth + service
    if (bottom > bounds.depth) {
      const shift = bottom - bounds.depth
      for (const item of sorted) item.y = Math.max(service, item.y - shift)
    }
  }

  for (let pass = 0; pass < PASSES; pass++) {
    // Alternating direction stops the layout settling on whichever end it
    // started from: a forward sweep pulls each block towards what feeds it, a
    // backward sweep towards what it feeds.
    const back = pass % 2 === 0
    const sweep = back ? columns : [...columns].reverse()

    for (const column of sweep) {
      if (column.items.length === 0) continue

      const wanted = new Map<string, number>()
      for (const item of column.items) {
        const partners = flows
          .filter((f) => (back ? f.to === item.id : f.from === item.id))
          .map((f) => positioned.get(back ? f.from : f.to))
          .filter((p): p is Sized => Boolean(p) && p !== item)

        wanted.set(
          item.id,
          partners.length === 0
            ? centreOf(item)
            : partners.reduce((sum, p) => sum + centreOf(p), 0) / partners.length,
        )
      }

      legalize(column.items, wanted)
    }
  }

  // Snapped last. Snapping during the sweeps would quantize every barycentre and
  // stop columns settling, and a block off the foundation grid costs a row of
  // filler either side of it in game.
  const packed: PackedModule[] = []
  let depth = 0
  for (const column of columns) {
    for (const item of column.items) {
      const y = Math.max(
        0,
        Math.min(
          Math.round(item.y / FOUNDATION_M) * FOUNDATION_M,
          Math.floor((bounds.depth - item.depth) / FOUNDATION_M) * FOUNDATION_M,
        ),
      )
      packed.push({
        module: item.module,
        x: column.x,
        y,
        columns: item.columns,
        width: item.width,
        depth: item.depth,
      })
      depth = Math.max(depth, y + item.depth)
    }
  }

  return {
    packed,
    overflow,
    width: Math.max(0, cursor - service),
    depth,
  }
}
