import { gameData, isFluid, itemName, items } from '../data/gameData'
import type { FactoryModule } from './types'

export type ReserveMode = 'fixed' | 'excess'

/** Storage the player wants for one item. */
export interface Reserve {
  item: string
  /**
   * How the target is decided. `fixed` stockpiles a set amount for building;
   * `excess` sizes the buffer from whatever the plan overproduces, so surplus
   * has somewhere to go instead of backing the line up.
   */
  mode: ReserveMode
  /** Units to hold, for `fixed`. */
  quantity: number
  /** Minutes of surplus to hold, for `excess`. */
  bufferMinutes: number
}

export const DEFAULT_BUFFER_MINUTES = 60

/** Units a reserve needs to hold, resolving `excess` against the plan. */
export function reserveTarget(reserve: Reserve, surplusRate: number): number {
  if (reserve.mode === 'excess') {
    return Math.max(0, surplusRate) * Math.max(0, reserve.bufferMinutes)
  }
  return Math.max(0, reserve.quantity)
}

export interface ReservePlan {
  reserve: Reserve
  /** Units to hold, after resolving `excess` mode against the plan. */
  target: number
  containerName: string
  containerClass: string
  /** Units one container holds. */
  perContainer: number
  containers: number
  /** What the containers actually hold, which rounds above the request. */
  actualCapacity: number
  footprint: { width: number; depth: number; height: number }
  /** Set when nothing suitable is unlocked at the current tier. */
  blocked: string | null
}

const FALLBACK_FOOTPRINT = { width: 8, depth: 8, height: 8 }

/**
 * Works out which container to use and how many, for a reserve of one item.
 * Solid capacity is slots x stack size, so the same container holds far more
 * Iron Plate (200 a slot) than Heavy Modular Frame (50 a slot).
 */
export function planReserve(
  reserve: Reserve,
  tier: number,
  surplusRate = 0,
): ReservePlan {
  const fluid = isFluid(reserve.item)
  const target = reserveTarget(reserve, surplusRate)
  const options = fluid
    ? gameData.storage.fluid.filter((s) => (s.unlockTier ?? 0) <= tier)
    : gameData.storage.solid.filter((s) => (s.unlockTier ?? 0) <= tier)

  const empty: ReservePlan = {
    reserve,
    target,
    containerName: '',
    containerClass: '',
    perContainer: 0,
    containers: 0,
    actualCapacity: 0,
    footprint: FALLBACK_FOOTPRINT,
    blocked: fluid
      ? 'No fluid buffer unlocked yet'
      : 'No storage container unlocked yet',
  }
  if (options.length === 0) return empty

  // Biggest available, so a reserve needs the fewest buildings.
  const best = options[options.length - 1]
  const stackSize = items[reserve.item]?.stackSize ?? 1
  const perContainer = fluid
    ? (best as { capacity: number }).capacity
    : (best as { slots: number }).slots * stackSize

  if (perContainer <= 0) return empty

  const containers =
    target > 0 ? Math.max(1, Math.ceil(target / perContainer - 1e-9)) : 0

  return {
    reserve,
    target,
    containerName: best.name,
    containerClass: best.className,
    perContainer,
    containers,
    actualCapacity: containers * perContainer,
    footprint: best.footprint
      ? {
          width: best.footprint.width,
          depth: best.footprint.depth,
          height: best.footprint.height ?? FALLBACK_FOOTPRINT.height,
        }
      : FALLBACK_FOOTPRINT,
    blocked: null,
  }
}

/**
 * Reserves as placeable blocks, so storage arranges and drags on the floor
 * exactly like a production module.
 */
export function storageModules(
  reserves: Reserve[],
  tier: number,
  surplusByItem: Record<string, number> = {},
): FactoryModule[] {
  const modules: FactoryModule[] = []

  for (const reserve of reserves) {
    const plan = planReserve(reserve, tier, surplusByItem[reserve.item] ?? 0)
    if (plan.blocked || plan.containers === 0) continue

    modules.push({
      id: `storage:${reserve.item}`,
      recipe: null,
      label: `${itemName(reserve.item)} reserve`,
      building: plan.containerClass,
      buildingName: plan.containerName,
      machines: plan.containers,
      clock: 1,
      power: 0,
      // A depot is filled by tapping an existing line, so it carries no
      // throughput of its own and doesn't generate routes.
      inputs: [],
      outputs: [],
      machineFootprint: plan.footprint,
    })
  }

  return modules
}
