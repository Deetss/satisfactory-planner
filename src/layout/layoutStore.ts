import { create } from 'zustand'
import { DEFAULT_BUFFER_MINUTES, type Reserve } from './storage'
import type {
  FactoryModule,
  Fitting,
  FloorRole,
  LayoutState,
  Orientation,
  Placement,
  RouteOverride,
  Side,
} from './types'
import {
  DEFAULT_FLOOR_HEIGHT_M,
  FOUNDATION_M,
  placementRect,
  rectsOverlap,
  snap,
} from './types'

const STORAGE_KEY = 'satisfactory-planner:layout:v1'

/** Reactive flags so undo and redo buttons can disable themselves. */
interface HistoryFlags {
  canUndo: boolean
  canRedo: boolean
}

interface LayoutActions {
  undo: () => void
  redo: () => void
  /** Closes the current undo group, e.g. when a drag finishes. */
  endGroup: () => void
  /** Moves a placed block to another floor, keeping its position. */
  setFloorOf: (moduleId: string, floorId: string) => void
  /** Copies a floor's arrangement onto a new floor above it. */
  duplicateFloor: (floorId: string) => void
  /** Shifts blocks by whole metres, for keyboard nudging. */
  nudge: (moduleIds: string[], dx: number, dy: number) => void
  /** Moves several blocks at once, as one undo step. */
  moveMany: (
    moves: { moduleId: string; x: number; y: number }[],
    group: string,
  ) => void
  /** Unplaces several blocks at once. */
  removeMany: (moduleIds: string[]) => void
  /** Turns several blocks, each from its own heading. */
  rotateMany: (moduleIds: string[]) => void
  /**
   * Mirrors the machines in each block, which swaps the face it feeds from with
   * the face it ships out of.
   */
  flipMany: (moduleIds: string[]) => void
  /** Applies the same change to several blocks, as one undo step. */
  patchMany: (
    moduleIds: string[],
    patch: Partial<Pick<Placement, 'columns' | 'inputSide' | 'outputSide'>>,
  ) => void
  /** Sets a different column count per block, e.g. squaring each one up. */
  setColumnsEach: (entries: { moduleId: string; columns: number }[]) => void
  /**
   * Applies a different change to each of several blocks in one undo step, so
   * clearing every blocked lift at once reverses with a single press.
   */
  patchEach: (
    entries: { moduleId: string; patch: Partial<Placement> }[],
  ) => void
  /** Sends several blocks to another floor. */
  setFloorOfMany: (moduleIds: string[], floorId: string) => void
  /** Marks a cross-floor connection as hand-carried, or belts it again. */
  toggleManualLink: (key: string) => void
  /**
   * Records part of a hand-drawn run. Patches merge, so moving a corner doesn't
   * forget which port the run was attached to.
   */
  editRoute: (
    routeId: string,
    patch: Partial<RouteOverride>,
    group?: string,
  ) => void
  /** Gives a run back to the router. */
  resetRoute: (routeId: string) => void
  /** Puts a splitter or merger on a run, at a point on this floor. */
  addFitting: (fitting: Omit<Fitting, 'id'>) => void
  removeFitting: (id: string) => void
  setReserve: (item: string, patch: Partial<Omit<Reserve, 'item'>>) => void
  removeReserve: (item: string) => void
  /** Replaces placements wholesale, e.g. from auto-arrange. */
  applyArrangement: (placements: Record<string, Placement>) => void
  place: (module: FactoryModule, x: number, y: number) => void
  move: (moduleId: string, x: number, y: number) => void
  remove: (moduleId: string) => void
  rotate: (moduleId: string) => void
  setColumns: (moduleId: string, columns: number) => void
  setSide: (moduleId: string, which: 'inputSide' | 'outputSide', side: Side) => void
  addFloor: () => void
  removeFloor: (floorId: string) => void
  renameFloor: (floorId: string, name: string) => void
  setActiveFloor: (floorId: string) => void
  setFloorSize: (floorId: string, width: number, depth: number) => void
  /** Dedicates a floor to stockpiles, or gives it back to production. */
  setFloorRole: (floorId: string, role: FloorRole) => void
  /** Storey height above the floor below, in metres. */
  setFloorElevation: (floorId: string, metres: number) => void
  /** Where the floor sits in the base, so upper floors can shift sideways. */
  setFloorOrigin: (floorId: string, x: number, y: number) => void
  /** Moves a floor up or down the stack, keeping its blocks with it. */
  moveFloor: (floorId: string, direction: -1 | 1) => void
  setSnapMetres: (metres: number) => void
  clearFloor: (floorId: string) => void
  /** Replaces the whole layout, e.g. from an imported plan file. */
  loadSnapshot: (snapshot: unknown) => void
}

/** Default floor extent, in foundations. */
const DEFAULT_GRID = 12

/** Step a floor's rise snaps to: the thinnest foundation you can stack. */
const RISE_STEP_M = 1

const firstFloor = {
  id: 'floor-1',
  name: 'Ground',
  elevation: 0,
  gridWidth: DEFAULT_GRID,
  gridDepth: DEFAULT_GRID,
  originX: 0,
  originY: 0,
}

const DEFAULTS: LayoutState = {
  floors: [firstFloor],
  activeFloorId: firstFloor.id,
  placements: {},
  snapMetres: FOUNDATION_M,
  reserves: [],
  manualLinks: [],
  routeOverrides: {},
  fittings: [],
}

/**
 * Brings a layout from anywhere outside the app (localStorage, an imported
 * file) up to the current shape, merged over the defaults. Merging matters: a
 * layout saved before a field existed would otherwise come back with that
 * field undefined and break on first render.
 */
export function normalizeLayout(input: unknown): LayoutState {
  const parsed = (input ?? {}) as Partial<LayoutState>
  const merged: LayoutState = { ...DEFAULTS, ...parsed }

  // A saved layout with no floors would leave the canvas unusable.
  if (!Array.isArray(merged.floors) || merged.floors.length === 0) {
    return DEFAULTS
  }
  if (!Array.isArray(merged.reserves)) merged.reserves = []
  merged.manualLinks = Array.isArray(merged.manualLinks)
    ? merged.manualLinks.filter((key): key is string => typeof key === 'string')
    : []
  merged.routeOverrides =
    typeof merged.routeOverrides === 'object' && merged.routeOverrides !== null
      ? merged.routeOverrides
      : {}
  if (!Array.isArray(merged.fittings)) merged.fittings = []

  // Placements saved before manifold sides existed need defaults.
  merged.placements = Object.fromEntries(
    Object.entries(
      (merged.placements ?? {}) as Record<string, Partial<Placement>>,
    ).map(([id, p]) => [
      id,
      { inputSide: 'west', outputSide: 'east', ...p } as Placement,
    ]),
  )

  // Snapping used to be an on/off flag rather than a step size.
  const legacySnap = (parsed as { snapToGrid?: boolean }).snapToGrid
  if (typeof parsed.snapMetres !== 'number') {
    merged.snapMetres = legacySnap === false ? 0 : FOUNDATION_M
  }

  // Floor size used to be one global setting; carry it onto each floor.
  const legacy = parsed as { gridWidth?: number; gridDepth?: number }
  merged.floors = merged.floors.map((floor, i) => ({
    ...floor,
    gridWidth: floor.gridWidth ?? legacy.gridWidth ?? DEFAULT_GRID,
    gridDepth: floor.gridDepth ?? legacy.gridDepth ?? DEFAULT_GRID,
    elevation:
      typeof floor.elevation === 'number'
        ? floor.elevation
        : i === 0
          ? 0
          : DEFAULT_FLOOR_HEIGHT_M,
    originX: typeof floor.originX === 'number' ? floor.originX : 0,
    originY: typeof floor.originY === 'number' ? floor.originY : 0,
    role: floor.role === 'storage' ? 'storage' : 'production',
  }))
  if (typeof merged.placements !== 'object' || merged.placements === null) {
    merged.placements = {}
  }
  if (!merged.floors.some((f) => f.id === merged.activeFloorId)) {
    merged.activeFloorId = merged.floors[0].id
  }
  return merged
}

function readStorage(): LayoutState {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored ? normalizeLayout(JSON.parse(stored)) : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

/** The editable state, without the actions or the undo flags. */
const snapshotOf = (s: LayoutState): LayoutState => ({
  floors: s.floors,
  activeFloorId: s.activeFloorId,
  placements: s.placements,
  snapMetres: s.snapMetres,
  reserves: s.reserves,
  manualLinks: s.manualLinks,
  routeOverrides: s.routeOverrides,
  fittings: s.fittings,
})

/** Undo steps kept. Deep enough to recover from a bad arrange, not unbounded. */
const HISTORY_LIMIT = 60

export const useLayoutStore = create<LayoutState & LayoutActions & HistoryFlags>(
  (set, get) => {
    // Outside the store: history isn't part of the layout, and nothing that
    // serializes the layout should pick it up.
    let past: LayoutState[] = []
    let future: LayoutState[] = []
    /** Commits sharing a group collapse into one undo step, e.g. one drag. */
    let openGroup: string | null = null

    const commit = (patch: Partial<LayoutState>, group?: string) => {
      const before = snapshotOf(get())

      // A drag fires a commit per pointermove; without grouping, one drag would
      // take a hundred presses of undo to reverse.
      if (!group || group !== openGroup) {
        past = [...past.slice(-(HISTORY_LIMIT - 1)), before]
        future = []
      }
      openGroup = group ?? null

      set({ ...patch, canUndo: past.length > 0, canRedo: future.length > 0 })
      persist(get())
    }

    const persist = (s: LayoutState) => {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(snapshotOf(s)),
        )
      } catch {
        // Storage being unavailable shouldn't break editing.
      }
    }

    /** Steps between the two stacks without recording a new step. */
    const step = (from: 'past' | 'future') => {
      const stack = from === 'past' ? past : future
      if (stack.length === 0) return
      const target = stack[stack.length - 1]
      const current = snapshotOf(get())

      if (from === 'past') {
        past = past.slice(0, -1)
        future = [...future, current]
      } else {
        future = future.slice(0, -1)
        past = [...past, current]
      }
      openGroup = null

      set({ ...target, canUndo: past.length > 0, canRedo: future.length > 0 })
      persist(get())
    }

    return {
      ...readStorage(),
      canUndo: false,
      canRedo: false,

      undo: () => step('past'),
      redo: () => step('future'),
      endGroup: () => {
        openGroup = null
      },

      applyArrangement: (placements) => commit({ placements }),

      toggleManualLink: (key) => {
        const current = get().manualLinks
        commit({
          manualLinks: current.includes(key)
            ? current.filter((k) => k !== key)
            : [...current, key],
        })
      },

      editRoute: (routeId, patch, group) => {
        const current = get().routeOverrides[routeId]
        commit(
          {
            routeOverrides: {
              ...get().routeOverrides,
              [routeId]: {
                ...current,
                waypoints: current?.waypoints ?? [],
                ...patch,
              },
            },
          },
          group,
        )
      },

      resetRoute: (routeId) => {
        const { [routeId]: _drawn, ...rest } = get().routeOverrides
        commit({ routeOverrides: rest })
      },

      addFitting: (fitting) =>
        commit({
          fittings: [
            ...get().fittings,
            { ...fitting, id: `fit-${Date.now()}` },
          ],
        }),

      removeFitting: (id) =>
        commit({ fittings: get().fittings.filter((f) => f.id !== id) }),

      setReserve: (item, patch) => {
        const reserves = get().reserves
        const current = reserves.find((r) => r.item === item)
        const next: Reserve = {
          item,
          mode: 'fixed',
          quantity: 0,
          bufferMinutes: DEFAULT_BUFFER_MINUTES,
          ...current,
          ...patch,
        }
        commit({
          reserves: current
            ? reserves.map((r) => (r.item === item ? next : r))
            : [...reserves, next],
        })
      },

      removeReserve: (item) => {
        const { [`storage:${item}`]: _unplaced, ...placements } = get().placements
        commit({
          reserves: get().reserves.filter((r) => r.item !== item),
          placements,
        })
      },

      place: (module, x, y) => {
        const s = get()
        const columns = s.placements[module.id]?.columns ?? 0
        commit({
          placements: {
            ...s.placements,
            [module.id]: {
              moduleId: module.id,
              floorId: s.activeFloorId,
              x: snap(x, s.snapMetres),
              y: snap(y, s.snapMetres),
              orientation: s.placements[module.id]?.orientation ?? 0,
              columns: columns || 1,
              inputSide: s.placements[module.id]?.inputSide ?? 'west',
              outputSide: s.placements[module.id]?.outputSide ?? 'east',
            },
          },
        })
      },

      move: (moduleId, x, y) => {
        const s = get()
        const existing = s.placements[moduleId]
        if (!existing) return
        commit(
          {
            placements: {
              ...s.placements,
              [moduleId]: {
                ...existing,
                x: Math.max(0, snap(x, s.snapMetres)),
                y: Math.max(0, snap(y, s.snapMetres)),
              },
            },
          },
          `move:${moduleId}`,
        )
      },

      nudge: (moduleIds, dx, dy) => {
        const s = get()
        const placements = { ...s.placements }
        let changed = false
        for (const moduleId of moduleIds) {
          const existing = placements[moduleId]
          if (!existing) continue
          placements[moduleId] = {
            ...existing,
            x: Math.max(0, existing.x + dx),
            y: Math.max(0, existing.y + dy),
          }
          changed = true
        }
        if (changed) commit({ placements })
      },

      moveMany: (moves, group) => {
        const s = get()
        const placements = { ...s.placements }
        let changed = false
        for (const move of moves) {
          const existing = placements[move.moduleId]
          if (!existing) continue
          placements[move.moduleId] = {
            ...existing,
            x: Math.max(0, snap(move.x, s.snapMetres)),
            y: Math.max(0, snap(move.y, s.snapMetres)),
          }
          changed = true
        }
        if (changed) commit({ placements }, group)
      },

      removeMany: (moduleIds) => {
        const placements = { ...get().placements }
        for (const moduleId of moduleIds) delete placements[moduleId]
        commit({ placements })
      },

      rotateMany: (moduleIds) => {
        const placements = { ...get().placements }
        let changed = false
        for (const moduleId of moduleIds) {
          const existing = placements[moduleId]
          if (!existing) continue
          placements[moduleId] = {
            ...existing,
            orientation: ((existing.orientation + 90) % 360) as Orientation,
          }
          changed = true
        }
        if (changed) commit({ placements })
      },

      flipMany: (moduleIds) => {
        const placements = { ...get().placements }
        let changed = false
        for (const moduleId of moduleIds) {
          const existing = placements[moduleId]
          if (!existing) continue
          // Each block flips about its own axis, which is the part the face
          // buttons can't do: they can only put every block on one face. The
          // swap is a no-op for a block that feeds and ships on one face, which
          // is exactly when the flag matters: it reorders the taps instead.
          placements[moduleId] = {
            ...existing,
            inputSide: existing.outputSide,
            outputSide: existing.inputSide,
            flipped: !existing.flipped,
          }
          changed = true
        }
        if (changed) commit({ placements })
      },

      patchMany: (moduleIds, patch) => {
        const placements = { ...get().placements }
        let changed = false
        for (const moduleId of moduleIds) {
          const existing = placements[moduleId]
          if (!existing) continue
          placements[moduleId] = { ...existing, ...patch }
          changed = true
        }
        if (changed) commit({ placements })
      },

      patchEach: (entries) => {
        const placements = { ...get().placements }
        let changed = false
        for (const { moduleId, patch } of entries) {
          const existing = placements[moduleId]
          if (!existing) continue
          placements[moduleId] = { ...existing, ...patch }
          changed = true
        }
        if (changed) commit({ placements })
      },

      setColumnsEach: (entries) => {
        const placements = { ...get().placements }
        let changed = false
        for (const { moduleId, columns } of entries) {
          const existing = placements[moduleId]
          if (!existing) continue
          placements[moduleId] = { ...existing, columns: Math.max(1, columns) }
          changed = true
        }
        if (changed) commit({ placements })
      },

      setFloorOfMany: (moduleIds, floorId) => {
        const s = get()
        if (!s.floors.some((f) => f.id === floorId)) return
        const placements = { ...s.placements }
        for (const moduleId of moduleIds) {
          const existing = placements[moduleId]
          if (!existing) continue
          placements[moduleId] = { ...existing, floorId }
        }
        commit({ placements, activeFloorId: floorId })
      },

      setFloorOf: (moduleId, floorId) => {
        const s = get()
        const existing = s.placements[moduleId]
        if (!existing || !s.floors.some((f) => f.id === floorId)) return
        commit({
          placements: {
            ...s.placements,
            [moduleId]: { ...existing, floorId },
          },
          // Following the block is almost always what you want next.
          activeFloorId: floorId,
        })
      },

      duplicateFloor: (floorId) => {
        const s = get()
        const source = s.floors.find((f) => f.id === floorId)
        if (!source) return

        const id = `floor-${Date.now()}`
        const index = s.floors.findIndex((f) => f.id === floorId)
        const floors = [...s.floors]
        floors.splice(index + 1, 0, {
          ...source,
          id,
          name: `${source.name} copy`,
          elevation: DEFAULT_FLOOR_HEIGHT_M,
        })

        // A block lives on one floor at a time, so a duplicate copies the
        // arrangement as empty space rather than cloning the blocks: two floors
        // can't both run the same recipe block.
        commit({ floors, activeFloorId: id })
      },

      remove: (moduleId) => {
        const { [moduleId]: _gone, ...rest } = get().placements
        commit({ placements: rest })
      },

      rotate: (moduleId) => {
        const s = get()
        const existing = s.placements[moduleId]
        if (!existing) return
        const next = ((existing.orientation + 90) % 360) as Orientation
        commit({
          placements: {
            ...s.placements,
            [moduleId]: { ...existing, orientation: next },
          },
        })
      },

      setColumns: (moduleId, columns) => {
        const s = get()
        const existing = s.placements[moduleId]
        if (!existing) return
        commit({
          placements: {
            ...s.placements,
            [moduleId]: { ...existing, columns: Math.max(1, columns) },
          },
        })
      },

      setSide: (moduleId, which, side) => {
        const s = get()
        const existing = s.placements[moduleId]
        if (!existing) return
        commit({
          placements: {
            ...s.placements,
            [moduleId]: { ...existing, [which]: side },
          },
        })
      },

      addFloor: () => {
        const s = get()
        const id = `floor-${Date.now()}`
        // A new floor copies the current one's footprint, which is nearly
        // always what you want when stacking.
        const current = s.floors.find((f) => f.id === s.activeFloorId)
        const floor = {
          id,
          name: `Level ${s.floors.length + 1}`,
          elevation: DEFAULT_FLOOR_HEIGHT_M,
          gridWidth: current?.gridWidth ?? DEFAULT_GRID,
          gridDepth: current?.gridDepth ?? DEFAULT_GRID,
          // Stacked directly over the current floor until moved.
          originX: current?.originX ?? 0,
          originY: current?.originY ?? 0,
        }
        commit({ floors: [...s.floors, floor], activeFloorId: id })
      },

      removeFloor: (floorId) => {
        const s = get()
        if (s.floors.length <= 1) return
        const floors = s.floors.filter((f) => f.id !== floorId)
        const placements = Object.fromEntries(
          Object.entries(s.placements).filter(
            ([, p]) => p.floorId !== floorId,
          ),
        )
        commit({
          floors,
          placements,
          activeFloorId:
            s.activeFloorId === floorId ? floors[0].id : s.activeFloorId,
        })
      },

      renameFloor: (floorId, name) =>
        commit(
          {
            floors: get().floors.map((f) =>
              f.id === floorId ? { ...f, name } : f,
            ),
          },
          // Grouped, or undoing a rename would take one press per character.
          `rename:${floorId}`,
        ),

      setActiveFloor: (activeFloorId) => commit({ activeFloorId }),

      setFloorSize: (floorId, width, depth) =>
        commit({
          floors: get().floors.map((f) =>
            f.id === floorId
              ? {
                  ...f,
                  gridWidth: Math.max(1, Math.round(width)),
                  gridDepth: Math.max(1, Math.round(depth)),
                }
              : f,
          ),
        }),

      setFloorRole: (floorId, role) =>
        commit({
          floors: get().floors.map((f) =>
            f.id === floorId ? { ...f, role } : f,
          ),
        }),

      setFloorElevation: (floorId, metres) => {
        // Not the placement step: an 8 m jump is far too coarse for a floor
        // height. Foundations come in 1 m, 2 m and 4 m, so a metre lands on a
        // height you can stack to while still being fine enough to tune.
        const elevation = Math.max(RISE_STEP_M, snap(metres, RISE_STEP_M))

        commit(
          {
            floors: get().floors.map((f, i) =>
              // The ground floor has nothing below it to stand on.
              f.id === floorId && i > 0 ? { ...f, elevation } : f,
            ),
          },
          `rise:${floorId}`,
        )
      },

      setFloorOrigin: (floorId, x, y) =>
        commit(
          {
            floors: get().floors.map((f) =>
              f.id === floorId
                ? {
                    ...f,
                    // Never negative: the base's own corner is the origin of
                    // the whole site. `|| FOUNDATION_M` used to sit here, which
                    // quietly forced a floor onto the 8 m grid even with
                    // snapping off, since free is stored as 0.
                    originX: Math.max(0, snap(x, get().snapMetres)),
                    originY: Math.max(0, snap(y, get().snapMetres)),
                  }
                : f,
            ),
          },
          `origin:${floorId}`,
        ),

      moveFloor: (floorId, direction) => {
        const s = get()
        const from = s.floors.findIndex((f) => f.id === floorId)
        const to = from + direction
        if (from < 0 || to < 0 || to >= s.floors.length) return

        const floors = [...s.floors]
        const [moved] = floors.splice(from, 1)
        floors.splice(to, 0, moved)

        // Elevation is the rise above the floor below, so it belongs to a
        // position in the stack rather than to the floor. Swapping two floors
        // without swapping their rises would move the whole stack's heights.
        const rises = s.floors.map((f) => f.elevation)
        commit({
          floors: floors.map((f, i) => ({
            ...f,
            elevation: i === 0 ? 0 : (rises[i] ?? DEFAULT_FLOOR_HEIGHT_M),
          })),
        })
      },

      setSnapMetres: (snapMetres) => commit({ snapMetres }),

      loadSnapshot: (snapshot) => commit(normalizeLayout(snapshot)),

      clearFloor: (floorId) =>
        commit({
          placements: Object.fromEntries(
            Object.entries(get().placements).filter(
              ([, p]) => p.floorId !== floorId,
            ),
          ),
        }),
    }
  },
)

/** Placements on a floor that overlap another placement on the same floor. */
export function findCollisions(
  placements: Placement[],
  modulesById: Map<string, FactoryModule>,
): Set<string> {
  const clashing = new Set<string>()

  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i]
      const b = placements[j]
      const moduleA = modulesById.get(a.moduleId)
      const moduleB = modulesById.get(b.moduleId)
      if (!moduleA || !moduleB) continue
      if (rectsOverlap(placementRect(moduleA, a), placementRect(moduleB, b))) {
        clashing.add(a.moduleId)
        clashing.add(b.moduleId)
      }
    }
  }

  return clashing
}

export { FOUNDATION_M }
