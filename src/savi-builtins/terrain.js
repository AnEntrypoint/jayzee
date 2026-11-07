const SHORE_DEFAULTS = Object.freeze({ apron: 6, berm: 0.3, grade: 0.06, rejoin: 24, shelf: 2.2, shelfReach: 6, drop: 20, scale: 1 })

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

export const shore = (height, level, opts = {}) => {
  if (!isFiniteNumber(height) || !isFiniteNumber(level)) throw new TypeError('shore takes a finite height and a finite water level, in metres')
  for (const name of Object.keys(opts)) {
    if (!Object.prototype.hasOwnProperty.call(SHORE_DEFAULTS, name)) throw new RangeError('shore option ' + name + ' is not a savi shore option')
    if (!isFiniteNumber(opts[name])) throw new TypeError('shore option ' + name + ' takes a finite number')
  }
  throw new RangeError('the shore curve is not stated in savi; refused as a scoped negative until savi documents its shape')
}

export const SHORE_OPTION_DEFAULTS = SHORE_DEFAULTS
export const TERRAIN_NAMES = Object.freeze(['shore'])
