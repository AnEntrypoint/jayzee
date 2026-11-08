export function readSlipCurve(points, name) {
  if (!Array.isArray(points) || points.length < 2) throw new Error(`[vehicle-tyre] ${name} needs at least 2 points`)
  let prevSlip = -Infinity
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || p[1] < 0 || p[0] <= prevSlip) {
      throw new Error(`[vehicle-tyre] ${name} points must be [slip, force] with slip strictly increasing and force >= 0`)
    }
    prevSlip = p[0]
  }
  return points
}

export function readSuspensionSpring(spring) {
  const { frequency, damping } = spring
  if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(damping) || damping < 0 || damping > 1) {
    throw new Error('[vehicle-suspension] frequency must be > 0 and damping within [0, 1]')
  }
  return { frequency, damping }
}
