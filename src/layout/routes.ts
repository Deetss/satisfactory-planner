import { gameData, isFluid, items } from '../data/gameData'
import type { FactoryModule } from './types'
import { num } from '../format'

export interface TransportOption {
  className: string
  name: string
  /** Items/min for belts, m3/min for pipes. */
  throughput: number
  unlockTier: number
}

export interface TransportChoice {
  /** Tier to build. Null when nothing is unlocked that can carry this. */
  option: TransportOption | null
  /** Parallel runs needed, because one line can't carry the rate. */
  lines: number
  /** True when the rate exceeds even the best unlocked tier on one line. */
  needsSplit: boolean
}

export interface Route {
  id: string
  item: string
  /** Total rate across all parallel lines. */
  rate: number
  fluid: boolean
  /** Null means the material enters from outside the factory. */
  from: string | null
  /** Null means it leaves the factory as output or surplus. */
  to: string | null
  transport: TransportChoice
}

const belts = (): TransportOption[] =>
  gameData.transport.belts.map((b) => ({
    className: b.className,
    name: b.name,
    throughput: b.itemsPerMinute,
    unlockTier: b.unlockTier,
  }))

const pipes = (): TransportOption[] =>
  gameData.transport.pipes.map((p) => ({
    className: p.className,
    name: p.name,
    throughput: p.cubicMetersPerMinute,
    unlockTier: p.unlockTier,
  }))

/**
 * Cheapest transport that carries `rate`, falling back to parallel runs of the
 * best unlocked tier when no single line is enough.
 */
export function chooseTransport(
  item: string,
  rate: number,
  tier: number,
): TransportChoice {
  const options = (isFluid(item) ? pipes() : belts())
    .filter((o) => o.unlockTier <= tier)
    .sort((a, b) => a.throughput - b.throughput)

  if (options.length === 0) {
    return { option: null, lines: 0, needsSplit: false }
  }

  const single = options.find((o) => o.throughput >= rate - 1e-9)
  if (single) return { option: single, lines: 1, needsSplit: false }

  const best = options[options.length - 1]
  return {
    option: best,
    lines: Math.ceil(rate / best.throughput - 1e-9),
    needsSplit: true,
  }
}

interface Side {
  /** Null stands for outside the factory: a miner, an import, or an export. */
  moduleId: string | null
  rate: number
}

/**
 * Every material handoff the plan implies, as module-to-module runs.
 *
 * Where an item has several producers and consumers the flow is split in
 * proportion to demand, the same assumption a manifold makes. Material with no
 * producer in the plan enters from outside (mining or an import), and anything
 * unconsumed leaves as output or surplus.
 */
export function deriveRoutes(
  modules: FactoryModule[],
  targets: Record<string, number>,
  surplus: { item: string; rate: number }[],
  tier: number,
): Route[] {
  const producers = new Map<string, Side[]>()
  const consumers = new Map<string, Side[]>()

  const add = (map: Map<string, Side[]>, item: string, side: Side) => {
    if (side.rate <= 1e-9) return
    const list = map.get(item) ?? []
    list.push(side)
    map.set(item, list)
  }

  for (const module of modules) {
    for (const output of module.outputs) {
      add(producers, output.item, { moduleId: module.id, rate: output.rate })
    }
    for (const input of module.inputs) {
      add(consumers, input.item, { moduleId: module.id, rate: input.rate })
    }
  }

  const routes: Route[] = []
  const push = (
    item: string,
    rate: number,
    from: string | null,
    to: string | null,
  ) => {
    if (rate <= 1e-6) return
    routes.push({
      id: `${from ?? 'in'}->${to ?? 'out'}:${item}`,
      item,
      rate,
      fluid: isFluid(item),
      from,
      to,
      transport: chooseTransport(item, rate, tier),
    })
  }

  const allItems = new Set([
    ...producers.keys(),
    ...consumers.keys(),
    ...Object.keys(targets),
    ...surplus.map((s) => s.item),
  ])

  for (const item of allItems) {
    const outs = producers.get(item) ?? []
    const ins = consumers.get(item) ?? []

    const internalSupply = outs.reduce((sum, s) => sum + s.rate, 0)
    const leaving =
      (targets[item] ?? 0) + (surplus.find((s) => s.item === item)?.rate ?? 0)
    const totalDemand = ins.reduce((sum, s) => sum + s.rate, 0) + leaving
    if (totalDemand <= 1e-9) continue

    // Anything the plan's own modules can't cover is mined or imported. Adding
    // it as another producer means every consumer gets a real source, instead
    // of the shortfall becoming one orphaned run.
    const imported = Math.max(0, totalDemand - internalSupply)
    const allProducers: Side[] =
      imported > 1e-9 ? [...outs, { moduleId: null, rate: imported }] : outs

    const totalSupply = internalSupply + imported
    if (totalSupply <= 1e-9) continue

    for (const producer of allProducers) {
      const share = producer.rate / totalSupply
      for (const consumer of ins) {
        push(item, consumer.rate * share, producer.moduleId, consumer.moduleId)
      }
      if (leaving > 1e-9) push(item, leaving * share, producer.moduleId, null)
    }
  }

  return routes
}

export const routeLabel = (route: Route) => {
  const name = items[route.item]?.name ?? route.item
  const unit = route.fluid ? 'm³/min' : '/min'
  return `${num(route.rate)}${unit} ${name}`
}
