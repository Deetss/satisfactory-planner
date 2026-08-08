import {
  gameData,
  generators as allGenerators,
  recipes as allRecipes,
  resources as allResources,
} from '../data/gameData'
import type { Constraint, LpProblem, Term } from './lp'
import { VariableRegistry } from './lp'

export type Objective = 'resources' | 'power' | 'machines'

export interface PlanRequest {
  /** Desired output rate per item, in items/min (m3/min for fluids). */
  targets: Record<string, number>
  /** Recipe class names the plan is allowed to use. */
  enabledRecipes: Set<string>
  /** Extraction ceiling per resource item, in items/min. Missing = map max. */
  resourceCaps: Record<string, number>
  objective: Objective
  /**
   * Items permitted to end up as unconsumed surplus. Anything not listed must
   * balance exactly, which forces the solver to sink byproducts properly.
   */
  allowSurplus: (item: string) => boolean
  /**
   * When set, the plan must generate at least as much power as it draws,
   * using only these generator classes. Fuel and cooling water for them
   * become part of the same optimization.
   */
  powerGeneration: { generators: string[] } | null
  /**
   * Machines you'd rather build for a given recipe, instead of the smallest
   * whole number that covers the throughput. Fewer means overclocking, more
   * means underclocking. This never changes the solve, only how the solved
   * throughput is spread across machines.
   */
  machineOverrides?: Record<string, number>
  /**
   * When set, ignore these items' fixed targets and instead scale them all by
   * one shared factor pushed as high as the resource limits allow. The value is
   * each item's share of that factor.
   *
   * `{ plate: 1 }` maximizes plate alone. `{ a: 10, b: 100 }` keeps a 10:100
   * ratio while filling the limits. `{ a: 1, b: 1 }` splits them evenly.
   */
  maximize?: Record<string, number> | null
}

export type VarMeta =
  | { kind: 'recipe'; recipe: string }
  | { kind: 'extract'; item: string }
  | { kind: 'surplus'; item: string }
  | { kind: 'generator'; generator: string; fuel: string }
  | { kind: 'maximized'; items: Record<string, number> }

export interface BuiltModel {
  problem: LpProblem
  registry: VariableRegistry<VarMeta>
  /** Items that got a balance constraint, in constraint order. */
  balanceItems: string[]
}

/**
 * Breaks ties between equally-optimal recipe mixes by mildly preferring fewer
 * machines. Without it the solver returns an arbitrary vertex and small input
 * changes make the whole plan reshuffle.
 */
const TIE_BREAK_WEIGHT = 1e-4

export function buildModel(request: PlanRequest): BuiltModel {
  const registry = new VariableRegistry<VarMeta>()

  const usableRecipes = [...request.enabledRecipes]
    .map((c) => allRecipes[c])
    .filter((r) => r !== undefined)

  // item -> terms contributing to its balance row
  const balance = new Map<string, Term[]>()
  const touch = (item: string) => {
    let terms = balance.get(item)
    if (!terms) {
      terms = []
      balance.set(item, terms)
    }
    return terms
  }

  const objective: Term[] = []

  // --- recipe variables: one unit = one machine running at 100% clock
  for (const recipe of usableRecipes) {
    const v = registry.add({ kind: 'recipe', recipe: recipe.className }, 'r')

    for (const p of recipe.products) {
      touch(p.item).push({ variable: v, coefficient: p.rate })
    }
    for (const i of recipe.ingredients) {
      touch(i.item).push({ variable: v, coefficient: -i.rate })
    }

    if (request.objective === 'power') {
      objective.push({ variable: v, coefficient: recipe.power })
    } else if (request.objective === 'machines') {
      objective.push({ variable: v, coefficient: 1 })
    } else {
      objective.push({ variable: v, coefficient: TIE_BREAK_WEIGHT })
    }
  }

  // --- generator variables: one unit = one generator at 100%
  const generatorVars: string[] = []
  if (request.powerGeneration) {
    for (const genClass of request.powerGeneration.generators) {
      const gen = allGenerators[genClass]
      if (!gen) continue

      for (const fuel of gen.fuels) {
        // A generator burning a foraged fuel can't be part of an automated
        // plan, so those combinations are skipped.
        if (gameData.items[fuel.item]?.foraged) continue

        const v = registry.add(
          { kind: 'generator', generator: genClass, fuel: fuel.item },
          'g',
        )
        generatorVars.push(v)

        touch(fuel.item).push({ variable: v, coefficient: -fuel.rate })
        if (gen.supplemental) {
          touch(gen.supplemental.item).push({
            variable: v,
            coefficient: -gen.supplemental.rate,
          })
        }
        if (fuel.byproduct) {
          touch(fuel.byproduct.item).push({
            variable: v,
            coefficient: fuel.byproduct.rate,
          })
        }

        if (request.objective === 'machines') {
          objective.push({ variable: v, coefficient: 1 })
        } else {
          objective.push({ variable: v, coefficient: TIE_BREAK_WEIGHT })
        }
      }
    }
  }

  // --- raw extraction variables
  const upperBounds: Record<string, number> = {}
  for (const resource of Object.values(allResources)) {
    // Only model extraction for resources this plan can actually touch.
    if (!balance.has(resource.item) && !request.targets[resource.item]) continue

    const v = registry.add({ kind: 'extract', item: resource.item }, 'e')
    touch(resource.item).push({ variable: v, coefficient: 1 })

    const cap = request.resourceCaps[resource.item] ?? resource.maxExtraction
    if (cap !== null && cap !== undefined && Number.isFinite(cap)) {
      upperBounds[v] = cap
    }

    if (request.objective === 'resources') {
      objective.push({ variable: v, coefficient: resource.weight })
    }
  }

  // --- surplus slack, so byproducts don't make the plan infeasible
  for (const item of [...balance.keys()]) {
    if (!request.allowSurplus(item)) continue
    const v = registry.add({ kind: 'surplus', item }, 's')
    touch(item).push({ variable: v, coefficient: -1 })
  }

  // --- items being maximized draw off one shared free variable instead of a
  // fixed target, so their whole mix scales together against the limits
  const maximizing = request.maximize ?? null
  const maximizedItems = maximizing ? Object.keys(maximizing) : []
  let maximizedVar: string | null = null
  if (maximizing && maximizedItems.length > 0) {
    maximizedVar = registry.add({ kind: 'maximized', items: maximizing }, 'm')
    for (const [item, share] of Object.entries(maximizing)) {
      if (share <= 0) continue
      touch(item).push({ variable: maximizedVar, coefficient: -share })
    }
  }

  // --- balance rows: production - consumption - surplus == requested output
  const constraints: Constraint[] = []
  const balanceItems: string[] = []
  let rowIndex = 0

  for (const [item, terms] of balance) {
    constraints.push({
      name: `bal${rowIndex++}`,
      terms,
      sense: '=',
      // A maximized item has no fixed target; its output is the variable.
      rhs: maximizing && item in maximizing ? 0 : (request.targets[item] ?? 0),
    })
    balanceItems.push(item)
  }

  // A target for something with no recipe and no extractor would silently
  // vanish, so give it a row that makes the model infeasible instead.
  for (const [item, rate] of Object.entries(request.targets)) {
    if (rate === 0 || balance.has(item)) continue
    constraints.push({
      name: `bal${rowIndex++}`,
      terms: [],
      sense: '=',
      rhs: rate,
    })
    balanceItems.push(item)
  }

  // --- power balance: generators must cover total machine draw
  if (request.powerGeneration && generatorVars.length > 0) {
    const terms: Term[] = []
    for (const [id, meta] of registry.entries()) {
      if (meta.kind === 'recipe') {
        terms.push({
          variable: id,
          coefficient: -allRecipes[meta.recipe].power,
        })
      } else if (meta.kind === 'generator') {
        terms.push({
          variable: id,
          coefficient: allGenerators[meta.generator].power,
        })
      }
    }
    constraints.push({ name: 'power', terms, sense: '>=', rhs: 0 })
  }

  // Maximizing output replaces the cost objective entirely. The small machine
  // penalty keeps it from padding the build with pointless extra machines that
  // don't raise output.
  if (maximizedVar) {
    const maxObjective: Term[] = [{ variable: maximizedVar, coefficient: 1 }]
    for (const [id, meta] of registry.entries()) {
      if (meta.kind === 'recipe' || meta.kind === 'generator') {
        maxObjective.push({ variable: id, coefficient: -TIE_BREAK_WEIGHT })
      }
    }
    return {
      problem: {
        direction: 'max',
        objective: maxObjective,
        constraints,
        upperBounds,
      },
      registry,
      balanceItems,
    }
  }

  return {
    problem: { direction: 'min', objective, constraints, upperBounds },
    registry,
    balanceItems,
  }
}
