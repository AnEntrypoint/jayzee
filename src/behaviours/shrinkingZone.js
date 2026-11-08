const RING_UNIT_DISC_RADIUS = 0.5
const DEFAULT_RING_COLOR = 0x00ffff
const DEFAULT_PHASE_SHRINK_SEC = 30
const VALID_PENALTIES = new Set(['damage', 'push', 'both'])

function refusal(message) {
  const err = new TypeError(`[shrinking-zone] ${message}`)
  err.reasonCode = 'shrinking-zone-invalid'
  return err
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isVec3 = (value) => Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
const isOptionalAtLeast = (value, min) => value == null || (isFiniteNumber(value) && value >= min)
const isOptionalPositive = (value) => value == null || (isFiniteNumber(value) && value > 0)
const isOptionalFunction = (value) => value == null || typeof value === 'function'

function validatePhase(phase, index) {
  if (!isPlainObject(phase)) throw refusal(`phases[${index}] must be an object`)
  if (!isOptionalAtLeast(phase.radius, 0) || phase.radius == null) throw refusal(`phases[${index}].radius must be a non-negative finite number`)
  if (!isOptionalAtLeast(phase.holdSec, 0)) throw refusal(`phases[${index}].holdSec must be a non-negative finite number`)
  if (!isOptionalAtLeast(phase.shrinkSec, 0)) throw refusal(`phases[${index}].shrinkSec must be a non-negative finite number`)
}

function validateLinear(spec) {
  if (!isOptionalPositive(spec.startRadius)) throw refusal('startRadius must be a positive finite number')
  if (!isOptionalAtLeast(spec.endRadius, 0)) throw refusal('endRadius must be a non-negative finite number')
  if (!isOptionalPositive(spec.durationSec)) throw refusal('durationSec must be a positive finite number')
  if ((spec.endRadius ?? 5) > (spec.startRadius ?? 100)) throw refusal('endRadius must not exceed startRadius')
}

function validateSpec(spec) {
  if (!isPlainObject(spec)) throw refusal('spec must be an object')
  if (spec.center != null && !isVec3(spec.center)) throw refusal('center must be a [x,y,z] finite-number array')
  if (spec.curve != null && spec.curve !== 'linear' && spec.curve !== 'phases') throw refusal('curve must be "linear" or "phases"')
  if ((spec.curve ?? 'linear') === 'linear') {
    validateLinear(spec)
  } else {
    if (!Array.isArray(spec.phases) || spec.phases.length === 0) throw refusal('phases must be a non-empty array when curve is "phases"')
    spec.phases.forEach(validatePhase)
  }
  if (!isOptionalAtLeast(spec.startDelaySec, 0)) throw refusal('startDelaySec must be a non-negative finite number')
  if (spec.outsidePenalty != null && !VALID_PENALTIES.has(spec.outsidePenalty)) throw refusal('outsidePenalty must be "damage", "push", or "both"')
  if (!isOptionalAtLeast(spec.damagePerSec, 0)) throw refusal('damagePerSec must be a non-negative finite number')
  if (!isOptionalAtLeast(spec.pushForce, 0)) throw refusal('pushForce must be a non-negative finite number')
  if (spec.affectDynamicEntities != null && typeof spec.affectDynamicEntities !== 'boolean') throw refusal('affectDynamicEntities must be a boolean')
  if (spec.showRing != null && typeof spec.showRing !== 'boolean') throw refusal('showRing must be a boolean')
  if (spec.ringColor != null && (!Number.isInteger(spec.ringColor) || spec.ringColor < 0)) throw refusal('ringColor must be a non-negative integer (hex color)')
  if (!isOptionalPositive(spec.ringHeight)) throw refusal('ringHeight must be a positive finite number')
  if (!isOptionalFunction(spec.onPhaseChange)) throw refusal('onPhaseChange must be a function')
  if (!isOptionalFunction(spec.onComplete)) throw refusal('onComplete must be a function')
}

const lerp = (a, b, t) => a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t)

function buildPhases(spec) {
  return spec.phases.map((phase) => ({
    radius: phase.radius,
    holdSec: phase.holdSec ?? 0,
    shrinkSec: phase.shrinkSec ?? DEFAULT_PHASE_SHRINK_SEC,
  }))
}

export function defineShrinkingZone(spec = {}, host = null) {
  validateSpec(spec)
  if (!host || typeof host !== 'object') throw refusal('a host accessor object is required')

  const center = spec.center ? [...spec.center] : [0, 0, 0]
  const curve = spec.curve ?? 'linear'
  const startDelaySec = spec.startDelaySec ?? 0
  const outsidePenalty = spec.outsidePenalty ?? 'damage'
  const damagePerSec = spec.damagePerSec ?? 5
  const pushForce = spec.pushForce ?? 8
  const affectDynamicEntities = spec.affectDynamicEntities === true
  const showRing = spec.showRing ?? true
  const ringColor = spec.ringColor ?? DEFAULT_RING_COLOR
  const ringHeight = spec.ringHeight ?? 0.2
  const startRadius = spec.startRadius ?? 100
  const endRadius = spec.endRadius ?? 5
  const durationSec = spec.durationSec ?? 120
  const phases = curve === 'phases' ? buildPhases(spec) : null
  const appliesDamage = outsidePenalty === 'damage' || outsidePenalty === 'both'
  const appliesPush = outsidePenalty === 'push' || outsidePenalty === 'both'

  let elapsed = 0
  let radius = curve === 'phases' ? phases[0].radius : startRadius
  let phaseIndex = 0
  let completed = false
  let ringId = null
  let outDirX = 0
  let outDirZ = 0
  const impulse = [0, 0, 0]

  const ringEntityId = () => `${host.entityId()}_zone_ring`

  function setPhase(index) {
    if (index === phaseIndex) return
    phaseIndex = index
    if (spec.onPhaseChange) spec.onPhaseChange(host.context, zone)
  }

  function spawnRing() {
    if (!showRing || ringId) return
    const id = ringEntityId()
    host.world.spawnChild(id, {
      position: [center[0], center[1], center[2]],
      bodyType: 'static',
      app: 'shrinking-zone-ring',
      config: { r: radius, h: ringHeight, color: ringColor },
    })
    ringId = id
  }

  function syncRing() {
    if (!showRing || !ringId) return
    const entity = host.world.getEntity(ringId)
    if (!entity) return
    entity.position[0] = center[0]
    entity.position[1] = center[1]
    entity.position[2] = center[2]
    const ringScale = radius / RING_UNIT_DISC_RADIUS
    entity.scale[0] = ringScale
    entity.scale[2] = ringScale
  }

  function despawnRing() {
    if (!ringId) return
    host.world.destroy(ringId)
    ringId = null
  }

  function linearRadius(activeSec) {
    if (durationSec <= 0) return endRadius
    return lerp(startRadius, endRadius, activeSec / durationSec)
  }

  function phaseRadius(activeSec) {
    let acc = 0
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i]
      const holdEnd = acc + phase.holdSec
      const shrinkEnd = holdEnd + (i + 1 < phases.length ? phases[i + 1].shrinkSec : 0)
      if (activeSec < holdEnd) {
        setPhase(i)
        return phase.radius
      }
      if (i + 1 < phases.length && activeSec < shrinkEnd) {
        setPhase(i + 1)
        const t = (activeSec - holdEnd) / Math.max(1e-6, phases[i + 1].shrinkSec)
        return lerp(phase.radius, phases[i + 1].radius, t)
      }
      acc = shrinkEnd
    }
    setPhase(phases.length - 1)
    return phases[phases.length - 1].radius
  }

  function finalRadiusReached() {
    return curve === 'linear' ? radius <= endRadius : radius <= phases[phases.length - 1].radius
  }

  function penalize(pos, vel, dt, applyPush) {
    const dx = pos[0] - center[0]
    const dz = pos[2] - center[2]
    const dist = Math.hypot(dx, dz)
    if (dist <= radius) return false
    const dirX = dist > 1e-6 ? -dx / dist : 0
    const dirZ = dist > 1e-6 ? -dz / dist : 0
    if (applyPush && vel) {
      vel[0] += dirX * pushForce * dt
      vel[2] += dirZ * pushForce * dt
    }
    outDirX = dirX
    outDirZ = dirZ
    return true
  }

  function scanPlayers(dt) {
    for (const player of host.players.getAll()) {
      const state = player.state
      if (!state || !state.position) continue
      if ((state.health ?? 1) <= 0) continue
      if (!penalize(state.position, state.velocity, dt, appliesPush)) continue
      if (appliesDamage && damagePerSec > 0) {
        const before = state.health ?? 100
        state.health = Math.max(0, before - damagePerSec * dt)
        if (state.health <= 0 && before > 0) host.players.send(player.id, { type: 'zone_death' })
      }
      if (appliesPush && pushForce > 0) host.players.send(player.id, { type: 'zone_push', dirX: outDirX, dirZ: outDirZ })
    }
  }

  function scanDynamicEntities(dt) {
    if (!affectDynamicEntities || !appliesPush) return
    const scanRadius = Math.max(radius * 3, radius + 200)
    for (const id of host.world.nearby(center, scanRadius)) {
      if (id === host.entityId() || id === ringId) continue
      const entity = host.world.getEntity(id)
      if (!entity || entity.bodyType !== 'dynamic' || !entity.position) continue
      if (!penalize(entity.position, null, dt, false)) continue
      if (pushForce > 0) {
        impulse[0] = outDirX * pushForce * dt
        impulse[2] = outDirZ * pushForce * dt
        host.world.applyImpulse(id, impulse)
      }
    }
  }

  const zone = {
    get radius() { return radius },
    get center() { return [...center] },
    get elapsed() { return elapsed },
    get phaseIndex() { return phaseIndex },
    get completed() { return completed },
    get ringEntityId() { return ringId },

    onChartReanchor({ transfer }) {
      transfer.point(center, center)
    },

    isOutside(pos) {
      if (!isVec3(pos)) return false
      return Math.hypot(pos[0] - center[0], pos[2] - center[2]) > radius
    },

    setCenter(pos) {
      if (!isVec3(pos)) throw refusal('setCenter requires a [x,y,z] finite-number array')
      center[0] = pos[0]
      center[1] = pos[1]
      center[2] = pos[2]
    },

    tick(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return
      elapsed += dt
      spawnRing()
      const activeSec = elapsed - startDelaySec
      if (activeSec > 0) {
        radius = curve === 'linear' ? linearRadius(activeSec) : phaseRadius(activeSec)
        if (!completed && finalRadiusReached()) {
          completed = true
          if (spec.onComplete) spec.onComplete(host.context, zone)
        }
        scanPlayers(dt)
        scanDynamicEntities(dt)
      }
      syncRing()
    },

    destroy() {
      despawnRing()
    },

    reset() {
      elapsed = 0
      phaseIndex = 0
      completed = false
      radius = curve === 'phases' ? phases[0].radius : startRadius
    },
  }

  return zone
}

export default defineShrinkingZone
