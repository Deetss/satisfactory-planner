/**
 * Splitters and mergers the plan already implies.
 *
 * Nothing about these is a choice: a manifold feeding two blocks divides
 * somewhere, and two blocks feeding one manifold join somewhere, and both cost a
 * building you have to find room for. Working them out from the runs means the
 * junctions are marked where the belts actually part company, rather than
 * leaving you to notice them and drop one by hand.
 */

import { itemName } from '../data/gameData'
import type { Point, RoutePath } from './paths'

/** Points closer than this are the same corner. */
const EPSILON = 0.001

export interface DerivedFitting {
  id: string
  kind: 'splitter' | 'merger'
  /** Floor-local metres. */
  x: number
  y: number
  item: string
  /** Runs meeting here, always two or more. */
  routeIds: string[]
  /** How many of the building this junction really takes. */
  count: number
  label: string
}

const same = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON

const at = (p: Point) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`

/**
 * Buildings needed to reach `ways` lines from one.
 *
 * A splitter has one input and three outputs, so it covers a three-way split on
 * its own and only a fourth line costs a second one. Mergers are the same in
 * reverse.
 */
export const fittingsFor = (ways: number) => Math.ceil((ways - 1) / 2)

export function deriveFittings(paths: RoutePath[]): DerivedFitting[] {
  interface Group {
    kind: 'splitter' | 'merger'
    item: string
    paths: RoutePath[]
  }

  const groups = new Map<string, Group>()

  for (const path of paths) {
    if (path.points.length < 2) continue

    // The loose end of a run that leaves the floor is a stub in mid-air, not a
    // tap, so nothing joins or divides there.
    const looseStart = path.terminal?.which === 'from'
    const looseEnd = path.terminal?.which === 'to'

    const ends: { kind: Group['kind']; point: Point }[] = [
      ...(looseStart ? [] : [{ kind: 'splitter' as const, point: path.points[0] }]),
      ...(looseEnd
        ? []
        : [
            {
              kind: 'merger' as const,
              point: path.points[path.points.length - 1],
            },
          ]),
    ]

    for (const end of ends) {
      const key = `${end.kind}|${path.route.item}|${at(end.point)}`
      const group = groups.get(key)
      if (group) group.paths.push(path)
      else groups.set(key, { kind: end.kind, item: path.route.item, paths: [path] })
    }
  }

  const fittings: DerivedFitting[] = []

  for (const [key, group] of groups) {
    if (group.paths.length < 2) continue

    // Runs off one tap follow the same line until they part; that parting is
    // where the building goes. Read off the drawn geometry rather than guessed
    // at, so a run bent by hand moves its junction with it.
    const forwards = group.kind === 'splitter'
    const shortest = Math.min(...group.paths.map((p) => p.points.length))
    const pointAt = (path: RoutePath, i: number) =>
      forwards ? path.points[i] : path.points[path.points.length - 1 - i]

    let common = 0
    while (common + 1 < shortest) {
      const next = pointAt(group.paths[0], common + 1)
      if (!group.paths.every((p) => same(pointAt(p, common + 1), next))) break
      common++
    }

    const point = pointAt(group.paths[0], common)
    const ways = group.paths.length

    fittings.push({
      id: key,
      kind: group.kind,
      x: point.x,
      y: point.y,
      item: group.item,
      routeIds: group.paths.map((p) => p.route.id),
      count: fittingsFor(ways),
      label:
        group.kind === 'splitter'
          ? `${itemName(group.item)} divides ${ways} ways here`
          : `${ways} ${itemName(group.item)} lines join here`,
    })
  }

  return fittings
}
