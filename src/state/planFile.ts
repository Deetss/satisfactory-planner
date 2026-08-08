/**
 * Save file for a whole plan: what to build, and where it goes.
 *
 * Both stores travel together, because a layout on its own is meaningless:
 * its placements reference blocks that only exist once the plan is solved.
 */

import { gameData, recipes } from '../data/gameData'
import { normalizeLayout, useLayoutStore } from '../layout/layoutStore'
import type { LayoutState } from '../layout/types'
import {
  normalizePlan,
  usePlannerStore,
  type PlannerSnapshot,
} from './plannerStore'

/** Bump only for a change old files can't be read through. */
export const PLAN_FILE_VERSION = 1

const KIND = 'satisfactory-planner'

export interface PlanFile {
  kind: typeof KIND
  version: number
  savedAt: string
  /** Free-text name, defaulting to whatever the plan produces. */
  name: string
  plan: PlannerSnapshot
  layout: LayoutState
}

/** What the plan is for, in a filename-friendly form. */
export function planName(targets: Record<string, number>): string {
  const names = Object.keys(targets).map(
    (item) => gameData.items[item]?.name ?? item,
  )
  if (names.length === 0) return 'empty plan'
  if (names.length <= 2) return names.join(' + ')
  return `${names[0]} +${names.length - 1} more`
}

export function buildPlanFile(savedAt: string): PlanFile {
  const planner = usePlannerStore.getState()
  const layout = useLayoutStore.getState()

  return {
    kind: KIND,
    version: PLAN_FILE_VERSION,
    savedAt,
    name: planName(planner.targets),
    plan: {
      targets: planner.targets,
      objective: planner.objective,
      tier: planner.tier,
      unlockedAlternates: planner.unlockedAlternates,
      resourceCaps: planner.resourceCaps,
      allowSurplus: planner.allowSurplus,
      powerGenerators: planner.powerGenerators,
      machineOverrides: planner.machineOverrides,
    },
    layout: {
      floors: layout.floors,
      activeFloorId: layout.activeFloorId,
      placements: layout.placements,
      snapMetres: layout.snapMetres,
      reserves: layout.reserves,
      manualLinks: layout.manualLinks,
      routeOverrides: layout.routeOverrides,
      fittings: layout.fittings,
    },
  }
}

export interface ImportReport {
  name: string
  floors: number
  placements: number
  /** Anything dropped on the way in, so nothing goes missing quietly. */
  warnings: string[]
}

/**
 * Loads a plan into both stores, whatever it arrived as.
 *
 * Content that's merely stale (an item or recipe this build doesn't know) is
 * dropped and reported, since a game update shouldn't make old plans
 * unopenable.
 */
export function applyPlan(file: Partial<PlanFile>): ImportReport {
  const plan = normalizePlan(file.plan)
  const warnings: string[] = []

  const unknownTargets = Object.keys(plan.targets).filter(
    (item) => !gameData.items[item],
  )
  for (const item of unknownTargets) delete plan.targets[item]

  const unknownCaps = Object.keys(plan.resourceCaps).filter(
    (item) => !gameData.items[item],
  )
  for (const item of unknownCaps) delete plan.resourceCaps[item]

  const unknownRecipes = plan.unlockedAlternates.filter((r) => !recipes[r])
  plan.unlockedAlternates = plan.unlockedAlternates.filter((r) => recipes[r])

  const unknownOverrides = Object.keys(plan.machineOverrides).filter(
    (r) => !recipes[r],
  )
  for (const recipe of unknownOverrides) delete plan.machineOverrides[recipe]

  const dropped = [
    [unknownTargets.length, 'target'],
    [unknownCaps.length, 'resource limit'],
    [unknownRecipes.length, 'alternate recipe'],
    [unknownOverrides.length, 'machine count'],
  ] as const
  for (const [count, label] of dropped) {
    if (count > 0) {
      warnings.push(`${count} unknown ${label}${count === 1 ? '' : 's'} dropped`)
    }
  }

  const layout = normalizeLayout(file.layout)

  // Placements for blocks the plan no longer produces are kept rather than
  // pruned: the plan is re-solved on load, and a block that comes back should
  // land where it was left.
  usePlannerStore.getState().loadSnapshot(plan)
  useLayoutStore.getState().loadSnapshot(layout)

  return {
    name: typeof file.name === 'string' ? file.name : planName(plan.targets),
    floors: layout.floors.length,
    placements: Object.keys(layout.placements).length,
    warnings,
  }
}

/**
 * Reads an exported file. Structurally wrong input throws with a message worth
 * showing, rather than loading half a plan.
 */
export function applyPlanFile(text: string): ImportReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("That isn't valid JSON. Pick a file this app exported.")
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected a plan file, got a bare value.')
  }

  const file = parsed as Partial<PlanFile>
  if (file.kind !== KIND) {
    throw new Error(
      `Not a Factory Planner file${file.kind ? ` (kind: ${String(file.kind)})` : ''}.`,
    )
  }
  if (typeof file.version !== 'number' || file.version > PLAN_FILE_VERSION) {
    throw new Error(
      `Saved by a newer version of the planner (file v${String(
        file.version,
      )}, this build reads v${PLAN_FILE_VERSION}).`,
    )
  }

  return applyPlan(file)
}

/** Filesystem-safe stem for the download, without an extension. */
export function planFileStem(name: string, savedAt: string): string {
  const day = savedAt.slice(0, 10)
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'plan'
  return `${day}-${slug}`
}
