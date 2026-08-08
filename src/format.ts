/**
 * Number formatting, in one place.
 *
 * Every panel used to round differently: a rate read 13.3 in the breakdown, 13
 * in the tangle list and 13.33 on a graph node, which makes the same number
 * look like three. Two decimals is where the game stops caring, since no belt
 * is troubled by a thousandth of an item a minute, and it's enough to show that
 * 13.33 machines' worth of demand isn't a clean 13.
 */

/** Places kept before a number stops meaning anything. */
export const DECIMALS = 2

/** A quantity or a rate. Trailing zeros are dropped, so 60 stays 60. */
export const num = (v: number, digits = DECIMALS) =>
  v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })

/** Power, switching to gigawatts where megawatts stop being readable. */
export const mw = (v: number) =>
  v >= 1000 ? `${num(v / 1000)} GW` : `${num(v)} MW`
