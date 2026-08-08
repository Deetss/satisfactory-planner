import { gameData, isFluid, resources } from '../data/gameData'
import { num } from '../format'

/**
 * Yield multiplier by node purity. These are game constants and don't appear in
 * the Docs export.
 */
export const PURITY = { impure: 0.5, normal: 1, pure: 2 } as const

export type Purity = keyof typeof PURITY

/** Highest clock an extractor can be overclocked to, with power shards. */
export const MAX_CLOCK = 2.5

export interface MiningPlan {
  extractorClass: string
  extractorName: string
  fluid: boolean
  /** False for the Water Extractor, which sits on open water, not a node. */
  nodeBased: boolean
  well: boolean
  /** Rate from one node at 100% clock, by purity. */
  perNode: Record<Purity, number>
  /** Nodes needed at 100% clock, by purity. */
  nodes: Record<Purity, number>
  /** Nodes needed at the 250% overclock ceiling, by purity. */
  nodesOverclocked: Record<Purity, number>
  /**
   * Clock the cheapest whole-node setup would run at, using normal nodes.
   * Below 1 means you have headroom.
   */
  normalNodeClock: number
  blocked: string | null
}

/**
 * Which extractor and how many nodes are needed to supply `rate` of a resource.
 *
 * Only extractors unlocked at `tier` are considered, and the fastest available
 * is chosen, since that always needs the fewest nodes.
 */
export function planMining(
  item: string,
  rate: number,
  tier: number,
): MiningPlan | null {
  const resource = resources[item]
  if (!resource) return null

  const fluid = isFluid(item)
  // Water comes from a pump; oil from an extractor or a well; ores from miners.
  const candidates = gameData.extractors.filter((e) => {
    if (e.fluid !== fluid) return false
    if (item === 'Desc_Water_C') return !e.nodeBased
    // Nitrogen only comes from resource wells.
    if (item === 'Desc_NitrogenGas_C') return e.well
    if (item === 'Desc_LiquidOil_C') return true
    return !e.well
  })

  const unlocked = candidates.filter((e) => (e.unlockTier ?? 0) <= tier)
  const zero = { impure: 0, normal: 0, pure: 0 }

  if (unlocked.length === 0) {
    const soonest = candidates.sort(
      (a, b) => (a.unlockTier ?? 0) - (b.unlockTier ?? 0),
    )[0]
    return {
      extractorClass: soonest?.className ?? '',
      extractorName: soonest?.name ?? 'extractor',
      fluid,
      nodeBased: soonest?.nodeBased ?? true,
      well: soonest?.well ?? false,
      perNode: { ...zero },
      nodes: { ...zero },
      nodesOverclocked: { ...zero },
      normalNodeClock: 0,
      blocked: soonest
        ? `Needs ${soonest.name}, unlocked at tier ${soonest.unlockTier}`
        : 'No extractor can gather this',
    }
  }

  // Fastest available always needs the fewest nodes.
  const best = unlocked.reduce((a, b) =>
    b.ratePerMinute > a.ratePerMinute ? b : a,
  )

  const perNode = best.nodeBased
    ? {
        impure: best.ratePerMinute * PURITY.impure,
        normal: best.ratePerMinute * PURITY.normal,
        pure: best.ratePerMinute * PURITY.pure,
      }
    : // No purity to vary, so every "node" is the same.
      {
        impure: best.ratePerMinute,
        normal: best.ratePerMinute,
        pure: best.ratePerMinute,
      }

  const count = (per: number, clock = 1) =>
    per > 0 ? Math.ceil(rate / (per * clock) - 1e-9) : 0

  const normalNodes = count(perNode.normal)

  return {
    extractorClass: best.className,
    extractorName: best.name,
    fluid,
    nodeBased: best.nodeBased,
    well: best.well,
    perNode,
    nodes: {
      impure: count(perNode.impure),
      normal: normalNodes,
      pure: count(perNode.pure),
    },
    nodesOverclocked: {
      impure: count(perNode.impure, MAX_CLOCK),
      normal: count(perNode.normal, MAX_CLOCK),
      pure: count(perNode.pure, MAX_CLOCK),
    },
    // Spreading the load over whole nodes means each runs below 100%.
    normalNodeClock:
      normalNodes > 0 ? rate / (normalNodes * perNode.normal) : 0,
    blocked: null,
  }
}

/** One-line summary of the cheapest sensible setup. */
export function miningSummary(plan: MiningPlan): string {
  if (plan.blocked) return plan.blocked

  const unit = plan.fluid ? 'm³/min' : '/min'
  if (!plan.nodeBased) {
    return `${plan.nodes.normal}x ${plan.extractorName} (${plan.perNode.normal} ${unit} each)`
  }

  const percent = plan.normalNodeClock * 100
  // Rounding a tiny draw to "0%" reads as nothing at all.
  const clock = percent > 0 && percent < 1 ? '<1' : num(percent)
  const what = plan.well ? 'satellite node' : 'normal node'
  return (
    `${plan.nodes.normal}x ${what}${plan.nodes.normal === 1 ? '' : 's'} ` +
    `on ${plan.extractorName} @ ${clock}%` +
    (plan.nodes.pure !== plan.nodes.normal
      ? `, or ${plan.nodes.pure}x pure`
      : '')
  )
}
