import { parseDefineSpec } from './specBoundary.js'

const PICKUP_SCHEMA = Object.freeze({
  radius: { type: 'number', min: 0, default: 1.5 },
  cooldown: { type: 'number', min: 0, default: 0 },
  oneShot: { type: 'boolean', default: false },
  onCollect: { type: 'function', required: true },
})

function readClock(now) {
  const atMs = now()
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) {
    const err = new TypeError('[pickup] pickup-clock-invalid: now() must return a finite number of milliseconds')
    err.reasonCode = 'pickup-clock-invalid'
    throw err
  }
  return atMs
}

function distanceSquared(a, b) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz
}

export function definePickup(spec, host, { now } = {}) {
  if (!host || typeof host !== 'object') {
    const err = new TypeError('[pickup] pickup-context-missing: a host accessor object is required')
    err.reasonCode = 'pickup-context-missing'
    throw err
  }
  if (typeof now !== 'function') {
    const err = new TypeError('[pickup] pickup-clock-invalid: now must be a function returning milliseconds')
    err.reasonCode = 'pickup-clock-invalid'
    throw err
  }
  const config = parseDefineSpec('definePickup', spec, PICKUP_SCHEMA)
  const radius2 = config.radius * config.radius
  const lastCollectMs = new Map()
  let collected = false

  const pickup = {
    get collected() { return collected },
    reset() {
      collected = false
      lastCollectMs.clear()
    },
    tick() {
      if (config.oneShot && collected) return
      const pos = host.position()
      if (!pos) return
      let atMs = null
      for (const player of host.players.getAll()) {
        const playerPos = player.state?.position
        if (!playerPos) continue
        if (distanceSquared(playerPos, pos) > radius2) continue
        if (config.cooldown > 0) {
          if (atMs === null) atMs = readClock(now)
          if (lastCollectMs.has(player.id) && atMs - lastCollectMs.get(player.id) < config.cooldown) continue
          lastCollectMs.set(player.id, atMs)
        }
        if (config.oneShot) collected = true
        config.onCollect(host.context, player, pickup)
        if (config.oneShot) return
      }
    },
  }
  return pickup
}
