/**
 * Layout model. A facility is a stack of floors; each floor holds modules;
 * each module is a block of identical machines running one recipe.
 *
 * Positions and sizes are in metres, matching the game. The foundation grid
 * is 8 m, so a module 3 foundations wide is 24 m.
 */

import type { Reserve } from './storage'

export const FOUNDATION_M = 8

/** Default vertical spacing between floors, in metres. */
export const DEFAULT_FLOOR_HEIGHT_M = 8

export interface Rect {
  x: number
  y: number
  width: number
  depth: number
}

export type Orientation = 0 | 90 | 180 | 270

/** Which face of a block material enters or leaves by. */
export type Side = 'west' | 'north' | 'east' | 'south'

export const SIDES: Side[] = ['west', 'north', 'east', 'south']

export const SIDE_LABEL: Record<Side, string> = {
  west: '←',
  north: '↑',
  east: '→',
  south: '↓',
}

export interface ModulePort {
  item: string
  /** Items or m3 per minute across the whole module. */
  rate: number
}

export interface FactoryModule {
  id: string
  /** Recipe this block runs; null for a free-form area the user added. */
  recipe: string | null
  label: string
  building: string
  buildingName: string
  /** Whole machines in this block. */
  machines: number
  clock: number
  /** MW for the whole block at its clock. */
  power: number
  inputs: ModulePort[]
  outputs: ModulePort[]
  /** Footprint of a single machine, before packing. Height drives headroom. */
  machineFootprint: { width: number; depth: number; height: number }
}

export interface Placement {
  moduleId: string
  floorId: string
  /** Top-left corner in metres. */
  x: number
  y: number
  orientation: Orientation
  /** Machines per row when packing the block; drives the footprint. */
  columns: number
  /** Face the feed manifold runs along. */
  inputSide: Side
  /** Face finished product leaves by. */
  outputSide: Side
  /**
   * Machines built mirrored, as you can in game.
   *
   * When the two manifolds are on opposite faces this simply swaps them. When
   * they share a face, which is how a block against a bus is built, the faces
   * can't swap and mirroring instead swaps where the two manifolds sit along
   * that face. That second case is the only way to move them at all.
   */
  flipped?: boolean
}

/** Midpoint of one face of a rect, where a manifold would attach. */
export function sideAnchor(rect: Rect, side: Side): { x: number; y: number } {
  switch (side) {
    case 'west':
      return { x: rect.x, y: rect.y + rect.depth / 2 }
    case 'east':
      return { x: rect.x + rect.width, y: rect.y + rect.depth / 2 }
    case 'north':
      return { x: rect.x + rect.width / 2, y: rect.y }
    case 'south':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.depth }
  }
}

/**
 * What a floor is for.
 *
 * A storage floor holds stockpiles and nothing else, which is how most bases end
 * up: containers want to be together, near a lift, and out of the way of the
 * production they buffer. Saying so lets arranging keep them off the production
 * floors instead of packing them in wherever they happened to fit.
 */
export type FloorRole = 'production' | 'storage'

export interface Floor {
  id: string
  name: string
  /** Defaults to production; only a dedicated floor says otherwise. */
  role?: FloorRole
  /** Height above the floor below, in metres. */
  elevation: number
  /** Buildable extent of this floor, in foundations. */
  gridWidth: number
  gridDepth: number
  /**
   * Where this floor's own origin sits in the base, in metres. An upper floor
   * built over a different patch of ground than the one below has a non-zero
   * offset, and block positions stay relative to their own floor.
   */
  originX: number
  originY: number
}

/**
 * Clear height above each floor: the gap up to the floor above.
 *
 * The top floor is unbounded. Giving it a default made tall machines on the top
 * floor report as not fitting under a ceiling that isn't there.
 */
export function storeyHeights(floors: Floor[]): number[] {
  return floors.map((_, i) =>
    i + 1 < floors.length
      ? floors[i + 1].elevation
      : Number.POSITIVE_INFINITY,
  )
}

/** Height of each floor's deck above the ground floor's, in metres. */
export function floorBases(floors: Floor[]): number[] {
  let running = 0
  return floors.map((floor, i) => {
    // The ground floor sits at zero however its elevation was saved.
    if (i > 0) running += floor.elevation
    return running
  })
}

/**
 * Where a run meets a block: which face, and how far along it from that face's
 * first corner. Stored relative to the block rather than as a point on the
 * floor, so moving the block carries its connections with it.
 */
export interface RouteEnd {
  side: Side
  along: number
}

/**
 * A run drawn by hand, kept in place of the derived one.
 *
 * Only what the player actually decided is stored. An end left off means "put it
 * where you would have anyway", so nudging a block still tidies up the ends of a
 * run whose corners were placed deliberately.
 */
export interface RouteOverride {
  from?: RouteEnd
  to?: RouteEnd
  /** Corners between the ends, in floor-local metres. */
  waypoints: { x: number; y: number }[]
}

/**
 * A splitter or merger sat on a run.
 *
 * The solver has no opinion about these: it balances rates, and how you divide
 * a line to reach three machines is a build decision. Recording them puts the
 * ones you've decided on into the plan, where they can be seen against the
 * space they take up.
 */
export interface Fitting {
  id: string
  /** The run it sits on. */
  routeId: string
  kind: 'splitter' | 'merger'
  floorId: string
  /** Floor-local metres. */
  x: number
  y: number
}

export interface LayoutState {
  floors: Floor[]
  activeFloorId: string
  placements: Record<string, Placement>
  /** Placement step in metres: 8 full foundation, 4 half, 2 quarter, 0 free. */
  snapMetres: number
  /** Quantities the player wants stockpiled for building. */
  reserves: Reserve[]
  /**
   * Cross-floor connections the player will carry by hand rather than belt, as
   * `linkKey` strings. Filling a stockpile a floor up is often not worth a lift.
   */
  manualLinks: string[]
  /** Hand-drawn runs, keyed by route id. Anything absent is auto-routed. */
  routeOverrides: Record<string, RouteOverride>
  /** Splitters and mergers placed on runs. */
  fittings: Fitting[]
}

/** Raw machine span of a packed block, before it's put on foundations. */
export function machineSpan(
  module: FactoryModule,
  columns: number,
  orientation: Orientation,
): { width: number; depth: number } {
  const cols = Math.max(1, Math.min(columns, module.machines))
  const rows = Math.ceil(module.machines / cols)
  const width = cols * module.machineFootprint.width
  const depth = rows * module.machineFootprint.depth
  const rotated = orientation === 90 || orientation === 270
  return rotated ? { width: depth, depth: width } : { width, depth }
}

/**
 * Area the block actually occupies, rounded up to whole foundations. This is
 * what blocks should tile against, so adjacent modules don't leave slivers.
 */
export function moduleFootprint(
  module: FactoryModule,
  columns: number,
  orientation: Orientation,
): { width: number; depth: number } {
  const span = machineSpan(module, columns, orientation)
  const round = (v: number) =>
    Math.ceil(v / FOUNDATION_M - 1e-9) * FOUNDATION_M
  return { width: round(span.width), depth: round(span.depth) }
}

export function placementRect(
  module: FactoryModule,
  placement: Placement,
): Rect {
  const { width, depth } = moduleFootprint(
    module,
    placement.columns,
    placement.orientation,
  )
  return { x: placement.x, y: placement.y, width, depth }
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.depth &&
    b.y < a.y + a.depth
  )
}

/**
 * Snap steps in metres, matching the foundation sizes you can actually build
 * on. 0 means free placement.
 */
export const SNAP_STEPS = [FOUNDATION_M, FOUNDATION_M / 2, FOUNDATION_M / 4, 0]

export const snap = (value: number, grid = FOUNDATION_M) =>
  grid > 0 ? Math.round(value / grid) * grid : value

/** Stockpile blocks carry this prefix, which is what marks them as storage. */
export const STORAGE_PREFIX = 'storage:'

export const isStorageModule = (moduleId: string) =>
  moduleId.startsWith(STORAGE_PREFIX)

export const floorRole = (floor: Floor): FloorRole => floor.role ?? 'production'
