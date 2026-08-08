// Turns the game's own Docs export into the normalized dataset the planner uses.
// Usage: node scripts/extract-game-data.mjs [path-to-en-US.json]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const OUT = path.join(ROOT, 'src/data/game-data.json')

const DEFAULT_DOCS = [
  '/mnt/d/SteamLibrary/steamapps/common/Satisfactory/CommunityResources/Docs/en-US.json',
  '/mnt/c/Program Files (x86)/Steam/steamapps/common/Satisfactory/CommunityResources/Docs/en-US.json',
  '/mnt/c/Program Files/Epic Games/SatisfactoryExperimental/CommunityResources/Docs/en-US.json',
]

// Fluid and gas quantities are stored in cm3; recipes read in m3.
const FLUID_SCALE = 1000

// Stack sizes ship as an enum rather than a number.
const STACK_SIZES = {
  SS_ONE: 1,
  SS_SMALL: 50,
  SS_MEDIUM: 100,
  SS_BIG: 200,
  SS_HUGE: 500,
  // Fluids are held in buffers by volume, not in inventory slots.
  SS_FLUID: 50,
}

const MANUFACTURER_CLASSES = new Set([
  'FGBuildableManufacturer',
  'FGBuildableManufacturerVariablePower',
])

// Max extraction across the whole map, from the wiki's resource tables
// (Mk.3 miners / pressurizers at 250%). Drives the scarcity weights the
// optimizer uses when it has to choose between raw inputs.
const MAX_EXTRACTION = {
  Desc_OreIron_C: 92100,
  Desc_Stone_C: 69300,
  Desc_Coal_C: 42300,
  Desc_OreCopper_C: 36900,
  Desc_OreGold_C: 15000,
  Desc_RawQuartz_C: 13500,
  Desc_OreBauxite_C: 12300,
  Desc_LiquidOil_C: 12600,
  Desc_NitrogenGas_C: 12000,
  Desc_Sulfur_C: 10800,
  Desc_SAM_C: 10200,
  Desc_OreUranium_C: 2100,
  Desc_Water_C: Number.POSITIVE_INFINITY,
}

function findDocs() {
  const explicit = process.argv[2]
  const candidates = explicit ? [explicit] : DEFAULT_DOCS
  for (const c of candidates) if (fs.existsSync(c)) return c
  throw new Error(
    `Could not find the game's Docs export. Pass the path to en-US.json:\n` +
      `  node scripts/extract-game-data.mjs "<Satisfactory>/CommunityResources/Docs/en-US.json"`,
  )
}

function readDocs(file) {
  const buf = fs.readFileSync(file)
  // The game ships this file as UTF-16LE with a BOM.
  const utf16 = buf.length > 1 && buf[0] === 0xff && buf[1] === 0xfe
  const text = utf16 ? buf.toString('utf16le') : buf.toString('utf8')
  return JSON.parse(text.replace(/^﻿/, ''))
}

function shortClass(nativeClass) {
  const m = /\.(\w+)'?$/.exec(nativeClass)
  return m ? m[1] : nativeClass
}

/** `Desc_IronPlate_C` out of a fully-qualified Unreal object path. */
function classOf(ref) {
  if (typeof ref !== 'string' || ref.trim() === '') return null
  const m = /([\w-]+)_C['"]?\s*$/.exec(ref.trim())
  return m ? `${m[1]}_C` : null
}

/**
 * Parses `((ItemClass="...",Amount=1),(ItemClass="...",Amount=2))` into
 * [{ item, amount }]. Amounts stay raw here; fluid scaling needs the item
 * forms, which aren't known until items are indexed.
 */
function parseItemAmounts(raw) {
  if (!raw) return []
  const out = []
  const re = /ItemClass\s*=\s*"?([^"]+?)"?\s*,\s*Amount\s*=\s*([\d.]+)/g
  let m
  while ((m = re.exec(raw)) !== null) {
    const item = classOf(m[1])
    if (!item) continue
    out.push({ item, amount: Number(m[2]) })
  }
  return out
}

/** Parses `("/path/A.A_C","/path/B.B_C")` into short class names. */
function parseClassList(raw) {
  if (!raw) return []
  const out = []
  const re = /"([^"]+)"/g
  let m
  while ((m = re.exec(raw)) !== null) {
    const c = classOf(m[1])
    if (c) out.push(c)
  }
  // Some entries are bare paths with no quotes.
  if (out.length === 0) {
    for (const part of raw.split(',')) {
      const c = classOf(part.replace(/[()"]/g, ''))
      if (c) out.push(c)
    }
  }
  return out
}

const num = (v) => (v === undefined || v === '' ? 0 : Number(v))

/**
 * Icon file stem from a Texture2D reference, e.g.
 * `Texture2D /Game/.../UI/IconDesc_IronPlates_256.IconDesc_IronPlates_256`
 * becomes `IconDesc_IronPlates_256`.
 *
 * These can't be derived from the class name: Desc_IronPlate_C's icon is
 * IconDesc_IronPlate*s*_256.
 */
function iconStem(ref) {
  if (typeof ref !== 'string' || ref.trim() === '') return null
  const path = ref.trim().split(/\s+/).pop() ?? ''
  const afterDot = path.includes('.') ? path.split('.').pop() : path.split('/').pop()
  return afterDot && afterDot !== '' ? afterDot : null
}

/** Splits `(a,b),(c,d)` into top-level chunks, ignoring nested commas. */
function splitTopLevel(raw) {
  const inner = raw.trim().replace(/^\(/, '').replace(/\)$/, '')
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i))
      start = i + 1
    }
  }
  parts.push(inner.slice(start))
  return parts.filter((p) => p.trim() !== '')
}

function vec(raw, key) {
  const m = new RegExp(
    `${key}=\\(X=(-?[\\d.eE+]+),Y=(-?[\\d.eE+]+),Z=(-?[\\d.eE+]+)(?:,W=(-?[\\d.eE+]+))?\\)`,
  ).exec(raw)
  if (!m) return null
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]), w: Number(m[4] ?? 0) }
}

/** Rotates a vector by a quaternion: v + 2w(q x v) + 2(q x (q x v)). */
function rotate(q, v) {
  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  })
  const t = cross(q, v)
  const t2 = { x: t.x * 2, y: t.y * 2, z: t.z * 2 }
  const c2 = cross(q, t2)
  return {
    x: v.x + q.w * t2.x + c2.x,
    y: v.y + q.w * t2.y + c2.y,
    z: v.z + q.w * t2.z + c2.z,
  }
}

/**
 * Footprint in metres from mClearanceData.
 *
 * Width and depth come only from the snapping boxes: boxes flagged
 * ExcludeForSnapping are volumes that don't block placement, and counting them
 * inflates the ground area a machine actually needs.
 *
 * Height is the opposite case. A machine's upper body is often a separate
 * non-snapping box. The Assembler's is, so excluding it reported 3 m for a
 * machine that needs 8 m of headroom. Only CT_Soft boxes are skipped, which are
 * the belt-port markers floating above the roof rather than the machine.
 */
function parseFootprint(raw) {
  if (!raw) return null

  let min = { x: Infinity, y: Infinity }
  let max = { x: -Infinity, y: -Infinity }
  let minZ = Infinity
  let maxZ = -Infinity
  let used = 0

  for (const entry of splitTopLevel(raw)) {
    const excluded = /ExcludeForSnapping=True/i.test(entry)
    const soft = /Type=CT_Soft/i.test(entry)
    if (excluded && soft) continue

    const boxMin = vec(entry, 'Min')
    const boxMax = vec(entry, 'Max')
    if (!boxMin || !boxMax) continue

    const transform = /RelativeTransform=\((.*)\)/s.exec(entry)?.[1] ?? ''
    const rotation = vec(transform, 'Rotation')
    const translation = vec(transform, 'Translation') ?? { x: 0, y: 0, z: 0 }

    for (const cx of [boxMin.x, boxMax.x]) {
      for (const cy of [boxMin.y, boxMax.y]) {
        for (const cz of [boxMin.z, boxMax.z]) {
          let corner = { x: cx, y: cy, z: cz }
          if (rotation) corner = rotate(rotation, corner)
          corner = {
            x: corner.x + translation.x,
            y: corner.y + translation.y,
            z: corner.z + translation.z,
          }
          minZ = Math.min(minZ, corner.z)
          maxZ = Math.max(maxZ, corner.z)
          if (soft || excluded) continue

          min = {
            x: Math.min(min.x, corner.x),
            y: Math.min(min.y, corner.y),
          }
          max = {
            x: Math.max(max.x, corner.x),
            y: Math.max(max.y, corner.y),
          }
          used++
        }
      }
    }
  }

  if (used === 0) return null

  const round = (v) => Math.round((v / 100) * 100) / 100
  return {
    width: round(max.x - min.x),
    depth: round(max.y - min.y),
    height: round(maxZ - minZ),
  }
}

const docs = readDocs(findDocs())
const byNative = new Map()
for (const group of docs) {
  const key = shortClass(group.NativeClass)
  byNative.set(key, (byNative.get(key) ?? []).concat(group.Classes))
}

// ---------------------------------------------------------------- items

const items = {}
const resourceClasses = new Set()

for (const [native, classes] of byNative) {
  const isDescriptor =
    native === 'FGItemDescriptor' ||
    native === 'FGResourceDescriptor' ||
    native === 'FGItemDescriptorBiomass' ||
    native === 'FGItemDescriptorNuclearFuel' ||
    native === 'FGConsumableDescriptor' ||
    native === 'FGEquipmentDescriptor' ||
    native === 'FGAmmoTypeProjectile' ||
    native === 'FGAmmoTypeInstantHit' ||
    native === 'FGAmmoTypeSpreadshot' ||
    native === 'FGPowerShardDescriptor'
  if (!isDescriptor) continue

  for (const c of classes) {
    const form =
      c.mForm === 'RF_LIQUID' ? 'liquid' : c.mForm === 'RF_GAS' ? 'gas' : 'solid'
    items[c.ClassName] = {
      className: c.ClassName,
      name: c.mDisplayName,
      form,
      isResource: native === 'FGResourceDescriptor',
      // Fluid energy is stored per cm3; normalize to per m3 so it lines up
      // with the m3 amounts used everywhere else.
      energy: num(c.mEnergyValue) * (form === 'solid' ? 1 : FLUID_SCALE),
      sinkPoints: num(c.mResourceSinkPoints),
      stackSize: STACK_SIZES[c.mStackSize] ?? null,
      icon: iconStem(c.mSmallIcon ?? c.mPersistentBigIcon),
    }
    if (native === 'FGResourceDescriptor') resourceClasses.add(c.ClassName)
  }
}

const isFluid = (itemClass) => {
  const it = items[itemClass]
  return it ? it.form !== 'solid' : false
}
const scale = (itemClass, amount) =>
  isFluid(itemClass) ? amount / FLUID_SCALE : amount

// ---------------------------------------------------------- buildings

const buildings = {}
for (const [native, classes] of byNative) {
  if (!MANUFACTURER_CLASSES.has(native)) continue
  for (const c of classes) {
    buildings[c.ClassName] = {
      className: c.ClassName,
      name: c.mDisplayName,
      power: num(c.mPowerConsumption),
      powerExponent: num(c.mPowerConsumptionExponent) || 1,
      variablePower: native === 'FGBuildableManufacturerVariablePower',
      footprint: parseFootprint(c.mClearanceData),
    }
  }
}

// ----------------------------------------------------------- unlocks

// recipe class -> how you unlock it. Alternates arrive via hard drives,
// everything else via a milestone or MAM research.
const unlockOf = new Map()

const SCHEMATIC_KIND = {
  EST_Milestone: 'milestone',
  EST_MAM: 'mam',
  EST_Alternate: 'alternate',
  EST_ResourceSink: 'awesome-shop',
  EST_HardDrive: 'alternate',
  EST_Tutorial: 'onboarding',
  EST_Custom: 'custom',
}

for (const c of byNative.get('FGSchematic') ?? []) {
  const unlocks = Array.isArray(c.mUnlocks) ? c.mUnlocks : []
  const recipes = unlocks
    .filter((u) => u.Class === 'BP_UnlockRecipe_C')
    .flatMap((u) => parseClassList(u.mRecipes))
  if (recipes.length === 0) continue

  // `Schematic_Alternate_*` is the reliable marker; mType is inconsistent
  // (some alternates ship as EST_Custom).
  const looksAlternate = /^Schematic_Alternate_/.test(c.ClassName)
  const kind = looksAlternate
    ? 'alternate'
    : (SCHEMATIC_KIND[c.mType] ?? 'custom')

  for (const r of recipes) {
    const prev = unlockOf.get(r)
    // Prefer the earliest tier when several schematics grant the same recipe.
    if (prev && prev.tier <= num(c.mTechTier)) continue
    unlockOf.set(r, {
      kind,
      tier: num(c.mTechTier),
      schematic: c.ClassName,
      schematicName: c.mDisplayName,
    })
  }
}

/**
 * Space Elevator phases, as the parts each one wants and how many.
 *
 * A phase is a schematic that costs items rather than granting a recipe, which
 * is why it falls out of the loop above: that one keys on `mUnlocks`. The cost
 * is the whole point here, so these are collected separately, and anything the
 * game stops shipping simply yields an empty list rather than a crash.
 */
const spaceElevator = []
for (const c of byNative.get('FGSchematic') ?? []) {
  if (c.mType !== 'EST_Custom') continue
  const cost = parseItemAmounts(c.mCost)
  if (cost.length === 0) continue
  // Phases are the ones paid for in Space Elevator parts. Other custom
  // schematics (the shop, the onboarding chain) cost ordinary items.
  if (!cost.every((entry) => /^Desc_SpaceElevatorPart_/.test(entry.item))) {
    continue
  }
  spaceElevator.push({
    schematic: c.ClassName,
    name: c.mDisplayName,
    tier: num(c.mTechTier),
    parts: cost.map((entry) => ({ item: entry.item, amount: entry.amount })),
  })
}
spaceElevator.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))

// Descriptor class -> build recipes that produce it. Matching on the product
// rather than the class name matters: recipe names don't reliably track their
// buildable (Recipe_SmelterMk1_C actually builds the Foundry).
const buildRecipesByProduct = new Map()
for (const c of byNative.get('FGRecipe') ?? []) {
  if (!/BuildGun/.test(c.mProducedIn ?? '')) continue
  for (const product of parseItemAmounts(c.mProduct)) {
    const list = buildRecipesByProduct.get(product.item) ?? []
    list.push(c.ClassName)
    buildRecipesByProduct.set(product.item, list)
  }
}

// Buildables keep their icon on the matching descriptor, not the Build_ class.
const buildableIcons = new Map()
for (const c of byNative.get('FGBuildingDescriptor') ?? []) {
  const icon = iconStem(c.mSmallIcon ?? c.mPersistentBigIcon)
  if (icon) buildableIcons.set(c.ClassName, icon)
}

const iconForBuildable = (buildClass) =>
  buildableIcons.get(buildClass.replace(/^Build_/, 'Desc_')) ?? null

/**
 * Tech tier that unlocks a buildable, taken from whichever schematic grants
 * its build recipe. Returns null when nothing grants it.
 */
function unlockTierFor(buildClass) {
  const descriptor = buildClass.replace(/^Build_/, 'Desc_')
  const tiers = (buildRecipesByProduct.get(descriptor) ?? [])
    .map((recipe) => unlockOf.get(recipe)?.tier)
    .filter((tier) => tier !== undefined)
  return tiers.length > 0 ? Math.min(...tiers) : null
}

// Buildings are indexed before schematics are read, so fill their tier in now.
for (const building of Object.values(buildings)) {
  building.unlockTier = unlockTierFor(building.className)
  building.icon = iconForBuildable(building.className)
}

// ----------------------------------------------------------- recipes

const recipes = {}
let skippedNonFactory = 0

for (const c of byNative.get('FGRecipe') ?? []) {
  const producedIn = parseClassList(c.mProducedIn)
  const machineClass = producedIn.find((p) => buildings[p])
  // Build recipes, hand-crafting and workshop-only recipes have no
  // automatable machine; the planner only models automated production.
  if (!machineClass) {
    skippedNonFactory++
    continue
  }

  const duration = num(c.mManufactoringDuration)
  if (duration <= 0) {
    skippedNonFactory++
    continue
  }

  const toEntry = ({ item, amount }) => {
    const scaled = scale(item, amount)
    return { item, amount: scaled, rate: (scaled * 60) / duration }
  }

  const ingredients = parseItemAmounts(c.mIngredients).map(toEntry)
  const products = parseItemAmounts(c.mProduct).map(toEntry)
  if (products.length === 0) {
    skippedNonFactory++
    continue
  }

  const unlock = unlockOf.get(c.ClassName) ?? null
  const building = buildings[machineClass]

  // Variable-power machines advertise a range; the mean is what a
  // steady-state plan should budget for.
  const varConstant = num(c.mVariablePowerConsumptionConstant)
  const varFactor = num(c.mVariablePowerConsumptionFactor)
  const power = building.variablePower
    ? varConstant + varFactor / 2
    : building.power

  recipes[c.ClassName] = {
    className: c.ClassName,
    name: c.mDisplayName,
    building: machineClass,
    duration,
    ingredients,
    products,
    power,
    powerRange: building.variablePower
      ? { min: varConstant, max: varConstant + varFactor }
      : null,
    isAlternate: unlock?.kind === 'alternate',
    unlock,
  }
}

// --------------------------------------------------------- generators

// Fuel burn and water draw are derived from power output and fuel energy
// rather than stored directly, so they stay correct if the game rebalances.
const generators = {}
const GENERATOR_CLASSES = ['FGBuildableGeneratorFuel', 'FGBuildableGeneratorNuclear']

for (const native of GENERATOR_CLASSES) {
  for (const c of byNative.get(native) ?? []) {
    const power = num(c.mPowerProduction)
    if (power <= 0) continue

    // m3/min of the supplemental resource (always water in practice).
    const supplementalRatio = num(c.mSupplementalToPowerRatio)
    const supplemental =
      c.mRequiresSupplementalResource === 'True' && supplementalRatio > 0
        ? {
            item: classOf(c.mSupplementalResourceClass) ?? 'Desc_Water_C',
            rate: (power * supplementalRatio * 60) / FLUID_SCALE,
          }
        : null

    const fuels = []
    for (const f of Array.isArray(c.mFuel) ? c.mFuel : []) {
      const fuelItem = classOf(f.mFuelClass)
      const fuel = fuelItem && items[fuelItem]
      if (!fuel || fuel.energy <= 0) continue

      const burnRate = (power / fuel.energy) * 60
      const byproductItem = classOf(f.mByproduct ?? '')
      fuels.push({
        item: fuelItem,
        rate: burnRate,
        byproduct: byproductItem
          ? {
              item: byproductItem,
              rate: burnRate * num(f.mByproductAmount),
            }
          : null,
      })
    }
    if (fuels.length === 0) continue

    generators[c.ClassName] = {
      className: c.ClassName,
      name: c.mDisplayName,
      power,
      supplemental,
      fuels,
      footprint: parseFootprint(c.mClearanceData),
      unlockTier: unlockTierFor(c.ClassName),
      icon: iconForBuildable(c.ClassName),
    }
  }
}

// ------------------------------------------------------- belts and pipes

// Throughput ceilings the layout editor validates routes against.
const transport = { belts: [], pipes: [] }

for (const c of byNative.get('FGBuildableConveyorBelt') ?? []) {
  const speed = num(c.mSpeed)
  if (speed <= 0) continue
  // Halving mSpeed reproduces all six published belt rates exactly
  // (Mk.1 60/min through Mk.6 1200/min).
  transport.belts.push({
    className: c.ClassName,
    name: c.mDisplayName,
    itemsPerMinute: speed / 2,
    unlockTier: unlockTierFor(c.ClassName),
    icon: iconForBuildable(c.ClassName),
  })
}
transport.belts.sort((a, b) => a.itemsPerMinute - b.itemsPerMinute)

for (const c of byNative.get('FGBuildablePipeline') ?? []) {
  const flow = num(c.mFlowLimit)
  if (flow <= 0) continue
  // The NoIndicator variants are cosmetic twins with identical throughput.
  if (/NoIndicator/i.test(c.ClassName)) continue
  transport.pipes.push({
    className: c.ClassName,
    name: c.mDisplayName,
    cubicMetersPerMinute: flow * 60,
    unlockTier: unlockTierFor(c.ClassName),
    icon: iconForBuildable(c.ClassName),
  })
}
transport.pipes.sort((a, b) => a.cubicMetersPerMinute - b.cubicMetersPerMinute)

// ----------------------------------------------------------- extractors

// Rate on a NORMAL-purity node at 100% clock. Purity multipliers (impure 0.5,
// pure 2.0) are game constants that don't appear in the Docs export.
const extractors = []

const EXTRACTOR_CLASSES = [
  ['FGBuildableResourceExtractor', true],
  ['FGBuildableWaterPump', false],
  ['FGBuildableFrackingExtractor', true],
]

for (const [native, nodeBased] of EXTRACTOR_CLASSES) {
  for (const c of byNative.get(native) ?? []) {
    const perCycle = num(c.mItemsPerCycle)
    const cycleTime = num(c.mExtractCycleTime)
    if (perCycle <= 0 || cycleTime <= 0) continue

    const forms = c.mAllowedResourceForms ?? ''
    const fluid = /RF_LIQUID|RF_GAS/.test(forms)
    const perMinute = ((perCycle / cycleTime) * 60) / (fluid ? FLUID_SCALE : 1)

    extractors.push({
      className: c.ClassName,
      name: c.mDisplayName,
      ratePerMinute: perMinute,
      fluid,
      // A Water Extractor sits on open water, so purity doesn't apply.
      nodeBased,
      well: native === 'FGBuildableFrackingExtractor',
      unlockTier: unlockTierFor(c.ClassName),
      icon: iconForBuildable(c.ClassName),
    })
  }
}
extractors.sort((a, b) => a.ratePerMinute - b.ratePerMinute)

// ------------------------------------------------------------- storage

// Buildings for holding reserves. Solid capacity is slots x stack size, so
// only the slot count is stored here; the item decides the rest.
const storage = { solid: [], fluid: [] }

for (const c of byNative.get('FGBuildableStorage') ?? []) {
  const slots = num(c.mInventorySizeX) * num(c.mInventorySizeY)
  // Medkit, hazard and personal boxes aren't factory storage.
  if (slots <= 0 || !/StorageContainer/.test(c.ClassName)) continue
  storage.solid.push({
    className: c.ClassName,
    name: c.mDisplayName,
    slots,
    footprint: parseFootprint(c.mClearanceData),
    unlockTier: unlockTierFor(c.ClassName),
    icon: iconForBuildable(c.ClassName),
  })
}
storage.solid.sort((a, b) => a.slots - b.slots)

for (const c of byNative.get('FGBuildablePipeReservoir') ?? []) {
  const capacity = num(c.mStorageCapacity)
  if (capacity <= 0) continue
  storage.fluid.push({
    className: c.ClassName,
    name: c.mDisplayName,
    capacity,
    footprint: parseFootprint(c.mClearanceData),
    unlockTier: unlockTierFor(c.ClassName),
    icon: iconForBuildable(c.ClassName),
  })
}
storage.fluid.sort((a, b) => a.capacity - b.capacity)


// ---------------------------------------------------------- resources

const resources = {}
for (const className of resourceClasses) {
  const max = MAX_EXTRACTION[className]
  if (max === undefined) continue
  resources[className] = {
    item: className,
    name: items[className].name,
    form: items[className].form,
    maxExtraction: Number.isFinite(max) ? max : null,
  }
}

// Scarcity weight, normalized so the most plentiful ore costs 1.0. Water is
// effectively unlimited, so it is free.
const finiteMax = Object.values(resources)
  .map((r) => r.maxExtraction)
  .filter((v) => v !== null)
const mostPlentiful = Math.max(...finiteMax)
for (const r of Object.values(resources)) {
  r.weight = r.maxExtraction === null ? 0 : mostPlentiful / r.maxExtraction
}

// Drop items that nothing can make and nothing consumes, so the pickers
// aren't full of equipment and ammo the planner can't reason about.
const referenced = new Set()
for (const r of Object.values(recipes)) {
  for (const e of [...r.ingredients, ...r.products]) referenced.add(e.item)
}
for (const key of Object.keys(items)) {
  if (!referenced.has(key) && !resources[key]) delete items[key]
}

const producedBy = {}
const consumedBy = {}
for (const r of Object.values(recipes)) {
  for (const p of r.products) (producedBy[p.item] ??= []).push(r.className)
  for (const i of r.ingredients) (consumedBy[i.item] ??= []).push(r.className)
}
// Generator byproducts (nuclear waste) are the only non-recipe producers.
for (const g of Object.values(generators))
  for (const f of g.fuels)
    if (f.byproduct) (producedBy[f.byproduct.item] ??= []).push(g.className)

// Anything with no producer and no extractor can only be picked up by hand:
// wood, leaves, alien remains, power slugs, holiday items. Recipes that eat
// these can't be automated from raw inputs, so the planner flags them.
for (const [key, item] of Object.entries(items))
  item.foraged = !producedBy[key] && !resources[key]

const payload = {
  meta: {
    generatedFrom: path.basename(findDocs()),
    gameVersion: null,
    counts: {
      items: Object.keys(items).length,
      recipes: Object.keys(recipes).length,
      alternates: Object.values(recipes).filter((r) => r.isAlternate).length,
      buildings: Object.keys(buildings).length,
      generators: Object.keys(generators).length,
      resources: Object.keys(resources).length,
      foraged: Object.values(items).filter((i) => i.foraged).length,
      belts: transport.belts.length,
      pipes: transport.pipes.length,
      storage: storage.solid.length + storage.fluid.length,
      extractors: extractors.length,
    },
  },
  items,
  recipes,
  buildings,
  generators,
  transport,
  storage,
  extractors,
  resources,
  spaceElevator,
  producedBy,
  consumedBy,
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(payload))

const sizeMb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2)
console.log(`wrote ${path.relative(ROOT, OUT)} (${sizeMb} MB)`)
console.table(payload.meta.counts)
console.log(`skipped ${skippedNonFactory} non-automatable recipes`)
