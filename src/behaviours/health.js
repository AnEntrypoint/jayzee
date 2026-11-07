import { parseDefineSpec, DEFINE_SPEC_SCHEMAS } from './specBoundary.js'

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isPositiveAmount = (amount) => isFiniteNumber(amount) && amount > 0

export function createHealth(spec = {}, { now = Date.now } = {}) {
  const config = parseDefineSpec('defineHealth', spec, DEFINE_SPEC_SCHEMAS.health)
  let max = config.max
  const invulnMs = config.invulnMs
  const startHp = isFiniteNumber(config.hp) ? Math.max(0, Math.min(max, config.hp)) : max
  let hp = startHp
  let alive = startHp > 0
  let lastHitAt = -Infinity

  function die(source) {
    hp = 0
    alive = false
    if (typeof config.onDeath === 'function') config.onDeath({ source })
  }

  return {
    get hp() { return hp },
    get max() { return max },
    get alive() { return alive },
    get fraction() { return max > 0 ? hp / max : 0 },
    damage(amount, source = null) {
      if (!alive || !isPositiveAmount(amount)) return hp
      const at = now()
      if (invulnMs > 0 && at - lastHitAt < invulnMs) return hp
      lastHitAt = at
      hp = Math.max(0, hp - amount)
      if (hp <= 0) die(source)
      else if (typeof config.onDamage === 'function') config.onDamage({ amount, hp, max, source })
      return hp
    },
    heal(amount) {
      if (!alive || !isPositiveAmount(amount)) return hp
      hp = Math.min(max, hp + amount)
      return hp
    },
    kill(source = null) {
      if (alive) die(source)
    },
    respawn(newHp) {
      hp = isFiniteNumber(newHp) ? Math.max(0, Math.min(max, newHp)) : max
      alive = hp > 0
      lastHitAt = -Infinity
      if (alive && typeof config.onRespawn === 'function') config.onRespawn({ hp })
      return hp
    },
    setMax(nextMax) {
      if (isPositiveAmount(nextMax)) {
        max = nextMax
        if (hp > max) hp = max
      }
      return max
    },
  }
}

export default createHealth
