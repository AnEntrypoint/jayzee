const isNumber = (value) => typeof value === 'number' && !Number.isNaN(value)

const requireNumber = (value, name) => {
  if (!isNumber(value)) throw new TypeError(name + ' takes a number, got ' + typeof value)
}

export const clamp = (value, min, max) => {
  requireNumber(value, 'value')
  requireNumber(min, 'min')
  requireNumber(max, 'max')
  if (min > max) throw new RangeError('clamp needs min <= max, got ' + min + ' > ' + max)
  return value < min ? min : value > max ? max : value
}

export const clamp01 = (value) => clamp(value, 0, 1)

export const lerp = (a, b, t) => {
  requireNumber(a, 'a')
  requireNumber(b, 'b')
  requireNumber(t, 't')
  return a + (b - a) * t
}

export const MATH_NAMES = Object.freeze(['clamp', 'clamp01', 'lerp'])

export const smoothstep = (edge0, edge1, x) => {
  requireNumber(edge0, 'edge0')
  requireNumber(edge1, 'edge1')
  requireNumber(x, 'x')
  if (edge0 === edge1) throw new RangeError('smoothstep needs distinct edges')
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export const inverseLerp = (a, b, value) => {
  requireNumber(a, 'a')
  requireNumber(b, 'b')
  requireNumber(value, 'value')
  if (a === b) throw new RangeError('inverseLerp needs a !== b')
  return (value - a) / (b - a)
}

export const remap = (inMin, inMax, outMin, outMax, value) => {
  requireNumber(inMin, 'inMin')
  requireNumber(inMax, 'inMax')
  requireNumber(outMin, 'outMin')
  requireNumber(outMax, 'outMax')
  requireNumber(value, 'value')
  return lerp(outMin, outMax, inverseLerp(inMin, inMax, value))
}

export const shortestArc = (fromDeg, toDeg) => {
  requireNumber(fromDeg, 'fromDeg')
  requireNumber(toDeg, 'toDeg')
  const turn = (((toDeg - fromDeg) % 360) + 360) % 360
  return turn > 180 ? turn - 360 : turn
}

export const stepAngle = (currentDeg, targetDeg, dt, opts = {}) => {
  requireNumber(currentDeg, 'currentDeg')
  requireNumber(targetDeg, 'targetDeg')
  requireNumber(dt, 'dt')
  const smoothing = opts.smoothing ?? 0.06
  requireNumber(smoothing, 'smoothing')
  if (smoothing < 0) throw new RangeError('smoothing must be zero or above')
  if (opts.maxDegPerSec !== undefined) throw new RangeError('maxDegPerSec has no documented behaviour in upstream; refused as a scoped negative')
  if (smoothing !== 0) throw new RangeError('stepAngle with smoothing above 0 has no documented curve in upstream; refused as a scoped negative')
  return currentDeg + shortestArc(currentDeg, targetDeg)
}

export const degToRad = (deg) => {
  requireNumber(deg, 'deg')
  return (deg * Math.PI) / 180
}

export const radToDeg = (rad) => {
  requireNumber(rad, 'rad')
  return (rad * 180) / Math.PI
}
