/**
 * Simplex solutions carry a little floating-point noise, so a rate that should
 * be 480 comes back as 480.0000000003 (or 479.9999999997). Left alone it shows
 * up as an ugly number in the UI, and worse, ceil() on a machine count reads
 * 12.000001 as 13 machines.
 *
 * The tolerance is relative, so it scales with magnitude: a value 1e-6 of the
 * way off a whole number snaps to it, while genuinely fractional rates like
 * 12.5 or 0.75 are left exactly as they are.
 */
const RELATIVE_TOLERANCE = 1e-6

export function cleanRate(value: number): number {
  if (!Number.isFinite(value)) return 0

  const whole = Math.round(value)
  const scale = Math.max(1, Math.abs(value))
  if (Math.abs(value - whole) / scale < RELATIVE_TOLERANCE) return whole

  // Not near a whole number, so keep real precision but drop the noise tail.
  return Math.round(value * 1e6) / 1e6
}
