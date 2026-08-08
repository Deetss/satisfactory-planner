import type { Crossing } from '../layout/congestion'
import type { Point, RoutePath } from '../layout/paths'
import { splitHalfway } from '../layout/paths'

/** What a pointer grabbed on a run being edited. */
export type RouteGrab =
  | { kind: 'end'; which: 'from' | 'to' }
  | { kind: 'corner'; index: number }
  | { kind: 'insert'; at: Point }

interface Props {
  paths: RoutePath[]
  /** Points where two runs cross, drawn as markers when shown. */
  crossings: Crossing[]
  scale: number
  /** Only draw runs touching this module, or all when null. */
  focusModuleId: string | null
  showCrossings: boolean
  /** The run being drawn by hand, which is the only one with handles. */
  editingRouteId?: string | null
  /** Corners already placed on that run, so only those get a drag handle. */
  editingWaypoints?: Point[]
  onPickRoute?: (routeId: string) => void
  onGrab?: (
    routeId: string,
    grab: RouteGrab,
    event: React.PointerEvent<SVGElement>,
  ) => void
  onGrabMove?: (event: React.PointerEvent<SVGElement>) => void
  onGrabEnd?: (event: React.PointerEvent<SVGElement>) => void
  /** Double clicking a corner takes it back out of the run. */
  onRemoveCorner?: (routeId: string, index: number) => void
  onRunMenu?: (event: React.MouseEvent, routeId: string) => void
}

/** Drawn in screen pixels rather than metres, so it stays legible zoomed out. */
const ARROW_PATH = 'M -4.5 -4 L 5 0 L -4.5 4 z'

/** Below this a segment is shorter than the arrowhead itself. */
const ARROW_ROOM_PX = 14

/** Midpoint and heading of the longest straight run, for the arrowhead. */
function arrowAt(
  points: Point[],
): { x: number; y: number; angle: number; length: number } | null {
  let best = 0
  let at: { x: number; y: number; angle: number; length: number } | null = null

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    const len = Math.hypot(to.x - from.x, to.y - from.y)
    if (len <= best) continue
    best = len
    at = {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
      // Taken from the segment itself, so it can never disagree with the path.
      angle: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
      length: len,
    }
  }

  return at
}

/** Midpoint of each segment, where a new corner can be dropped in. */
function midpoints(points: Point[]): Point[] {
  const mids: Point[] = []
  for (let i = 1; i < points.length; i++) {
    mids.push({
      x: (points[i - 1].x + points[i].x) / 2,
      y: (points[i - 1].y + points[i].y) / 2,
    })
  }
  return mids
}

export function RouteLayer({
  paths,
  crossings,
  scale,
  focusModuleId,
  showCrossings,
  editingRouteId = null,
  editingWaypoints = [],
  onPickRoute,
  onGrab,
  onGrabMove,
  onGrabEnd,
  onRemoveCorner,
  onRunMenu,
}: Props) {
  const drawable = focusModuleId
    ? paths.filter(
        (p) =>
          p.route.from === focusModuleId || p.route.to === focusModuleId,
      )
    : paths

  if (drawable.length === 0) return null

  const visible = new Set(drawable.map((p) => p.route.id))
  const marks = showCrossings
    ? crossings.filter((c) => visible.has(c.a) && visible.has(c.b))
    : []

  const editing = drawable.find((p) => p.route.id === editingRouteId) ?? null

  return (
    <svg className="routes">
      {drawable.map(({ route, points, external, terminal }) => {
        const status = !route.transport.option
          ? 'blocked'
          : route.transport.needsSplit
            ? 'split'
            : 'ok'

        const width = Math.max(1, route.transport.lines * 1.5)
        const dash = route.fluid ? '5 4' : '11 6'
        const shared = `route route--${status} ${
          external ? 'route--external' : ''
        } ${route.fluid ? 'route--fluid' : ''}`
        const toAttr = (pts: Point[]) =>
          pts.map((p) => `${p.x * scale},${p.y * scale}`).join(' ')

        // Healthy runs are drawn in two halves: green leaving the output,
        // orange arriving at the input. Warning states stay one colour so they
        // still read as a problem.
        //
        // A stub off the floor gets one colour for its whole length instead.
        // Splitting a 10 m dash in half said nothing except that it had two
        // ends, where the single thing worth reading off it is whether material
        // is arriving or leaving.
        const halves: { points: Point[]; tone: string }[] =
          status !== 'ok'
            ? [{ points, tone: status }]
            : terminal
              ? [{ points, tone: terminal.which === 'from' ? 'in' : 'out' }]
              : splitHalfway(points).map((half, index) => ({
                  points: half,
                  tone: index === 0 ? 'out' : 'in',
                }))

        return (
          <g
            key={route.id}
            className={`route__group ${
              route.id === editingRouteId ? 'route__group--editing' : ''
            }`}
          >
            {/* A fat invisible copy of the line, so a belt is easy to hit
                without thickening what's drawn. */}
            {onPickRoute && (
              <polyline
                className="route__hit"
                points={toAttr(points)}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onPickRoute(route.id)
                }}
                onContextMenu={(event) => onRunMenu?.(event, route.id)}
              >
                <title>Click to draw this run by hand, right click for more</title>
              </polyline>
            )}
            {halves.map(({ points: half, tone }) => {
              // Each half takes its arrow from its own longest segment, so an
              // arrowhead can only ever agree with the line it sits on.
              const arrow = arrowAt(half)
              const room = arrow !== null && arrow.length * scale > ARROW_ROOM_PX

              return (
                <g key={tone}>
                  <polyline
                    className={`${shared} route--${tone}`}
                    points={toAttr(half)}
                    strokeWidth={width}
                    strokeDasharray={dash}
                  />
                  {arrow && room && (
                    <path
                      className={`route__arrow route__arrow--${tone}`}
                      d={ARROW_PATH}
                      transform={`translate(${arrow.x * scale} ${arrow.y * scale}) rotate(${arrow.angle})`}
                    />
                  )}
                </g>
              )
            })}
          </g>
        )
      })}

      {editing && onGrab && (
        <g className="route__handles">
          {/* Segment midpoints add a corner; the two ends slide around their
              block's edge; existing corners drag freely. */}
          {midpoints(editing.points).map((mid, index) => (
            <circle
              key={`add-${index}`}
              className="route__add"
              cx={mid.x * scale}
              cy={mid.y * scale}
              r={4}
              onPointerDown={(event) => {
                event.stopPropagation()
                onGrab(editing.route.id, { kind: 'insert', at: mid }, event)
              }}
              onPointerMove={onGrabMove}
              onPointerUp={onGrabEnd}
              onPointerCancel={onGrabEnd}
            >
              <title>Drag to bend the run here</title>
            </circle>
          ))}

          {editingWaypoints.map((corner, index) => (
            <rect
              key={`corner-${index}`}
              className="route__corner"
              x={corner.x * scale - 5}
              y={corner.y * scale - 5}
              width={10}
              height={10}
              onPointerDown={(event) => {
                event.stopPropagation()
                onGrab(editing.route.id, { kind: 'corner', index }, event)
              }}
              onPointerMove={onGrabMove}
              onPointerUp={onGrabEnd}
              onPointerCancel={onGrabEnd}
              onDoubleClick={() => onRemoveCorner?.(editing.route.id, index)}
            >
              <title>Drag to move this corner. Double click to remove it.</title>
            </rect>
          ))}

          {(['from', 'to'] as const).map((which) => {
            const point =
              which === 'from'
                ? editing.points[0]
                : editing.points[editing.points.length - 1]
            return (
              <circle
                key={which}
                className={`route__end route__end--${which}`}
                cx={point.x * scale}
                cy={point.y * scale}
                r={5}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onGrab(editing.route.id, { kind: 'end', which }, event)
                }}
                onPointerMove={onGrabMove}
                onPointerUp={onGrabEnd}
                onPointerCancel={onGrabEnd}
              >
                <title>
                  {which === 'from'
                    ? 'Drag around the block to pick the port it leaves from'
                    : 'Drag around the block to pick the port it feeds'}
                </title>
              </circle>
            )
          })}
        </g>
      )}

      {marks.map((crossing) => (
        <g
          className="crossing"
          key={`${crossing.a}|${crossing.b}|${crossing.x},${crossing.y}`}
          transform={`translate(${crossing.x * scale} ${crossing.y * scale})`}
        >
          <circle r={5} />
          <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" />
        </g>
      ))}
    </svg>
  )
}
