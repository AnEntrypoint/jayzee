const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isPositive = (value) => isFiniteNumber(value) && value > 0

const toVec = (v) => {
  const arr = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x, v.y, v.z] : null
  if (!arr || arr.length !== 3 || !arr.every(isFiniteNumber)) throw new TypeError('a vector is {x, y, z} or [x, y, z] with finite numbers')
  return [arr[0], arr[1], arr[2]]
}

export const elevation = (speed, g, distance, rise) => {
  if (!isPositive(speed)) throw new RangeError('speed is a positive number of metres per second')
  if (!isPositive(g)) throw new RangeError('g is the positive magnitude of acceleration')
  if (!isPositive(distance)) throw new RangeError('distance is a positive horizontal range in metres')
  if (!isFiniteNumber(rise)) throw new TypeError('rise is a finite height in metres')
  const v2 = speed * speed
  const disc = v2 * v2 - g * (g * distance * distance + 2 * rise * v2)
  if (disc < 0) return null
  return Math.atan((v2 - Math.sqrt(disc)) / (g * distance))
}

export const solveShot = (from, to, speed, g, lead = null) => {
  if (lead !== undefined && lead !== null) throw new RangeError('lead has no documented behaviour in savi; refused as a scoped negative')
  const a = toVec(from)
  const b = toVec(to)
  const dx = b[0] - a[0]
  const dz = b[2] - a[2]
  const distance = Math.hypot(dx, dz)
  if (distance === 0) throw new RangeError('a shot straight up or down has no low angle; refused as a scoped negative')
  const angle = elevation(speed, g, distance, b[1] - a[1])
  if (angle === null) return null
  const horizontal = speed * Math.cos(angle)
  return {
    vel: [horizontal * (dx / distance), speed * Math.sin(angle), horizontal * (dz / distance)],
    time: distance / horizontal,
  }
}

export const BALLISTICS_NAMES = Object.freeze(['solveShot', 'elevation'])
