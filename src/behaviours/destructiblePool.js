const PARK_OFFSET = Object.freeze([0, -5000, 0])
const IMPULSE_PATTERNS = Object.freeze(['outward', 'outward-up', 'up'])

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonNegativeNumber = (value) => isFiniteNumber(value) && value >= 0
const positiveNumber = (value) => isFiniteNumber(value) && value > 0
const positiveInteger = (value) => Number.isInteger(value) && value >= 1

const MISSING_PIECE_COUNT = '[destructible] fracturedPieceCount is required when fracturedAsset is set (read it from the baked <asset>.pieces.json sidecar\'s pieceCount field)'

const SPEC_RULES = Object.freeze([
  ['health', (v) => !positiveNumber(v), '[destructible] health must be a positive finite number'],
  ['impactThreshold', (v) => !nonNegativeNumber(v), '[destructible] impactThreshold must be a non-negative finite number'],
  ['impactRadius', (v) => !positiveNumber(v), '[destructible] impactRadius must be a positive finite number'],
  ['debrisCount', (v) => !positiveInteger(v), '[destructible] debrisCount must be a positive integer'],
  ['debrisLifetime', (v) => !nonNegativeNumber(v), '[destructible] debrisLifetime must be a non-negative finite number (seconds); 0 = never despawn'],
  ['debrisSettleGrace', (v) => !nonNegativeNumber(v), '[destructible] debrisSettleGrace must be a non-negative finite number (seconds)'],
  ['debrisFreezeAfter', (v) => !nonNegativeNumber(v), '[destructible] debrisFreezeAfter must be a non-negative finite number (seconds); 0 = disable force-freeze'],
  ['respawnDelay', (v) => !nonNegativeNumber(v), '[destructible] respawnDelay must be a non-negative finite number (seconds); 0 = never respawn'],
  ['debrisImpulsePattern', (v) => typeof v !== 'function' && !IMPULSE_PATTERNS.includes(v), '[destructible] debrisImpulsePattern must be "outward", "outward-up", "up", or a function(i, n, rng) -> [x,y,z]'],
  ['debrisShape', (v) => !isPlainObject(v), '[destructible] debrisShape must be a plain object'],
  ['fracturedAsset', (v) => typeof v !== 'string', '[destructible] fracturedAsset must be a string path to a scripts/fracture-glb.mjs-baked GLB'],
  ['fracturedPieceCount', (v) => !positiveInteger(v), '[destructible] fracturedPieceCount must be a positive integer (the number of baked pieces in fracturedAsset)'],
  ['onDestroyed', (v) => typeof v !== 'function', '[destructible] onDestroyed must be a function'],
  ['onRespawn', (v) => typeof v !== 'function', '[destructible] onRespawn must be a function'],
])

export function validateDestructibleSpec(spec) {
  if (spec !== null && typeof spec !== 'object') throw new TypeError('[destructible] spec must be an object')
  const s = spec || {}
  for (const [key, violates, message] of SPEC_RULES) {
    if (s[key] != null && violates(s[key])) throw new TypeError(message)
    if (key === 'fracturedPieceCount' && s.fracturedAsset != null && s.fracturedPieceCount == null) throw new TypeError(MISSING_PIECE_COUNT)
  }
}

export function jitter(spread, random) {
  return (random() * 2 - 1) * spread
}

export function resolveDebrisImpulsePattern(pattern, random) {
  if (typeof pattern === 'function') return pattern
  if (pattern === 'up') return () => [0, 6 + random() * 3, 0]
  if (pattern === 'outward') {
    return (i, n) => {
      const angle = (i / n) * Math.PI * 2 + jitter(0.3, random)
      const mag = 3 + random() * 2
      return [Math.cos(angle) * mag, 0, Math.sin(angle) * mag]
    }
  }
  return (i, n) => {
    const angle = (i / n) * Math.PI * 2 + jitter(0.4, random)
    const mag = 2.5 + random() * 2.5
    return [Math.cos(angle) * mag, 5 + random() * 4, Math.sin(angle) * mag]
  }
}

export function createDestructiblePool(spec = {}, host) {
  validateDestructibleSpec(spec)
  if (!host || !host.world || !host.entity || !host.players || typeof host.now !== 'function' || typeof host.random !== 'function') {
    throw new TypeError('[destructible] world, entity, players, now and random are required')
  }
  const { world, entity, players, now, random } = host

  const health = spec.health ?? 100
  const impactThreshold = spec.impactThreshold ?? 0
  const fracturedAsset = spec.fracturedAsset ?? null
  const debrisCount = fracturedAsset ? spec.fracturedPieceCount : (spec.debrisCount ?? 8)
  const debrisLifetime = spec.debrisLifetime ?? 8
  const debrisSettleGrace = spec.debrisSettleGrace ?? 0.5
  const debrisFreezeAfter = spec.debrisFreezeAfter ?? 3
  const respawnDelay = spec.respawnDelay ?? 0
  const impulseFn = resolveDebrisImpulsePattern(spec.debrisImpulsePattern ?? 'outward-up', random)

  const homePosition = [...entity.position]
  const homeScale = [...(entity.scale || [1, 1, 1])]
  const homeCustom = entity.custom ? { ...entity.custom } : null

  let damageTaken = 0
  let destroyed = false
  let respawnTimer = 0
  const debrisIds = new Set()
  const poolFree = []
  const poolAll = new Set()
  const poolByKey = new Map()
  const debrisTimers = new Map()

  function intactHalfExtents() {
    const c = homeCustom
    if (c && isFiniteNumber(c.sx) && isFiniteNumber(c.sy) && isFiniteNumber(c.sz)) return [c.sx / 2, c.sy / 2, c.sz / 2]
    return [0.5, 0.5, 0.5]
  }

  const impactRadius = spec.impactRadius ?? (Math.max(...intactHalfExtents()) * 1.5)

  function pieceExtents() {
    const shape = spec.debrisShape
    if (shape && isFiniteNumber(shape.hx) && isFiniteNumber(shape.hy) && isFiniteNumber(shape.hz)) return [shape.hx, shape.hy, shape.hz]
    const [hx, hy, hz] = intactHalfExtents()
    const divisor = Math.cbrt(debrisCount)
    return [hx / divisor, hy / divisor, hz / divisor]
  }

  function pieceMass() {
    const declared = spec.debrisShape?.mass
    if (declared != null) return Math.max(0.1, declared)
    return Math.max(0.1, (homeCustom?.mass ?? 50) / debrisCount)
  }

  function nextPieceId(suffix) {
    return `${entity.id}_debris_${suffix}_${now()}_${Math.floor(random() * 1e6)}`
  }

  function acquirePiece(position, rotation, config, fixedSlotKey, model) {
    const spawnCfg = { position, rotation, bodyType: 'dynamic', app: 'destructible-debris', config }
    if (model) spawnCfg.model = model
    let id
    if (fixedSlotKey != null) {
      id = poolByKey.get(fixedSlotKey)
      if (id == null) {
        id = nextPieceId(fixedSlotKey)
        world.spawnChild(id, spawnCfg)
        poolByKey.set(fixedSlotKey, id)
        poolAll.add(id)
        return id
      }
    } else {
      id = poolFree.pop()
      if (id == null) {
        id = nextPieceId(poolAll.size)
        world.spawnChild(id, spawnCfg)
        poolAll.add(id)
        return id
      }
    }
    world.setPosition(id, position, rotation)
    const e = world.getEntity(id)
    if (e) e.scale = [1, 1, 1]
    return id
  }

  function releasePiece(id) {
    const e = world.getEntity(id)
    if (e) {
      e.scale = [0, 0, 0]
      world.setPosition(id, [PARK_OFFSET[0], PARK_OFFSET[1], PARK_OFFSET[2]])
    }
    world.setBodyActive(id, false)
    if (!fracturedAsset) poolFree.push(id)
  }

  function trackDebris(id) {
    debrisIds.add(id)
    debrisTimers.set(id, { age: 0, remaining: debrisLifetime > 0 ? debrisLifetime : null, lod: 'physical' })
  }

  function spawnFractured() {
    const shape = spec.debrisShape || {}
    const mass = pieceMass()
    const color = shape.color ?? homeCustom?.color ?? 0x8b4513
    const roughness = shape.roughness ?? homeCustom?.roughness ?? 0.85
    const ids = []
    for (let i = 0; i < debrisCount; i++) {
      const id = acquirePiece([...homePosition], entity.rotation, { fracturedAsset, pieceIndex: i, mass, color, roughness }, i, fracturedAsset)
      world.applyImpulse(id, impulseFn(i, debrisCount, random))
      trackDebris(id)
      ids.push(id)
    }
    return ids
  }

  function spawnPieces() {
    if (fracturedAsset) return spawnFractured()
    const [px, py, pz] = homePosition
    const [hx, hy, hz] = pieceExtents()
    const shape = spec.debrisShape || {}
    const mass = pieceMass()
    const color = shape.color ?? homeCustom?.color ?? 0x8b4513
    const roughness = shape.roughness ?? homeCustom?.roughness ?? 0.85
    const ids = []
    for (let i = 0; i < debrisCount; i++) {
      const jx = jitter(hx * 0.5, random)
      const jy = jitter(hy * 0.5, random)
      const jz = jitter(hz * 0.5, random)
      const id = acquirePiece([px + jx, py + jy, pz + jz], entity.rotation, { hx, hy, hz, mass, color, roughness })
      world.applyImpulse(id, impulseFn(i, debrisCount, random))
      trackDebris(id)
      ids.push(id)
    }
    return ids
  }

  function despawnAllDebris() {
    for (const id of debrisIds) releasePiece(id)
    debrisIds.clear()
    debrisTimers.clear()
  }

  function drain() {
    for (const id of poolAll) world.destroy(id)
    poolAll.clear()
    poolFree.length = 0
    poolByKey.clear()
    debrisIds.clear()
    debrisTimers.clear()
  }

  function scanForImpact() {
    const [ox, oy, oz] = entity.position
    for (const p of players.getAll()) {
      const pp = p.state?.position
      if (!pp) continue
      const dx = pp[0] - ox
      const dy = pp[1] - oy
      const dz = pp[2] - oz
      if (dx * dx + dy * dy + dz * dz > impactRadius * impactRadius) continue
      const pv = p.state?.velocity
      if (!pv) continue
      if (destructible.impact(pv)) return
    }
    for (const id of world.nearby(entity.position, impactRadius)) {
      if (id === entity.id || debrisIds.has(id)) continue
      const e = world.getEntity(id)
      if (!e || !e.velocity) continue
      if (destructible.impact(e.velocity)) return
    }
  }

  const destructible = {
    get destroyed() { return destroyed },
    get damageTaken() { return damageTaken },
    get health() { return health },
    get debrisIds() { return [...debrisIds] },
    get debrisPoolSize() { return poolAll.size },
    get debrisPoolFree() { return poolFree.length },
    get debrisLOD() {
      return [...debrisTimers].map(([id, st]) => ({ id, age: st.age, remaining: st.remaining, lod: st.lod }))
    },
    onChartReanchor({ transfer }) {
      transfer.point(homePosition, homePosition)
    },
    damage(amount) {
      if (destroyed || !isFiniteNumber(amount) || amount <= 0) return destroyed
      damageTaken += amount
      if (damageTaken >= health) destructible.destroy()
      return destroyed
    },
    impact(velocity) {
      if (destroyed || impactThreshold <= 0 || !Array.isArray(velocity)) return destroyed
      const speed = Math.hypot(velocity[0] || 0, velocity[1] || 0, velocity[2] || 0)
      if (speed < impactThreshold) return destroyed
      return destructible.damage(health)
    },
    destroy() {
      if (destroyed) return false
      destroyed = true
      const ids = spawnPieces()
      entity.position = [homePosition[0] + PARK_OFFSET[0], homePosition[1] + PARK_OFFSET[1], homePosition[2] + PARK_OFFSET[2]]
      entity.scale = [0, 0, 0]
      respawnTimer = respawnDelay > 0 ? respawnDelay : 0
      if (typeof spec.onDestroyed === 'function') spec.onDestroyed({ ids })
      return true
    },
    respawn() {
      if (!destroyed) return false
      despawnAllDebris()
      destroyed = false
      damageTaken = 0
      respawnTimer = 0
      entity.position = [...homePosition]
      entity.scale = [...homeScale]
      if (typeof spec.onRespawn === 'function') spec.onRespawn()
      return true
    },
    reset() {
      despawnAllDebris()
      destroyed = false
      damageTaken = 0
      respawnTimer = 0
      entity.position = [...homePosition]
      entity.scale = [...homeScale]
    },
    tick(dt) {
      for (const [id, st] of debrisTimers) {
        st.age += dt
        if (st.remaining != null) {
          st.remaining -= dt
          if (st.remaining <= 0) {
            releasePiece(id)
            debrisIds.delete(id)
            debrisTimers.delete(id)
            continue
          }
        }
        if (st.lod === 'physical' && st.age >= debrisSettleGrace) {
          const forceFreeze = debrisFreezeAfter > 0 && st.age >= debrisFreezeAfter
          if ((forceFreeze || world.isAtRest(id)) && world.setMotionType(id, 'kinematic')) st.lod = 'frozen'
        } else if (st.lod === 'frozen') {
          if (world.setMotionType(id, 'static')) st.lod = 'static'
        }
      }
      if (destroyed) {
        if (respawnDelay > 0) {
          respawnTimer -= dt
          if (respawnTimer <= 0) destructible.respawn()
        }
        return
      }
      if (impactThreshold > 0) scanForImpact()
    },
    drain,
  }
  return destructible
}
