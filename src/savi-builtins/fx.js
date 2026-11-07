const POP_KEYS = ['spawn', 'lifetime', 'delay', 'span', 'size', 'rotation', 'alpha']
const SPAWN_KEYS = ['rate']
const SPAN_KEY = 'window'
const EMIT_TOLERANCE = 1e-9

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const refuse = (what) => {
  throw new RangeError(what + ' has no documented headless behaviour in savi; refused as a scoped negative')
}

const checkSeconds = (name, value) => {
  if (!isFiniteNumber(value) || value < 0) throw new RangeError(name + ' takes zero or more seconds')
  return value
}

const checkSpan = (input) => {
  if (!Array.isArray(input) || input.length !== 2) throw new TypeError('window is [start, end] in seconds')
  const [start, end] = input
  checkSeconds('window start', start)
  if (!(end > start)) throw new RangeError('window end is after its start')
  return [start, end]
}

export const validatePop = (name, def) => {
  if (typeof name !== 'string' || name === '') throw new TypeError('a population has a name')
  if (!def || typeof def !== 'object' || Array.isArray(def)) throw new TypeError('population ' + name + ' is an object')
  const allowed = [...POP_KEYS.filter((key) => key !== 'span'), SPAN_KEY]
  for (const key of Object.keys(def)) {
    if (!allowed.includes(key)) refuse('population key ' + key)
  }
  const spawn = def.spawn
  if (spawn === undefined || spawn === null || typeof spawn !== 'object') throw new RangeError('population ' + name + ' needs spawn: { rate }')
  for (const key of Object.keys(spawn)) {
    if (!SPAWN_KEYS.includes(key)) refuse('spawn key ' + key)
  }
  if (!isFiniteNumber(spawn.rate) || spawn.rate < 0) throw new RangeError('spawn rate is zero or more particles per second')
  let lifetime = null
  if (def.lifetime !== undefined) {
    if (Array.isArray(def.lifetime)) refuse('a random lifetime range')
    if (!isFiniteNumber(def.lifetime) || def.lifetime <= 0) throw new RangeError('lifetime takes a positive number of seconds; omit it for no expiry')
    lifetime = def.lifetime
  }
  const delay = def.delay === undefined ? 0 : checkSeconds('delay', def.delay)
  const span = def[SPAN_KEY] === undefined ? [0, Infinity] : checkSpan(def[SPAN_KEY])
  if (def.size !== undefined && (!isFiniteNumber(def.size) || def.size <= 0)) throw new RangeError('size is a positive number of metres')
  if (def.rotation !== undefined && !isFiniteNumber(def.rotation)) throw new TypeError('rotation is a finite number of radians')
  if (def.alpha !== undefined && (!isFiniteNumber(def.alpha) || def.alpha < 0 || def.alpha > 1)) throw new RangeError('alpha takes 0 to 1')
  return {
    name,
    rate: spawn.rate,
    lifetime,
    delay,
    span,
    size: def.size ?? null,
    rotation: def.rotation ?? null,
    alpha: def.alpha ?? null,
  }
}

export const emittedBy = (population, seconds) => {
  if (!isFiniteNumber(seconds) || seconds < 0) throw new RangeError('seconds takes zero or more')
  const start = Math.max(population.delay, population.span[0])
  const end = Math.min(seconds, population.span[1])
  if (end <= start) return 0
  return Math.floor(population.rate * (end - start) + EMIT_TOLERANCE)
}

const built = new WeakSet()

export const pop = (name, def) => {
  const record = Object.freeze(validatePop(name, def))
  built.add(record)
  return record
}

export const fx = (...pops) => {
  if (pops.length === 0) throw new RangeError('fx takes at least one population')
  for (const record of pops) {
    if (!built.has(record)) throw new TypeError('fx takes populations made by pop(name, def)')
  }
  return Object.freeze({ populations: pops })
}

export const FX_NAMES = Object.freeze(['fx', 'pop', 'emittedBy'])
export const FX_EMIT_TOLERANCE = EMIT_TOLERANCE
