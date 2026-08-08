import highsLoader from 'highs'
import wasmUrl from 'highs/runtime?url'
import { resources as allResources } from '../data/gameData'
import {
  emptyResult,
  interpretSolution,
  type ColumnValues,
  type Diagnosis,
  type PlanResult,
  type Shortfall,
} from './interpret'
import { toLpFormat } from './lp'
import { cleanRate } from './rates'
import { buildModel, type PlanRequest } from './model'

type Highs = Awaited<ReturnType<typeof highsLoader>>

let highsPromise: Promise<Highs> | null = null

function loadSolver(): Promise<Highs> {
  // The WASM binary is fetched once and shared by every solve.
  highsPromise ??= highsLoader({ locateFile: () => wasmUrl })
  return highsPromise
}

export async function solvePlan(request: PlanRequest): Promise<PlanResult> {
  const { problem, registry } = buildModel(request)
  const lp = toLpFormat(problem)

  if (!Object.values(request.targets).some((v) => v > 0)) return emptyResult(lp)

  let solution
  try {
    const highs = await loadSolver()
    solution = highs.solve(lp, { output_flag: false, log_to_console: false })
  } catch (error) {
    return {
      ...emptyResult(lp),
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }

  if (solution.Status !== 'Optimal') {
    if (solution.Status !== 'Infeasible') {
      return {
        ...emptyResult(lp),
        status: 'error',
        message: `Solver returned: ${solution.Status}`,
      }
    }
    const diagnosis = await diagnoseInfeasible(request)
    return {
      ...emptyResult(lp),
      status: 'infeasible',
      message: diagnosis.message,
      diagnosis,
    }
  }

  const columns: ColumnValues = {}
  for (const [id, column] of Object.entries(solution.Columns)) {
    columns[id] = 'Primal' in column ? (column.Primal ?? 0) : 0
  }

  return interpretSolution(
    request,
    registry,
    columns,
    solution.ObjectiveValue,
    lp,
  )
}

const RATE_EPSILON = 1e-6

/** Smallest rate worth planning for: one item a minute. */
export const MIN_VIABLE_RATE = 1

/**
 * The floor: what it costs to produce every selected item at the slowest
 * meaningful rate. Answers "what do I need before I can even attempt this?",
 * without disturbing the real targets.
 */
export async function solveMinimumFloor(
  request: PlanRequest,
): Promise<PlanResult> {
  const targets: Record<string, number> = {}
  for (const [item, rate] of Object.entries(request.targets)) {
    if (rate > 0) targets[item] = MIN_VIABLE_RATE
  }
  if (Object.keys(targets).length === 0) return emptyResult('')

  return solvePlan({ ...request, targets })
}

/**
 * Gives every product an equal share of each resource limit, then maximizes
 * each one inside its own allowance.
 *
 * This is different from an even split of *output*: sharing the ore equally
 * gives more of whatever is cheaper to make, whereas equal output rates make
 * the expensive product consume more of the budget.
 */
export async function solveEvenResourceSplit(
  request: PlanRequest,
  items: string[],
): Promise<Record<string, number> | null> {
  if (items.length === 0) return null

  const share = 1 / items.length
  const dividedCaps: Record<string, number> = {}
  for (const [item, resource] of Object.entries(allResources)) {
    const effective = request.resourceCaps[item] ?? resource.maxExtraction
    if (effective !== null && Number.isFinite(effective)) {
      dividedCaps[item] = effective * share
    }
  }

  // Each product is solved on its own so its consumption is unambiguous;
  // shared intermediates would otherwise make attribution arbitrary.
  const rates: Record<string, number> = {}
  for (const item of items) {
    const isolated: Record<string, number> = {}
    for (const other of items) isolated[other] = 0

    const solved = await solveBalanced(
      { ...request, targets: isolated, resourceCaps: dividedCaps },
      { [item]: 1 },
    )
    rates[item] = solved?.[item] ?? 0
  }

  return rates
}

/**
 * Works out why a plan is infeasible. Re-solves with every extraction ceiling
 * lifted: if that succeeds, the limits were the problem and the solved
 * extraction rates are the minimum the target actually needs. If it still
 * fails, the recipe set can't reach the target at all.
 */
export async function diagnoseInfeasible(
  request: PlanRequest,
): Promise<Diagnosis> {
  const uncapped: Record<string, number> = {}
  for (const item of Object.keys(allResources)) {
    uncapped[item] = Number.POSITIVE_INFINITY
  }

  const { problem, registry } = buildModel({
    ...request,
    resourceCaps: uncapped,
  })

  let solution
  try {
    const highs = await loadSolver()
    solution = highs.solve(toLpFormat(problem), {
      output_flag: false,
      log_to_console: false,
    })
  } catch {
    return {
      kind: 'unknown',
      shortfalls: [],
      message: 'That target is unreachable and the cause could not be determined.',
    }
  }

  if (solution.Status !== 'Optimal') {
    return {
      kind: 'recipes',
      shortfalls: [],
      message:
        'No combination of your unlocked recipes can make that, even with unlimited resources. ' +
        'Raise the tech tier or enable the alternate recipes it needs.',
    }
  }

  const shortfalls: Shortfall[] = []
  for (const [id, meta] of registry.entries()) {
    if (meta.kind !== 'extract') continue
    const column = solution.Columns[id]
    const required = cleanRate(
      column && 'Primal' in column ? (column.Primal ?? 0) : 0,
    )
    if (required <= RATE_EPSILON) continue

    const userCap = request.resourceCaps[meta.item]
    const mapMax = allResources[meta.item]?.maxExtraction
    const limit =
      userCap !== undefined && Number.isFinite(userCap)
        ? userCap
        : (mapMax ?? Number.POSITIVE_INFINITY)

    if (required > limit + RATE_EPSILON) {
      shortfalls.push({
        item: meta.item,
        required,
        limit,
        mapLimited: userCap === undefined || !Number.isFinite(userCap),
      })
    }
  }

  shortfalls.sort((a, b) => b.required / b.limit - a.required / a.limit)

  if (shortfalls.length === 0) {
    return {
      kind: 'unknown',
      shortfalls: [],
      message:
        'That target is unreachable. Byproducts may have nowhere to go. Try ' +
        'allowing surplus.',
    }
  }

  return {
    kind: 'limits',
    shortfalls,
    message: `Not enough ${shortfalls.length === 1 ? 'of one resource' : `${shortfalls.length} resources`} to hit that target.`,
  }
}

/**
 * Highest output rate of `item` the current recipes and resource caps allow.
 * Returns null when the model can't be solved.
 */
export async function solveMaxRate(
  request: PlanRequest,
  item: string,
): Promise<number | null> {
  const rates = await solveBalanced(request, { [item]: 1 })
  return rates ? (rates[item] ?? null) : null
}

/**
 * Scales a whole mix of items up together until the resource limits bind, and
 * returns the rate each one lands on.
 *
 * `shares` sets the mix: pass the current targets to keep their ratios, or 1
 * for every item to divide the limits evenly between them.
 */
export async function solveBalanced(
  request: PlanRequest,
  shares: Record<string, number>,
): Promise<Record<string, number> | null> {
  const live = Object.entries(shares).filter(([, share]) => share > 0)
  if (live.length === 0) return null

  const zeroed: Record<string, number> = { ...request.targets }
  for (const [item] of live) zeroed[item] = 0

  const { problem, registry } = buildModel({
    ...request,
    targets: zeroed,
    maximize: Object.fromEntries(live),
  })

  let solution
  try {
    const highs = await loadSolver()
    solution = highs.solve(toLpFormat(problem), {
      output_flag: false,
      log_to_console: false,
    })
  } catch {
    return null
  }

  if (solution.Status !== 'Optimal') return null

  for (const [id, meta] of registry.entries()) {
    if (meta.kind !== 'maximized') continue
    const column = solution.Columns[id]
    const factor = column && 'Primal' in column ? (column.Primal ?? 0) : 0

    const rates: Record<string, number> = {}
    for (const [item, share] of Object.entries(meta.items)) {
      rates[item] = cleanRate(share * factor)
    }
    return rates
  }
  return null
}
