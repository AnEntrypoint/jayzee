const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const toPoint = (p) => {
  const arr = Array.isArray(p) ? p : p && typeof p === 'object' ? [p.x, p.y, p.z] : null
  if (!arr || arr.length !== 3 || !arr.every(isFiniteNumber)) throw new TypeError('a lighting point is {x, y, z} or [x, y, z] with finite numbers')
  return [arr[0], arr[1], arr[2]]
}

const refuse = (name) => {
  throw new RangeError(name + ' has a name and a type in savi, but no documented value or semantics; refused as a scoped negative until savi documents them')
}

const requireIndex = (i) => {
  if (!Number.isInteger(i) || i < 0) throw new RangeError('a light index is a whole number from 0')
  return i
}

export const sunDirection = () => refuse('sunDirection')
export const sunRadiance = () => refuse('sunRadiance')
export const ambientRadiance = () => refuse('ambientRadiance')
export const wet = () => refuse('wet')
export const rain = () => refuse('rain')
export const windDirection = () => refuse('windDirection')
export const windSpeed = () => refuse('windSpeed')
export const windTravel = () => refuse('windTravel')

export const fogColor = (toward) => {
  toPoint(toward)
  return refuse('fogColor')
}

export const sunVisibility = (P) => {
  toPoint(P)
  return refuse('sunVisibility')
}

export const lightsAt = (P, options = {}) => {
  toPoint(P)
  if (options !== null && typeof options !== 'object') throw new TypeError('lightsAt options are { shadow }')
  return refuse('lightsAt')
}

export const lightCount = (P) => {
  toPoint(P)
  return refuse('lightCount')
}

export const lightRadiance = (P, i) => {
  toPoint(P)
  requireIndex(i)
  return refuse('lightRadiance')
}

export const lightPosition = (P, i) => {
  toPoint(P)
  requireIndex(i)
  return refuse('lightPosition')
}

export const LIGHTING_NAMES = Object.freeze([
  'sunDirection', 'sunRadiance', 'ambientRadiance', 'wet', 'rain', 'windDirection', 'windSpeed', 'windTravel',
  'fogColor', 'sunVisibility', 'lightsAt', 'lightCount', 'lightRadiance', 'lightPosition',
])
