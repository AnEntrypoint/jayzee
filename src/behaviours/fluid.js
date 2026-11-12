export const FLUID_DEFAULTS = Object.freeze({
  capacity: 1024,
  smoothingRadius: 0.1,
  restDensity: 1000,
  stiffness: 200,
  viscosity: 3.5,
  particleSpacing: 0.05,
  gravity: Object.freeze([0, -9.81, 0]),
  restitution: 0.2,
  wallFriction: 0.02,
  stepSeconds: 1 / 120,
  courant: 0.3,
  maxSubsteps: 16,
})

export const FLUID_REFUSAL = Object.freeze({
  OPTION: 'fluid-option',
  BOUNDS: 'fluid-bounds',
  FULL: 'fluid-full',
  POSITION: 'fluid-position',
  INDEX: 'fluid-index',
})

export class FluidError extends Error {
  constructor(code, message) {
    super(code + ': ' + message)
    this.name = 'FluidError'
    this.code = code
  }
}

const refuse = (code, message) => {
  throw new FluidError(code, message)
}

const isVec3 = (v) => Array.isArray(v) && v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])

const positive = (value, name) => {
  if (!Number.isFinite(value) || value <= 0) refuse(FLUID_REFUSAL.OPTION, name + ' must be a finite number greater than 0, got ' + String(value))
  return value
}

const atLeastZero = (value, name) => {
  if (!Number.isFinite(value) || value < 0) refuse(FLUID_REFUSAL.OPTION, name + ' must be a finite number of at least 0, got ' + String(value))
  return value
}

export function createFluid(options = {}) {
  const o = { ...FLUID_DEFAULTS, ...options }
  if (!Number.isInteger(o.capacity) || o.capacity < 1) refuse(FLUID_REFUSAL.OPTION, 'capacity must be an integer of at least 1, got ' + String(o.capacity))
  const capacity = o.capacity
  const h = positive(o.smoothingRadius, 'smoothingRadius')
  const restDensity = positive(o.restDensity, 'restDensity')
  const stiffness = atLeastZero(o.stiffness, 'stiffness')
  const viscosity = atLeastZero(o.viscosity, 'viscosity')
  const spacing = positive(o.particleSpacing, 'particleSpacing')
  const restitution = atLeastZero(o.restitution, 'restitution')
  const wallFriction = atLeastZero(o.wallFriction, 'wallFriction')
  const stepSeconds = positive(o.stepSeconds, 'stepSeconds')
  const courant = positive(o.courant, 'courant')
  if (!Number.isInteger(o.maxSubsteps) || o.maxSubsteps < 1) refuse(FLUID_REFUSAL.OPTION, 'maxSubsteps must be an integer of at least 1')
  if (!isVec3(o.gravity)) refuse(FLUID_REFUSAL.OPTION, 'gravity must be a finite [x, y, z] triple')
  if (!o.bounds || !isVec3(o.bounds.min) || !isVec3(o.bounds.max)) refuse(FLUID_REFUSAL.BOUNDS, 'bounds needs finite min and max triples: the neighbour grid is sized from them once')
  const collider = o.collider ?? null
  if (collider !== null && typeof collider !== 'function') refuse(FLUID_REFUSAL.OPTION, 'collider must be a function (x, y, z, normalOut) returning a signed distance')

  const minX = o.bounds.min[0], minY = o.bounds.min[1], minZ = o.bounds.min[2]
  const maxX = o.bounds.max[0], maxY = o.bounds.max[1], maxZ = o.bounds.max[2]
  if (!(maxX > minX && maxY > minY && maxZ > minZ)) refuse(FLUID_REFUSAL.BOUNDS, 'bounds max must be above min on every axis')
  const gx = o.gravity[0], gy = o.gravity[1], gz = o.gravity[2]

  const nx = Math.max(1, Math.ceil((maxX - minX) / h))
  const ny = Math.max(1, Math.ceil((maxY - minY) / h))
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / h))
  const cellCount = nx * ny * nz
  if (cellCount > 1 << 24) refuse(FLUID_REFUSAL.BOUNDS, 'bounds over smoothingRadius gives ' + cellCount + ' grid cells, above the 16777216 limit')

  const h2 = h * h
  const kernel = 15 / (Math.PI * Math.pow(h, 6))
  const reach = Math.ceil(h / spacing)
  let latticeKernelSum = 0
  for (let k = -reach; k <= reach; k++) {
    for (let j = -reach; j <= reach; j++) {
      for (let i = -reach; i <= reach; i++) {
        const r2 = (i * i + j * j + k * k) * spacing * spacing
        if (r2 < h2) latticeKernelSum += kernel * Math.pow(h - Math.sqrt(r2), 3)
      }
    }
  }
  const mass = restDensity / latticeKernelSum
  const kernelGrad = -3 * kernel
  const viscLap = 45 / (Math.PI * Math.pow(h, 6))
  const coincident = h * 1e-3
  const coincident2 = coincident * coincident
  const selfDensity = mass * kernel * h * h2
  const soundSpeed = Math.sqrt(Math.max(stiffness, 1e-9))
  const stableDt = courant * h / (soundSpeed + Math.sqrt(2 * Math.hypot(gx, gy, gz) * (maxY - minY)))
  const substeps = Math.min(o.maxSubsteps, Math.max(1, Math.ceil(stepSeconds / stableDt)))
  const dt = stepSeconds / substeps

  const px = new Float64Array(capacity), py = new Float64Array(capacity), pz = new Float64Array(capacity)
  const vx = new Float64Array(capacity), vy = new Float64Array(capacity), vz = new Float64Array(capacity)
  const ax = new Float64Array(capacity), ay = new Float64Array(capacity), az = new Float64Array(capacity)
  const density = new Float64Array(capacity)
  const pressure = new Float64Array(capacity)
  const cellOf = new Int32Array(capacity)
  const cellStart = new Int32Array(cellCount + 1)
  const cellFill = new Int32Array(cellCount)
  const sorted = new Int32Array(capacity)
  const normal = [0, 0, 0]
  const hashView = new Uint32Array(px.buffer)
  const hashViewY = new Uint32Array(py.buffer)
  const hashViewZ = new Uint32Array(pz.buffer)
  let count = 0
  let ticks = 0
  let refusedSpawns = 0

  const clampCell = (value, n) => (value < 0 ? 0 : value >= n ? n - 1 : value)

  const wallShare = (d) => {
    if (d >= h) return 0
    const u = h - (d < 0 ? 0 : d)
    const u2 = u * u
    return 2 * Math.PI * kernel * u2 * u2 * u * (h / 20 - u / 30)
  }
  const wallPush = (d) => {
    if (d >= h) return 0
    const u = h - (d < 0 ? 0 : d)
    const u2 = u * u
    return 2 * Math.PI * kernel * u2 * u2 * (h / 4 - u / 5)
  }

  function buildGrid() {
    cellStart.fill(0)
    for (let i = 0; i < count; i++) {
      const cx = clampCell(Math.floor((px[i] - minX) / h), nx)
      const cy = clampCell(Math.floor((py[i] - minY) / h), ny)
      const cz = clampCell(Math.floor((pz[i] - minZ) / h), nz)
      const cell = (cz * ny + cy) * nx + cx
      cellOf[i] = cell
      cellStart[cell + 1]++
    }
    for (let c = 0; c < cellCount; c++) cellStart[c + 1] += cellStart[c]
    cellFill.fill(0)
    for (let i = 0; i < count; i++) {
      const cell = cellOf[i]
      sorted[cellStart[cell] + cellFill[cell]] = i
      cellFill[cell]++
    }
  }

  function computeDensity() {
    for (let i = 0; i < count; i++) {
      const cell = cellOf[i]
      const cx = cell % nx
      const cy = ((cell - cx) / nx) % ny
      const cz = (cell - cx - cy * nx) / (nx * ny)
      let sum = 0
      for (let dz = -1; dz <= 1; dz++) {
        const z = cz + dz
        if (z < 0 || z >= nz) continue
        for (let dy = -1; dy <= 1; dy++) {
          const y = cy + dy
          if (y < 0 || y >= ny) continue
          for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx
            if (x < 0 || x >= nx) continue
            const other = (z * ny + y) * nx + x
            for (let k = cellStart[other]; k < cellStart[other + 1]; k++) {
              const j = sorted[k]
              const rx = px[i] - px[j], ry = py[i] - py[j], rz = pz[i] - pz[j]
              const r2 = rx * rx + ry * ry + rz * rz
              if (r2 >= h2) continue
              const d = h - Math.sqrt(r2)
              sum += d * d * d
            }
          }
        }
      }
      const walls = wallShare(px[i] - minX) + wallShare(maxX - px[i]) + wallShare(py[i] - minY) + wallShare(maxY - py[i]) + wallShare(pz[i] - minZ) + wallShare(maxZ - pz[i])
      density[i] = mass * kernel * sum + restDensity * walls
      const excess = density[i] - restDensity
      pressure[i] = excess > 0 ? stiffness * excess : 0
    }
  }

  function computeAcceleration() {
    for (let i = 0; i < count; i++) {
      const cell = cellOf[i]
      const cx = cell % nx
      const cy = ((cell - cx) / nx) % ny
      const cz = (cell - cx - cy * nx) / (nx * ny)
      let fx = 0, fy = 0, fz = 0
      for (let dz = -1; dz <= 1; dz++) {
        const z = cz + dz
        if (z < 0 || z >= nz) continue
        for (let dy = -1; dy <= 1; dy++) {
          const y = cy + dy
          if (y < 0 || y >= ny) continue
          for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx
            if (x < 0 || x >= nx) continue
            const other = (z * ny + y) * nx + x
            for (let k = cellStart[other]; k < cellStart[other + 1]; k++) {
              const j = sorted[k]
              if (j === i) continue
              const rx = px[i] - px[j], ry = py[i] - py[j], rz = pz[i] - pz[j]
              let ry2 = ry
              let r2 = rx * rx + ry * ry + rz * rz
              if (r2 >= h2) continue
              if (r2 < coincident2) {
                ry2 = i < j ? -coincident : coincident
                r2 = rx * rx + ry2 * ry2 + rz * rz
              }
              const r = Math.sqrt(r2)
              const gap = h - r
              const push = -mass * (pressure[i] / (density[i] * density[i]) + pressure[j] / (density[j] * density[j])) * kernelGrad * gap * gap / r
              const drag = viscosity * mass * viscLap * gap / (density[i] * density[j])
              fx += push * rx + drag * (vx[j] - vx[i])
              fy += push * ry2 + drag * (vy[j] - vy[i])
              fz += push * rz + drag * (vz[j] - vz[i])
            }
          }
        }
      }
      const wallScale = restDensity * pressure[i] / (density[i] * density[i])
      ax[i] = gx + fx + wallScale * (wallPush(px[i] - minX) - wallPush(maxX - px[i]))
      ay[i] = gy + fy + wallScale * (wallPush(py[i] - minY) - wallPush(maxY - py[i]))
      az[i] = gz + fz + wallScale * (wallPush(pz[i] - minZ) - wallPush(maxZ - pz[i]))
    }
  }

  function integrate() {
    const keep = 1 - wallFriction
    for (let i = 0; i < count; i++) {
      vx[i] += ax[i] * dt
      vy[i] += ay[i] * dt
      vz[i] += az[i] * dt
      px[i] += vx[i] * dt
      py[i] += vy[i] * dt
      pz[i] += vz[i] * dt
      if (px[i] < minX) { px[i] = minX; if (vx[i] < 0) vx[i] = -vx[i] * restitution; vy[i] *= keep; vz[i] *= keep }
      else if (px[i] > maxX) { px[i] = maxX; if (vx[i] > 0) vx[i] = -vx[i] * restitution; vy[i] *= keep; vz[i] *= keep }
      if (py[i] < minY) { py[i] = minY; if (vy[i] < 0) vy[i] = -vy[i] * restitution; vx[i] *= keep; vz[i] *= keep }
      else if (py[i] > maxY) { py[i] = maxY; if (vy[i] > 0) vy[i] = -vy[i] * restitution; vx[i] *= keep; vz[i] *= keep }
      if (pz[i] < minZ) { pz[i] = minZ; if (vz[i] < 0) vz[i] = -vz[i] * restitution; vx[i] *= keep; vy[i] *= keep }
      else if (pz[i] > maxZ) { pz[i] = maxZ; if (vz[i] > 0) vz[i] = -vz[i] * restitution; vx[i] *= keep; vy[i] *= keep }
      if (collider !== null) {
        const distance = collider(px[i], py[i], pz[i], normal)
        if (distance < 0) {
          px[i] -= normal[0] * distance
          py[i] -= normal[1] * distance
          pz[i] -= normal[2] * distance
          const into = vx[i] * normal[0] + vy[i] * normal[1] + vz[i] * normal[2]
          if (into < 0) {
            const bounce = (1 + restitution) * into
            vx[i] -= bounce * normal[0]
            vy[i] -= bounce * normal[1]
            vz[i] -= bounce * normal[2]
          }
        }
      }
    }
  }

  function checkIndex(i) {
    if (!Number.isInteger(i) || i < 0 || i >= count) refuse(FLUID_REFUSAL.INDEX, 'no particle ' + String(i) + ' (count ' + count + ')')
  }

  const fluid = {
    capacity,
    mass,
    substeps,
    substepSeconds: dt,
    smoothingRadius: h,
    restDensity,
    get count() { return count },
    get ticks() { return ticks },
    get refusedSpawns() { return refusedSpawns },
    spawn(x, y, z, velX = 0, velY = 0, velZ = 0) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(velX) || !Number.isFinite(velY) || !Number.isFinite(velZ)) {
        refuse(FLUID_REFUSAL.POSITION, 'a particle needs finite position and velocity numbers')
      }
      if (count === capacity) {
        refusedSpawns++
        return -1
      }
      const i = count
      px[i] = Math.min(maxX, Math.max(minX, x)); py[i] = Math.min(maxY, Math.max(minY, y)); pz[i] = Math.min(maxZ, Math.max(minZ, z))
      vx[i] = velX; vy[i] = velY; vz[i] = velZ
      density[i] = restDensity
      pressure[i] = 0
      count++
      return i
    },
    spawnBlock(min, max, step = spacing) {
      if (!isVec3(min) || !isVec3(max)) refuse(FLUID_REFUSAL.POSITION, 'spawnBlock needs finite min and max triples')
      positive(step, 'spawnBlock step')
      let added = 0
      for (let z = min[2]; z <= max[2] + 1e-9; z += step) {
        for (let y = min[1]; y <= max[1] + 1e-9; y += step) {
          for (let x = min[0]; x <= max[0] + 1e-9; x += step) {
            if (fluid.spawn(x, y, z) !== -1) added++
          }
        }
      }
      return added
    },
    clear() {
      count = 0
    },
    step() {
      for (let s = 0; s < substeps; s++) {
        buildGrid()
        computeDensity()
        computeAcceleration()
        integrate()
      }
      ticks++
    },
    refreshDensity() {
      buildGrid()
      computeDensity()
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
    setVelocity(i, x, y, z) {
      checkIndex(i)
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) refuse(FLUID_REFUSAL.POSITION, 'a velocity needs three finite numbers')
      vx[i] = x; vy[i] = y; vz[i] = z
    },
    densityOf(i) {
      checkIndex(i)
      return density[i]
    },
    pressureOf(i) {
      checkIndex(i)
      return pressure[i]
    },
    bruteDensityOf(i) {
      checkIndex(i)
      let sum = 0
      for (let j = 0; j < count; j++) {
        const rx = px[i] - px[j], ry = py[i] - py[j], rz = pz[i] - pz[j]
        const r2 = rx * rx + ry * ry + rz * rz
        if (r2 >= h2) continue
        const d = h - Math.sqrt(r2)
        sum += d * d * d
      }
      const walls = wallShare(px[i] - minX) + wallShare(maxX - px[i]) + wallShare(py[i] - minY) + wallShare(maxY - py[i]) + wallShare(pz[i] - minZ) + wallShare(maxZ - pz[i])
      return mass * kernel * sum + restDensity * walls
    },
    selfDensity,
    kineticEnergy() {
      let e = 0
      for (let i = 0; i < count; i++) e += vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]
      return 0.5 * mass * e
    },
    momentum(out = [0, 0, 0]) {
      out[0] = 0; out[1] = 0; out[2] = 0
      for (let i = 0; i < count; i++) { out[0] += vx[i]; out[1] += vy[i]; out[2] += vz[i] }
      out[0] *= mass; out[1] *= mass; out[2] *= mass
      return out
    },
    centreOfMass(out = [0, 0, 0]) {
      out[0] = 0; out[1] = 0; out[2] = 0
      if (count === 0) return out
      for (let i = 0; i < count; i++) { out[0] += px[i]; out[1] += py[i]; out[2] += pz[i] }
      out[0] /= count; out[1] /= count; out[2] /= count
      return out
    },
    hash() {
      let hsh = 0x811c9dc5
      const words = count * 2
      for (let i = 0; i < words; i++) hsh = Math.imul(hsh ^ hashView[i], 0x01000193)
      for (let i = 0; i < words; i++) hsh = Math.imul(hsh ^ hashViewY[i], 0x01000193)
      for (let i = 0; i < words; i++) hsh = Math.imul(hsh ^ hashViewZ[i], 0x01000193)
      return hsh >>> 0
    },
    views() {
      return { px, py, pz, vx, vy, vz, density, pressure }
    },
  }
  return fluid
}

export default createFluid
