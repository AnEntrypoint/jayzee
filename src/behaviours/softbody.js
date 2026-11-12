export const SOFTBODY_DEFAULTS = Object.freeze({
  particleCapacity: 512,
  constraintCapacity: 4096,
  gravity: Object.freeze([0, -9.81, 0]),
  stepSeconds: 1 / 60,
  substeps: 8,
  iterations: 1,
  damping: 0.05,
  friction: 0.6,
  groundY: null,
})

export const SOFTBODY_REFUSAL = Object.freeze({
  OPTION: 'softbody-option',
  FULL: 'softbody-full',
  INDEX: 'softbody-index',
  VALUE: 'softbody-value',
  DEGENERATE: 'softbody-degenerate-constraint',
})

export class SoftbodyError extends Error {
  constructor(code, message) {
    super(code + ': ' + message)
    this.name = 'SoftbodyError'
    this.code = code
  }
}

const refuse = (code, message) => {
  throw new SoftbodyError(code, message)
}

const isVec3 = (v) => Array.isArray(v) && v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])

const positiveInteger = (value, name) => {
  if (!Number.isInteger(value) || value < 1) refuse(SOFTBODY_REFUSAL.OPTION, name + ' must be an integer of at least 1, got ' + String(value))
  return value
}

const atLeastZero = (value, name, code = SOFTBODY_REFUSAL.OPTION) => {
  if (!Number.isFinite(value) || value < 0) refuse(code, name + ' must be a finite number of at least 0, got ' + String(value))
  return value
}

export function createSoftbody(options = {}) {
  const o = { ...SOFTBODY_DEFAULTS, ...options }
  const particleCapacity = positiveInteger(o.particleCapacity, 'particleCapacity')
  const constraintCapacity = positiveInteger(o.constraintCapacity, 'constraintCapacity')
  const substeps = positiveInteger(o.substeps, 'substeps')
  if (!Number.isInteger(o.iterations) || o.iterations < 0) refuse(SOFTBODY_REFUSAL.OPTION, 'iterations must be an integer of at least 0')
  const iterations = o.iterations
  if (!Number.isFinite(o.stepSeconds) || o.stepSeconds <= 0) refuse(SOFTBODY_REFUSAL.OPTION, 'stepSeconds must be a finite number greater than 0')
  const damping = atLeastZero(o.damping, 'damping')
  const friction = atLeastZero(o.friction, 'friction')
  if (!isVec3(o.gravity)) refuse(SOFTBODY_REFUSAL.OPTION, 'gravity must be a finite [x, y, z] triple')
  if (o.groundY !== null && !Number.isFinite(o.groundY)) refuse(SOFTBODY_REFUSAL.OPTION, 'groundY must be null or a finite number')
  const collider = o.collider ?? null
  if (collider !== null && typeof collider !== 'function') refuse(SOFTBODY_REFUSAL.OPTION, 'collider must be a function (x, y, z, normalOut) returning a signed distance')
  const groundY = o.groundY
  const gx = o.gravity[0], gy = o.gravity[1], gz = o.gravity[2]
  const h = o.stepSeconds / substeps
  const keepVelocity = Math.max(0, 1 - damping * h)
  const keepTangent = Math.max(0, 1 - friction)

  const px = new Float64Array(particleCapacity), py = new Float64Array(particleCapacity), pz = new Float64Array(particleCapacity)
  const qx = new Float64Array(particleCapacity), qy = new Float64Array(particleCapacity), qz = new Float64Array(particleCapacity)
  const vx = new Float64Array(particleCapacity), vy = new Float64Array(particleCapacity), vz = new Float64Array(particleCapacity)
  const invMass = new Float64Array(particleCapacity)
  const massOf = new Float64Array(particleCapacity)
  const touching = new Uint8Array(particleCapacity)
  const ca = new Int32Array(constraintCapacity), cb = new Int32Array(constraintCapacity)
  const rest = new Float64Array(constraintCapacity)
  const compliance = new Float64Array(constraintCapacity)
  const normal = [0, 0, 0]
  const hashX = new Uint32Array(px.buffer), hashY = new Uint32Array(py.buffer), hashZ = new Uint32Array(pz.buffer)
  let particles = 0
  let constraints = 0
  let ticks = 0

  function checkIndex(i) {
    if (!Number.isInteger(i) || i < 0 || i >= particles) refuse(SOFTBODY_REFUSAL.INDEX, 'no particle ' + String(i) + ' (count ' + particles + ')')
  }

  function solveConstraints() {
    for (let c = 0; c < constraints; c++) {
      const i = ca[c], j = cb[c]
      const wi = invMass[i], wj = invMass[j]
      const w = wi + wj
      if (w === 0) continue
      const dx = px[i] - px[j], dy = py[i] - py[j], dz = pz[i] - pz[j]
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (length === 0) continue
      const lambda = -(length - rest[c]) / (w + compliance[c] / (h * h)) / length
      px[i] += wi * lambda * dx; py[i] += wi * lambda * dy; pz[i] += wi * lambda * dz
      px[j] -= wj * lambda * dx; py[j] -= wj * lambda * dy; pz[j] -= wj * lambda * dz
    }
  }

  function collide() {
    for (let i = 0; i < particles; i++) {
      touching[i] = 0
      if (invMass[i] === 0) continue
      if (groundY !== null && py[i] < groundY) {
        py[i] = groundY
        px[i] = qx[i] + (px[i] - qx[i]) * keepTangent
        pz[i] = qz[i] + (pz[i] - qz[i]) * keepTangent
        touching[i] = 1
      }
      if (collider !== null) {
        const distance = collider(px[i], py[i], pz[i], normal)
        if (distance < 0) {
          px[i] -= normal[0] * distance
          py[i] -= normal[1] * distance
          pz[i] -= normal[2] * distance
          touching[i] = 1
        }
      }
    }
  }

  function substep() {
    for (let i = 0; i < particles; i++) {
      if (invMass[i] === 0) continue
      vx[i] += gx * h; vy[i] += gy * h; vz[i] += gz * h
      qx[i] = px[i]; qy[i] = py[i]; qz[i] = pz[i]
      px[i] += vx[i] * h; py[i] += vy[i] * h; pz[i] += vz[i] * h
    }
    for (let k = 0; k < iterations; k++) solveConstraints()
    collide()
    for (let i = 0; i < particles; i++) {
      if (invMass[i] === 0) continue
      vx[i] = (px[i] - qx[i]) / h * keepVelocity
      vy[i] = (py[i] - qy[i]) / h * keepVelocity
      vz[i] = (pz[i] - qz[i]) / h * keepVelocity
    }
  }

  const body = {
    particleCapacity,
    constraintCapacity,
    substepSeconds: h,
    get particleCount() { return particles },
    get constraintCount() { return constraints },
    get ticks() { return ticks },
    addParticle(x, y, z, mass = 1) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) refuse(SOFTBODY_REFUSAL.VALUE, 'a particle needs three finite position numbers')
      atLeastZero(mass, 'mass', SOFTBODY_REFUSAL.VALUE)
      if (particles === particleCapacity) refuse(SOFTBODY_REFUSAL.FULL, 'particle capacity ' + particleCapacity + ' is used up')
      const i = particles++
      px[i] = x; py[i] = y; pz[i] = z
      qx[i] = x; qy[i] = y; qz[i] = z
      vx[i] = 0; vy[i] = 0; vz[i] = 0
      massOf[i] = mass
      invMass[i] = mass > 0 ? 1 / mass : 0
      return i
    },
    addConstraint(i, j, softness = 0, restLength = null) {
      checkIndex(i)
      checkIndex(j)
      if (i === j) refuse(SOFTBODY_REFUSAL.DEGENERATE, 'a constraint needs two different particles, got ' + i + ' twice')
      atLeastZero(softness, 'compliance', SOFTBODY_REFUSAL.VALUE)
      const length = restLength === null ? Math.hypot(px[i] - px[j], py[i] - py[j], pz[i] - pz[j]) : restLength
      if (!Number.isFinite(length) || length <= 0) refuse(SOFTBODY_REFUSAL.DEGENERATE, 'a constraint needs a rest length above 0, got ' + String(length))
      if (constraints === constraintCapacity) refuse(SOFTBODY_REFUSAL.FULL, 'constraint capacity ' + constraintCapacity + ' is used up')
      const c = constraints++
      ca[c] = i; cb[c] = j
      rest[c] = length
      compliance[c] = softness
      return c
    },
    pin(i) {
      checkIndex(i)
      invMass[i] = 0
      vx[i] = 0; vy[i] = 0; vz[i] = 0
    },
    unpin(i) {
      checkIndex(i)
      invMass[i] = massOf[i] > 0 ? 1 / massOf[i] : 0
    },
    isPinned(i) {
      checkIndex(i)
      return invMass[i] === 0
    },
    movePinned(i, x, y, z) {
      checkIndex(i)
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) refuse(SOFTBODY_REFUSAL.VALUE, 'a position needs three finite numbers')
      if (invMass[i] !== 0) refuse(SOFTBODY_REFUSAL.VALUE, 'particle ' + i + ' is not pinned, so the solver would move it straight back')
      px[i] = x; py[i] = y; pz[i] = z
    },
    applyImpulse(i, ix, iy, iz) {
      checkIndex(i)
      if (!Number.isFinite(ix) || !Number.isFinite(iy) || !Number.isFinite(iz)) refuse(SOFTBODY_REFUSAL.VALUE, 'an impulse needs three finite numbers')
      vx[i] += ix * invMass[i]; vy[i] += iy * invMass[i]; vz[i] += iz * invMass[i]
    },
    step() {
      for (let s = 0; s < substeps; s++) substep()
      ticks++
    },
    position(i, out = [0, 0, 0]) {
      checkIndex(i)
      out[0] = px[i]; out[1] = py[i]; out[2] = pz[i]
      return out
    },
    velocity(i, out = [0, 0, 0]) {
      checkIndex(i)
      out[0] = vx[i]; out[1] = vy[i]; out[2] = vz[i]
      return out
    },
    isTouching(i) {
      checkIndex(i)
      return touching[i] === 1
    },
    centroid(out = [0, 0, 0]) {
      let total = 0
      out[0] = 0; out[1] = 0; out[2] = 0
      for (let i = 0; i < particles; i++) {
        const m = massOf[i] > 0 ? massOf[i] : 1
        out[0] += px[i] * m; out[1] += py[i] * m; out[2] += pz[i] * m
        total += m
      }
      if (total > 0) { out[0] /= total; out[1] /= total; out[2] /= total }
      return out
    },
    extent(out = [0, 0, 0]) {
      let loX = Infinity, loY = Infinity, loZ = Infinity, hiX = -Infinity, hiY = -Infinity, hiZ = -Infinity
      for (let i = 0; i < particles; i++) {
        if (px[i] < loX) loX = px[i]
        if (px[i] > hiX) hiX = px[i]
        if (py[i] < loY) loY = py[i]
        if (py[i] > hiY) hiY = py[i]
        if (pz[i] < loZ) loZ = pz[i]
        if (pz[i] > hiZ) hiZ = pz[i]
      }
      out[0] = particles ? hiX - loX : 0; out[1] = particles ? hiY - loY : 0; out[2] = particles ? hiZ - loZ : 0
      return out
    },
    maxStrain() {
      let worst = 0
      for (let c = 0; c < constraints; c++) {
        const i = ca[c], j = cb[c]
        const strain = Math.abs(Math.hypot(px[i] - px[j], py[i] - py[j], pz[i] - pz[j]) - rest[c]) / rest[c]
        if (strain > worst) worst = strain
      }
      return worst
    },
    kineticEnergy() {
      let e = 0
      for (let i = 0; i < particles; i++) e += massOf[i] * (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i])
      return 0.5 * e
    },
    hash() {
      let hsh = 0x811c9dc5
      const words = particles * 2
      for (let i = 0; i < words; i++) hsh = Math.imul(hsh ^ hashX[i], 0x01000193)
      for (let i = 0; i < words; i++) hsh = Math.imul(hsh ^ hashY[i], 0x01000193)
      for (let i = 0; i < words; i++) hsh = Math.imul(hsh ^ hashZ[i], 0x01000193)
      return hsh >>> 0
    },
  }
  return body
}

export function addSoftbodyBox(body, { min, max, cells = [2, 2, 2], mass = 1, compliance = 0 }) {
  if (!isVec3(min) || !isVec3(max)) refuse(SOFTBODY_REFUSAL.VALUE, 'a box needs finite min and max triples')
  if (!Array.isArray(cells) || cells.length !== 3 || !cells.every((n) => Number.isInteger(n) && n >= 1)) refuse(SOFTBODY_REFUSAL.VALUE, 'cells must be three integers of at least 1')
  const [nx, ny, nz] = cells
  const points = (nx + 1) * (ny + 1) * (nz + 1)
  const each = mass / points
  const first = body.particleCount
  const firstConstraint = body.constraintCount
  const at = (i, j, k) => first + (k * (ny + 1) + j) * (nx + 1) + i
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        body.addParticle(min[0] + (max[0] - min[0]) * i / nx, min[1] + (max[1] - min[1]) * j / ny, min[2] + (max[2] - min[2]) * k / nz, each)
      }
    }
  }
  const link = (a, b) => body.addConstraint(a, b, compliance)
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        if (i < nx) link(at(i, j, k), at(i + 1, j, k))
        if (j < ny) link(at(i, j, k), at(i, j + 1, k))
        if (k < nz) link(at(i, j, k), at(i, j, k + 1))
        if (i < nx && j < ny) { link(at(i, j, k), at(i + 1, j + 1, k)); link(at(i + 1, j, k), at(i, j + 1, k)) }
        if (i < nx && k < nz) { link(at(i, j, k), at(i + 1, j, k + 1)); link(at(i + 1, j, k), at(i, j, k + 1)) }
        if (j < ny && k < nz) { link(at(i, j, k), at(i, j + 1, k + 1)); link(at(i, j + 1, k), at(i, j, k + 1)) }
        if (i < nx && j < ny && k < nz) {
          link(at(i, j, k), at(i + 1, j + 1, k + 1))
          link(at(i + 1, j, k), at(i, j + 1, k + 1))
          link(at(i, j + 1, k), at(i + 1, j, k + 1))
          link(at(i, j, k + 1), at(i + 1, j + 1, k))
        }
      }
    }
  }
  return { first, count: points, firstConstraint, constraintCount: body.constraintCount - firstConstraint, at }
}

export function addSoftbodyRope(body, { from, to, segments = 8, mass = 1, compliance = 0, pinFirst = true }) {
  if (!isVec3(from) || !isVec3(to)) refuse(SOFTBODY_REFUSAL.VALUE, 'a rope needs finite from and to triples')
  if (!Number.isInteger(segments) || segments < 1) refuse(SOFTBODY_REFUSAL.VALUE, 'segments must be an integer of at least 1')
  const first = body.particleCount
  const each = mass / (segments + 1)
  for (let s = 0; s <= segments; s++) {
    const t = s / segments
    body.addParticle(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t, each)
  }
  for (let s = 0; s < segments; s++) body.addConstraint(first + s, first + s + 1, compliance)
  if (pinFirst) body.pin(first)
  return { first, count: segments + 1, last: first + segments }
}

export default createSoftbody
