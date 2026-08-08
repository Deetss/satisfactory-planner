import raw from './game-data.json' with { type: 'json' }

export type ItemForm = 'solid' | 'liquid' | 'gas'

export interface Item {
  className: string
  name: string
  form: ItemForm
  isResource: boolean
  energy: number
  sinkPoints: number
  /** Units per inventory slot; null when the item can't be stacked. */
  stackSize: number | null
  foraged: boolean
  /** Icon file stem, imported separately from the player's own game install. */
  icon: string | null
}

export interface RecipeEntry {
  item: string
  amount: number
  /** Items (or m3) per minute for one machine at 100% clock. */
  rate: number
}

export type UnlockKind =
  | 'milestone'
  | 'mam'
  | 'alternate'
  | 'awesome-shop'
  | 'onboarding'
  | 'custom'

export interface Unlock {
  kind: UnlockKind
  tier: number
  schematic: string
  schematicName: string
}

export interface Recipe {
  className: string
  name: string
  building: string
  duration: number
  ingredients: RecipeEntry[]
  products: RecipeEntry[]
  /** MW for one machine at 100% clock; mean draw for variable-power machines. */
  power: number
  powerRange: { min: number; max: number } | null
  isAlternate: boolean
  unlock: Unlock | null
}

/** Placement footprint in metres, from the building's clearance boxes. */
export interface Footprint {
  width: number
  depth: number
  height: number
}

export interface Building {
  className: string
  name: string
  power: number
  powerExponent: number
  variablePower: boolean
  footprint: Footprint | null
  /** Tech tier that unlocks it; null if no schematic grants it. */
  unlockTier: number | null
  /** Icon file stem, imported separately. */
  icon: string | null
}

export interface GeneratorFuel {
  item: string
  rate: number
  byproduct: { item: string; rate: number } | null
}

export interface Generator {
  className: string
  name: string
  power: number
  supplemental: { item: string; rate: number } | null
  fuels: GeneratorFuel[]
  footprint: Footprint | null
  /** Tech tier that unlocks it; null if no schematic grants it. */
  unlockTier: number | null
  /** Icon file stem, imported separately. */
  icon: string | null
}

export interface Resource {
  item: string
  name: string
  form: ItemForm
  /** Map-wide max extraction per minute; null means effectively unlimited. */
  maxExtraction: number | null
  /** Scarcity multiplier, 1.0 for the most plentiful ore, 0 for water. */
  weight: number
}

export interface Belt {
  className: string
  name: string
  itemsPerMinute: number
  unlockTier: number
  /** Icon file stem, imported separately. */
  icon: string | null
}

export interface Pipe {
  className: string
  name: string
  cubicMetersPerMinute: number
  unlockTier: number
  /** Icon file stem, imported separately. */
  icon: string | null
}

export interface SolidStorage {
  className: string
  name: string
  /** Inventory slots; capacity is slots x the item's stack size. */
  slots: number
  footprint: Footprint | null
  unlockTier: number | null
  /** Icon file stem, imported separately. */
  icon: string | null
}

export interface FluidStorage {
  className: string
  name: string
  /** m3 held, regardless of fluid. */
  capacity: number
  footprint: Footprint | null
  unlockTier: number | null
  /** Icon file stem, imported separately. */
  icon: string | null
}

export interface Extractor {
  className: string
  name: string
  /** Rate on a normal-purity node at 100% clock. */
  ratePerMinute: number
  fluid: boolean
  /** False for the Water Extractor, which sits on open water, not a node. */
  nodeBased: boolean
  /** True for satellite extractors on a resource well. */
  well: boolean
  unlockTier: number | null
  /** Icon file stem, imported separately. */
  icon: string | null
}

export interface GameData {
  meta: {
    generatedFrom: string
    gameVersion: string | null
    counts: Record<string, number>
  }
  items: Record<string, Item>
  recipes: Record<string, Recipe>
  buildings: Record<string, Building>
  generators: Record<string, Generator>
  transport: { belts: Belt[]; pipes: Pipe[] }
  storage: { solid: SolidStorage[]; fluid: FluidStorage[] }
  extractors: Extractor[]
  resources: Record<string, Resource>
  /**
   * Space Elevator phases and what each one wants delivered. Absent from data
   * extracted before this was pulled out of the game's docs, so every reader
   * has to cope with it being missing.
   */
  spaceElevator?: ElevatorPhase[]
  producedBy: Record<string, string[]>
  consumedBy: Record<string, string[]>
}

export interface ElevatorPhase {
  schematic: string
  name: string
  tier: number
  /** Total units to deliver, not a rate. */
  parts: { item: string; amount: number }[]
}

export const gameData = raw as unknown as GameData

/** Every item the Space Elevator takes, phase data or not. */
export const ELEVATOR_PARTS = Object.keys(
  (raw as unknown as GameData).items,
).filter((className) => /^Desc_SpaceElevatorPart_/.test(className))

export const elevatorPhases = (): ElevatorPhase[] =>
  gameData.spaceElevator ?? []

export const items = gameData.items
export const recipes = gameData.recipes
export const buildings = gameData.buildings
export const generators = gameData.generators
export const resources = gameData.resources

export const itemName = (className: string) =>
  items[className]?.name ?? className

export const isFluid = (className: string) =>
  items[className] !== undefined && items[className].form !== 'solid'

/** Items/min for solids, m3/min for fluids. */
export const rateUnit = (className: string) =>
  isFluid(className) ? 'm³/min' : '/min'

/** Unit suffix with a leading space where one reads better. */
export const rateSuffix = (className: string) =>
  isFluid(className) ? ' m³/min' : '/min'

export const MAX_TIER = Math.max(
  0,
  ...Object.values(recipes).map((r) => r.unlock?.tier ?? 0),
)

/**
 * Recipes that produce an item, ordered so the standard recipe comes before
 * alternates.
 */
export function recipesProducing(item: string): Recipe[] {
  return (gameData.producedBy[item] ?? [])
    .map((c) => recipes[c])
    .filter((r): r is Recipe => r !== undefined)
    .sort((a, b) => Number(a.isAlternate) - Number(b.isAlternate))
}

/** Items that can be a planner target: anything an automated recipe makes. */
export const producibleItems = Object.keys(items)
  .filter((i) => (gameData.producedBy[i] ?? []).some((c) => recipes[c]))
  .sort((a, b) => itemName(a).localeCompare(itemName(b)))
