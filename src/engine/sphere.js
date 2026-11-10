export const PLANET_RADIUS_M = 6360000.0
export const GRAVITY_M_PER_S2 = 9.8

const TWO_PI = 2 * Math.PI

export const surfacePoint = (latRad, lonRad, heightM = 0, radiusM = PLANET_RADIUS_M) => {
  const r = radiusM + heightM
  const c = Math.cos(latRad)
  return [r * c * Math.sin(lonRad), r * Math.sin(latRad), r * c * Math.cos(lonRad)]
}

export const normalise = (v) => {
  const length = Math.hypot(v[0], v[1], v[2])
  if (!(length > 0)) throw new RangeError('cannot normalise a zero vector')
  return [v[0] / length, v[1] / length, v[2] / length]
}

export const upAt = (position) => normalise(position)

export const gravityAt = (position, g = GRAVITY_M_PER_S2) => {
  const down = normalise(position)
  return [-g * down[0], -g * down[1], -g * down[2]]
}

export const frameOnSurface = (up, yaw = 0) => {
  const n = normalise(up)
  const reference = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const east = normalise(cross(reference, n))
  const north = cross(n, east)
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const forward = [c * east[0] + s * north[0], c * east[1] + s * north[1], c * east[2] + s * north[2]]
  const side = cross(n, forward)
  return { up: n, forward, side }
}

export const altitudeOf = (position, radiusM = PLANET_RADIUS_M) => Math.hypot(position[0], position[1], position[2]) - radiusM

export const wrapAngle = (angle) => ((angle % TWO_PI) + TWO_PI) % TWO_PI

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
