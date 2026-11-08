import { recordHit } from '../anticheat/OutlierDetector.js'
import { parseDefineSpec } from './specBoundary.js'

const PLAYER_HIT_ATTRIBUTION_RADIUS_SQ = 2 * 2
const CALLBACK_RULE = Object.freeze({ type: 'function' })
const WEAPON_SCHEMA = Object.freeze({
  damage: { type: 'number', min: 0, default: 25 },
  range: { type: 'number', min: 0, exclusiveMin: true, default: 100 },
  magazine: { type: 'number', min: 0, default: 0 },
  reloadMs: { type: 'number', min: 0, default: 1500 },
  fireRateMs: { type: 'number', min: 0, default: 120 },
  headshotMult: { type: 'number', min: 0, exclusiveMin: true, default: 2 },
  onFire: CALLBACK_RULE,
  onHit: CALLBACK_RULE,
  onKill: CALLBACK_RULE,
  onReload: CALLBACK_RULE,
})

function readHost(host) {
  if (host === null || typeof host !== 'object') throw new TypeError('[weapon] host is required')
  if (typeof host.now !== 'function') throw new TypeError('[weapon] host.now must be a clock function returning milliseconds')
  if (typeof host.raycast !== 'function') throw new TypeError('[weapon] host.raycast must be a function')
  if (!host.players || typeof host.players.getAll !== 'function') throw new TypeError('[weapon] host.players.getAll must be a function')
  return host
}

export function defineWeapon(spec = {}, host) {
  const hostRef = readHost(host)
  const parsed = parseDefineSpec('defineWeapon', spec, WEAPON_SCHEMA)
  const { damage, range, magazine, reloadMs, fireRateMs, headshotMult } = parsed
  const now = hostRef.now

  let ammo = magazine > 0 ? magazine : Infinity
  let lastFireAt = -Infinity
  let reloadingUntil = 0
  let reloadPending = false

  const isReloading = () => now() < reloadingUntil
  const notify = (name, arg) => {
    const fn = parsed[name]
    if (typeof fn !== 'function') return
    try {
      fn(hostRef, arg)
    } catch (err) {
      if (typeof hostRef.warn === 'function') hostRef.warn(`[weapon] ${name} threw: ${err && err.message}`)
    }
  }
  const finalizeReload = () => {
    if (magazine > 0 && reloadPending && now() >= reloadingUntil) {
      ammo = magazine
      reloadPending = false
    }
  }

  const weapon = {
    get ammo() { return ammo },
    get magazine() { return magazine },
    get reloading() { return isReloading() },
    canFire() {
      finalizeReload()
      if (isReloading()) return false
      if (now() - lastFireAt < fireRateMs) return false
      return ammo > 0
    },
    fire(shooterId, origin, dir, opts = {}) {
      finalizeReload()
      if (isReloading()) return { fired: false, reason: 'reloading' }
      if (now() - lastFireAt < fireRateMs) return { fired: false, reason: 'cooldown' }
      if (ammo <= 0) return { fired: false, reason: 'empty' }
      lastFireAt = now()
      if (ammo !== Infinity) ammo--
      notify('onFire', { shooterId, origin, dir })
      if (ammo === 0 && magazine > 0) weapon.reload(shooterId)

      const r = hostRef.raycast(origin, dir, range, opts.excludeBodyId ?? null)
      const result = { fired: true, hit: false, targetPlayerId: null, killed: false, ammo }
      if (!r || !r.hit) return result
      result.hit = true
      const hitPoint = r.position
      const headshot = !!opts.headshot
      const dmg = damage * (headshot ? headshotMult : 1)
      const victim = hitPoint ? findVictim(hitPoint, shooterId) : null
      if (victim && victim.state) {
        const before = victim.state.health ?? 100
        const after = Math.max(0, before - dmg)
        victim.state.health = after
        result.targetPlayerId = victim.id
        result.killed = before > 0 && after <= 0
        notify('onHit', { shooterId, targetPlayerId: victim.id, targetEntityId: r.entityId, point: hitPoint, damage: dmg, killed: result.killed })
        if (result.killed) notify('onKill', { shooterId, victimId: victim.id })
        recordHit(hostRef.eventLog, shooterId, { headshot, timestampMs: now(), targetId: victim.id })
      } else {
        notify('onHit', { shooterId, targetPlayerId: null, targetEntityId: r.entityId, point: hitPoint, damage: dmg, killed: false })
      }
      return result
    },
    reload(shooterId) {
      if (magazine <= 0) return false
      if (isReloading()) return false
      reloadingUntil = now() + reloadMs
      reloadPending = true
      notify('onReload', { shooterId })
      return true
    },
    setAmmo(n) {
      if (magazine <= 0) return ammo
      ammo = Math.max(0, Math.min(magazine, (typeof n === 'number' && Number.isFinite(n)) ? n : 0))
      return ammo
    },
  }

  const findVictim = (hitPoint, shooterId) => {
    for (const p of hostRef.players.getAll()) {
      const pp = p.state?.position
      if (!pp) continue
      if (p.id === shooterId) continue
      const dx = pp[0] - hitPoint[0], dy = pp[1] - hitPoint[1], dz = pp[2] - hitPoint[2]
      if (dx * dx + dy * dy + dz * dz <= PLAYER_HIT_ATTRIBUTION_RADIUS_SQ) return p
    }
    return null
  }

  return weapon
}

export default defineWeapon
