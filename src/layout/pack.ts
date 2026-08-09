import { orderByFlow, type Flow } from './tidy'
import {
  FOUNDATION_M,
  STORAGE_PREFIX,
  isStorageModule,
  type FactoryModule,
  type Orientation,
} from './types'

/** Rounds a span up to whole foundations, since that's what you actually build. */
export const toFoundations = (metres: number) =>
  Math.ceil(metres / FOUNDATION_M - 1e-9) * FOUNDATION_M

/**
 * Footprint a block occupies once it sits on foundations. Machine spans rarely
 * land on 8 m, so the buildable area is the span rounded up.
 */
export function gridFootprint(
  module: FactoryModule,
  columns: number,
  orientation: Orientation = 0,
): { width: number; depth: number } {
  const cols = Math.max(1, Math.min(columns, module.machines))
  const rows = Math.ceil(module.machines / cols)
  const width = toFoundations(cols * module.machineFootprint.width)
  const depth = toFoundations(rows * module.machineFootprint.depth)
  const rotated = orientation === 90 || orientation === 270
  return rotated ? { width: depth, depth: width } : { width, depth }
}

/**
 * Longest:shortest side a block may reach. Without this, minimizing area alone
 * picks pathological strips: a Constructor is exactly 8 m wide, so a single
 * column wastes no width at all and wins on pure area while being 500 m long.
 */
const MAX_ASPECT = 3

/**
 * Machines per row that wastes the fewest foundations while staying a usable
 * shape. Optimizing packed grid area beats optimizing the raw machine span,
 * because a partial foundation still costs a whole one.
 */
export function defaultColumns(module: FactoryModule): number {
  if (module.machines <= 1) return 1

  let best = 0
  let bestArea = Infinity
  let bestAspect = Infinity
  // Fallback for blocks no arrangement can keep within the aspect cap.
  let squarest = 1
  let squarestAspect = Infinity

  for (let cols = 1; cols <= module.machines; cols++) {
    const { width, depth } = gridFootprint(module, cols)
    const area = width * depth
    const aspect = Math.max(width, depth) / Math.min(width, depth)

    if (aspect < squarestAspect) {
      squarestAspect = aspect
      squarest = cols
    }
    if (aspect > MAX_ASPECT) continue

    if (
      area < bestArea - 1e-9 ||
      (Math.abs(area - bestArea) < 1e-9 && aspect < bestAspect)
    ) {
      best = cols
      bestArea = area
      bestAspect = aspect
    }
  }

  return best || squarest
}

/**
 * Production stage per module: raw-fed blocks are 0, and each block sits one
 * stage after whatever feeds it. Satisfactory has genuine loops (refinery
 * byproducts, water returns), so a module already being visited counts as
 * stage 0 rather than recursing forever.
 */
export function productionStages(
  modules: FactoryModule[],
): Map<string, number> {
  const producersOf = new Map<string, FactoryModule[]>()
  for (const module of modules) {
    for (const output of module.outputs) {
      const list = producersOf.get(output.item) ?? []
      list.push(module)
      producersOf.set(output.item, list)
    }
  }

  const stages = new Map<string, number>()
  const visiting = new Set<string>()

  const stageOf = (module: FactoryModule): number => {
    const cached = stages.get(module.id)
    if (cached !== undefined) return cached
    if (visiting.has(module.id)) return 0

    visiting.add(module.id)
    let stage = 0
    for (const input of module.inputs) {
      for (const producer of producersOf.get(input.item) ?? []) {
        if (producer.id === module.id) continue
        stage = Math.max(stage, stageOf(producer) + 1)
      }
    }
    visiting.delete(module.id)

    stages.set(module.id, stage)
    return stage
  }

  for (const module of modules) stageOf(module)

  // A depot has no inputs or outputs, because it's filled by tapping a line
  // rather than carrying throughput. That leaves it at stage 0 and parks it in
  // the first column, as far as it can get from the block it taps, so it's
  // staged with whatever produces the item it holds instead.
  for (const module of modules) {
    if (!isStorageModule(module.id)) continue
    const item = module.id.slice(STORAGE_PREFIX.length)
    const sources = producersOf.get(item) ?? []
    if (sources.length === 0) continue
    stages.set(
      module.id,
      Math.max(...sources.map((s) => stages.get(s.id) ?? 0)),
    )
  }

  return stages
}

export interface PackedModule {
  module: FactoryModule
  x: number
  y: number
  columns: number
  width: number
  depth: number
}

/**
 * Clear ground reserved around every block, in metres.
 *
 * A block's footprint is its machines. What it doesn't include is the manifold
 * feeding them, the belt taking the product away, or anywhere to stand, and all
 * three have to go somewhere. One foundation on each side means any face can
 * carry a line without the neighbour's machines being in the way, and blocks at
 * the floor edge get their lane too.
 */
export const SERVICE_M = FOUNDATION_M

/**
 * Clear ground kept between the blocks and the floor's own edge.
 *
 * Separate from the lane between two blocks, and not optional with it: a belt
 * has to get around the outside of a block as well as between two of them, and
 * the foundation at the very edge is where the wall, the ramp or the lift
 * landing goes. A block flush to the boundary leaves nowhere to put any of it.
 */
export const EDGE_M = FOUNDATION_M

/**
 * Arranges blocks into left-to-right bands, one band per production stage, so
 * material flows across the floor in the same direction the graph reads and
 * belt runs stay short. Within a band, blocks stack downward.
 */
export function packByStage(
  modules: FactoryModule[],
  options: {
    gutter?: number
    bounds?: { width: number; depth: number }
    /** Handoffs between blocks, used to order each band so belts don't cross. */
    flows?: Flow[]
    /** Clear ground kept around each block for belts and pipes. */
    service?: number
  } = {},
): {
  packed: PackedModule[]
  /** Blocks that wouldn't fit the floor, so they stay in the tray. */
  overflow: FactoryModule[]
  width: number
  depth: number
} {
  // The service lane already separates neighbours, so the gutter is extra space
  // on top of it rather than the only space there is.
  const gutter = options.gutter ?? 0
  const service = options.service ?? SERVICE_M
  const stages = productionStages(modules)

  const byStage = new Map<number, FactoryModule[]>()
  for (const module of modules) {
    const stage = stages.get(module.id) ?? 0
    const list = byStage.get(stage) ?? []
    list.push(module)
    byStage.set(stage, list)
  }

  const sizedByStage = new Map<
    number,
    { module: FactoryModule; columns: number; width: number; depth: number }[]
  >()
  let totalArea = 0
  let deepestModule = 0

  for (const [stage, inStage] of byStage) {
    const sized = inStage
      .map((module) => {
        const columns = defaultColumns(module)
        const { width, depth } = gridFootprint(module, columns)
        // The ground a block really costs includes the lane around it, which is
        // what the floor has to be sized against.
        totalArea += (width + service * 2) * (depth + service * 2)
        deepestModule = Math.max(deepestModule, depth + service * 2)
        return { module, columns, width, depth }
      })
      // Widest first so each sub-column's left edge stays flush.
      .sort((a, b) => b.width - a.width || b.depth - a.depth)
    sizedByStage.set(stage, sized)
  }

  // Size decides the shape of a band; flow decides who sits where in it. Doing
  // it in that order means the tidier ordering only reshuffles within a band,
  // which is where a crossing is won or lost, and leaves the packing alone.
  if (options.flows) {
    const rank = orderByFlow(
      new Map(
        [...sizedByStage].map(([stage, list]) => [
          stage,
          list.map((item) => item.module.id),
        ]),
      ),
      options.flows,
    )
    for (const list of sizedByStage.values()) {
      list.sort(
        (a, b) => (rank.get(a.module.id) ?? 0) - (rank.get(b.module.id) ?? 0),
      )
    }
  }

  // Without a fixed floor, aim for a roughly square result; a stage holding
  // many blocks would otherwise stack into one absurdly tall column.
  const boundWidth = options.bounds
    ? options.bounds.width
    : Number.POSITIVE_INFINITY
  const boundDepth = options.bounds
    ? options.bounds.depth
    : Math.max(deepestModule, toFoundations(Math.sqrt(totalArea * 1.4)))

  const packed: PackedModule[] = []
  const overflow: FactoryModule[] = []

  // Shelf packing in production order. Blocks run left to right in stage order
  // and wrap to a new shelf at the floor edge, so stages stay grouped when
  // there's room and a tight floor still fills sensibly.
  let cursorX = 0
  let cursorY = 0
  let shelfDepth = 0
  let usedWidth = 0

  for (const stage of [...sizedByStage.keys()].sort((a, b) => a - b)) {
    for (const item of sizedByStage.get(stage) ?? []) {
      // Everything below packs the block with its lane around it, and the block
      // itself sits in the middle of that.
      const taken = {
        width: item.width + service * 2,
        depth: item.depth + service * 2,
      }

      // A block wider or deeper than the whole floor can never be placed.
      if (taken.width > boundWidth || taken.depth > boundDepth) {
        overflow.push(item.module)
        continue
      }

      if (cursorX > 0 && cursorX + taken.width > boundWidth) {
        cursorX = 0
        cursorY += shelfDepth + gutter
        shelfDepth = 0
      }

      if (cursorY + taken.depth > boundDepth) {
        overflow.push(item.module)
        continue
      }

      packed.push({
        module: item.module,
        x: cursorX + service,
        y: cursorY + service,
        columns: item.columns,
        width: item.width,
        depth: item.depth,
      })

      cursorX += taken.width + gutter
      shelfDepth = Math.max(shelfDepth, taken.depth)
      usedWidth = Math.max(usedWidth, cursorX - gutter)
    }
  }

  return {
    packed,
    overflow,
    width: usedWidth,
    depth: cursorY + shelfDepth,
  }
}
