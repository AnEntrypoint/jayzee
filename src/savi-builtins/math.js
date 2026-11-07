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
