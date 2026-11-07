const WATER_DEFAULTS = Object.freeze({ scale: 1, softness: 0.08 })

const REQUIRED = Object.freeze({
  waterRippleSlope: 6,
  waterFoam: 4,
  waterFoamField: 3,
  waterFoamFieldLod: 5,
  waterFoamCoverage: 2,
  waterTransmittance: 3,
  waterMedium: 3,
  waterUnderwaterDistortion: 5,
  waterRayBoxDistance: 5,
  waterCaustics: 2,
  waterCausticsAt: 11,
  waterCausticsRefracted: 11,
  waterFresnel: 2,
})

export const WATER_NAMES = Object.freeze(Object.keys(REQUIRED))

const refuse = (what) => {
  throw new RangeError(what + ' has no documented headless behaviour in savi; refused as a scoped negative')
}

const finiteLeaves = (value, label) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(label + ' is a finite number')
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) finiteLeaves(item, label)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) finiteLeaves(item, label)
    return
  }
  throw new TypeError(label + ' is a number, a list or an object of numbers')
}

const waterCall = (name, args) => {
  const need = REQUIRED[name]
  if (args.length < need) throw new RangeError(name + ' takes ' + need + ' arguments, got ' + args.length)
  args.forEach((value, index) => {
    if (value === undefined) {
      if (index < need) throw new RangeError(name + ' argument ' + index + ' is missing')
      return
    }
    finiteLeaves(value, name + ' argument ' + index)
  })
  return refuse(name)
}

export const foamSettings = (scale = WATER_DEFAULTS.scale, softness = WATER_DEFAULTS.softness) => {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) throw new RangeError('foam scale is a positive finite number')
  if (typeof softness !== 'number' || !Number.isFinite(softness) || softness < 0) throw new RangeError('foam softness is zero or more')
  return Object.freeze({ scale, softness })
}

export const waterRippleSlope = (...args) => waterCall('waterRippleSlope', args)
export const waterFoam = (...args) => waterCall('waterFoam', args)
export const waterFoamField = (...args) => waterCall('waterFoamField', args)
export const waterFoamFieldLod = (...args) => waterCall('waterFoamFieldLod', args)
export const waterFoamCoverage = (...args) => waterCall('waterFoamCoverage', args)
export const waterTransmittance = (...args) => waterCall('waterTransmittance', args)
export const waterMedium = (...args) => waterCall('waterMedium', args)
export const waterUnderwaterDistortion = (...args) => waterCall('waterUnderwaterDistortion', args)
export const waterRayBoxDistance = (...args) => waterCall('waterRayBoxDistance', args)
export const waterCaustics = (...args) => waterCall('waterCaustics', args)
export const waterCausticsAt = (...args) => waterCall('waterCausticsAt', args)
export const waterCausticsRefracted = (...args) => waterCall('waterCausticsRefracted', args)
export const waterFresnel = (...args) => waterCall('waterFresnel', args)

export { WATER_DEFAULTS }
