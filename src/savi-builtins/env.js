const ENV_FIELDS = Object.freeze(['wind', 'rain', 'light', 'charge', 'water', 'cloud'])

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const toPoint = (p) => {
  const arr = Array.isArray(p) ? p : p && typeof p === 'object' ? [p.x, p.y, p.z] : null
  if (!arr || arr.length !== 3 || !arr.every(isFiniteNumber)) throw new TypeError('envAt takes a point {x, y, z} or [x, y, z] with finite numbers')
  return [arr[0], arr[1], arr[2]]
}

export const envAt = (ctx, point) => {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('envAt takes the behaviour ctx')
  toPoint(point)
  throw new RangeError('envAt has no documented source of its values in savi: the return shape is named, the EnvFlow type is not defined, and the environment the ctx carries is not described. Refused as a scoped negative until savi documents them.')
}

export const ENV_NAMES = Object.freeze(['envAt'])
export const ENV_RETURN_FIELDS = ENV_FIELDS
