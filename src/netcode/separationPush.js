export const SEPARATION_PUSH_VELOCITY_CAP = 3.0

export function separationPush(dx, dy, dz, minDist, dt, out) {
  const dist2 = dx * dx + dy * dy + dz * dz
  if (dist2 >= minDist * minDist || dist2 === 0) return false
  const dist = Math.sqrt(dist2)
  const nx = dx / dist
  const nz = dz / dist
  const halfPush = (minDist - dist) * 0.5
  const pushVel = Math.min(halfPush / dt, SEPARATION_PUSH_VELOCITY_CAP)
  out[0] = nx * halfPush
  out[1] = nz * halfPush
  out[2] = nx * pushVel
  out[3] = nz * pushVel
  return true
}
