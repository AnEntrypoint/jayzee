const PHYSICS_DEFAULTS = Object.freeze({ raycastDistance: 200, traverseStepHeight: 0.3 })
const RAYCAST_KEYS = ['distance', 'radius', 'physicsOnly', 'multiple', 'bodies']
const TRAVERSE_KEYS = ['stepHeight']
const BODIES = ['static', 'dynamic', 'all']

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const refuse = (what) => {
  throw new RangeError(what + ' has no documented headless behaviour in savi; refused as a scoped negative')
}

const toVec = (v) => {
  const arr = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x, v.y, v.z] : null
  if (!arr || arr.length !== 3 || !arr.every(isFiniteNumber)) throw new TypeError('a vector is {x, y, z} or [x, y, z] with finite numbers')
  return [arr[0], arr[1], arr[2]]
}

export const normaliseRaycast = (opts) => {
  const o = typeof opts === 'number' ? { distance: opts } : opts
  if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new TypeError('raycast opts is a distance in metres or an options object')
  for (const key of Object.keys(o)) {
    if (!RAYCAST_KEYS.includes(key)) refuse('raycast option ' + key)
  }
  const distance = o.distance ?? PHYSICS_DEFAULTS.raycastDistance
  if (!isFiniteNumber(distance) || distance <= 0) throw new RangeError('raycast distance is a positive number of metres, default 200')
  if (o.radius !== undefined && (!isFiniteNumber(o.radius) || o.radius < 0)) throw new RangeError('raycast radius is zero or more metres')
  if (o.bodies === undefined) throw new RangeError('raycast bodies is required; savi states no default for it')
  if (!BODIES.includes(o.bodies)) throw new RangeError('raycast bodies is static, dynamic or all')
  if (o.physicsOnly !== undefined && typeof o.physicsOnly !== 'boolean') throw new TypeError('physicsOnly takes a boolean')
  if (o.multiple !== undefined && typeof o.multiple !== 'boolean') throw new TypeError('multiple takes a boolean')
  return {
    distance,
    radius: o.radius ?? 0,
    physicsOnly: o.physicsOnly === true,
    multiple: o.multiple === true,
    bodies: o.bodies,
  }
}

export const normaliseTraverse = (opts = {}) => {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) throw new TypeError('traverseCheck options is an object')
  for (const key of Object.keys(opts)) {
    if (!TRAVERSE_KEYS.includes(key)) refuse('traverseCheck option ' + key)
  }
  const stepHeight = opts.stepHeight ?? PHYSICS_DEFAULTS.traverseStepHeight
  if (!isFiniteNumber(stepHeight) || stepHeight < 0) throw new RangeError('stepHeight is zero or more metres, default 0.3')
  return { stepHeight }
}

export const raycast = (ctx, origin, direction, opts) => {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('raycast takes the behaviour ctx first')
  toVec(origin)
  toVec(direction)
  normaliseRaycast(opts)
  return refuse('raycast against a physics world')
}

export const traverseCheck = (ctx, from, to, opts) => {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('traverseCheck takes the behaviour ctx first')
  toVec(from)
  toVec(to)
  normaliseTraverse(opts)
  return refuse('traverseCheck against a physics world')
}

export const createWorld = () => refuse('createWorld, a physics world of its own with save and restore')
export const overlapPoint = () => refuse('overlapPoint')
export const overlapSegment = () => refuse('overlapSegment')
export const jumpCheck = () => refuse('jumpCheck')
export const getInputRay = () => refuse('getInputRay')

export const PHYSICS_NAMES = Object.freeze(['raycast', 'overlapPoint', 'overlapSegment', 'traverseCheck', 'jumpCheck', 'getInputRay', 'createWorld'])
export const PHYSICS_OPTION_DEFAULTS = PHYSICS_DEFAULTS
