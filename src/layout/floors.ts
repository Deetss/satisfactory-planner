/**
 * Where floors sit relative to each other.
 *
 * Block positions are floor-local, but a stack of floors only makes sense in
 * base coordinates: the ground floor is the base and doesn't move, and upper
 * floors are offset over it. These convert between the two and work out what a
 * floor is standing on.
 */

import { FOUNDATION_M, type Floor, type Rect } from './types'

/** A floor's deck in base metres. */
export function floorRect(floor: Floor): Rect {
  return {
    x: floor.originX,
    y: floor.originY,
    width: floor.gridWidth * FOUNDATION_M,
    depth: floor.gridDepth * FOUNDATION_M,
  }
}

/**
 * Extent the whole stack covers, so a canvas can show an upper floor's overhang
 * as well as the base it hangs off.
 */
export function baseBounds(floors: Floor[]): Rect {
  const rects = floors.map(floorRect)
  const right = Math.max(...rects.map((r) => r.x + r.width))
  const bottom = Math.max(...rects.map((r) => r.y + r.depth))
  return { x: 0, y: 0, width: right, depth: bottom }
}

const covers = (rect: Rect, x: number, y: number, size: number) =>
  x >= rect.x - 1e-9 &&
  y >= rect.y - 1e-9 &&
  x + size <= rect.x + rect.width + 1e-9 &&
  y + size <= rect.y + rect.depth + 1e-9

export interface Cell {
  /** Floor-local metres, for drawing on the active floor. */
  x: number
  y: number
  size: number
}

/**
 * Foundations of `floor` with nothing underneath them.
 *
 * A floor pushed out past the one below cantilevers, and those foundations are
 * over open ground. Worked out a foundation at a time, which is the resolution
 * you actually build at, and returned in the floor's own coordinates so the
 * canvas can draw them straight onto it.
 */
export function unsupportedCells(floor: Floor, below: Floor[]): Cell[] {
  if (below.length === 0) return []

  const decks = below.map(floorRect)
  const cells: Cell[] = []

  for (let cx = 0; cx < floor.gridWidth; cx++) {
    for (let cy = 0; cy < floor.gridDepth; cy++) {
      const baseX = floor.originX + cx * FOUNDATION_M
      const baseY = floor.originY + cy * FOUNDATION_M
      const supported = decks.some((deck) =>
        covers(deck, baseX, baseY, FOUNDATION_M),
      )
      if (supported) continue
      cells.push({
        x: cx * FOUNDATION_M,
        y: cy * FOUNDATION_M,
        size: FOUNDATION_M,
      })
    }
  }

  return cells
}
