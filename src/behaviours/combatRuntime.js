import { resolveCombatConfig, resolveShotDamage, regenerateHealth, isInsidePowerupPickup, createKillStreakTracker, createFallTimers, POWERUP_PICKUP_RADIUS } from './combat.js'
import { findHitSpatial, hitHeightRatio, normalizeShotDirection, resolveFireRequest, DEFAULT_HITBOX } from '../netcode/hitscan.js'
import { createShotEpochResolver, SHOT_EPOCH_REFUSAL } from '../netcode/shotChartEpoch.js'

export const COMBAT_REFUSAL = Object.freeze({
  NOT_JOINED: 'not-joined',
  ALREADY_JOINED: 'already-joined',
  MESSAGE_SHAPE: 'message-not-object',
  UNKNOWN_MESSAGE: 'unknown-message',
  DEAD: 'dead',
  RELOADING: 'reloading',
  EMPTY: 'empty',
  FULL: 'magazine-full',
  DIRECTION: 'bad-direction',
  NO_BODY: 'no-body',
})

export const DEFAULT_POWERUP_KINDS = Object.freeze([
  Object.freeze({ kind: 'damage', multiplier: 2, durationMs: 10000 }),
  Object.freeze({ kind: 'regen', durationMs: 8000 }),
  Object.freeze({ kind: 'health', amount: 50 }),
])

export const DEFAULT_POWERUP_RESPAWN_MS = 15000
const PLACEMENT_TRIES_PER_POWERUP = 32

const isVec3 = (v) => Array.isArray(v) && v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])

const refusal = (reason) => ({ ok: false, reason })

export function placePowerups({ count, min, max, random, groundAt, minSeparation = POWERUP_PICKUP_RADIUS * 2, kinds = DEFAULT_POWERUP_KINDS }) {
  if (!Number.isInteger(count) || count < 0) throw new TypeError('[combat] placePowerups count must be an integer of at least 0')
  if (!isVec3(min) || !isVec3(max)) throw new TypeError('[combat] placePowerups needs finite min and max triples')
  if (typeof random !== 'function') throw new TypeError('[combat] placePowerups needs an injected random function')
  if (typeof groundAt !== 'function') throw new TypeError('[combat] placePowerups needs groundAt(x, z) returning a height or null')
  if (!Array.isArray(kinds) || kinds.length === 0) throw new TypeError('[combat] placePowerups needs at least one powerup kind')
  const placed = []
  const sep2 = minSeparation * minSeparation
  let tries = 0
  const limit = count * PLACEMENT_TRIES_PER_POWERUP
  while (placed.length < count && tries < limit) {
    tries++
    const x = min[0] + (max[0] - min[0]) * random()
    const z = min[2] + (max[2] - min[2]) * random()
    const kind = kinds[Math.min(kinds.length - 1, Math.floor(random() * kinds.length))]
    const y = groundAt(x, z)
    if (!Number.isFinite(y) || y < min[1] || y > max[1]) continue
    let clear = true
    for (const other of placed) {
      const dx = other.position[0] - x, dy = other.position[1] - y, dz = other.position[2] - z
      if (dx * dx + dy * dy + dz * dz < sep2) { clear = false; break }
    }
    if (!clear) continue
    placed.push({ id: 'powerup-' + placed.length, position: [x, y, z], ...kind })
  }
  return { powerups: placed, tries, short: count - placed.length }
}

export function createCombatRuntime({ config: overrides = {}, players, raycast = null, lagComp = null, now, send, broadcast, spawnPoints = [[0, 0, 0]], powerups = [], powerupRespawnMs = DEFAULT_POWERUP_RESPAWN_MS, hitbox = DEFAULT_HITBOX, chartLedger = null }) {
  const config = resolveCombatConfig(overrides)
  if (typeof players?.list !== 'function' || typeof players?.get !== 'function') throw new TypeError('[combat] runtime needs players with list and get')
  if (raycast !== null && typeof raycast !== 'function') throw new TypeError('[combat] raycast must be a function (origin, direction, range) or null')
  if (typeof now !== 'function') throw new TypeError('[combat] runtime needs an injected now clock in milliseconds')
  if (typeof send !== 'function' || typeof broadcast !== 'function') throw new TypeError('[combat] runtime needs send and broadcast functions')
  if (!Array.isArray(spawnPoints) || spawnPoints.length === 0 || !spawnPoints.every(isVec3)) throw new TypeError('[combat] spawnPoints must be a non-empty array of finite triples')
  if (!Array.isArray(powerups) || !powerups.every((p) => p && typeof p.id === 'string' && isVec3(p.position) && typeof p.kind === 'string')) throw new TypeError('[combat] each powerup needs an id, a position and a kind')

  const shotEpochs = chartLedger === null ? null : createShotEpochResolver({ ledger: chartLedger, lagComp, hitbox })
  const combatants = new Map()
  const streaks = createKillStreakTracker({ now })
  const fallTimers = createFallTimers({ graceSec: config.fallKillGraceSec })
  const pickups = powerups.map((p) => ({ ...p, position: [...p.position], active: true, respawnAt: 0 }))
  const stats = { shots: 0, hits: 0, blocked: 0, kills: 0, refused: 0, pickups: 0, reexpressed: 0 }
  const impulse = [0, 0, 0]

  const bodyOf = (id) => {
    const player = players.get(id)
    return player && player.state && isVec3(player.state.position) ? player : null
  }

  const alive = (c) => c.respawnAt === 0

  const refuse = (reason) => {
    stats.refused++
    return refusal(reason)
  }

  function chooseSpawn(forId) {
    let best = 0
    let bestGap = -1
    for (let i = 0; i < spawnPoints.length; i++) {
      let gap = Infinity
      for (const [otherId, other] of combatants) {
        if (otherId === forId || !alive(other)) continue
        const body = bodyOf(otherId)
        if (!body) continue
        const p = body.state.position
        const d = Math.hypot(p[0] - spawnPoints[i][0], p[1] - spawnPoints[i][1], p[2] - spawnPoints[i][2])
        if (d < gap) gap = d
      }
      if (gap > bestGap) { bestGap = gap; best = i }
    }
    return best
  }

  function placeAtSpawn(id, c) {
    const index = chooseSpawn(id)
    const point = spawnPoints[index]
    if (typeof players.teleport === 'function') players.teleport(id, [point[0], point[1], point[2]])
    c.hp = config.health
    c.ammo = config.magazineSize
    c.reloadUntil = 0
    c.respawnAt = 0
    c.invulnUntil = now() + config.spawnInvulnMs
    c.damageMultiplier = 1
    c.damageUntil = 0
    c.regenUntil = 0
    fallTimers.forget(id)
    return index
  }

  function push(id, direction, strength) {
    if (strength === 0 || typeof players.applyImpulse !== 'function') return
    impulse[0] = direction[0] * strength
    impulse[1] = direction[1] * strength
    impulse[2] = direction[2] * strength
    players.applyImpulse(id, impulse)
  }

  function kill(victimId, killerId, cause, headshot = false) {
    const victim = combatants.get(victimId)
    if (!victim || !alive(victim)) return false
    victim.hp = 0
    victim.deaths++
    victim.respawnAt = now() + config.respawnTime * 1000
    victim.reloadUntil = 0
    victim.damageMultiplier = 1
    victim.damageUntil = 0
    victim.regenUntil = 0
    streaks.forget(victimId)
    fallTimers.forget(victimId)
    let streak = 0
    const killer = killerId !== null && killerId !== victimId ? combatants.get(killerId) : null
    if (killer) {
      killer.kills++
      streak = streaks.record(killerId)
    }
    stats.kills++
    broadcast({ type: 'kill', killer: killer ? killerId : null, victim: victimId, cause, headshot, streak })
    return true
  }

  function reload(id) {
    const c = combatants.get(id)
    if (!c) return refuse(COMBAT_REFUSAL.NOT_JOINED)
    if (!alive(c)) return refuse(COMBAT_REFUSAL.DEAD)
    if (c.reloadUntil !== 0) return refuse(COMBAT_REFUSAL.RELOADING)
    if (c.ammo === config.magazineSize) return refuse(COMBAT_REFUSAL.FULL)
    c.reloadUntil = now() + config.reloadTime
    send(id, { type: 'reload', until: c.reloadUntil })
    return { ok: true, until: c.reloadUntil }
  }

  function fire(id, msg) {
    const c = combatants.get(id)
    if (!c) return refuse(COMBAT_REFUSAL.NOT_JOINED)
    if (!alive(c)) return refuse(COMBAT_REFUSAL.DEAD)
    if (c.reloadUntil !== 0) return refuse(COMBAT_REFUSAL.RELOADING)
    const stamped = shotEpochs === null ? null : shotEpochs.reexpress(msg)
    if (stamped !== null && !stamped.ok && stamped.reason !== SHOT_EPOCH_REFUSAL.DIRECTION) return refuse(stamped.reason)
    const direction = stamped !== null && stamped.ok ? stamped.direction : normalizeShotDirection(msg?.direction)
    if (!direction) return refuse(COMBAT_REFUSAL.DIRECTION)
    const shooter = bodyOf(id)
    if (!shooter) return refuse(COMBAT_REFUSAL.NO_BODY)
    if (c.ammo === 0) {
      reload(id)
      return refuse(COMBAT_REFUSAL.EMPTY)
    }
    c.ammo--
    stats.shots++
    if (stamped !== null && stamped.reexpressed) stats.reexpressed++
    const request = resolveFireRequest(lagComp, id, shooter.state.position, stamped ?? msg, hitbox)
    const targetable = (target) => {
      const other = combatants.get(target.id)
      return other !== undefined && alive(other)
    }
    const hit = findHitSpatial(players.list(), { shooterId: id, origin: request.origin, direction, range: config.range, lagComp, viewTick: request.viewTick, isTargetable: targetable, hitbox })
    const wall = raycast ? raycast(request.origin, direction, config.range) : null
    push(id, direction, -config.shootKnockback)
    if (c.ammo === 0) reload(id)
    if (!hit) return { ok: true, hit: false, blocked: false, ammo: c.ammo }
    if (wall && Number.isFinite(wall.distance) && wall.distance < hit.dot) {
      stats.blocked++
      return { ok: true, hit: false, blocked: true, ammo: c.ammo }
    }
    const targetId = hit.target.id
    const target = combatants.get(targetId)
    if (now() < target.invulnUntil) return { ok: true, hit: true, target: targetId, damage: 0, invulnerable: true, ammo: c.ammo }
    const multiplier = now() < c.damageUntil ? c.damageMultiplier : 1
    const shot = resolveShotDamage({ config, buffDamage: multiplier, hitRatio: hitHeightRatio(hit.proj, hit.tp, hitbox), targetHp: target.hp })
    target.hp = shot.hp
    stats.hits++
    push(targetId, direction, config.hitKnockback)
    send(targetId, { type: 'hit', by: id, damage: shot.damage, headshot: shot.headshot, hp: shot.hp })
    send(id, { type: 'hit_confirm', target: targetId, damage: shot.damage, headshot: shot.headshot, lethal: shot.lethal })
    if (shot.lethal) kill(targetId, id, 'shot', shot.headshot)
    return { ok: true, hit: true, target: targetId, damage: shot.damage, headshot: shot.headshot, lethal: shot.lethal, rewound: hit.rewound !== null, ammo: c.ammo }
  }

  function scoreboard() {
    const rows = []
    for (const [id, c] of combatants) rows.push({ id, kills: c.kills, deaths: c.deaths, streak: streaks.streakOf(id), alive: alive(c) })
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
    return rows
  }

  function applyPickup(id, c, pickup) {
    const at = now()
    if (pickup.kind === 'damage') {
      c.damageMultiplier = Number.isFinite(pickup.multiplier) && pickup.multiplier > 0 ? pickup.multiplier : 2
      c.damageUntil = at + (pickup.durationMs || 0)
    } else if (pickup.kind === 'regen') {
      c.regenUntil = at + (pickup.durationMs || 0)
    } else if (pickup.kind === 'health') {
      c.hp = Math.min(config.health, c.hp + (Number.isFinite(pickup.amount) ? pickup.amount : 0))
    }
    pickup.active = false
    pickup.respawnAt = at + powerupRespawnMs
    stats.pickups++
    broadcast({ type: 'powerup_taken', id: pickup.id, kind: pickup.kind, by: id, respawnAt: pickup.respawnAt })
  }

  return {
    config,
    join(id) {
      if (combatants.has(id)) return refuse(COMBAT_REFUSAL.ALREADY_JOINED)
      if (!bodyOf(id)) return refuse(COMBAT_REFUSAL.NO_BODY)
      const c = { hp: 0, ammo: 0, reloadUntil: 0, respawnAt: 0, invulnUntil: 0, damageMultiplier: 1, damageUntil: 0, regenUntil: 0, kills: 0, deaths: 0 }
      combatants.set(id, c)
      const spawnIndex = placeAtSpawn(id, c)
      send(id, { type: 'combat_state', hp: c.hp, ammo: c.ammo, powerups: pickups.map((p) => ({ id: p.id, kind: p.kind, position: p.position, active: p.active })) })
      return { ok: true, spawnIndex }
    },
    leave(id) {
      if (!combatants.delete(id)) return false
      streaks.forget(id)
      fallTimers.forget(id)
      return true
    },
    fire,
    reload,
    handleMessage(id, msg) {
      if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return refuse(COMBAT_REFUSAL.MESSAGE_SHAPE)
      if (!combatants.has(id)) return refuse(COMBAT_REFUSAL.NOT_JOINED)
      if (msg.type === 'fire') return fire(id, msg)
      if (msg.type === 'reload') return reload(id)
      if (msg.type === 'scoreboard') {
        const rows = scoreboard()
        send(id, { type: 'scoreboard', rows })
        return { ok: true, rows }
      }
      return refuse(COMBAT_REFUSAL.UNKNOWN_MESSAGE)
    },
    tick(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('[combat] tick needs a finite dt of at least 0, got ' + String(dt))
      const at = now()
      for (const [id, c] of combatants) {
        if (!alive(c)) {
          if (at >= c.respawnAt) {
            const spawnIndex = placeAtSpawn(id, c)
            broadcast({ type: 'respawn', player: id, spawnIndex })
          }
          continue
        }
        if (c.reloadUntil !== 0 && at >= c.reloadUntil) {
          c.reloadUntil = 0
          c.ammo = config.magazineSize
          send(id, { type: 'reloaded', ammo: c.ammo })
        }
        if (at < c.regenUntil) c.hp = regenerateHealth(c.hp, config, dt)
        const body = bodyOf(id)
        if (!body) continue
        if (fallTimers.advance(id, dt, body.state.position[1] < -config.fallKillDepth)) {
          kill(id, null, 'fall')
          continue
        }
        for (const pickup of pickups) {
          if (pickup.active && isInsidePowerupPickup(body.state.position, pickup.position)) applyPickup(id, c, pickup)
        }
      }
      for (const pickup of pickups) {
        if (!pickup.active && at >= pickup.respawnAt) {
          pickup.active = true
          broadcast({ type: 'powerup_ready', id: pickup.id, kind: pickup.kind, position: pickup.position })
        }
      }
    },
    scoreboard,
    stateOf(id) {
      const c = combatants.get(id)
      if (!c) return null
      const at = now()
      return { hp: c.hp, ammo: c.ammo, alive: alive(c), reloading: c.reloadUntil !== 0, invulnerable: at < c.invulnUntil, damageMultiplier: at < c.damageUntil ? c.damageMultiplier : 1, regenerating: at < c.regenUntil, kills: c.kills, deaths: c.deaths }
    },
    powerupStates() {
      return pickups.map((p) => ({ id: p.id, kind: p.kind, active: p.active, respawnAt: p.respawnAt }))
    },
    getStats() {
      return { ...stats }
    },
  }
}
