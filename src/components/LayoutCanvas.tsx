import { useCallback, useMemo, useRef, useState } from 'react'
import { buildings, generators as allGenerators, itemName } from '../data/gameData'
import { adviseOnFloors } from '../layout/advice'
import {
  findDepotFeeds,
  findFloorLinks,
  findShaftClashes,
  planShafts,
  type FloorCongestion,
  type Shaft,
  type ShaftClash,
} from '../layout/congestion'
import { findCollisions, useLayoutStore } from '../layout/layoutStore'
import { packAsBus, type ArrangeMode, type Growth } from '../layout/bus'
import { packByColumns } from '../layout/columns'
import { baseBounds, floorRect, unsupportedCells } from '../layout/floors'
import { defaultColumns } from '../layout/modules'
import { EDGE_M, SERVICE_M, packByStage, type PackedModule } from '../layout/pack'
import { nudgeTangled } from '../layout/nudge'
import type { Point, RoutePath } from '../layout/paths'
import { alongPath, closestOnPath, endOf, nearestFaceEnd } from '../layout/paths'
import { deriveFittings } from '../layout/fittings'
import type { Route } from '../layout/routes'
import { complexityOf, faceFlows, flowsOf, scoreFloor, tuneFaces } from '../layout/tidy'
import type {
  FactoryModule,
  Floor,
  Placement,
  RouteOverride,
  Side,
} from '../layout/types'
import {
  FOUNDATION_M,
  SIDE_LABEL,
  SNAP_STEPS,
  floorRole,
  isStorageModule,
  placementRect,
  snap,
} from '../layout/types'
import { useCanvasZoom } from '../hooks/useCanvasZoom'
import { useUiStore, type RouteVisibility } from '../state/uiStore'
import { Compass } from './Compass'
import { ContextMenu, type MenuAt, type MenuEntry } from './ContextMenu'
import { Icon } from './Icon'
import { PortLayer } from './PortLayer'
import { RouteLayer, type RouteGrab } from './RouteLayer'
import { ViewToggle, type LayoutView } from './ViewToggle'

interface Props {
  modules: FactoryModule[]
  /** Selected blocks, the last being the primary. */
  selection: string[]
  onSelect: (moduleId: string | null, additive?: boolean) => void
  /** Runs on the active floor, already laid out in metres. */
  paths: RoutePath[]
  congestion: FloorCongestion | null
  /** Vertical runs, including ones only passing through this floor. */
  shafts: Shaft[]
  shaftClashes: ShaftClash[]
  /** Corridor the last bus arrangement reserved, when there is one. */
  bus: BusCorridor | null
  view: LayoutView
  onViewChange: (view: LayoutView) => void
  /** The run being drawn by hand, if any. */
  editingRouteId: string | null
  onEditRoute: (routeId: string | null) => void
}

export type { RouteVisibility }

/** A reserved bus corridor, tied to the floor it was arranged on. */
export interface BusCorridor {
  floorId: string
  x: number
  y: number
  width: number
  depth: number
}

/** Screen pixels per metre. Zoom multiplies this. */
const BASE_SCALE = 3

/** Plan-view size of a lift column, in metres. */
const SHAFT_M = 2

/**
 * Room around the site, in pixels.
 *
 * Plenty of what a floor shows sits outside its own ground: stubs for material
 * coming from elsewhere, the panels naming them, and a floor dragged out past
 * the base. In pixels rather than metres because what's hanging over the edge is
 * mostly labels, which don't shrink when you zoom out.
 */
const MARGIN_PX = 120

interface DragState {
  moduleId: string
  /** Offset from the module's origin to the pointer, in metres. */
  grabX: number
  grabY: number
  pointerId: number
  /** Every block travelling with this drag, and where it sits relative to it. */
  followers: { moduleId: string; dx: number; dy: number }[]
}

interface FloorDragState {
  /** Offset from the floor's origin to the pointer, in base metres. */
  grabX: number
  grabY: number
  pointerId: number
}

export function LayoutCanvas({
  modules,
  selection,
  onSelect,
  paths,
  congestion,
  shafts,
  shaftClashes,
  bus,
  view,
  onViewChange,
  editingRouteId,
  onEditRoute,
}: Props) {
  const layout = useLayoutStore()
  // What the canvas draws is remembered across reloads: it's how you were
  // reading the floor, not part of the plan.
  const routeView = useUiStore((s) => s.routeView)
  const setRouteView = useUiStore((s) => s.setRouteView)
  const showTangles = useUiStore((s) => s.showTangles)
  const setShowTangles = useUiStore((s) => s.setShowTangles)
  const lane = useUiStore((s) => s.lane)
  // The drag lives in a ref so the very first pointermove is already handled;
  // waiting for a re-render to attach a listener drops the start of the drag.
  const dragRef = useRef<DragState | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const floorDragRef = useRef<FloorDragState | null>(null)
  const [movingFloor, setMovingFloor] = useState(false)
  // Blocks are positioned against the deck, which moves with the floor, so it
  // needs its own ref separate from the zoom surface.
  const floorRef = useRef<HTMLDivElement>(null)

  const abandonDrag = useCallback(() => {
    dragRef.current = null
    setDraggingId(null)
    useLayoutStore.getState().endGroup()
  }, [])

  const { zoom, step, scrollRef, surfaceRef } = useCanvasZoom<HTMLDivElement>({
    onPinchStart: abandonDrag,
  })

  const scale = BASE_SCALE * zoom
  const modulesById = useMemo(
    () => new Map(modules.map((m) => [m.id, m])),
    [modules],
  )

  const selected = useMemo(() => new Set(selection), [selection])
  const selectedId = selection.length > 0 ? selection[selection.length - 1] : null

  const activeIndex = layout.floors.findIndex((f) => f.id === layout.activeFloorId)

  const onFloor = (floorId: string | undefined) =>
    Object.values(layout.placements).filter((p) => p.floorId === floorId)

  const current = onFloor(layout.activeFloorId)

  const collisions = useMemo(
    () => findCollisions(current, modulesById),
    [current, modulesById],
  )


  /**
   * Converts a client point to metres on the active floor. Measured from the
   * floor's own deck, so block positions stay floor-local however far the floor
   * is offset over the base.
   */
  const toMetres = (clientX: number, clientY: number) => {
    const box = floorRef.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return {
      x: (clientX - box.left) / scale,
      y: (clientY - box.top) / scale,
    }
  }

  const [menu, setMenu] = useState<MenuAt | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  /** Blocks the menu should act on: the whole selection when it's in it. */
  const targetsFor = (moduleId: string) =>
    selection.includes(moduleId) ? selection : [moduleId]

  const blockMenu = (event: React.MouseEvent, moduleId: string) => {
    event.preventDefault()
    const module = modulesById.get(moduleId)
    const targets = targetsFor(moduleId)
    const many = targets.length > 1
    setMenu({
      x: event.clientX,
      y: event.clientY,
      title: many ? `${targets.length} blocks` : (module?.label ?? 'Block'),
      entries: [
        { label: 'Rotate', hint: 'R', onSelect: () => layout.rotateMany(targets) },
        { label: 'Flip', hint: 'F', onSelect: () => layout.flipMany(targets) },
        {
          label: 'Square up',
          onSelect: () =>
            layout.setColumnsEach(
              targets.flatMap((id) => {
                const m = modulesById.get(id)
                return m ? [{ moduleId: id, columns: defaultColumns(m) }] : []
              }),
            ),
        },
        'separator',
        ...layout.floors
          .filter((floor) => floor.id !== layout.activeFloorId)
          .map((floor) => ({
            label: `Send to ${floor.name}`,
            onSelect: () => layout.setFloorOfMany(targets, floor.id),
          })),
        'separator',
        {
          label: many ? 'Unplace all' : 'Unplace',
          hint: 'Del',
          danger: true,
          onSelect: () => {
            layout.removeMany(targets)
            onSelect(null)
          },
        },
      ],
    })
  }

  /**
   * Which block face a run taps at each end, with the point it taps at.
   *
   * Read back off the drawn line rather than recomputed, so a swap moves the
   * ports you can actually see, including ones already placed by hand.
   */
  const endsOf = (path: RoutePath) =>
    (['from', 'to'] as const).flatMap((which) => {
      const moduleId = which === 'from' ? path.route.from : path.route.to
      const placement = moduleId ? layout.placements[moduleId] : null
      const module = moduleId ? modulesById.get(moduleId) : null
      if (!moduleId || !placement || !module) return []
      if (placement.floorId !== layout.activeFloorId) return []

      const side = which === 'from' ? placement.outputSide : placement.inputSide
      const point = which === 'from'
        ? path.points[0]
        : path.points[path.points.length - 1]
      return [
        {
          which,
          moduleId,
          side,
          end: endOf(placementRect(module, placement), side, point),
        },
      ]
    })

  /**
   * Runs sharing a face with this one, and the swap that exchanges their taps.
   *
   * Ports are assigned by where each run is headed, which is right far more
   * often than not, but two runs whose destinations sit on top of each other
   * have nothing to sort by. This is the manual say over which is which.
   */
  const swapsFor = (path: RoutePath) => {
    const mine = endsOf(path)
    return paths.flatMap((other) => {
      if (other.route.id === path.route.id) return []
      for (const theirs of endsOf(other)) {
        const match = mine.find(
          (m) => m.moduleId === theirs.moduleId && m.side === theirs.side,
        )
        if (!match) continue
        // Same item, same direction means they already share a tap, so there
        // is nothing to exchange.
        if (
          other.route.item === path.route.item &&
          theirs.which === match.which
        ) {
          continue
        }

        const partner =
          theirs.which === 'from' ? other.route.to : other.route.from
        const towards = partner
          ? (modulesById.get(partner)?.label ?? 'off the floor')
          : 'off the floor'
        return [
          {
            label: `Swap ports with ${itemName(other.route.item)} to ${towards}`,
            onSelect: () => {
              // Both sides are written, or the one left to the router would
              // just be reassigned back to where it started.
              layout.editRoute(path.route.id, { [match.which]: theirs.end })
              layout.editRoute(other.route.id, { [theirs.which]: match.end })
            },
          },
        ]
      }
      return []
    })
  }

  const runMenu = (event: React.MouseEvent, routeId: string) => {
    event.preventDefault()
    const path = paths.find((p) => p.route.id === routeId)
    const at = toMetres(event.clientX, event.clientY)
    // A splitter sits on the belt, so where you clicked is pulled onto the run
    // rather than onto the grid. Snapping to the grid instead left it floating
    // beside any run that doesn't happen to follow a foundation edge.
    const spot = path ? closestOnPath(path.points, at) : at
    const onRun = { routeId, floorId: layout.activeFloorId, ...spot }

    setMenu({
      x: event.clientX,
      y: event.clientY,
      title: path ? itemName(path.route.item) : 'Run',
      entries: [
        { label: 'Draw by hand', onSelect: () => onEditRoute(routeId) },
        {
          label: 'Reset to routed',
          disabled: !layout.routeOverrides[routeId],
          onSelect: () => layout.resetRoute(routeId),
        },
        ...(path && swapsFor(path).length > 0
          ? (['separator', ...swapsFor(path)] as MenuEntry[])
          : []),
        'separator',
        {
          label: 'Add splitter here',
          onSelect: () => layout.addFitting({ ...onRun, kind: 'splitter' }),
        },
        {
          label: 'Add merger here',
          onSelect: () => layout.addFitting({ ...onRun, kind: 'merger' }),
        },
      ],
    })
  }

  const floorMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    setMenu({
      x: event.clientX,
      y: event.clientY,
      title: activeFloor?.name ?? 'Floor',
      entries: [
        {
          label: 'Clear selection',
          disabled: selection.length === 0,
          onSelect: () => onSelect(null),
        },
        {
          label: 'Undo',
          hint: 'Ctrl+Z',
          disabled: !layout.canUndo,
          onSelect: layout.undo,
        },
        {
          label: 'Redo',
          hint: 'Ctrl+Shift+Z',
          disabled: !layout.canRedo,
          onSelect: layout.redo,
        },
        'separator',
        {
          label: 'Send this floor back to the tray',
          danger: true,
          onSelect: () => layout.clearFloor(layout.activeFloorId),
        },
      ],
    })
  }

  /**
   * Dragging a hand-drawn run: an end slides around its block's edge, a corner
   * moves freely on the snap grid, and a segment midpoint becomes a new corner
   * the moment it's dragged.
   */
  const routeDragRef = useRef<{
    routeId: string
    grab: RouteGrab
    /** Set once an insert has become a real corner, so it keeps moving. */
    cornerIndex: number | null
    pointerId: number
  } | null>(null)

  const startRouteDrag = (
    routeId: string,
    grab: RouteGrab,
    event: React.PointerEvent<SVGElement>,
  ) => {
    routeDragRef.current = {
      routeId,
      grab,
      cornerIndex: grab.kind === 'corner' ? grab.index : null,
      pointerId: event.pointerId,
    }
    onEditRoute(routeId)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // The drag still works while the pointer stays over the handle.
    }
  }

  const continueRouteDrag = (event: React.PointerEvent<SVGElement>) => {
    const drag = routeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()

    const path = paths.find((p) => p.route.id === drag.routeId)
    if (!path) return
    const at = toMetres(event.clientX, event.clientY)
    const group = `route:${drag.routeId}`

    if (drag.grab.kind === 'end') {
      const moduleId =
        drag.grab.which === 'from' ? path.route.from : path.route.to
      const module = moduleId ? modulesById.get(moduleId) : null
      const placement = moduleId ? layout.placements[moduleId] : null
      // An end outside the factory has no block to slide along.
      if (!module || !placement) return
      layout.editRoute(
        drag.routeId,
        { [drag.grab.which]: nearestFaceEnd(placementRect(module, placement), at) },
        group,
      )
      return
    }

    const grid = layout.snapMetres
    const snapped: Point = {
      x: Math.max(0, grid > 0 ? snap(at.x, grid) : at.x),
      y: Math.max(0, grid > 0 ? snap(at.y, grid) : at.y),
    }
    const corners = layout.routeOverrides[drag.routeId]?.waypoints ?? []

    if (drag.cornerIndex === null && drag.grab.kind === 'insert') {
      // Where the new corner belongs among the existing ones, measured along the
      // line rather than counted by vertex: squaring off adds corners of its own.
      const reached = alongPath(path.points, drag.grab.at)
      const index = corners.filter(
        (corner) => alongPath(path.points, corner) < reached,
      ).length
      drag.cornerIndex = index
      layout.editRoute(
        drag.routeId,
        {
          waypoints: [
            ...corners.slice(0, index),
            snapped,
            ...corners.slice(index),
          ],
        },
        group,
      )
      return
    }

    const index = drag.cornerIndex
    if (index === null || index >= corners.length) return
    layout.editRoute(
      drag.routeId,
      {
        waypoints: corners.map((corner, i) => (i === index ? snapped : corner)),
      },
      group,
    )
  }

  const endRouteDrag = (event: React.PointerEvent<SVGElement>) => {
    const drag = routeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    routeDragRef.current = null
    layout.endGroup()
  }

  /** Same, but in base metres, for dragging the floor itself. */
  const toBaseMetres = (clientX: number, clientY: number) => {
    const box = surfaceRef.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return {
      x: (clientX - box.left) / scale,
      y: (clientY - box.top) / scale,
    }
  }

  // Dragging the whole floor. Pointer events cover mouse and touch alike, and
  // capture keeps the drag alive once the finger leaves the small handle.
  const startFloorDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const point = toBaseMetres(event.clientX, event.clientY)
    floorDragRef.current = {
      grabX: point.x - originX,
      grabY: point.y - originY,
      pointerId: event.pointerId,
    }
    setMovingFloor(true)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Same fallback as a block drag: it still works while the pointer is on
      // the handle.
    }
  }

  const continueFloorDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = floorDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const point = toBaseMetres(event.clientX, event.clientY)
    layout.setFloorOrigin(
      layout.activeFloorId,
      point.x - drag.grabX,
      point.y - drag.grabY,
    )
  }

  const endFloorDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = floorDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    floorDragRef.current = null
    setMovingFloor(false)
    layout.endGroup()
  }

  // One pointer path covers mouse and touch. Pointer capture routes every
  // later event for this pointer back to the tile even once the finger has
  // slid off it, so no window listeners are needed.
  const startDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    moduleId: string,
    blockX: number,
    blockY: number,
  ) => {
    event.stopPropagation()
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    // Dragging a block that's already part of a selection keeps that selection,
    // so a whole set can be moved without ctrl-clicking it back together.
    if (additive || !selected.has(moduleId)) onSelect(moduleId, additive)

    const travelling = selected.has(moduleId) && !additive ? selection : [moduleId]
    const point = toMetres(event.clientX, event.clientY)
    dragRef.current = {
      moduleId,
      grabX: point.x - blockX,
      grabY: point.y - blockY,
      pointerId: event.pointerId,
      followers: travelling
        .filter((id) => id !== moduleId)
        .flatMap((id) => {
          const other = layout.placements[id]
          if (!other) return []
          return [{ moduleId: id, dx: other.x - blockX, dy: other.y - blockY }]
        }),
    }
    setDraggingId(moduleId)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture can be refused for a pointer that's already gone; the drag
      // still works while the pointer stays over the tile.
    }
  }

  const continueDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const point = toMetres(event.clientX, event.clientY)
    const x = point.x - drag.grabX
    const y = point.y - drag.grabY

    if (drag.followers.length === 0) {
      layout.move(drag.moduleId, x, y)
      return
    }
    layout.moveMany(
      [
        { moduleId: drag.moduleId, x, y },
        ...drag.followers.map((f) => ({
          moduleId: f.moduleId,
          x: x + f.dx,
          y: y + f.dy,
        })),
      ],
      `move:${drag.moduleId}`,
    )
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDraggingId(null)
    // Closes the undo step, so the whole drag reverses in one press and the
    // next drag starts a step of its own.
    layout.endGroup()
  }

  // Blocks with someone else's belt running over them.
  const overrun = new Set(congestion?.overBlocks.map((o) => o.moduleId) ?? [])

  // Where the runs on show divide and join. Following the visible runs means a
  // junction can never be marked for a belt you can't see.
  const junctions = useMemo(() => {
    const shown =
      routeView === 'selected' && selectedId
        ? paths.filter(
            (p) => p.route.from === selectedId || p.route.to === selectedId,
          )
        : paths
    return deriveFittings(shown)
  }, [paths, routeView, selectedId])

  // Lifts that touch this floor, including ones only passing through it on
  // their way somewhere else. Those are the ones you can't otherwise see.
  const fouled = new Set(shaftClashes.map((c) => c.shaftId))
  const shaftsHere = shafts
    .filter((shaft) => activeIndex >= shaft.low && activeIndex <= shaft.high)
    .map((shaft) => ({
      shaft,
      passingThrough:
        shaft.link.fromFloorId !== layout.activeFloorId &&
        shaft.link.toFloorId !== layout.activeFloorId,
      fouled: fouled.has(shaft.id),
    }))

  // A 2 m column is 6 px at default zoom, too small to see or tap.
  const shaftPx = Math.max(SHAFT_M * scale, 16)

  const activeFloor = layout.floors[activeIndex]
  const originX = activeFloor?.originX ?? 0
  const originY = activeFloor?.originY ?? 0

  const gridW = (activeFloor?.gridWidth ?? 12) * FOUNDATION_M
  const gridD = (activeFloor?.gridDepth ?? 12) * FOUNDATION_M

  // Everything under the active floor, ground first.
  const below = layout.floors.slice(0, Math.max(0, activeIndex))

  // Blocks on the floors underneath, so you can see what you're building over.
  // Deeper floors show through wherever the ones above them don't reach.
  const belowGhosts = below.flatMap((floor, index) =>
    onFloor(floor.id)
      .map((placement) => ({
        placement,
        module: modulesById.get(placement.moduleId),
        floor,
        depth: below.length - index,
      }))
      .filter((g): g is typeof g & { module: FactoryModule } => Boolean(g.module)),
  )

  const overhang = useMemo(
    () => (activeFloor ? unsupportedCells(activeFloor, below) : []),
    [activeFloor, below],
  )

  // The canvas covers the whole site, not just this floor, so a floor pushed
  // out past the base still has room to be drawn.
  const site = baseBounds(layout.floors)

  return (
    <div className="layout">
      <div className="layout__toolbar">
        <ViewToggle value={view} onChange={onViewChange} />

        <span className="toolbar__divider" />

        <select
          className="select layout__floorpick"
          value={layout.activeFloorId}
          aria-label="Floor"
          onChange={(e) => layout.setActiveFloor(e.target.value)}
        >
          {layout.floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({onFloor(f.id).length})
            </option>
          ))}
        </select>

        {/* Moving a floor up or down the stack sits next to the picker that
            chose it, because the two are one job: pick a level, put it
            somewhere else. It used to live in the Floor panel, which on a phone
            is behind the controls sheet and two taps of scrolling away. */}
        {layout.floors.length > 1 && (
          <div className="btngroup btngroup--joined">
            <button
              type="button"
              className="btn btn--icon"
              onClick={() => layout.moveFloor(layout.activeFloorId, -1)}
              disabled={activeIndex <= 0}
              aria-label="Move this floor down a level"
              title="Move this floor down a level, blocks and all"
            >
              ↓
            </button>
            <button
              type="button"
              className="btn btn--icon"
              onClick={() => layout.moveFloor(layout.activeFloorId, 1)}
              disabled={activeIndex < 0 || activeIndex >= layout.floors.length - 1}
              aria-label="Move this floor up a level"
              title="Move this floor up a level, blocks and all"
            >
              ↑
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn btn--icon"
          onClick={layout.addFloor}
          title="Add a floor above this one"
        >
          + Floor
        </button>
        <span className="toolbar__divider" />

        {/* Undo and redo act on the whole layout rather than this floor, which
            is why they belong up here rather than among the floor's own
            controls, where they read as undoing something about the floor. */}
        <div className="btngroup btngroup--joined">
          <button
            type="button"
            className="btn btn--icon"
            onClick={layout.undo}
            disabled={!layout.canUndo}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={layout.redo}
            disabled={!layout.canRedo}
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
          >
            ↷
          </button>
        </div>

        <span className="toolbar__divider" />

        <div className="btngroup btngroup--joined">
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => step(1 / 1.3)}
            aria-label="Zoom out"
            title="Zoom out. Wheel or pinch works too."
          >
            −
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => step(1.3)}
            aria-label="Zoom in"
            title="Zoom in. Wheel or pinch works too."
          >
            +
          </button>
        </div>
        <button
          type="button"
          className={`btn btn--icon ${layout.snapMetres > 0 ? 'btn--active' : ''}`}
          onClick={() => {
            const next =
              SNAP_STEPS[
                (SNAP_STEPS.indexOf(layout.snapMetres) + 1) % SNAP_STEPS.length
              ]
            layout.setSnapMetres(next ?? 0)
          }}
          title="Placement step: full foundation, half, quarter, or free"
        >
          <span className="btn__key">Snap</span>
          {layout.snapMetres > 0 ? `${layout.snapMetres} m` : 'Free'}
        </button>

        <span className="toolbar__divider" />

        <button
          type="button"
          className={`btn btn--icon ${routeView !== 'off' ? 'btn--active' : ''}`}
          onClick={() =>
            setRouteView(
              routeView === 'selected' ? 'all' : routeView === 'all' ? 'off' : 'selected',
            )
          }
          title="Cycle belt and pipe runs: selected block, all blocks, off"
        >
          <span className="btn__key">Runs</span>
          {routeView === 'selected' ? 'selected' : routeView === 'all' ? 'all' : 'off'}
        </button>
        <button
          type="button"
          className={`btn btn--icon ${showTangles ? 'btn--active' : ''}`}
          onClick={() => setShowTangles(!showTangles)}
          title="Mark where runs cross, share a lane, or pass over a block"
        >
          <span className="btn__key">Tangles</span>
          {showTangles ? 'on' : 'off'}
          {showTangles && congestion && congestion.score > 0 && (
            <span className="badge badge--warn">{congestion.score}</span>
          )}
        </button>
      </div>

      {menu && <ContextMenu at={menu} onClose={closeMenu} />}

      <div className="layout__scroll" ref={scrollRef}>
        <Compass />
        {/* The surface spans the whole site, so an upper floor pushed out past
            the base has somewhere to be drawn. Everything belonging to the
            active floor lives in the deck below, in floor-local metres. */}
        <div
          ref={surfaceRef}
          className="layout__surface"
          data-pan=""
          style={{
            width: site.width * scale + MARGIN_PX * 2,
            height: site.depth * scale + MARGIN_PX * 2,
          }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onSelect(null)
          }}
        >
          {/* The site itself, inset so anything hanging off an edge has room:
              port panels, external stubs and a floor dragged out past the base
              all sit outside the ground and would otherwise be cut off by the
              scroll container. */}
          <div
            className="layout__site"
            data-pan=""
            style={{
              left: MARGIN_PX,
              top: MARGIN_PX,
              width: site.width * scale,
              height: site.depth * scale,
            }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) onSelect(null)
            }}
          >
          {below.map((floor, depth) => {
            const rect = floorRect(floor)
            return (
              <div
                key={`deck-${floor.id}`}
                className="deck"
                data-pan=""
                style={{
                  left: rect.x * scale,
                  top: rect.y * scale,
                  width: rect.width * scale,
                  height: rect.depth * scale,
                  // Floors further down recede, so the one directly beneath
                  // reads as the nearest thing under your feet.
                  opacity: 0.85 ** (below.length - depth),
                }}
              >
                <span className="deck__label">{floor.name}</span>
              </div>
            )
          })}

        {/* The deck and its grid are a backdrop. Blocks on the floors below are
            drawn over it, so they still read as shadows through the floor you
            are standing on, and remain visible out in an overhang. */}
        <div
          className={`floor ${movingFloor ? 'floor--moving' : ''}`}
          data-pan=""
          style={{
            left: originX * scale,
            top: originY * scale,
            width: gridW * scale,
            height: gridD * scale,
            backgroundSize:
              layout.snapMetres > 0 && layout.snapMetres < FOUNDATION_M
                ? `${FOUNDATION_M * scale}px ${FOUNDATION_M * scale}px, ` +
                  `${FOUNDATION_M * scale}px ${FOUNDATION_M * scale}px, ` +
                  `${layout.snapMetres * scale}px ${layout.snapMetres * scale}px, ` +
                  `${layout.snapMetres * scale}px ${layout.snapMetres * scale}px`
                : `${FOUNDATION_M * scale}px ${FOUNDATION_M * scale}px`,
          }}
          data-subgrid={
            layout.snapMetres > 0 && layout.snapMetres < FOUNDATION_M
              ? 'on'
              : undefined
          }
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onSelect(null)
          }}
          onContextMenu={floorMenu}
        />

        {belowGhosts.map(({ placement, module, floor, depth }) => {
          const rect = placementRect(module, placement)
          return (
            <div
              key={`ghost-${placement.moduleId}`}
              className="tile tile--ghost"
              style={{
                left: (rect.x + floor.originX) * scale,
                top: (rect.y + floor.originY) * scale,
                width: rect.width * scale,
                height: rect.depth * scale,
                // Each floor further down fades, so the one immediately beneath
                // reads as the nearest thing under your feet.
                opacity: 0.75 ** depth,
              }}
              title={`${module.label} on ${floor.name}`}
            >
              <span className="tile__label">{module.label}</span>
            </div>
          )
        })}

        {/* Everything on the active floor, in floor-local metres. Sits above the
            shadows so the floor you're editing is always the clearest layer. */}
        <div
          ref={floorRef}
          className="floor__content"
          style={{
            left: originX * scale,
            top: originY * scale,
            width: gridW * scale,
            height: gridD * scale,
          }}
        >
          {/* Foundations with nothing under them. Worth seeing: in game they
              need pillars, and they're where a floor has drifted off its base. */}
          {overhang.map((cell) => (
            <div
              key={`cantilever-${cell.x},${cell.y}`}
              className="cantilever"
              style={{
                left: cell.x * scale,
                top: cell.y * scale,
                width: cell.size * scale,
                height: cell.size * scale,
              }}
              title="Cantilevered: nothing below this foundation"
            />
          ))}

          {/* Junctions the plan already implies: where one line divides to feed
              two blocks, and where several join to feed one. Drawn quietly,
              since they follow from the runs rather than being decisions. */}
          {routeView !== 'off' &&
            junctions.map((junction) => (
              <div
                key={junction.id}
                className={`fitting fitting--${junction.kind} fitting--derived`}
                style={{ left: junction.x * scale, top: junction.y * scale }}
                title={`${junction.label}. ${junction.count} ${
                  junction.kind
                }${junction.count === 1 ? '' : 's'} to build.`}
              >
                {junction.count > 1 ? junction.count : ''}
              </div>
            ))}

          {/* Splitters and mergers the player has decided on. Small, because
              in game they are a single foundation cell at most. */}
          {layout.fittings
            .filter((fitting) => fitting.floorId === layout.activeFloorId)
            .map((fitting) => (
              <button
                type="button"
                key={fitting.id}
                className={`fitting fitting--${fitting.kind}`}
                style={{ left: fitting.x * scale, top: fitting.y * scale }}
                title={`${fitting.kind === 'merger' ? 'Merger' : 'Splitter'}. Right click to remove.`}
                onPointerDown={(event) => event.stopPropagation()}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setMenu({
                    x: event.clientX,
                    y: event.clientY,
                    title: fitting.kind === 'merger' ? 'Merger' : 'Splitter',
                    entries: [
                      {
                        label: 'Remove',
                        danger: true,
                        onSelect: () => layout.removeFitting(fitting.id),
                      },
                    ],
                  })
                }}
              >
                {fitting.kind === 'merger' ? 'M' : 'S'}
              </button>
            ))}

          {activeIndex > 0 && (
            <button
              type="button"
              className="floor__grab"
              // The name is on the deck label and in the toolbar picker
              // already, so the handle only has to be findable, not labelled.
              title={`Drag to move ${activeFloor?.name ?? 'this floor'} over the base`}
              aria-label={`Move ${activeFloor?.name ?? 'this floor'}`}
              onPointerDown={startFloorDrag}
              onPointerMove={continueFloorDrag}
              onPointerUp={endFloorDrag}
              onPointerCancel={endFloorDrag}
            >
              ✥
            </button>
          )}

          {routeView !== 'off' && (
            <RouteLayer
              paths={paths}
              crossings={congestion?.crossings ?? []}
              scale={scale}
              focusModuleId={routeView === 'selected' ? selectedId : null}
              showCrossings={showTangles}
              editingRouteId={editingRouteId}
              editingWaypoints={
                editingRouteId
                  ? (layout.routeOverrides[editingRouteId]?.waypoints ?? [])
                  : []
              }
              onPickRoute={onEditRoute}
              onGrab={startRouteDrag}
              onGrabMove={continueRouteDrag}
              onGrabEnd={endRouteDrag}
              onRunMenu={runMenu}
              onRemoveCorner={(routeId, index) => {
                const corners =
                  layout.routeOverrides[routeId]?.waypoints ?? []
                layout.editRoute(routeId, {
                  waypoints: corners.filter((_, i) => i !== index),
                })
              }}
            />
          )}

          {routeView !== 'off' && (
            <PortLayer
              paths={paths}
              scale={scale}
              floors={layout.floors}
              activeFloorId={layout.activeFloorId}
              labelOf={(id) => modulesById.get(id)?.label ?? null}
              focusModuleId={routeView === 'selected' ? selectedId : null}
            />
          )}

          {showTangles &&
            shaftsHere.map(({ shaft, passingThrough, fouled: bad }) => (
              <div
                key={shaft.id}
                className={[
                  'shaft',
                  passingThrough ? 'shaft--through' : '',
                  bad ? 'shaft--fouled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  // A column is measured in base metres, because it stands in
                  // one place through floors that are offset from each other,
                  // but it's drawn on a deck whose own origin is that offset.
                  // Without taking the origin back off, every lift on an offset
                  // floor lands that far east of where it really stands.
                  // Centred on the column, which is a point rather than a corner.
                  left: (shaft.x - originX) * scale - shaftPx / 2,
                  top: (shaft.y - originY) * scale - shaftPx / 2,
                  width: shaftPx,
                  height: shaftPx,
                }}
                title={`${
                  shaft.link.rise > 0 ? 'Lift up' : 'Drop down'
                } ${Math.abs(shaft.link.rise)} floor${
                  Math.abs(shaft.link.rise) === 1 ? '' : 's'
                }${passingThrough ? ', passing through this floor' : ''}`}
              >
                {shaft.link.rise > 0 ? '↑' : '↓'}
              </div>
            ))}

          {bus && bus.floorId === layout.activeFloorId && (
            <div
              className="bus"
              style={{
                left: bus.x * scale,
                top: bus.y * scale,
                width: bus.width * scale,
                height: bus.depth * scale,
              }}
              title={`Bus corridor, ${bus.width >= bus.depth ? bus.depth : bus.width} m wide. Keep it clear.`}
            >
              <span className="bus__label">bus</span>
            </div>
          )}

          {current.map((placement) => {
            const module = modulesById.get(placement.moduleId)
            if (!module) return null
            const rect = placementRect(module, placement)
            const clashing = collisions.has(placement.moduleId)
            const outside =
              rect.x + rect.width > gridW + 1e-6 ||
              rect.y + rect.depth > gridD + 1e-6
            const isGenerator = module.power < 0
            const isStorage = module.id.startsWith('storage:')
            const crossed = showTangles && overrun.has(placement.moduleId)

            return (
              <div
                key={placement.moduleId}
                className={[
                  'tile',
                  isGenerator ? 'tile--generator' : '',
                  isStorage ? 'tile--storage' : '',
                  clashing ? 'tile--clash' : '',
                  crossed ? 'tile--crossed' : '',
                  outside ? 'tile--outside' : '',
                  selected.has(placement.moduleId) ? 'tile--selected' : '',
                  draggingId === placement.moduleId ? 'tile--dragging' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: rect.x * scale,
                  top: rect.y * scale,
                  width: rect.width * scale,
                  height: rect.depth * scale,
                  // Drawn as a ring outside the block, so the ground arranging
                  // keeps clear for belts is visible rather than taken on trust.
                  '--lane': `${lane * scale}px`,
                } as React.CSSProperties}
                onPointerDown={(e) =>
                  startDrag(e, placement.moduleId, placement.x, placement.y)
                }
                onContextMenu={(e) => blockMenu(e, placement.moduleId)}
                onPointerMove={continueDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <span className="tile__label">
                  <Icon
                    icon={
                      buildings[module.building]?.icon ??
                      allGenerators[module.building]?.icon
                    }
                    name={module.buildingName}
                    size={14}
                  />
                  {module.machines}x {module.buildingName}
                </span>
                <span className="tile__sub">{module.label}</span>
                <span className="tile__size">
                  {rect.width}×{rect.depth} m
                  <span
                    className="tile__flow tile__flow--in"
                    title={`Fed from the ${placement.inputSide} face`}
                  >
                    {SIDE_LABEL[placement.inputSide]}
                  </span>
                  <span
                    className="tile__flow tile__flow--out"
                    title={`Ships out the ${placement.outputSide} face`}
                  >
                    {SIDE_LABEL[placement.outputSide]}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
        </div>
        </div>
      </div>
    </div>
  )
}

export interface ArrangeResult {
  overflow: FactoryModule[]
  /** Metres left along the growth axis, for a bus arrangement. */
  growthRoom: number | null
  /** The corridor to keep clear, for a bus arrangement. */
  bus: BusCorridor | null
}

/** Above this many belt segments the crossing search stops being worth its cost. */
const TUNE_LIMIT = 400

export interface ArrangePlan {
  mode: ArrangeMode
  growth: Growth
  routes?: Route[]
  /** Clear ground kept around each block for belts and pipes, in metres. */
  service?: number
}

/**
 * Lays a set of modules onto one floor: where each block sits and which way its
 * manifolds face. Returns a new placement map rather than writing to the store,
 * so a whole stack can be arranged floor by floor and committed as one step.
 */
function arrangeOnto(options: {
  modules: FactoryModule[]
  floor: Floor
  plan: ArrangePlan
  placements: Record<string, Placement>
  modulesById: Map<string, FactoryModule>
  overrides: Record<string, RouteOverride>
}) {
  const { floor, plan, modulesById, overrides } = options

  // In a canonical order, so the layout is a function of the plan alone. Fed in
  // caller order, adding one recipe could reshuffle every seed and move blocks
  // that had nothing to do with the change.
  const modules = options.modules
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))

  const routes = plan.routes ?? []
  const flows = flowsOf(routes)
  const service = plan.service

  /**
   * Ground held back at the floor's boundary, so nothing is ever built flush to
   * the edge.
   *
   * Only the shortfall, because the column and area packers already leave the
   * lane around every block and an edge block is no exception, so at the usual
   * lane the border is already there and taking another foundation would only
   * cost a block its place for nothing. The bus packer runs its corridor out to
   * the edge on purpose, so there it is the whole foundation.
   */
  const edge =
    plan.mode === 'bus'
      ? EDGE_M
      : Math.max(0, EDGE_M - (service ?? SERVICE_M))

  // Arranging is bounded by the floor, so a small footprint reports what
  // doesn't fit instead of silently growing the grid. The packers get the floor
  // less its border and everything they place is shifted in by it, which keeps
  // the margin in one place rather than in all three of them.
  const bounds = {
    width: Math.max(0, floor.gridWidth * FOUNDATION_M - edge * 2),
    depth: Math.max(0, floor.gridDepth * FOUNDATION_M - edge * 2),
  }

  const bus =
    plan.mode === 'bus'
      ? packAsBus(modules, { bounds, growth: plan.growth, flows, service })
      : null

  /** Lays one packing onto the floor and faces the manifolds. No polish yet. */
  const settle = (result: { packed: PackedModule[]; overflow: FactoryModule[] }) => {
    let placements = { ...options.placements }

    // Arranging lays the plan out from scratch, so what doesn't fit really does
    // go back to the tray. Leaving it placed left a block sitting wherever it
    // happened to be, overlapping whatever was arranged on top of it, while the
    // panel said it had been put away.
    for (const module of result.overflow) delete placements[module.id]

    for (const item of result.packed) {
      // A bus arrangement has a known feed side, so the manifolds face the
      // corridor rather than keeping whatever they had. Without one the faces
      // are decided below, against where the neighbours actually landed.
      const sides = bus
        ? busSides(plan.growth, item, bus.bus)
        : { inputSide: 'west' as Side, outputSide: 'east' as Side }

      placements[item.module.id] = {
        moduleId: item.module.id,
        floorId: floor.id,
        x: item.x + edge,
        y: item.y + edge,
        orientation: 0,
        columns: item.columns,
        ...sides,
      }
    }

    if (!bus && routes.length > 0 && result.packed.length > 0) {
      // Point every manifold at its own neighbours first, which is right for
      // most blocks and costs nothing. The tangles that survive are bought back
      // by the polish rounds.
      placements = faceFlows(placements, modulesById, flows, floor.id)
    }

    return placements
  }

  /**
   * Rounds of turning manifolds and moving tangled blocks, until one buys
   * nothing. Faces and positions trade against each other: turning a manifold
   * can free a block to move somewhere better, and moving it can make a
   * different facing right. Both passes only ever accept improvements, so a
   * round can't make the floor worse, only fail to help.
   */
  const polish = (
    placements: Record<string, Placement>,
    rounds: number,
  ): Record<string, Placement> => {
    const tuning = { routes, modulesById, placements, floor, overrides }
    if (routes.length === 0 || complexityOf(tuning) > TUNE_LIMIT) return placements

    let best = scoreFloor({ ...tuning, placements })
    for (let round = 0; round < rounds; round++) {
      placements = tuneFaces({ ...tuning, placements })
      placements = nudgeTangled({
        routes,
        modulesById,
        placements,
        floor,
        overrides,
        service: service ?? SERVICE_M,
        edge,
      })
      const now = scoreFloor({ ...tuning, placements })
      if (now >= best - 1e-9) break
      best = now
    }
    return placements
  }

  const measure = (placements: Record<string, Placement>) =>
    scoreFloor({ routes, modulesById, placements, floor, overrides })

  /**
   * The candidate layouts, finished and measured, best kept.
   *
   * One packing, however good its rules, is a single sample from a space the
   * rules can't see all of, and which seed wins changes floor to floor. So
   * every candidate gets one polish round, because a packing can't be judged
   * half-dressed: the layout with the worst raw crossings is sometimes the one
   * whose tangles all turn out fixable, and the only way to know is to try.
   * Only the round-one winner gets the remaining rounds, which cost as much
   * again and rarely change the order.
   *
   * The search is also what makes arranging repeatable: the winner is decided
   * by the measured score, not by whatever order the modules arrived in.
   */
  const chosen = (() => {
    if (bus) return { placements: settle(bus), result: bus }

    const candidates: { packed: PackedModule[]; overflow: FactoryModule[] }[] = []
    const seen = new Set<string>()
    const consider = (
      candidate: { packed: PackedModule[]; overflow: FactoryModule[] } | null,
    ) => {
      if (!candidate) return
      // Different seeds often settle on the same layout; polishing and scoring
      // an identical twin is pure waste.
      const signature = candidate.packed
        .map((p) => `${p.module.id}@${p.x},${p.y}`)
        .sort()
        .join('|')
      if (seen.has(signature)) return
      seen.add(signature)
      candidates.push(candidate)
    }

    for (const seed of ['depth', 'name', 'shallow'] as const) {
      consider(packByColumns(modules, { bounds, flows, service, seed }))
    }
    consider(packByStage(modules, { bounds, flows, service }))

    if (candidates.length === 0) {
      const fallback = packByStage(modules, { bounds, flows, service })
      return { placements: polish(settle(fallback), 3), result: fallback }
    }

    // A block in the tray outranks any amount of tidiness, so a candidate that
    // trays more blocks than the best can never win and isn't worth polishing.
    const minOverflow = Math.min(...candidates.map((c) => c.overflow.length))

    let field = candidates
      .filter((c) => c.overflow.length === minOverflow)
      .map((candidate, index) => ({
        candidate,
        index,
        placements: settle(candidate),
        score: Infinity,
        // A candidate is done when a round stops helping; polishing it further
        // would only burn the time the rest of the field needs.
        done: false,
      }))

    for (const entry of field) entry.score = measure(entry.placements)

    /**
     * Rounds are run across the whole field rather than one candidate to the
     * end, because the rankings lie early: the eventual winner is regularly
     * mid-field after one round and only shows itself after two. So everyone
     * gets round one, the plausible get round two, and only the leader gets
     * round three. Ties break on arrival order, which is fixed, so the same
     * plan always picks the same winner.
     */
    const KEEP: Record<number, number> = { 0: 3, 1: 1, 2: 1 }
    for (let round = 0; round < 3 && field.some((f) => !f.done); round++) {
      for (const entry of field) {
        if (entry.done) continue
        const polished = polish(entry.placements, 1)
        const score = measure(polished)
        if (score >= entry.score - 1e-9) {
          entry.done = true
          continue
        }
        entry.placements = polished
        entry.score = score
      }

      field.sort((a, b) => a.score - b.score || a.index - b.index)

      // Nothing tangled leaves the rest of the field only belt length to win
      // on, which isn't worth the search time. Any tangle costs at least 100
      // in the score, and length can't reach that shy of ten kilometres.
      if (field[0].score < 100) break

      // The cull: drop candidates too far behind to plausibly come back. The
      // factor is generous because round-two comebacks are real, but a
      // candidate at several times the leader isn't coming back from that.
      const cutoff = field[0].score * 3
      field = field
        .filter((f, i) => i === 0 || f.score <= cutoff)
        .slice(0, KEEP[round] ?? 1)
    }

    const winner = field[0]
    return { placements: winner.placements, result: winner.candidate }
  })()

  const { placements } = chosen
  const result = chosen.result

  return {
    placements,
    overflow: result.overflow,
    growthRoom: bus?.growthRoom ?? null,
    bus: bus
      ? {
          floorId: floor.id,
          ...bus.bus,
          x: bus.bus.x + edge,
          y: bus.bus.y + edge,
        }
      : null,
  }
}

/**
 * The modules a floor is willing to take.
 *
 * With a floor dedicated to stockpiles, containers belong there and production
 * belongs everywhere else. With no such floor, everything is fair game, so a
 * plan that never asked for one behaves exactly as it did before.
 */
function forFloor(
  modules: FactoryModule[],
  floor: Floor,
  floors: Floor[],
): FactoryModule[] {
  if (!floors.some((f) => floorRole(f) === 'storage')) return modules
  const wantsStorage = floorRole(floor) === 'storage'
  return modules.filter((m) => isStorageModule(m.id) === wantsStorage)
}

/**
 * Arranges every module on the active floor.
 *
 * `compact` fills the floor in production order, minimizing area. `bus` lays the
 * factory along one axis either side of a corridor and leaves the far end open,
 * which costs area but means the next stage doesn't require moving anything.
 */
export function autoArrange(
  modules: FactoryModule[],
  plan: ArrangePlan,
): ArrangeResult {
  const layout = useLayoutStore.getState()
  const floor = layout.floors.find((f) => f.id === layout.activeFloorId)
  if (!floor) return { overflow: modules, growthRoom: null, bus: null }

  const result = arrangeOnto({
    modules: forFloor(modules, floor, layout.floors),
    floor,
    plan,
    placements: layout.placements,
    modulesById: new Map(modules.map((m) => [m.id, m])),
    overrides: layout.routeOverrides,
  })

  // Going through the store action rather than setState keeps the arrangement
  // in localStorage; a bare setState would vanish on reload.
  layout.applyArrangement(result.placements)
  return {
    overflow: result.overflow,
    growthRoom: result.growthRoom,
    bus: result.bus,
  }
}

/**
 * Arranges the whole stack: which floor each block lives on as well as where it
 * sits on that floor.
 *
 * Floors are filled in production order, so material climbs one level at a time
 * and a lift rarely has to pass through a floor it doesn't stop at. Each floor
 * takes what fits and hands the rest up, which is the same question the packer
 * already answers, asked once per floor.
 *
 * Afterwards the lifts are lined up: a column stands at the shipping face it
 * leaves by, and what it feeds is slid under it where there's room, so material
 * arrives where it's wanted instead of crossing the upper floor to get there.
 */
export function arrangeStack(
  modules: FactoryModule[],
  plan: ArrangePlan,
): ArrangeResult {
  const layout = useLayoutStore.getState()
  if (layout.floors.length === 0) {
    return { overflow: modules, growthRoom: null, bus: null }
  }

  const modulesById = new Map(modules.map((m) => [m.id, m]))
  // Nothing is placed to begin with, so a floor's packing can't be steered by
  // where things happened to be sitting from the last arrangement.
  let placements: Record<string, Placement> = {}
  let active: { bus: BusCorridor | null; growthRoom: number | null } = {
    bus: null,
    growthRoom: null,
  }

  // Stockpiles and production are poured separately when a floor is dedicated
  // to storage, so a container can't take a slot on a production floor and a
  // machine can't take one in the warehouse.
  const dedicated = layout.floors.some((f) => floorRole(f) === 'storage')
  let remaining = {
    production: dedicated
      ? modules.filter((m) => !isStorageModule(m.id))
      : modules,
    storage: dedicated ? modules.filter((m) => isStorageModule(m.id)) : [],
  }

  for (const floor of layout.floors) {
    const storage = floorRole(floor) === 'storage'
    const queue = storage ? remaining.storage : remaining.production
    if (queue.length === 0) continue

    const result = arrangeOnto({
      modules: queue,
      floor,
      plan,
      placements,
      modulesById,
      overrides: layout.routeOverrides,
    })

    placements = result.placements
    remaining = storage
      ? { ...remaining, storage: result.overflow }
      : { ...remaining, production: result.overflow }
    if (floor.id === layout.activeFloorId) {
      active = { bus: result.bus, growthRoom: result.growthRoom }
    }
  }

  layout.applyArrangement(placements)

  // Lining the lifts up is worth doing only once everything has a home, since
  // where a column lands depends on both ends.
  alignLifts(modules, modulesById, plan.routes ?? [])

  return {
    overflow: [...remaining.production, ...remaining.storage],
    growthRoom: active.growthRoom,
    bus: active.bus,
  }
}

/** Slides each lift's landing block under the column that feeds it. */
function alignLifts(
  modules: FactoryModule[],
  modulesById: Map<string, FactoryModule>,
  routes: Route[],
) {
  const layout = useLayoutStore.getState()
  const manual = new Set(layout.manualLinks)

  const links = [
    ...findFloorLinks(routes, layout.placements, layout.floors),
    ...findDepotFeeds(modules, layout.placements, layout.floors),
  ]
  const shafts = planShafts(
    links,
    layout.placements,
    modulesById,
    layout.floors,
    manual,
  )

  const moves = adviseOnFloors({
    shafts,
    clashes: findShaftClashes(shafts, layout.placements, modulesById, layout.floors),
    routes,
    placements: layout.placements,
    modulesById,
    floors: layout.floors,
    manual,
    overrides: layout.routeOverrides,
    // Only the landings are wanted here, and those don't read the floors'
    // congestion, so measuring it would be work thrown away.
    congestion: [],
  })
    // Only the alignment: which floor a block belongs on was just decided by
    // the packing, and re-deciding it here would undo that.
    .filter((advice) => advice.kind === 'landing')
    .flatMap((advice) => {
      const fix = advice.fixes.find((f) => f.kind === 'align')
      return fix ? [{ moduleId: fix.moduleId, patch: fix.patch }] : []
    })

  if (moves.length > 0) layout.patchEach(moves)
}

/**
 * Faces a block's manifolds at the bus it sits against, which is the whole
 * point of arranging around one: every run is a short hop to the corridor.
 */
function busSides(
  growth: Growth,
  item: { x: number; y: number; width: number; depth: number },
  bus: { x: number; y: number },
): { inputSide: Side; outputSide: Side } {
  if (growth === 'east') {
    // Blocks above the corridor face down into it, and vice versa.
    const above = item.y + item.depth <= bus.y + 1e-9
    return above
      ? { inputSide: 'south', outputSide: 'south' }
      : { inputSide: 'north', outputSide: 'north' }
  }

  const leftOf = item.x + item.width <= bus.x + 1e-9
  return leftOf
    ? { inputSide: 'east', outputSide: 'east' }
    : { inputSide: 'west', outputSide: 'west' }
}
