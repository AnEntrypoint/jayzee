import { defineComponentSchema, registerComponentSchema } from '../protocol/componentSchema.js'
import { parseDefineSpec, DEFINE_SPEC_SCHEMAS } from './specBoundary.js'

export const HEALTH_SCHEMA = defineComponentSchema({
  hp: { type: 'u16', tier: 'full' },
  max: { type: 'u16', tier: 'full' },
  alive: { type: 'bool', tier: 'full' },
})

export function registerHealthSchema() {
  return registerComponentSchema('health', HEALTH_SCHEMA)
}

const GROWTH_FACTOR = 2
const INITIAL_CAPACITY = 16
const FIELD_CTORS = Object.freeze({
  hp: Float32Array,
  max: Float32Array,
  alive: Float32Array,
  lastHitAt: Float64Array,
  invulnMs: Float64Array,
})
const FIELD_NAMES = Object.freeze(Object.keys(FIELD_CTORS))

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isPositiveAmount = (amount) => isFiniteNumber(amount) && amount > 0

export function createHealthPool() {
  let capacity = INITIAL_CAPACITY
  const columns = {}
  for (const name of FIELD_NAMES) columns[name] = new FIELD_CTORS[name](capacity)
  let nextFreshSlot = 0
  const freeList = []
  let epoch = 0

  function grow(minCapacity) {
    let next = capacity
    while (next < minCapacity) next *= GROWTH_FACTOR
    for (const name of FIELD_NAMES) {
      const grown = new FIELD_CTORS[name](next)
      grown.set(columns[name])
      columns[name] = grown
    }
    capacity = next
    epoch++
  }

  return {
    alloc() {
      let slot
      if (freeList.length > 0) slot = freeList.pop()
      else {
        if (nextFreshSlot >= capacity) grow(nextFreshSlot + 1)
        slot = nextFreshSlot++
      }
      for (const name of FIELD_NAMES) columns[name][slot] = 0
      return slot
    },
    free(slot) { freeList.push(slot) },
    column(name) { return columns[name] },
    get epoch() { return epoch },
    get capacity() { return capacity },
    get liveCount() { return nextFreshSlot - freeList.length },
  }
}

function readView(pool) {
  return {
    hp: pool.column('hp'),
    max: pool.column('max'),
    alive: pool.column('alive'),
    lastHitAt: pool.column('lastHitAt'),
    invulnMs: pool.column('invulnMs'),
  }
}

function viewOf(pool) {
  let epoch = pool.epoch
  let view = readView(pool)
  return function current() {
    if (epoch !== pool.epoch) {
      view = readView(pool)
      epoch = pool.epoch
    }
    return view
  }
}

export function defineHealthPooled(spec = {}, { pool, now, registerDisposer } = {}) {
  if (!pool || typeof pool.alloc !== 'function') throw new TypeError('[health] pool is required')
  if (typeof now !== 'function') throw new TypeError('[health] now must be a function')
  const config = parseDefineSpec('defineHealth', spec, DEFINE_SPEC_SCHEMAS.health)
  const columns = viewOf(pool)
  const slot = pool.alloc()
  const startHp = isFiniteNumber(config.hp) ? Math.max(0, Math.min(config.max, config.hp)) : config.max
  const initial = columns()
  initial.hp[slot] = startHp
  initial.max[slot] = config.max
  initial.alive[slot] = startHp > 0 ? 1 : 0
  initial.lastHitAt[slot] = -Infinity
  initial.invulnMs[slot] = config.invulnMs
  let disposed = false

  const health = {
    get hp() { return columns().hp[slot] },
    get max() { return columns().max[slot] },
    get alive() { return columns().alive[slot] === 1 },
    get fraction() {
      const c = columns()
      return c.max[slot] > 0 ? c.hp[slot] / c.max[slot] : 0
    },
    damage(amount, source = null) {
      const c = columns()
      if (c.alive[slot] !== 1 || !isPositiveAmount(amount)) return c.hp[slot]
      const at = now()
      if (c.invulnMs[slot] > 0 && at - c.lastHitAt[slot] < c.invulnMs[slot]) return c.hp[slot]
      c.lastHitAt[slot] = at
      const newHp = Math.max(0, c.hp[slot] - amount)
      c.hp[slot] = newHp
      if (newHp <= 0) {
        c.alive[slot] = 0
        if (typeof config.onDeath === 'function') config.onDeath({ source })
      } else if (typeof config.onDamage === 'function') {
        config.onDamage({ amount, hp: newHp, max: c.max[slot], source })
      }
      return columns().hp[slot]
    },
    heal(amount) {
      const c = columns()
      if (c.alive[slot] !== 1 || !isPositiveAmount(amount)) return c.hp[slot]
      const newHp = Math.min(c.max[slot], c.hp[slot] + amount)
      c.hp[slot] = newHp
      return newHp
    },
    kill(source = null) {
      const c = columns()
      if (c.alive[slot] !== 1) return
      c.hp[slot] = 0
      c.alive[slot] = 0
      if (typeof config.onDeath === 'function') config.onDeath({ source })
    },
    respawn(hp) {
      const c = columns()
      const newHp = isFiniteNumber(hp) ? Math.max(0, Math.min(c.max[slot], hp)) : c.max[slot]
      c.hp[slot] = newHp
      const alive = newHp > 0
      c.alive[slot] = alive ? 1 : 0
      c.lastHitAt[slot] = -Infinity
      if (alive && typeof config.onRespawn === 'function') config.onRespawn({ hp: columns().hp[slot] })
      return columns().hp[slot]
    },
    setMax(next) {
      const c = columns()
      if (isPositiveAmount(next)) {
        c.max[slot] = next
        if (c.hp[slot] > next) c.hp[slot] = next
      }
      return columns().max[slot]
    },
  }

  if (typeof registerDisposer === 'function') {
    registerDisposer(() => {
      if (disposed) return
      disposed = true
      pool.free(slot)
    })
  }
  return health
}
