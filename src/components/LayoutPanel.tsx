import { useCallback, useMemo, useState } from 'react'
import {
  generators as allGenerators,
  buildings,
  itemName,
  rateUnit,
} from '../data/gameData'
import { adviseOnFloors, type Fix } from '../layout/advice'
import {
  analyseFloor,
  findDepotFeeds,
  findFloorLinks,
  findShaftClashes,
  planShafts,
  type FloorCongestion,
} from '../layout/congestion'
import { GROWTH_LABEL } from '../layout/bus'
import { useLayoutStore } from '../layout/layoutStore'
import { defaultColumns, modulesFromPlan } from '../layout/modules'
import { routePaths, type RoutePath } from '../layout/paths'
import { deriveRoutes } from '../layout/routes'
import { planReserve, storageModules } from '../layout/storage'
import {
  FOUNDATION_M,
  SIDES,
  SIDE_LABEL,
  STORAGE_PREFIX,
  floorRole,
  isStorageModule,
  moduleFootprint,
  type Side,
} from '../layout/types'
import type { PlanResult } from '../solver/interpret'
import { useShortcuts } from '../hooks/useShortcuts'
import { Panel } from './Panel'
import { usePlannerStore } from '../state/plannerStore'
import { useUiStore } from '../state/uiStore'
import { ElevatorPanel } from './ElevatorPanel'
import { Icon, ItemIcon } from './Icon'
import {
  LayoutCanvas,
  arrangeStack,
  autoArrange,
  type BusCorridor,
} from './LayoutCanvas'
import { ReservesPanel } from './ReservesPanel'
import { RoutesPanel } from './RoutesPanel'
import { Segmented } from './Segmented'
import { SideView } from './SideView'
import { TanglePanel } from './TanglePanel'
import { num } from '../format'


export function LayoutPanel({ result }: { result: PlanResult }) {
  const layout = useLayoutStore()
  // A list rather than one id: ctrl-click adds to it, and the last one clicked
  // is the primary, which is what the detail panel and route focus follow.
  const [selection, setSelection] = useState<string[]>([])
  const selectedId = selection.length > 0 ? selection[selection.length - 1] : null

  const pick = useCallback((moduleId: string | null, additive = false) => {
    setSelection((current) => {
      if (moduleId === null) return []
      if (!additive) return [moduleId]
      return current.includes(moduleId)
        ? current.filter((id) => id !== moduleId)
        : [...current, moduleId]
    })
  }, [])
  // The run being drawn by hand. One at a time, since its handles sit on top of
  // everything else on the canvas.
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null)
  const [overflow, setOverflow] = useState<string[]>([])
  const view = useUiStore((s) => s.layoutView)
  const setView = useUiStore((s) => s.setLayoutView)
  const sideOpen = useUiStore((s) => s.sideOpen)
  const setSideOpen = useUiStore((s) => s.setSideOpen)
  const arrangeMode = useUiStore((s) => s.arrangeMode)
  const setArrangeMode = useUiStore((s) => s.setArrangeMode)
  const growth = useUiStore((s) => s.growth)
  const setGrowth = useUiStore((s) => s.setGrowth)
  // Kept in the UI store so the canvas can draw the lane it reserves, and so the
  // setting survives a reload like the rest of how you were working.
  const service = useUiStore((s) => s.lane)
  const setService = useUiStore((s) => s.setLane)
  const [growthRoom, setGrowthRoom] = useState<number | null>(null)
  const [busCorridor, setBusCorridor] = useState<BusCorridor | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 2000)
  }, [])

  const deselect = useCallback(() => setSelection([]), [])

  useShortcuts({ selection, onDeselect: deselect, onNotice: showNotice })

  const targets = usePlannerStore((s) => s.targets)
  const tier = usePlannerStore((s) => s.tier)

  const reserves = useLayoutStore((s) => s.reserves)

  const modules = useMemo(() => {
    const surplusByItem: Record<string, number> = {}
    for (const s of result.surplus) surplusByItem[s.item] = s.rate
    // Storage blocks sit alongside production blocks so they arrange, drag and
    // collide with exactly the same machinery.
    return [
      ...modulesFromPlan(result),
      ...storageModules(reserves, tier, surplusByItem),
    ]
  }, [result, reserves, tier])
  const modulesById = useMemo(
    () => new Map(modules.map((m) => [m.id, m])),
    [modules],
  )

  const routes = useMemo(
    () => deriveRoutes(modules, targets, result.surplus, tier),
    [modules, targets, result.surplus, tier],
  )

  // Every floor is analysed, not just the visible one: the tangle worth finding
  // is usually on the floor you aren't looking at. Both views read this, so the
  // markers on the canvas and the counts in the list can't disagree.
  const byFloor = useMemo(() => {
    const map = new Map<string, { paths: RoutePath[]; congestion: FloorCongestion }>()
    for (const floor of layout.floors) {
      const paths = routePaths({
        routes,
        modulesById,
        placements: layout.placements,
        floorId: floor.id,
        overrides: layout.routeOverrides,
      })
      map.set(floor.id, {
        paths,
        congestion: analyseFloor(
          floor,
          paths,
          Object.values(layout.placements).filter(
            (p) => p.floorId === floor.id,
          ),
          modulesById,
        ),
      })
    }
    return map
  }, [layout.floors, layout.placements, layout.routeOverrides, routes, modulesById])

  const worstFirst = useMemo(
    () =>
      [...byFloor.values()]
        .map((entry) => entry.congestion)
        .sort((a, b) => b.score - a.score),
    [byFloor],
  )

  const floorLinks = useMemo(
    () => [
      ...findFloorLinks(routes, layout.placements, layout.floors),
      ...findDepotFeeds(modules, layout.placements, layout.floors),
    ],
    [routes, modules, layout.placements, layout.floors],
  )

  const manual = useMemo(
    () => new Set(layout.manualLinks),
    [layout.manualLinks],
  )

  const editingLabel = editingRouteId
    ? (() => {
        const route = routes.find((r) => r.id === editingRouteId)
        return route ? `the ${itemName(route.item)} run` : 'this run'
      })()
    : ''

  // A lift is a column through every floor between its ends, so it can foul a
  // machine on a floor neither end is on. Hand-carried links get a column too,
  // so they can be seen on the elevation, but it's marked as needing nothing.
  const shafts = useMemo(
    () =>
      planShafts(
        floorLinks,
        layout.placements,
        modulesById,
        layout.floors,
        manual,
      ),
    [floorLinks, layout.placements, modulesById, layout.floors, manual],
  )

  const shaftClashes = useMemo(
    () =>
      findShaftClashes(shafts, layout.placements, modulesById, layout.floors),
    [shafts, layout.placements, modulesById, layout.floors],
  )

  const shaftAdvice = useMemo(
    () =>
      adviseOnFloors({
        shafts,
        clashes: shaftClashes,
        routes,
        placements: layout.placements,
        modulesById,
        floors: layout.floors,
        manual,
        overrides: layout.routeOverrides,
        congestion: worstFirst,
      }),
    [
      shafts,
      shaftClashes,
      routes,
      layout.placements,
      layout.routeOverrides,
      modulesById,
      layout.floors,
      manual,
      worstFirst,
    ],
  )

  const NOTICE: Record<Fix['kind'], string> = {
    floor: 'Moved to another floor',
    align: 'Lined up with the lift',
    face: 'Shipping face changed',
    move: 'Block moved',
    hand: 'Carried by hand',
  }

  /** Applies one suggestion, whichever kind it is. */
  const applyFix = useCallback(
    (fix: Fix) => {
      if (fix.kind === 'hand') {
        for (const key of fix.links ?? []) {
          if (!manual.has(key)) layout.toggleManualLink(key)
        }
        showNotice('Carried by hand')
        return
      }
      layout.patchEach([{ moduleId: fix.moduleId, patch: fix.patch }])
      showNotice(NOTICE[fix.kind])
    },
    // NOTICE is a literal rebuilt each render and never read asynchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [manual, layout, showNotice],
  )

  /** Takes the first suggestion for each, as one undo step. */
  const clearAllLifts = useCallback(() => {
    const moves = shaftAdvice.flatMap((advice) => {
      const best = advice.fixes.find((f) => f.kind !== 'hand')
      return best ? [{ moduleId: best.moduleId, patch: best.patch }] : []
    })
    if (moves.length === 0) {
      showNotice('Nothing here can be fixed by moving a block')
      return
    }
    layout.patchEach(moves)
    showNotice(`Applied ${moves.length} suggestion${moves.length === 1 ? '' : 's'}`)
  }, [shaftAdvice, layout, showNotice])

  const unplaced = modules.filter((m) => !layout.placements[m.id])

  const tangleCount = worstFirst.reduce(
    (sum, c) => sum + c.crossings.length + c.laneClashes.length + c.overBlocks.length,
    0,
  )
  const selected = selectedId ? modulesById.get(selectedId) : null

  // Every control acts on the whole selection, so it needs to know when the
  // selected blocks disagree: a rotation reads 90 degrees only if they all do.
  const placed = selection
    .map((id) => layout.placements[id])
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
  const shared = <T,>(read: (p: (typeof placed)[number]) => T): T | null => {
    if (placed.length === 0) return null
    const first = read(placed[0])
    return placed.every((p) => read(p) === first) ? first : null
  }
  const sharedColumns = shared((p) => p.columns)
  const sharedFloorId = shared((p) => p.floorId)
  const sharedOrientation = shared((p) => p.orientation)
  const selectedModules = selection
    .map((id) => modulesById.get(id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
  // A block can't have more columns than it has machines, so the tightest of
  // the selected blocks sets the ceiling for all of them.
  const maxColumns = selectedModules.reduce(
    (least, module) => Math.min(least, module.machines),
    Number.POSITIVE_INFINITY,
  )

  const activeFloor = layout.floors.find((f) => f.id === layout.activeFloorId)
  const floorPlacements = Object.values(layout.placements).filter(
    (p) => p.floorId === layout.activeFloorId,
  )

  // Generators carry negative power, so draw and supply separate cleanly.
  const floorStats = floorPlacements.reduce(
    (acc, p) => {
      const module = modulesById.get(p.moduleId)
      if (!module) return acc
      const size = moduleFootprint(module, p.columns, p.orientation)
      return {
        draw: acc.draw + Math.max(0, module.power),
        supply: acc.supply + Math.max(0, -module.power),
        machines: acc.machines + module.machines,
        area: acc.area + size.width * size.depth,
      }
    },
    { draw: 0, supply: 0, machines: 0, area: 0 },
  )

  const isStorageFloor = activeFloor ? floorRole(activeFloor) === 'storage' : false

  // How full the floor is, which is what the raw area and the size were both
  // circling. One number answers "is there room for more".
  const usedFoundations = Math.ceil(
    floorStats.area / (FOUNDATION_M * FOUNDATION_M),
  )
  const totalFoundations =
    (activeFloor?.gridWidth ?? 12) * (activeFloor?.gridDepth ?? 12)

  // What the containers on this floor actually hold. Read off the reserve plans
  // rather than the blocks, because capacity depends on the item's stack size:
  // the same container holds 200 Iron Plate or 50 Heavy Modular Frame.
  const floorStorage = floorPlacements.reduce(
    (acc, p) => {
      if (!isStorageModule(p.moduleId)) return acc
      const item = p.moduleId.slice(STORAGE_PREFIX.length)
      const reserve = reserves.find((r) => r.item === item)
      if (!reserve) return acc
      const plan = planReserve(
        reserve,
        tier,
        result.surplus.find((s) => s.item === item)?.rate ?? 0,
      )
      return {
        containers: acc.containers + plan.containers,
        capacity: acc.capacity + plan.actualCapacity,
      }
    },
    { containers: 0, capacity: 0 },
  )

  if (modules.length === 0 && reserves.length === 0) {
    return (
      <div className="graph-empty">
        <p>Solve a production plan first, then its machines show up here to arrange.</p>
      </div>
    )
  }

  return (
    <div className="layout-panel">
      {view === 'top' ? (
        <LayoutCanvas
          modules={modules}
          selection={selection}
          onSelect={pick}
          paths={byFloor.get(layout.activeFloorId)?.paths ?? []}
          congestion={byFloor.get(layout.activeFloorId)?.congestion ?? null}
          shafts={shafts}
          shaftClashes={shaftClashes}
          bus={busCorridor}
          view={view}
          onViewChange={setView}
          editingRouteId={editingRouteId}
          onEditRoute={setEditingRouteId}
        />
      ) : (
        <SideView
          modules={modules}
          selection={selection}
          onSelect={pick}
          shafts={shafts}
          shaftClashes={shaftClashes}
          congestionByFloor={byFloor}
          view={view}
          onViewChange={setView}
        />
      )}

      <aside className={`layout-panel__side ${sideOpen ? '' : 'layout-panel__side--shut'}`}>
        {/* The handle only exists on a narrow screen, where the controls and the
            floor are stacked and one of them has to give. Collapsed it still
            reports what needs attention, so closing it doesn't mean losing
            track of a tangle or a block left in the tray. */}
        <button
          type="button"
          className="sheet"
          aria-expanded={sideOpen}
          onClick={() => setSideOpen(!sideOpen)}
          title={sideOpen ? 'Hide the controls' : 'Show the controls'}
        >
          <span className="sheet__grip" aria-hidden="true" />
          <span className="sheet__label">
            {placed.length === 0
              ? 'Controls'
              : placed.length === 1 && selected
                ? selected.label
                : `${placed.length} blocks`}
          </span>
          {tangleCount > 0 && (
            <span className="badge badge--warn">
              {tangleCount} tangle{tangleCount === 1 ? '' : 's'}
            </span>
          )}
          {unplaced.length > 0 && (
            <span className="badge">{unplaced.length} in tray</span>
          )}
          <span className="sheet__chevron" aria-hidden="true">
            {sideOpen ? '▾' : '▸'}
          </span>
        </button>
        <div className="layout-panel__scroll">
        {placed.length > 0 && (
          <section className="section">
            <h2 className="section__title">
              {placed.length === 1 && selected
                ? selected.label
                : `${placed.length} blocks selected`}
            </h2>
            <p className="muted" style={{ margin: '0 0 6px', fontSize: 12 }}>
              {placed.length === 1 && selected ? (
                <>
                  {selected.machines}x {selected.buildingName} @{' '}
                  {num(selected.clock * 100)}%
                </>
              ) : (
                'Every control here applies to all of them. Drag any one to move the set; arrow keys nudge them together.'
              )}
            </p>
            <div className="row">
              <span className="row__grow">Machines per row</span>
              <input
                className="input input--rate"
                type="number"
                min={1}
                max={maxColumns}
                // Blank rather than a lie when the selected blocks differ.
                value={sharedColumns ?? ''}
                placeholder="mixed"
                onChange={(e) =>
                  layout.patchMany(selection, {
                    columns: Math.max(1, Number(e.target.value) || 1),
                  })
                }
              />
            </div>
            {(['inputSide', 'outputSide'] as const).map((which) => (
              <div className="row" key={which}>
                <span
                  className={`row__grow ${
                    which === 'inputSide' ? 'flow-in' : 'flow-out'
                  }`}
                >
                  {which === 'inputSide' ? 'Feed from' : 'Ship out'}
                </span>
                <div className="btngroup">
                  {SIDES.map((side: Side) => (
                    <button
                      key={side}
                      type="button"
                      className={`btn btn--icon ${
                        shared((p) => p[which]) === side ? 'btn--active' : ''
                      }`}
                      title={`${which === 'inputSide' ? 'Feed' : 'Ship'} along the ${side} face`}
                      onClick={() => layout.patchMany(selection, { [which]: side })}
                    >
                      {SIDE_LABEL[side]}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {layout.floors.length > 1 && (
              <div className="row">
                <span className="row__grow">On floor</span>
                <select
                  className="select"
                  style={{ width: 'auto' }}
                  value={sharedFloorId ?? ''}
                  onChange={(e) =>
                    e.target.value &&
                    layout.setFloorOfMany(selection, e.target.value)
                  }
                >
                  {sharedFloorId === null && (
                    <option value="">Spread over floors…</option>
                  )}
                  {layout.floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="btngroup" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => layout.rotateMany(selection)}
                title="Turn 90 degrees (R)"
              >
                Rotate{sharedOrientation === null ? '' : ` ${sharedOrientation}°`}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => layout.flipMany(selection)}
                title="Mirror the machines, swapping the feed face with the shipping face (F)"
              >
                Flip
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  layout.setColumnsEach(
                    selectedModules.map((module) => ({
                      moduleId: module.id,
                      columns: defaultColumns(module),
                    })),
                  )
                }
                title="Give each block the squarest footprint it has"
              >
                Square up
              </button>
              {placed.length > 1 && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setSelection([])}
                >
                  Clear selection
                </button>
              )}
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  layout.removeMany(selection)
                  setSelection([])
                }}
                title="Send back to the tray (Delete)"
              >
                Unplace{placed.length > 1 ? ' all' : ''}
              </button>
            </div>
            {/* Only for a single block: summing rates across a selection would
                describe a throughput no belt in it actually carries. */}
            {placed.length === 1 && selected && (
            <table className="table" style={{ marginTop: 8 }}>
              <tbody>
                {selected.inputs.map((i) => (
                  <tr key={`in-${i.item}`}>
                    <td className="muted">in</td>
                    <td>
                      <span className="cell">
                        <ItemIcon item={i.item} size={16} />
                        {itemName(i.item)}
                      </span>
                    </td>
                    <td className="num">
                      {num(i.rate)}
                      <span className="muted">{rateUnit(i.item)}</span>
                    </td>
                  </tr>
                ))}
                {selected.outputs.map((o) => (
                  <tr key={`out-${o.item}`}>
                    <td className="muted">out</td>
                    <td>
                      <span className="cell">
                        <ItemIcon item={o.item} size={16} />
                        {itemName(o.item)}
                      </span>
                    </td>
                    <td className="num">
                      {num(o.rate)}
                      <span className="muted">{rateUnit(o.item)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </section>
        )}
        <Panel
          title="Arrange"
          defaultOpen
          summary={`${arrangeMode === 'bus' ? 'Bus line' : 'Flow columns'} · ${
            service === 0 ? 'no lane' : `${service} m lane`
          }`}
        >
          <div className="arrange">
            <Segmented
              label="How blocks are arranged"
              value={arrangeMode}
              onChange={setArrangeMode}
              options={[
                {
                  value: 'compact',
                  label: 'Flow columns',
                  title:
                    'Material flows west to east, a column per stage. Tries several layouts and keeps the one that measures best, so the same plan always arranges the same way.',
                },
                {
                  value: 'bus',
                  label: 'Bus line',
                  title:
                    'One corridor with blocks either side, open at the far end so you can extend without moving anything.',
                },
              ]}
            />
            {arrangeMode === 'bus' && (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="row__grow muted" style={{ fontSize: 12 }}>
                  Leave room to grow
                </span>
                <Segmented
                  label="Direction the factory can grow"
                  value={growth}
                  onChange={setGrowth}
                  options={[
                    { value: 'east', label: 'East', title: 'Extend the bus to the right' },
                    { value: 'south', label: 'South', title: 'Extend the bus downward' },
                  ]}
                />
              </div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <span className="row__grow muted" style={{ fontSize: 12 }}>
                Lane round each block
              </span>
              <Segmented
                label="Clear ground kept around each block"
                value={service}
                onChange={setService}
                options={[
                  {
                    value: 0,
                    label: 'None',
                    title:
                      'Blocks touch. Tightest floor, but nowhere to run a manifold.',
                  },
                  {
                    value: FOUNDATION_M,
                    label: '8 m',
                    title:
                      'One foundation each side: room for a belt or a pipe on any face.',
                  },
                  {
                    value: FOUNDATION_M * 2,
                    label: '16 m',
                    title:
                      'Two foundations each side: a manifold with splitters, and room to walk.',
                  },
                ]}
              />
            </div>
          </div>

          <div className="btngroup" style={{ marginTop: 10 }}>
            <button
              type="button"
              className={`btn ${unplaced.length > 0 ? 'btn--primary' : ''}`}
              onClick={() => {
                const result = autoArrange(modules, {
                  mode: arrangeMode,
                  growth,
                  routes,
                  service,
                })
                setOverflow(result.overflow.map((m) => m.label))
                setGrowthRoom(result.growthRoom)
                setBusCorridor(result.bus)
              }}
              title="Lay every block on this floor out from scratch"
            >
              This floor
              {unplaced.length > 0 && (
                <span className="badge">{unplaced.length}</span>
              )}
            </button>
            {layout.floors.length > 1 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const result = arrangeStack(modules, {
                    mode: arrangeMode,
                    growth,
                    routes,
                    service,
                  })
                  setOverflow(result.overflow.map((m) => m.label))
                  setGrowthRoom(result.growthRoom)
                  setBusCorridor(result.bus)
                  showNotice(
                    `Arranged ${layout.floors.length} floors, lifts lined up`,
                  )
                }}
                title="Lay the whole stack out: which floor each block goes on, where it sits, and where the lifts land"
              >
                All floors
              </button>
            )}
            {/* Emptying a floor is undone by arranging again, so it stays a
                plain button. Only losing the floor itself is destructive, and
                that lives with the floor's own controls. */}
            <button
              type="button"
              className="btn"
              onClick={() => layout.clearFloor(layout.activeFloorId)}
              title="Send every block on this floor back to the tray"
            >
              Clear
            </button>
          </div>

          {growthRoom !== null && (
            <p
              className={`note ${growthRoom <= 0 ? 'note--warn' : 'note--ok'}`}
              title={`Free space at the ${GROWTH_LABEL[growth]} end of the bus, where the next stage would go`}
            >
              {growthRoom > 0
                ? `${growthRoom / FOUNDATION_M} foundations to grow ${GROWTH_LABEL[growth]}`
                : `No room left ${GROWTH_LABEL[growth]}`}
            </p>
          )}

          {editingRouteId && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="row__grow muted" style={{ fontSize: 12 }}>
                Drawing {editingLabel}. Drag the ends around a block to pick a
                port, the dots to bend it, and double click a corner to drop it.
              </span>
              <div className="btngroup btngroup--joined">
                <button
                  type="button"
                  className="btn btn--tiny"
                  onClick={() => {
                    layout.resetRoute(editingRouteId)
                    showNotice('Back to the routed line')
                  }}
                  disabled={!layout.routeOverrides[editingRouteId]}
                  title="Throw away the drawn line and let the router lay it out again"
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="btn btn--tiny"
                  onClick={() => setEditingRouteId(null)}
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {notice && <p className="note note--ok">{notice}</p>}
        </Panel>

        {/* The floor's own properties, all of them, in one place. Size and
            position used to live in the canvas toolbar, which put half a
            floor's settings a screen away from the other half. */}
        <Panel
          title="Floor"
          summary={`${activeFloor?.gridWidth ?? 12}×${
            activeFloor?.gridDepth ?? 12
          } · ${
            isStorageFloor
              ? `${floorStorage.containers} container${
                  floorStorage.containers === 1 ? '' : 's'
                }, ${num(floorStorage.capacity)} held`
              : `${floorStats.machines} machines, ${num(floorStats.draw)} MW`
          }`}
        >
          <div className="row">
            <label className="field row__grow" title="Name this floor">
              <span className="field__label">Name</span>
              <input
                className="input row__grow"
                value={activeFloor?.name ?? ''}
                aria-label="Floor name"
                onChange={(e) =>
                  layout.renameFloor(layout.activeFloorId, e.target.value)
                }
              />
            </label>
          </div>

          <div className="row">
            <span className="row__grow">For</span>
            <Segmented
              label="What this floor is for"
              value={activeFloor ? floorRole(activeFloor) : 'production'}
              onChange={(role) =>
                layout.setFloorRole(layout.activeFloorId, role)
              }
              options={[
                {
                  value: 'production' as const,
                  label: 'Machines',
                  title: 'Production blocks. Stockpiles go on a storage floor.',
                },
                {
                  value: 'storage' as const,
                  label: 'Storage',
                  title:
                    'Stockpiles only. Arranging keeps containers here and machines off it.',
                },
              ]}
            />
          </div>

          <div className="row">
            <span className="row__grow" title="Floor size in 8 m foundations">
              Size
            </span>
            <input
              className="input input--tiny"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              aria-label="Floor width in foundations"
              value={activeFloor?.gridWidth ?? 12}
              onChange={(e) =>
                layout.setFloorSize(
                  layout.activeFloorId,
                  Number(e.target.value) || 1,
                  activeFloor?.gridDepth ?? 12,
                )
              }
            />
            <span className="field__sep">×</span>
            <input
              className="input input--tiny"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              aria-label="Floor depth in foundations"
              value={activeFloor?.gridDepth ?? 12}
              onChange={(e) =>
                layout.setFloorSize(
                  layout.activeFloorId,
                  activeFloor?.gridWidth ?? 12,
                  Number(e.target.value) || 1,
                )
              }
            />
          </div>

          <div className="row">
            <span
              className="row__grow"
              title="Where this floor sits in the base, in metres. Offset an upper floor to build it over a different area."
            >
              Sits at
            </span>
            <input
              className="input input--tiny"
              type="number"
              inputMode="numeric"
              step={FOUNDATION_M}
              aria-label="Floor origin east"
              value={activeFloor?.originX ?? 0}
              onChange={(e) =>
                layout.setFloorOrigin(
                  layout.activeFloorId,
                  Number(e.target.value) || 0,
                  activeFloor?.originY ?? 0,
                )
              }
            />
            <span className="field__sep">,</span>
            <input
              className="input input--tiny"
              type="number"
              inputMode="numeric"
              step={FOUNDATION_M}
              aria-label="Floor origin south"
              value={activeFloor?.originY ?? 0}
              onChange={(e) =>
                layout.setFloorOrigin(
                  layout.activeFloorId,
                  activeFloor?.originX ?? 0,
                  Number(e.target.value) || 0,
                )
              }
            />
          </div>

          <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>
            {usedFoundations} of {totalFoundations} foundations built on
          </p>

          {/* Moving the floor up and down the stack lives in the toolbar, next
              to the picker that selects it. */}
          <div className="btngroup" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn"
              onClick={() => layout.duplicateFloor(layout.activeFloorId)}
              title="New floor above with this one's size, height and offset"
            >
              Duplicate
            </button>
            {layout.floors.length > 1 && (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => layout.removeFloor(layout.activeFloorId)}
                title="Remove this floor and everything on it"
              >
                Delete
              </button>
            )}
          </div>
        </Panel>


        <TanglePanel
          floors={worstFirst}
          links={floorLinks}
          shaftClashes={shaftClashes}
          allFloors={layout.floors}
          activeFloorId={layout.activeFloorId}
          onPickFloor={layout.setActiveFloor}
          manual={manual}
          onToggleManual={layout.toggleManualLink}
          advice={shaftAdvice}
          onApplyFix={applyFix}
          onClearAllLifts={clearAllLifts}
        />

        <ElevatorPanel result={result} tier={tier} />

        <ReservesPanel result={result} tier={tier} />

        <RoutesPanel
          routes={routes}
          modulesById={modulesById}
          focusModuleId={selectedId}
        />

        <Panel
          title="Tray"
          defaultOpen={unplaced.length > 0}
          summary={
            unplaced.length === 0
              ? 'everything placed'
              : `${unplaced.length} waiting`
          }
        >
          {/* What an arrange couldn't fit belongs here, with the rest of what
              isn't placed, rather than in a section of its own saying the same
              blocks are in the tray. */}
          {overflow.length > 0 && (
            <p className="note note--warn">
              {overflow.length} block{overflow.length === 1 ? '' : 's'} wouldn't
              fit: {overflow.join(', ')}. Enlarge the floor, add another level,
              or arrange all floors.
            </p>
          )}
          {unplaced.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              Everything in the plan is placed.
            </p>
          )}
          {unplaced.map((module) => {
            const size = moduleFootprint(module, defaultColumns(module), 0)
            return (
              <div className="row" key={module.id}>
                <span className="row__grow">
                  <Icon
                    icon={
                      buildings[module.building]?.icon ??
                      allGenerators[module.building]?.icon
                    }
                    name={module.buildingName}
                    size={16}
                  />
                  {module.machines}x {module.buildingName}
                  <br />
                  <span className="muted" style={{ fontSize: 12 }}>
                    {module.label} · {size.width}×{size.depth} m
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn--icon"
                  onClick={() => {
                    useLayoutStore.getState().place(module, 0, 0)
                    layout.setColumns(module.id, defaultColumns(module))
                    setSelection([module.id])
                  }}
                >
                  Place
                </button>
              </div>
            )
          })}
        </Panel>
        </div>
      </aside>
    </div>
  )
}
