import { useMemo, useRef, useState } from 'react'
import { itemName } from '../data/gameData'
import { useLayoutStore } from '../layout/layoutStore'
import type {
  FloorCongestion,
  Shaft,
  ShaftClash,
} from '../layout/congestion'
import type { FactoryModule } from '../layout/types'
import {
  FOUNDATION_M,
  floorBases,
  placementRect,
  storeyHeights,
} from '../layout/types'
import { useCanvasZoom } from '../hooks/useCanvasZoom'
import { Compass } from './Compass'
import { ViewToggle, type LayoutView } from './ViewToggle'

interface Props {
  modules: FactoryModule[]
  /** Selected blocks, the last being the primary. */
  selection: string[]
  onSelect: (moduleId: string | null, additive?: boolean) => void
  /** Vertical runs between floors, as the columns they occupy. */
  shafts: Shaft[]
  shaftClashes: ShaftClash[]
  congestionByFloor: Map<string, { congestion: FloorCongestion }>
  view: LayoutView
  onViewChange: (view: LayoutView) => void
}

/** Which way the elevation is drawn from. */
type Eye = 'south' | 'west'

const EYE_LABEL: Record<Eye, string> = {
  south: 'south',
  west: 'west',
}

/** Screen pixels per horizontal metre. */
const BASE_SCALE = 3

/**
 * Vertical metres are drawn this much larger than horizontal ones. An 8 m
 * storey against a 96 m floor is a sliver at true scale, so elevations
 * routinely stretch the vertical axis. Heights stay proportional to each other,
 * which is what the headroom check reads.
 */
const VERTICAL_EXAGGERATION = 4

/** Room left above the top floor so its blocks aren't clipped. */
const HEADROOM_M = 3

/** Assumed height for the open top storey, when nothing tall stands on it. */
const DEFAULT_STOREY_M = 8

/** Thickness of a foundation deck, drawn to scale. */
const DECK_M = 1

/** Left column holding floor names, clear of the blocks. */
const GUTTER_PX = 78

interface Bar {
  moduleId: string
  label: string
  buildingName: string
  machines: number
  /** Across the elevation, in metres. */
  offset: number
  span: number
  /** Above the ground floor's deck, in metres. */
  base: number
  height: number
  /** Set when the block won't fit under the floor above. */
  overHeight: boolean
}

export function SideView({
  modules,
  selection,
  onSelect,
  shafts,
  shaftClashes,
  congestionByFloor,
  view,
  onViewChange,
}: Props) {
  const floors = useLayoutStore((s) => s.floors)
  const placements = useLayoutStore((s) => s.placements)
  const setFloorElevation = useLayoutStore((s) => s.setFloorElevation)
  const activeFloorId = useLayoutStore((s) => s.activeFloorId)
  const endGroup = useLayoutStore((s) => s.endGroup)
  const setActiveFloor = useLayoutStore((s) => s.setActiveFloor)
  const [eye, setEye] = useState<Eye>('south')
  const { zoom, step, scrollRef, surfaceRef } = useCanvasZoom<SVGSVGElement>()
  const selected = new Set(selection)

  // Dragging a deck upward raises that floor. Held in a ref so the first move
  // is already live, the same as every other drag here.
  const riseDrag = useRef<{
    floorId: string
    startY: number
    startRise: number
    pointerId: number
  } | null>(null)
  const [risingFloor, setRisingFloor] = useState<string | null>(null)

  const scale = BASE_SCALE * zoom
  const modulesById = useMemo(
    () => new Map(modules.map((m) => [m.id, m])),
    [modules],
  )

  const storeys = storeyHeights(floors)
  const bases = floorBases(floors)
  const floorIndex = new Map(floors.map((f, i) => [f.id, i]))

  // Depth collapses away, so a block is a bar as wide as it is on the axis
  // being looked along and as tall as one machine.
  const bars: Bar[][] = floors.map(() => [])
  for (const placement of Object.values(placements)) {
    const module = modulesById.get(placement.moduleId)
    const index = floorIndex.get(placement.floorId)
    if (!module || index === undefined) continue

    const rect = placementRect(module, placement)
    const height = module.machineFootprint.height
    const floor = floors[index]
    // An elevation shows the whole base, so a floor offset sideways draws
    // offset too. Positions are floor-local until here.
    const shift = eye === 'south' ? floor.originX : floor.originY
    bars[index].push({
      moduleId: placement.moduleId,
      label: module.label,
      buildingName: module.buildingName,
      machines: module.machines,
      offset: (eye === 'south' ? rect.x : rect.y) + shift,
      span: eye === 'south' ? rect.width : rect.depth,
      base: bases[index],
      height,
      overHeight: height > storeys[index] + 1e-6,
    })
  }

  // Overlapping bars are unavoidable once depth is collapsed, so draw the
  // widest first and let narrow blocks read on top of them.
  for (const list of bars) list.sort((a, b) => b.span - a.span)

  const fouled = useMemo(
    () => new Set(shaftClashes.map((c) => c.shaftId)),
    [shaftClashes],
  )

  const risers = useMemo(
    () => risersFor(shafts, bases, eye, fouled),
    [shafts, bases, eye, fouled],
  )

  const vScale = scale * VERTICAL_EXAGGERATION
  // An offset floor reaches further than its own size, so the canvas has to
  // cover origin plus extent or the far end is clipped.
  const widest = Math.max(
    ...floors.map(
      (f) =>
        (eye === 'south' ? f.originX : f.originY) +
        (eye === 'south' ? f.gridWidth : f.gridDepth) * FOUNDATION_M,
    ),
  )
  const topFloorTallest = Math.max(
    0,
    ...bars[bars.length - 1].map((b) => b.height),
  )
  const totalHeight =
    bases[bases.length - 1] +
    // The top storey is unbounded, so the canvas is sized by what stands on it.
    Math.max(topFloorTallest, DEFAULT_STOREY_M) +
    HEADROOM_M +
    // Room under the ground deck, which hangs below zero like every other.
    DECK_M

  const width = GUTTER_PX + widest * scale
  const height = totalHeight * vScale

  /** Metres above the ground deck to a y in SVG space, where up is negative. */
  const toY = (metres: number) => (totalHeight - DECK_M - metres) * vScale

  /** Metres along the elevation to an x, past the label gutter. */
  const toX = (metres: number) => GUTTER_PX + metres * scale

  /**
   * Drag a deck up or down to set that floor's rise. Working in metres from the
   * pointer's own travel rather than its absolute position keeps it steady when
   * the canvas resizes mid-drag, which it does as the stack gets taller.
   */
  const startRiseDrag = (
    event: React.PointerEvent<SVGGElement>,
    floorId: string,
    rise: number,
  ) => {
    event.stopPropagation()
    riseDrag.current = {
      floorId,
      startY: event.clientY,
      startRise: rise,
      pointerId: event.pointerId,
    }
    setRisingFloor(floorId)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Works while the pointer stays on the deck even without capture.
    }
  }

  const continueRiseDrag = (event: React.PointerEvent<SVGGElement>) => {
    const drag = riseDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    // Up on screen is a bigger rise, and the vertical scale is exaggerated.
    const metres = (drag.startY - event.clientY) / vScale
    setFloorElevation(drag.floorId, drag.startRise + metres)
  }

  const endRiseDrag = (event: React.PointerEvent<SVGGElement>) => {
    const drag = riseDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    riseDrag.current = null
    setRisingFloor(null)
    endGroup()
  }

  const overHeightCount = bars.flat().filter((b) => b.overHeight).length
  const activeIndex = floorIndex.get(activeFloorId) ?? 0
  const tangleOf = (floorId: string) =>
    congestionByFloor.get(floorId)?.congestion.score ?? 0

  return (
    <div className="layout">
      <div className="layout__toolbar">
        <ViewToggle value={view} onChange={onViewChange} />

        <span className="toolbar__divider" />

        <button
          type="button"
          className="btn btn--icon"
          onClick={() => setEye(eye === 'south' ? 'west' : 'south')}
          title="Which side the elevation is drawn from"
        >
          <span className="btn__key">Facing</span>
          {EYE_LABEL[eye]}
        </button>
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
        {floors.length > 1 && (
          <label className="field" title="Storey height above the floor below">
            <span className="field__label">Rise</span>
            <input
              className="input input--tiny"
              type="number"
              inputMode="decimal"
              min={1}
              max={100}
              step={1}
              value={floors[activeIndex]?.elevation ?? 8}
              disabled={activeIndex === 0}
              onChange={(e) =>
                setFloorElevation(activeFloorId, Number(e.target.value) || 8)
              }
            />
            <span className="field__sep">m</span>
          </label>
        )}
        <span className="toolbar__divider" />

        <span className="chip" title="Heights are drawn stretched so storeys read">
          vert ×{VERTICAL_EXAGGERATION}
        </span>
        {overHeightCount > 0 && (
          <span className="chip chip--bad">
            {overHeightCount} too tall for its storey
          </span>
        )}
        {risers.length > 0 && (
          <span className="chip">{risers.length} between floors</span>
        )}
      </div>

      <div className="layout__scroll" ref={scrollRef}>
        <Compass facing={eye} />
        <svg
          ref={surfaceRef}
          className="elevation"
          data-pan=""
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onSelect(null)
          }}
        >
          {floors.map((floor, index) => {
            const deck = toY(bases[index])
            const floorWidth =
              (eye === 'south' ? floor.gridWidth : floor.gridDepth) *
              FOUNDATION_M *
              scale
            const deckStart = eye === 'south' ? floor.originX : floor.originY
            const canRaise = index > 0
            return (
              <g
                key={floor.id}
                className={`elevation__floorgroup ${
                  canRaise ? 'elevation__floorgroup--draggable' : ''
                } ${risingFloor === floor.id ? 'elevation__floorgroup--rising' : ''}`}
                onPointerDown={(e) => {
                  setActiveFloor(floor.id)
                  if (canRaise) startRiseDrag(e, floor.id, floor.elevation)
                }}
                onPointerMove={canRaise ? continueRiseDrag : undefined}
                onPointerUp={canRaise ? endRiseDrag : undefined}
                onPointerCancel={canRaise ? endRiseDrag : undefined}
              >
                {canRaise && <title>Drag up or down to set this floor's rise</title>}
                {/* A grab band thicker than the deck itself, so the deck stays
                    thin to scale while still being easy to catch. */}
                {canRaise && (
                  <rect
                    className="elevation__grab"
                    x={toX(deckStart)}
                    y={deck - 9}
                    width={floorWidth}
                    height={18 + DECK_M * vScale}
                  />
                )}
                <rect
                  className={`elevation__deck ${
                    floor.id === activeFloorId ? 'elevation__deck--active' : ''
                  }`}
                  x={toX(deckStart)}
                  y={deck}
                  width={floorWidth}
                  height={DECK_M * vScale}
                />
                <line
                  className="elevation__rule"
                  x1={GUTTER_PX}
                  x2={width}
                  y1={deck}
                  y2={deck}
                />
                <text className="elevation__floor" x={4} y={deck - 4}>
                  {floor.name}
                </text>
                <text className="elevation__height" x={4} y={deck + 9}>
                  at {bases[index]} m
                  {index > 0 && ` · rise ${floor.elevation} m`}
                </text>
                {tangleOf(floor.id) > 0 && (
                  <text className="elevation__tangle" x={4} y={deck + 20}>
                    {tangleOf(floor.id)} tangles
                  </text>
                )}
              </g>
            )
          })}

          {bars.map((list, index) =>
            list.map((bar) => {
              const top = toY(bar.base + bar.height)
              const barHeight = bar.height * vScale
              return (
                <g
                  key={bar.moduleId}
                  className={[
                    'elevation__block',
                    bar.overHeight ? 'elevation__block--tall' : '',
                    selected.has(bar.moduleId)
                      ? 'elevation__block--selected'
                      : '',
                    index === activeIndex ? '' : 'elevation__block--other',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPointerDown={(e) =>
                    onSelect(bar.moduleId, e.ctrlKey || e.metaKey || e.shiftKey)
                  }
                >
                  <title>
                    {`${bar.machines}x ${bar.buildingName} (${bar.label}), ${bar.height} m tall`}
                  </title>
                  <rect
                    x={toX(bar.offset)}
                    y={top}
                    width={bar.span * scale}
                    height={barHeight}
                  />
                  {bar.span * scale > 52 && barHeight > 12 && (
                    <text x={toX(bar.offset) + 4} y={top + 12}>
                      {bar.machines}x {bar.buildingName}
                    </text>
                  )}
                  {bar.span * scale > 52 && barHeight > 26 && (
                    <text
                      className="elevation__blocksub"
                      x={toX(bar.offset) + 4}
                      y={top + 24}
                    >
                      {bar.label} · {bar.height} m
                    </text>
                  )}
                </g>
              )
            }),
          )}

          {risers.map((riser) => {
            const x = toX(riser.offset)
            const from = toY(riser.fromBase)
            const to = toY(riser.toBase)
            // The column is vertical, then the belt runs along the floor it
            // arrives on to reach the face it feeds. Drawing that last stretch
            // is what says which side of the floor above it comes down on.
            const lands = riser.landing !== null ? toX(riser.landing) : x
            const jogs = Math.abs(lands - x) > 1
            return (
              <g
                className={[
                  'elevation__riser',
                  riser.manual ? 'elevation__riser--manual' : '',
                  riser.fouled ? 'elevation__riser--fouled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={riser.id}
              >
                <title>{riser.label}</title>
                <polyline
                  className="elevation__riserline"
                  points={`${x},${from} ${x},${to} ${lands},${to}`}
                />
                {jogs ? (
                  <polygon
                    points={arrowAcross(lands, to, lands > x ? 1 : -1)}
                  />
                ) : (
                  <polygon points={arrowPoints(x, to, from > to ? -1 : 1)} />
                )}
                {/* Marks the transfer as one the player makes, not the factory. */}
                {riser.manual && (
                  <text
                    className="elevation__risermark"
                    x={x + 5}
                    y={(from + to) / 2}
                  >
                    hand
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {risers.length > 0 && (
        <div className="elevation__legend">
          {risers.some((r) => !r.manual) && (
            <>
              <span className="muted">Needs a lift or riser:</span>{' '}
              {risers
                .filter((r) => !r.manual)
                .map((r) => r.label)
                .join(' · ')}
            </>
          )}
          {risers.some((r) => r.manual) && (
            <>
              <span className="muted"> Carried by hand:</span>{' '}
              {risers
                .filter((r) => r.manual)
                .map((r) => r.label.replace(' (by hand)', ''))
                .join(' · ')}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Triangle at the end of a riser, pointing the way material travels. */
function arrowPoints(x: number, y: number, direction: 1 | -1): string {
  const tip = y + direction * 2
  const back = y - direction * 7
  return `${x},${tip} ${x - 4},${back} ${x + 4},${back}`
}

/** The same, lying on its side for the stretch along the floor it lands on. */
function arrowAcross(x: number, y: number, direction: 1 | -1): string {
  const tip = x + direction * 2
  const back = x - direction * 7
  return `${tip},${y} ${back},${y - 4} ${back},${y + 4}`
}

interface Riser {
  id: string
  offset: number
  /** Where it lands across the elevation, when the far block is placed. */
  landing: number | null
  fromBase: number
  toBase: number
  fouled: boolean
  manual: boolean
  label: string
}

/**
 * Each vertical run as a line on the elevation, drawn at the same spot the
 * clash check uses so a red riser and a reported clash always agree.
 */
function risersFor(
  shafts: Shaft[],
  bases: number[],
  eye: Eye,
  fouled: Set<string>,
): Riser[] {
  return shafts.map((shaft) => {
    const climbed = Math.abs(shaft.link.rise)
    const note = shaft.manual
      ? ' (by hand)'
      : fouled.has(shaft.id)
        ? ' (blocked)'
        : ''
    const what = shaft.link.depot
      ? `${itemName(shaft.link.item)} reserve, filled from`
      : itemName(shaft.link.item)
    const landing = eye === 'south' ? shaft.toX : shaft.toY
    return {
      id: shaft.id,
      offset: eye === 'south' ? shaft.x : shaft.y,
      landing,
      fromBase: bases[shaft.link.rise > 0 ? shaft.low : shaft.high],
      toBase: bases[shaft.link.rise > 0 ? shaft.high : shaft.low],
      fouled: fouled.has(shaft.id),
      manual: shaft.manual,
      label: `${what} ${
        shaft.link.rise > 0 ? 'up' : 'down'
      } ${climbed} floor${climbed === 1 ? '' : 's'}${note}`,
    }
  })
}
