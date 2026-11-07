export const DEFAULT_COMBAT = Object.freeze({
  respawnTime: 1.5,
  health: 100,
  damagePerHit: 20,
  headshotMultiplier: 2.5,
  headshotZone: 0.7,
  hitKnockback: 4,
  shootKnockback: 2,
  magazineSize: 30,
  reloadTime: 2000,
  spawnInvulnMs: 1500,
  fallKillDepth: 20,
  fallKillGraceSec: 0.5,
  buffRegenFractionPerSec: 0.1,
  range: 1000
})

export const POWERUP_PICKUP_RADIUS = 1.7
export const KILL_STREAK_WINDOW_MS = 3000

export const UNKNOWN_HEALTH = Object.freeze({
  known: false,
  get hp() {
    throw new TypeError('[combat] health is unattested: branch on known before reading hp')
  }
})

export function readHealth(state) {
  const hp = state?.health
  return Number.isFinite(hp) ? { known: true, hp } : UNKNOWN_HEALTH
}

const CONFIG_RULES = Object.freeze({
  respawnTime: { rule: 'a finite number greater than 0', test: v => Number.isFinite(v) && v > 0 },
  health: { rule: 'a finite number greater than 0', test: v => Number.isFinite(v) && v > 0 },
  damagePerHit: { rule: 'a finite number greater than 0', test: v => Number.isFinite(v) && v > 0 },
  headshotMultiplier: { rule: 'a finite number of at least 0', test: v => Number.isFinite(v) && v >= 0 },
  headshotZone: { rule: 'a finite number between 0 and 1', test: v => Number.isFinite(v) && v >= 0 && v <= 1 },
  hitKnockback: { rule: 'a finite number of at least 0', test: v => Number.isFinite(v) && v >= 0 },
  shootKnockback: { rule: 'a finite number of at least 0', test: v => Number.isFinite(v) && v >= 0 },
  magazineSize: { rule: 'an integer of at least 1', test: v => Number.isInteger(v) && v >= 1 },
  reloadTime: { rule: 'a finite number of at least 0', test: v => Number.isFinite(v) && v >= 0 },
  spawnInvulnMs: { rule: 'a finite number of at least 0', test: v => Number.isFinite(v) && v >= 0 },
  fallKillDepth: { rule: 'a finite number greater than 0', test: v => Number.isFinite(v) && v > 0 },
  fallKillGraceSec: { rule: 'a finite number of at least 0', test: v => Number.isFinite(v) && v >= 0 },
  buffRegenFractionPerSec: { rule: 'a finite number of at least 0', test: v => Number.isFinite(v) && v >= 0 },
  range: { rule: 'a finite number greater than 0', test: v => Number.isFinite(v) && v > 0 }
})

function describeValue(v) {
  return typeof v === 'number' ? String(v) : JSON.stringify(v)
}

export function resolveCombatConfig(overrides = {}) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) throw new TypeError('[combat] spec.config must be an object')
  const config = { ...DEFAULT_COMBAT, ...overrides }
  for (const [field, { rule, test }] of Object.entries(CONFIG_RULES)) {
    if (!Object.prototype.hasOwnProperty.call(overrides, field)) continue
    if (test(config[field])) continue
    throw new TypeError(`[combat] spec.config.${field} must be ${rule}, got ${describeValue(config[field])}`)
  }
  return config
}

export function resolveShotDamage({ config, buffDamage = 1, hitRatio, targetHp }) {
  if (!Number.isFinite(targetHp)) throw new TypeError(`[combat] shot resolved against a target whose health is unattested: ${describeValue(targetHp)}`)
  const baseDamage = Math.round(config.damagePerHit * buffDamage)
  const headshot = hitRatio >= config.headshotZone
  const damage = headshot ? Math.round(baseDamage * config.headshotMultiplier) : baseDamage
  const hp = Math.max(0, targetHp - damage)
  return { baseDamage, damage, headshot, hp, lethal: hp <= 0 }
}

export function regenerateHealth(hp, config, dt) {
  return Math.min(config.health, hp + config.health * config.buffRegenFractionPerSec * dt)
}

export function isInsidePowerupPickup(playerPosition, powerupPosition, radius = POWERUP_PICKUP_RADIUS) {
  const dx = playerPosition[0] - powerupPosition[0]
  const dy = playerPosition[1] - powerupPosition[1]
  const dz = playerPosition[2] - powerupPosition[2]
  return dx * dx + dy * dy + dz * dz <= radius * radius
}

export function createKillStreakTracker({ now = Date.now, windowMs = KILL_STREAK_WINDOW_MS } = {}) {
  const streaks = new Map()
  return {
    record(shooterId) {
      const at = now()
      const previous = streaks.get(shooterId)
      const streak = previous && at - previous.at < windowMs ? previous.streak + 1 : 1
      streaks.set(shooterId, { streak, at })
      return streak
    },
    forget(playerId) {
      streaks.delete(playerId)
    },
    streakOf(playerId) {
      const entry = streaks.get(playerId)
      return entry ? entry.streak : 0
    }
  }
}

export function createFallTimers({ graceSec }) {
  const elapsedByPlayer = new Map()
  return {
    advance(playerId, dt, falling) {
      if (!falling) {
        elapsedByPlayer.delete(playerId)
        return false
      }
      const elapsed = (elapsedByPlayer.get(playerId) || 0) + dt
      if (elapsed >= graceSec) {
        elapsedByPlayer.delete(playerId)
        return true
      }
      elapsedByPlayer.set(playerId, elapsed)
      return false
    },
    forget(playerId) {
      elapsedByPlayer.delete(playerId)
    },
    elapsedOf(playerId) {
      return elapsedByPlayer.get(playerId) || 0
    }
  }
}
