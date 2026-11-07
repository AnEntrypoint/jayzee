export function defaultImpactRadius(intactHalfExtents) {
  return Math.max(...intactHalfExtents) * 1.5
}

export function pieceExtentsFor(debrisShape, intactHalfExtents, debrisCount) {
  if (debrisShape && Number.isFinite(debrisShape.hx) && Number.isFinite(debrisShape.hy) && Number.isFinite(debrisShape.hz)) {
    return [debrisShape.hx, debrisShape.hy, debrisShape.hz]
  }
  const divisor = Math.cbrt(debrisCount)
  return intactHalfExtents.map((half) => half / divisor)
}

export function pieceMassFor(declaredMass, homeMass, debrisCount) {
  if (declaredMass != null) return Math.max(0.1, declaredMass)
  return Math.max(0.1, (homeMass ?? 50) / debrisCount)
}

export function createDestructibleCore(spec = {}) {
  const health = spec.health ?? 100
  const impactThreshold = spec.impactThreshold ?? 0
  const respawnDelay = spec.respawnDelay ?? 0
  let damageTaken = 0
  let destroyed = false
  let respawnTimer = 0

  function destroy() {
    if (destroyed) return false
    destroyed = true
    respawnTimer = respawnDelay > 0 ? respawnDelay : 0
    if (typeof spec.onDestroyed === 'function') spec.onDestroyed()
    return true
  }

  function damage(amount) {
    if (destroyed || !(typeof amount === 'number' && Number.isFinite(amount)) || amount <= 0) return destroyed
    damageTaken += amount
    if (damageTaken >= health) destroy()
    return destroyed
  }

  function respawn() {
    if (!destroyed) return false
    destroyed = false
    damageTaken = 0
    respawnTimer = 0
    if (typeof spec.onRespawn === 'function') spec.onRespawn()
    return true
  }

  return {
    get destroyed() { return destroyed },
    get damageTaken() { return damageTaken },
    get health() { return health },
    damage,
    impact(velocity) {
      if (destroyed || impactThreshold <= 0 || !Array.isArray(velocity)) return destroyed
      const speed = Math.hypot(velocity[0] || 0, velocity[1] || 0, velocity[2] || 0)
      if (speed < impactThreshold) return destroyed
      return damage(health)
    },
    destroy,
    respawn,
    reset() {
      destroyed = false
      damageTaken = 0
      respawnTimer = 0
    },
    tick(dt) {
      if (!destroyed || respawnDelay <= 0) return
      respawnTimer -= dt
      if (respawnTimer <= 0) respawn()
    },
  }
}

export function createDebrisTimers({ lifetime = 8, settleGrace = 0.5, freezeAfter = 3 } = {}) {
  const timers = new Map()
  return {
    track(id) {
      timers.set(id, { age: 0, remaining: lifetime > 0 ? lifetime : null, lod: 'physical' })
    },
    forget(id) {
      timers.delete(id)
    },
    clear() {
      timers.clear()
    },
    snapshot() {
      return [...timers].map(([id, st]) => ({ id, age: st.age, remaining: st.remaining, lod: st.lod }))
    },
    tick(dt, world) {
      const expired = []
      for (const [id, st] of timers) {
        st.age += dt
        if (st.remaining != null) {
          st.remaining -= dt
          if (st.remaining <= 0) {
            expired.push(id)
            timers.delete(id)
            continue
          }
        }
        if (st.lod === 'physical' && st.age >= settleGrace) {
          const forceFreeze = freezeAfter > 0 && st.age >= freezeAfter
          if ((forceFreeze || world.isAtRest(id)) && world.setMotionType(id, 'kinematic')) st.lod = 'frozen'
        } else if (st.lod === 'frozen') {
          if (world.setMotionType(id, 'static')) st.lod = 'static'
        }
      }
      return expired
    }
  }
}
