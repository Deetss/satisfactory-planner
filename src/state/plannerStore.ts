import { create } from 'zustand'
import { gameData, recipes, resources } from '../data/gameData'
import type { Objective, PlanRequest } from '../solver/model'

export interface PlannerState {
  targets: Record<string, number>
  objective: Objective
  /** Highest unlocked tech tier; gates every non-alternate recipe. */
  tier: number
  /** Alternate recipes acquired from hard drives. */
  unlockedAlternates: string[]
  /** Per-resource extraction ceiling. Absent means the map-wide maximum. */
  resourceCaps: Record<string, number>
  /** When false, every item must balance exactly and byproducts must be sunk. */
  allowSurplus: boolean
  /** Generator classes the plan may build to power itself. */
  powerGenerators: string[]
  /** Machines you'd rather build per recipe, instead of the minimum. */
  machineOverrides: Record<string, number>

  setTarget: (item: string, rate: number) => void
  removeTarget: (item: string) => void
  setObjective: (objective: Objective) => void
  setTier: (tier: number) => void
  toggleAlternate: (recipe: string) => void
  setAlternates: (recipes: string[]) => void
  setResourceCap: (item: string, cap: number | null) => void
  setAllowSurplus: (allow: boolean) => void
  togglePowerGenerator: (generator: string) => void
  setMachineCount: (recipe: string, count: number | null) => void
  /** Replaces the whole plan, e.g. from an imported plan file. */
  loadSnapshot: (snapshot: unknown) => void
  reset: () => void
}

const DEFAULTS = {
  targets: {} as Record<string, number>,
  objective: 'resources' as Objective,
  tier: 8,
  unlockedAlternates: [] as string[],
  resourceCaps: {} as Record<string, number>,
  allowSurplus: true,
  powerGenerators: [] as string[],
  machineOverrides: {} as Record<string, number>,
}

const STORAGE_KEY = 'satisfactory-planner:v1'

export type PlannerSnapshot = typeof DEFAULTS
type Persisted = PlannerSnapshot

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Keeps only `{item: rate}` pairs with a usable rate. */
function numberMap(input: unknown): Record<string, number> {
  if (!isRecord(input)) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

const stringList = (input: unknown): string[] =>
  Array.isArray(input) ? input.filter((v): v is string => typeof v === 'string') : []

/**
 * Brings a plan from outside the app up to the current shape. Anything of the
 * wrong type is dropped rather than trusted: a hand-edited or stale file
 * shouldn't be able to put the solver into a state it can't describe.
 */
export function normalizePlan(input: unknown): Persisted {
  const p = isRecord(input) ? input : {}
  const tier = typeof p.tier === 'number' ? Math.round(p.tier) : DEFAULTS.tier

  return {
    targets: numberMap(p.targets),
    objective: (['resources', 'power', 'machines'] as Objective[]).includes(
      p.objective as Objective,
    )
      ? (p.objective as Objective)
      : DEFAULTS.objective,
    tier: Math.min(9, Math.max(0, tier)),
    unlockedAlternates: stringList(p.unlockedAlternates),
    resourceCaps: numberMap(p.resourceCaps),
    allowSurplus:
      typeof p.allowSurplus === 'boolean' ? p.allowSurplus : DEFAULTS.allowSurplus,
    powerGenerators: stringList(p.powerGenerators),
    machineOverrides: numberMap(p.machineOverrides),
  }
}

function readStorage(): Partial<Persisted> | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

/** Whatever was last open in this browser; a link then wins over it. */
const initial: Persisted = { ...DEFAULTS, ...readStorage() }

// The address bar is written by urlState, which is the only place that can see
// the layout as well as the plan. This store keeps the local copy.
function persist(state: Persisted) {
  if (typeof window === 'undefined') return
  const snapshot: Persisted = {
    targets: state.targets,
    objective: state.objective,
    tier: state.tier,
    unlockedAlternates: state.unlockedAlternates,
    resourceCaps: state.resourceCaps,
    allowSurplus: state.allowSurplus,
    powerGenerators: state.powerGenerators,
    machineOverrides: state.machineOverrides,
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // A full or blocked storage quota shouldn't break planning.
  }
}

export const usePlannerStore = create<PlannerState>((set, get) => {
  const commit = (patch: Partial<Persisted>) => {
    set(patch as Partial<PlannerState>)
    const s = get()
    persist({
      targets: s.targets,
      objective: s.objective,
      tier: s.tier,
      unlockedAlternates: s.unlockedAlternates,
      resourceCaps: s.resourceCaps,
      allowSurplus: s.allowSurplus,
      powerGenerators: s.powerGenerators,
      machineOverrides: s.machineOverrides,
      ...patch,
    })
  }

  return {
    ...initial,

    setTarget: (item, rate) =>
      commit({ targets: { ...get().targets, [item]: rate } }),

    removeTarget: (item) => {
      const { [item]: _removed, ...rest } = get().targets
      commit({ targets: rest })
    },

    setObjective: (objective) => commit({ objective }),

    setTier: (tier) => commit({ tier }),

    toggleAlternate: (recipe) => {
      const current = get().unlockedAlternates
      commit({
        unlockedAlternates: current.includes(recipe)
          ? current.filter((r) => r !== recipe)
          : [...current, recipe],
      })
    },

    setAlternates: (list) => commit({ unlockedAlternates: list }),

    setResourceCap: (item, cap) => {
      const next = { ...get().resourceCaps }
      if (cap === null) delete next[item]
      else next[item] = cap
      commit({ resourceCaps: next })
    },

    setAllowSurplus: (allowSurplus) => commit({ allowSurplus }),

    togglePowerGenerator: (generator) => {
      const current = get().powerGenerators
      commit({
        powerGenerators: current.includes(generator)
          ? current.filter((g) => g !== generator)
          : [...current, generator],
      })
    },

    setMachineCount: (recipe, count) => {
      const next = { ...get().machineOverrides }
      if (count === null || count < 1) delete next[recipe]
      else next[recipe] = Math.round(count)
      commit({ machineOverrides: next })
    },

    loadSnapshot: (snapshot) => commit(normalizePlan(snapshot)),

    reset: () => commit({ ...DEFAULTS }),
  }
})

/** Recipes needing a hand-fed input can't be part of an automated plan. */
const needsForagedInput = (recipeClass: string) =>
  recipes[recipeClass].ingredients.some(
    (i) => gameData.items[i.item]?.foraged === true,
  )

export function selectEnabledRecipes(state: PlannerState): Set<string> {
  const unlocked = new Set(state.unlockedAlternates)
  const enabled = new Set<string>()

  for (const recipe of Object.values(recipes)) {
    if (needsForagedInput(recipe.className)) continue

    const allowed = recipe.isAlternate
      ? unlocked.has(recipe.className)
      : (recipe.unlock?.tier ?? 0) <= state.tier

    if (allowed) enabled.add(recipe.className)
  }

  return enabled
}

export function selectPlanRequest(state: PlannerState): PlanRequest {
  return {
    targets: state.targets,
    enabledRecipes: selectEnabledRecipes(state),
    resourceCaps: state.resourceCaps,
    objective: state.objective,
    // Water is unlimited and free, so leaving it unbalanced is never a
    // planning mistake worth blocking on.
    allowSurplus: state.allowSurplus
      ? () => true
      : (item) => item === 'Desc_Water_C',
    machineOverrides: state.machineOverrides,
    powerGeneration:
      state.powerGenerators.length > 0
        ? { generators: state.powerGenerators }
        : null,
  }
}

export const resourceList = Object.values(resources).sort((a, b) =>
  a.name.localeCompare(b.name),
)
