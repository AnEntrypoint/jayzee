const MIN_STEER_DIST = 1e-4
const STEERING_DEFAULTS = Object.freeze({ speed: 3, arriveRadius: 0.5, separation: 0, clampToTerrain: false, yOffset: 0, useNavCost: false })
const STEERING_KEYS = Object.freeze(Object.keys(STEERING_DEFAULTS))

function refusal(field, rule) {
  const err = new TypeError(`[steering] ${field} must be ${rule}`)
  err.field = field
  return err
}

const isNonNegativeFinite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0

function readSteeringSpec(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) throw refusal('spec', 'a plain object')
  for (const key of Object.keys(spec)) {
    if (!STEERING_KEYS.includes(key)) throw new TypeError(`[steering] spec has no key "${key}"`)
  }
  const out = { ...STEERING_DEFAULTS }
  for (const key of STEERING_KEYS) {
    if (spec[key] !== undefined) out[key] = spec[key]
  }
  for (const field of ['speed', 'arriveRadius', 'separation']) {
    if (!isNonNegativeFinite(out[field])) throw refusal(field, 'a non-negative finite number')
  }
  if (typeof out.yOffset !== 'number' || !Number.isFinite(out.yOffset)) throw refusal('yOffset', 'a finite number')
  for (const field of ['clampToTerrain', 'useNavCost']) {
    if (typeof out[field] !== 'boolean') throw refusal(field, 'a boolean')
  }
  return out
}

export function defineSteering(spec = {}, host = {}) {
  const config = readSteeringSpec(spec)
  if (host === null || typeof host !== 'object') throw new TypeError('[steering] host must be an object')
  const { speed, arriveRadius, separation, clampToTerrain, yOffset, useNavCost } = config
  const sep2 = separation * separation
  const { terrainHeightAt, navCostAt } = host

  const clampY = (x, z, y) => {
    if (!clampToTerrain || typeof terrainHeightAt !== 'function') return y
    const h = terrainHeightAt(x, z)
    return typeof h === 'number' && Number.isFinite(h) ? h + yOffset : y
  }

  const stepOnce = (from, target, dt, peers) => {
    const fx = from[0], fy = from[1], fz = from[2]
    let vx = target[0] - fx, vz = target[2] - fz
    const dist = Math.hypot(vx, vz)
    let sp = speed
    const withinArriveRadius = dist <= arriveRadius
    if (withinArriveRadius) sp = dist > MIN_STEER_DIST ? speed * (dist / arriveRadius) : 0
    if (useNavCost && typeof navCostAt === 'function' && dist > MIN_STEER_DIST) {
      const cost = navCostAt(fx, fz)
      if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) sp = sp / cost
    }
    if (dist > MIN_STEER_DIST) {
      vx = (vx / dist) * sp
      vz = (vz / dist) * sp
    } else {
      vx = 0
      vz = 0
    }
    if (separation > 0 && peers && peers.length) {
      let sx = 0, sz = 0, n = 0
      for (let i = 0; i < peers.length; i++) {
        const p = peers[i]
        const dx = fx - p[0], dz = fz - p[2]
        const d2 = dx * dx + dz * dz
        if (d2 > 1e-6 && d2 < sep2) {
          const d = Math.sqrt(d2)
          sx += (dx / d) * (1 - d / separation)
          sz += (dz / d) * (1 - d / separation)
          n++
        }
      }
      if (n) {
        vx += sx * speed
        vz += sz * speed
      }
    }
    const nx = fx + vx * dt, nz = fz + vz * dt
    return { position: [nx, clampY(nx, nz, fy), nz], velocity: [vx, 0, vz], arrived: withinArriveRadius }
  }

  return {
    step(from, target, dt, peers) {
      return stepOnce(from, target, dt, peers)
    },
    followPath(from, waypoints, dt, state, peers) {
      const st = state || { i: 0 }
      if (!waypoints || st.i >= waypoints.length) return { position: [...from], velocity: [0, 0, 0], done: true, state: st }
      const waypoint = waypoints[st.i]
      const r = stepOnce(from, waypoint, dt, peers)
      if (r.arrived && Math.hypot(waypoint[0] - r.position[0], waypoint[2] - r.position[2]) <= arriveRadius) st.i++
      return { position: r.position, velocity: r.velocity, done: st.i >= waypoints.length, state: st }
    },
  }
}

export default defineSteering
