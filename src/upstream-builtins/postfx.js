const POSTFX_DEFAULTS = Object.freeze({ vignetteRoundness: 2, vignetteFeather: 0.45, dofBokehScale: 1 })

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const toColor = (c) => {
  if (!Array.isArray(c) || c.length !== 3 || !c.every(isFiniteNumber)) throw new TypeError('a color is [r, g, b] with finite numbers')
  return [c[0], c[1], c[2]]
}

const refuse = (what) => {
  throw new RangeError(what + ' has no documented headless behaviour in upstream; refused as a scoped negative for any non-neutral value')
}

const copyIfNeutral = (color, neutral, what) => {
  const c = toColor(color)
  if (neutral) return c
  return refuse(what)
}

export const grade = (color, opts = {}) => {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) throw new TypeError('grade options is an object')
  const given = Object.keys(opts).filter((key) => opts[key] !== undefined)
  return copyIfNeutral(color, given.length === 0, 'grade with ' + given.join(', '))
}

export const vignette = (color, intensity, opts = {}) => {
  toColor(color)
  if (!isFiniteNumber(intensity) || intensity < 0) throw new RangeError('vignette intensity is zero or more')
  const roundness = opts.roundness ?? POSTFX_DEFAULTS.vignetteRoundness
  const feather = opts.feather ?? POSTFX_DEFAULTS.vignetteFeather
  if (!isFiniteNumber(roundness) || !isFiniteNumber(feather) || feather < 0) throw new RangeError('vignette roundness and feather are finite, feather zero or more')
  return copyIfNeutral(color, intensity === 0, 'vignette with intensity ' + intensity)
}

export const blur = (scene, amount) => {
  toColor(scene)
  if (!isFiniteNumber(amount) || amount < 0 || amount > 1) throw new RangeError('blur amount is 0 to 1')
  return copyIfNeutral(scene, amount === 0, 'blur with amount ' + amount)
}

export const dof = (color, viewZ, focusDistance, focusRange, bokehScale = POSTFX_DEFAULTS.dofBokehScale) => {
  toColor(color)
  if (!isFiniteNumber(viewZ)) throw new TypeError('viewZ is a finite depth')
  if (!isFiniteNumber(focusDistance) || focusDistance < 0) throw new RangeError('focusDistance is zero or more metres')
  if (!isFiniteNumber(focusRange) || focusRange < 0) throw new RangeError('focusRange is zero or more metres')
  if (!isFiniteNumber(bokehScale) || bokehScale < 0) throw new RangeError('bokehScale is zero or more pixels, default 1')
  return refuse('dof with a focus range of ' + focusRange + ' m')
}

export const bloom = (color) => toColor(color)

export const grain = (color, intensity) => copyIfNeutral(color, intensity === 0, 'grain')
export const film = (color, intensity) => copyIfNeutral(color, intensity === 0, 'film')
export const tint = (color, _oklch, amount) => copyIfNeutral(color, amount === 0, 'tint')
export const scanlines = (color, intensity, count) => copyIfNeutral(color, intensity === 0 || count === 0, 'scanlines')
export const dotScreen = (color, angle, scale) => copyIfNeutral(color, scale === 0, 'dotScreen')
export const chromaticAberration = (color, strength) => copyIfNeutral(color, strength === 0, 'chromaticAberration')
export const pixelate = (scene, size) => {
  toColor(scene)
  if (!isFiniteNumber(size) || size < 1) throw new RangeError('pixelate size is at least 1 pixel')
  return copyIfNeutral(scene, size === 1, 'pixelate with size ' + size)
}

export const POSTFX_NAMES = Object.freeze(['grade', 'vignette', 'grain', 'film', 'tint', 'scanlines', 'dotScreen', 'chromaticAberration', 'dof', 'pixelate', 'blur', 'bloom'])
export const POSTFX_OPTION_DEFAULTS = POSTFX_DEFAULTS
