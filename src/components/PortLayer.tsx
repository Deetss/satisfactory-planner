/**
 * What a run that leaves this floor actually connects to.
 *
 * Every such run is drawn as a stub off a face, and a face with four of them is
 * four identical dashes: you can see that something arrives without seeing what,
 * how much, or from where. These panels say it, one per face rather than one per
 * run, so a busy face reads as a short list instead of a picket fence.
 */

import { itemName } from '../data/gameData'
import type { RoutePath } from '../layout/paths'
import type { Floor, Side } from '../layout/types'
import { num } from '../format'
import { ItemIcon } from './Icon'

interface Props {
  paths: RoutePath[]
  scale: number
  floors: Floor[]
  /** The floor being drawn, so the others can be named as up or down from it. */
  activeFloorId: string
  /** Labels for blocks at the far end, when they're in the plan. */
  labelOf: (moduleId: string) => string | null
  /** Only the runs touching this block, or all of them when null. */
  focusModuleId: string | null
}

interface Row {
  routeId: string
  item: string
  rate: number
  fluid: boolean
  /** Material arriving, as opposed to leaving. */
  feed: boolean
  where: string
  detail: string
}

interface Port {
  key: string
  side: Side
  x: number
  y: number
  rows: Row[]
}

export function PortLayer({
  paths,
  scale,
  floors,
  activeFloorId,
  labelOf,
  focusModuleId,
}: Props) {
  const here = floors.findIndex((f) => f.id === activeFloorId)

  /**
   * The floor at the far end, as a climb or a drop from this one.
   *
   * A run only leaves the floor if the other end is somewhere else, so naming
   * the level is the whole point: "Iron Ingot" arriving says nothing about
   * whether you're building a lift up or a chute down to get it.
   */
  const levelOf = (floorId: string | null) => {
    const level = floorId ? floors.findIndex((f) => f.id === floorId) : -1
    if (level < 0) return 'another floor'
    if (level === here) return floors[level].name
    return `${level > here ? '↑' : '↓'} ${floors[level].name}`
  }

  const ports = new Map<string, Port>()

  for (const path of paths) {
    const terminal = path.terminal
    if (!terminal) continue
    if (
      focusModuleId &&
      path.route.from !== focusModuleId &&
      path.route.to !== focusModuleId
    ) {
      continue
    }

    const feed = terminal.which === 'from'
    const label = terminal.moduleId ? labelOf(terminal.moduleId) : null
    // A block named after the only thing it makes would read "Iron Ingot Iron
    // Ingot", which says less than the item on its own already did.
    const far = label && label !== itemName(path.route.item) ? label : null

    const place =
      terminal.kind === 'outside'
        ? feed
          ? 'imported'
          : 'shipped out'
        : terminal.kind === 'unplaced'
          ? 'in the tray'
          : levelOf(terminal.floorId)

    const where = [far, place].filter(Boolean).join(' ')
    const detail = `${feed ? 'from' : 'to'} ${[label, place]
      .filter(Boolean)
      .join(', ')}`

    const key = `${terminal.atModuleId}:${terminal.side}`
    const port = ports.get(key)
    const row: Row = {
      routeId: path.route.id,
      item: path.route.item,
      rate: path.route.rate,
      fluid: path.route.fluid,
      feed,
      where,
      detail,
    }

    if (port) {
      port.rows.push(row)
      // The panel sits off the middle of the stubs it explains, so adding one
      // re-centres it rather than leaving it over the first.
      port.x += (terminal.point.x - port.x) / port.rows.length
      port.y += (terminal.point.y - port.y) / port.rows.length
    } else {
      ports.set(key, {
        key,
        side: terminal.side,
        x: terminal.point.x,
        y: terminal.point.y,
        rows: [row],
      })
    }
  }

  if (ports.size === 0) return null

  return (
    <>
      {[...ports.values()].map((port) => (
        <div
          key={port.key}
          className={`port port--${port.side}`}
          style={{ left: port.x * scale, top: port.y * scale }}
        >
          {port.rows
            // Feeds first, so a face doing both reads in the order material
            // moves: in at the top, out underneath.
            .sort(
              (a, b) =>
                Number(b.feed) - Number(a.feed) ||
                itemName(a.item).localeCompare(itemName(b.item)),
            )
            .map((row) => (
              <span
                key={row.routeId}
                className={`port__row port__row--${row.feed ? 'in' : 'out'}`}
                title={`${num(row.rate)}${row.fluid ? ' m³' : ''}/min ${itemName(
                  row.item,
                )} ${row.detail}`}
              >
                <ItemIcon item={row.item} size={12} />
                <span className="port__rate">{num(row.rate)}</span>
                <span className="port__name">{itemName(row.item)}</span>
                <span className="port__where">{row.where}</span>
              </span>
            ))}
        </div>
      ))}
    </>
  )
}
