/**
 * The one place both sides of the golden gate round.
 *
 * `tools/regen-goldens.ts` imports these before `JSON.stringify` and
 * `test/golden.test.ts` imports them before `toEqual`. A second copy of either
 * helper is a drift surface: D-05 requires the generator and the harness to
 * round identically, and if they ever stopped the gate would redden on
 * arithmetic rather than on behaviour.
 */

/**
 * Coordinates to a millimetre.
 *
 * The trailing `+ 0` collapses negative zero. `Math.round(-0.0004 * 1000) / 1000`
 * is `-0`, `JSON.stringify(-0)` writes `0`, so the reparsed golden holds positive
 * zero. `toEqual` accepts that pair and `toStrictEqual` would not, so without the
 * `+ 0` a later tightening of the assertion produces a failure nobody can read.
 */
export const roundMetres = (value: number): number =>
  Math.round(value * 1000) / 1000 + 0

/**
 * Six significant figures, which is what HiGHS itself reports, so a score is
 * never recorded to a precision finer than the numbers it was computed from.
 */
export const roundScore = (value: number): number =>
  Number(value.toPrecision(6))

/**
 * One fixture's observed arrangement.
 *
 * Field order is D-06's, with D-10 putting the solved module list at the head:
 * a plan code carries targets rather than machines, so the arrangement is
 * coupled to `game-data.json` through the solver. Naming the modules first makes
 * a dataset refresh read as items and counts at the top of the diff instead of
 * as forty moved coordinates that look like an engine regression.
 */
export interface Golden {
  modules: {
    id: string
    label: string
    machines: number
    /**
     * One machine, not the packed block. `moduleFootprint` depends on the
     * placement's column count, which `placements` already pins.
     */
    footprint: { width: number; depth: number; height: number }
  }[]
  floors: { id: string; gridWidth: number; gridDepth: number; role: string }[]
  placements: {
    moduleId: string
    floorId: string
    x: number
    y: number
    orientation: number
    columns: number
    inputSide: string
    outputSide: string
    flipped?: true
  }[]
  paths: {
    floorId: string
    /** The route's id, not the route: its transport choices belong to `deriveRoutes`. */
    routeId: string
    external: boolean
    drawn: boolean
    points: { x: number; y: number }[]
  }[]
  /** Counts, so the three array-valued fields of `FloorCongestion` arrive as lengths. */
  congestion: {
    floorId: string
    crossings: number
    laneClashes: number
    overBlocks: number
    runs: number
    length: number
    score: number
  }[]
  /** D-04: `scoreFloor` recomputed from the final placements, one entry per floor. */
  scores: { floorId: string; score: number }[]
}
