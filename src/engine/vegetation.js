import { mulberry32, capAreaKm2 } from './population.js'
import { PLANET_RADIUS_M } from './sphere.js'
import { TRANSFORM_STRIDE_FLOATS, copyAccounting } from './sharedData.js'
import { densityFor } from './populationDensity.js'

export const VEG_SPECIES = Object.freeze(['trees'])
export const defaultAllocate = (kind, length) => {
  if (kind === 'f32') return new Float32Array(length)
  if (kind === 'f64') return new Float64Array(length)
  if (kind === 'u32') return new Uint32Array(length)
  if (kind === 'u8') return new Uint8Array(length)
  throw new RangeError('unknown allocation kind: ' + kind)
}
export const VEG_GEN_INSTANCES_PER_FRAME = 4096
export const MATRIX_BYTES = TRANSFORM_STRIDE_FLOATS * 4

const isCount = (v, name, min) => {
  if (!Number.isInteger(v) || v < min) throw new RangeError(name + ' must be a whole number at least ' + min)
}

export const patchSeed = (worldSeed, patchId, species = 0) => {
  if (!Number.isInteger(patchId)) throw new TypeError('patchId must be an integer')
  let h = ((worldSeed | 0) ^ 0x7eed) >>> 0
  h = Math.imul(h ^ patchId, 0x9e3779b1) >>> 0
  h = Math.imul(h ^ species, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  return h >>> 0
}

export const planVegetationPool = ({ maxBufferBytes, residentPatches, capacityPerPatch }) => {
  if (!(maxBufferBytes > 0) || !Number.isFinite(maxBufferBytes)) throw new RangeError('maxBufferBytes must be a positive finite number, read from the device once')
  isCount(residentPatches, 'residentPatches', 1)
  isCount(capacityPerPatch, 'capacityPerPatch', 1)
  const slotBytes = capacityPerPatch * MATRIX_BYTES
  const byDevice = Math.floor(maxBufferBytes / slotBytes)
  const slots = Math.min(residentPatches, byDevice)
  if (slots < 1) throw new RangeError('the device buffer limit holds no patch at this capacity')
  return { slots, capacityPerPatch, slotBytes, bytesPerSpecies: slots * slotBytes, bound: slots === residentPatches ? 'patches' : 'device' }
}

export const createVegetationPool = ({
  plan,
  species = VEG_SPECIES,
  worldSeed,
  heightAt,
  patchCentre,
  densityOf = (s) => densityFor('trees'),
  generatePerFrame = VEG_GEN_INSTANCES_PER_FRAME,
  now,
  radiusM = PLANET_RADIUS_M,
  cullRadiusM,
  allocate = defaultAllocate,
}) => {
  if (!(cullRadiusM >= 0) || !Number.isFinite(cullRadiusM)) throw new TypeError('createVegetationPool needs cullRadiusM, the bounding radius of one patch in metres')
  if (!plan || !Number.isInteger(plan.slots)) throw new TypeError('createVegetationPool needs a plan from planVegetationPool')
  if (typeof heightAt !== 'function') throw new TypeError('createVegetationPool needs heightAt(n), the patch height store')
  if (typeof patchCentre !== 'function') throw new TypeError('createVegetationPool needs patchCentre(patchId) returning { latRad, lonRad, capRad }')
  if (typeof now !== 'function') throw new TypeError('createVegetationPool needs now(), the injected clock')
  if (!Number.isInteger(worldSeed)) throw new TypeError('worldSeed must be an integer')
  isCount(generatePerFrame, 'generatePerFrame', 1)
  if (generatePerFrame < plan.capacityPerPatch) throw new RangeError('generatePerFrame must be at least one patch capacity, or a full patch never generates')
  const slots = plan.slots
  const capacity = plan.capacityPerPatch
  const block = allocate('f32', species.length * slots * capacity * TRANSFORM_STRIDE_FLOATS)
  const perPatch = capacity * TRANSFORM_STRIDE_FLOATS
  const buffers = species.map((_, s) => Array.from({ length: slots }, (__, slot) => block.subarray((s * slots + slot) * perPatch, (s * slots + slot + 1) * perPatch)))
  const countsBlock = allocate('u32', species.length * slots)
  const counts = species.map((_, s) => countsBlock.subarray(s * slots, (s + 1) * slots))
  const dirty = allocate('u8', slots)
  const owner = new Int32Array(slots).fill(-1)
  const stamp = new Uint32Array(slots)
  const freeStack = new Int32Array(slots)
  for (let s = 0; s < slots; s++) freeStack[s] = slots - 1 - s
  let freeTop = slots
  const slotOf = new Map()
  const pending = []
  let epoch = 0
  let deferred = 0
  let generated = 0
  let generatedInstances = 0
  let generateMs = 0
  const nrm = new Float64Array(3)
  const origins = allocate('f64', slots * 3)

  const expectedCount = (s, cap) => Math.round(densityOf(s) * capAreaKm2(cap.capRad, radiusM))

  const generate = (slot, patchId) => {
    const c = patchCentre(patchId)
    const cosCap = Math.cos(c.capRad)
    const cl = Math.cos(c.latRad), sl = Math.sin(c.latRad)
    const centre = [cl * Math.sin(c.lonRad), sl, cl * Math.cos(c.lonRad)]
    origins[slot * 3] = radiusM * centre[0]
    origins[slot * 3 + 1] = radiusM * centre[1]
    origins[slot * 3 + 2] = radiusM * centre[2]
    const ref = Math.abs(centre[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    const a0 = [ref[1] * centre[2] - ref[2] * centre[1], ref[2] * centre[0] - ref[0] * centre[2], ref[0] * centre[1] - ref[1] * centre[0]]
    const al = Math.hypot(a0[0], a0[1], a0[2])
    const a = [a0[0] / al, a0[1] / al, a0[2] / al]
    const b = [centre[1] * a[2] - centre[2] * a[1], centre[2] * a[0] - centre[0] * a[2], centre[0] * a[1] - centre[1] * a[0]]
    for (let s = 0; s < species.length; s++) {
      const count = expectedCount(species[s], c)
      if (count > capacity) throw new RangeError('patch ' + patchId + ' needs ' + count + ' instances, above the capacity ' + capacity)
      const random = mulberry32(patchSeed(worldSeed, patchId, s))
      const buf = buffers[s][slot]
      const base = 0
      for (let i = 0; i < count; i++) {
        const cosTheta = 1 - random() * (1 - cosCap)
        const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta))
        const phi = random() * 2 * Math.PI
        const cp = Math.cos(phi), sp = Math.sin(phi)
        let x = cosTheta * centre[0] + sinTheta * (cp * a[0] + sp * b[0])
        let y = cosTheta * centre[1] + sinTheta * (cp * a[1] + sp * b[1])
        let z = cosTheta * centre[2] + sinTheta * (cp * a[2] + sp * b[2])
        const len = Math.hypot(x, y, z)
        x /= len; y /= len; z /= len
        nrm[0] = x; nrm[1] = y; nrm[2] = z
        const h = heightAt(nrm)
        const r = radiusM + h
        const yaw = random() * 2 * Math.PI
        const refN = Math.abs(y) < 0.9 ? [0, 1, 0] : [1, 0, 0]
        let ex = refN[1] * z - refN[2] * y, ey = refN[2] * x - refN[0] * z, ez = refN[0] * y - refN[1] * x
        const el = Math.hypot(ex, ey, ez)
        ex /= el; ey /= el; ez /= el
        const nx = y * ez - z * ey, ny = z * ex - x * ez, nz = x * ey - y * ex
        const cw = Math.cos(yaw), sw = Math.sin(yaw)
        const fx = cw * ex + sw * nx, fy = cw * ey + sw * ny, fz = cw * ez + sw * nz
        const sx = y * fz - z * fy, sy = z * fx - x * fz, sz = x * fy - y * fx
        const o = base + i * TRANSFORM_STRIDE_FLOATS
        buf[o] = sx; buf[o + 1] = sy; buf[o + 2] = sz; buf[o + 3] = 0
        buf[o + 4] = x; buf[o + 5] = y; buf[o + 6] = z; buf[o + 7] = 0
        buf[o + 8] = fx; buf[o + 9] = fy; buf[o + 10] = fz; buf[o + 11] = 0
        buf[o + 12] = r * x - radiusM * centre[0]
        buf[o + 13] = r * y - radiusM * centre[1]
        buf[o + 14] = r * z - radiusM * centre[2]
        buf[o + 15] = 1
      }
      counts[s][slot] = count
    }
    dirty[slot] = 1
    generated += 1
    generatedInstances += counts.reduce((acc, arr) => acc + arr[slot], 0)
  }

  const sync = (patchIds) => {
    epoch += 1
    for (const id of patchIds) {
      if (!Number.isInteger(id)) throw new TypeError('patch ids must be integers')
      const existing = slotOf.get(id)
      if (existing !== undefined) { stamp[existing] = epoch; continue }
      if (freeTop === 0) { deferred += 1; continue }
      freeTop -= 1
      const slot = freeStack[freeTop]
      slotOf.set(id, slot)
      owner[slot] = id
      stamp[slot] = epoch
      pending.push(slot)
    }
    for (let slot = 0; slot < slots; slot++) {
      if (owner[slot] === -1 || stamp[slot] === epoch) continue
      slotOf.delete(owner[slot])
      owner[slot] = -1
      for (const arr of counts) arr[slot] = 0
      freeStack[freeTop] = slot
      freeTop += 1
      const queued = pending.indexOf(slot)
      if (queued !== -1) pending.splice(queued, 1)
    }
  }

  const step = (budget = generatePerFrame) => {
    if (!(budget >= capacity)) throw new RangeError('budget must be at least one patch capacity')
    let spent = 0
    let done = 0
    const t0 = now()
    while (pending.length > 0) {
      const slot = pending[0]
      if (spent > 0 && spent + capacity > budget) break
      pending.shift()
      generate(slot, owner[slot])
      spent += capacity
      done += 1
    }
    generateMs += now() - t0
    return { patches: done, budgetInstances: spent }
  }

  const drawRanges = (speciesIndex, out) => {
    if (!(speciesIndex >= 0 && speciesIndex < species.length)) throw new RangeError('species index out of range')
    let n = 0
    const cnt = counts[speciesIndex]
    for (let slot = 0; slot < slots; slot++) {
      if (cnt[slot] === 0) continue
      out[n * 2] = slot
      out[n * 2 + 1] = cnt[slot]
      n += 1
    }
    return n
  }

  const readWorld = (speciesIndex, slot, i, out) => {
    const o = i * TRANSFORM_STRIDE_FLOATS + 12
    const buf = buffers[speciesIndex][slot]
    out[0] = origins[slot * 3] + buf[o]
    out[1] = origins[slot * 3 + 1] + buf[o + 1]
    out[2] = origins[slot * 3 + 2] + buf[o + 2]
    return out
  }

  return {
    sync,
    step,
    drawRanges,
    readWorld,
    origin: (slot) => [origins[slot * 3], origins[slot * 3 + 1], origins[slot * 3 + 2]],
    memory: () => ({ block, counts: countsBlock, dirty, origins, species: species.length, slots, capacity, radius: cullRadiusM }),
    buffers: () => buffers,
    counts: () => counts,
    slotOf: (id) => slotOf.get(id),
    bytes: () => buffers.reduce((acc, arr) => acc + arr.reduce((x, b) => x + b.byteLength, 0), 0),
    stats: () => ({ resident: slotOf.size, pending: pending.length, deferred, generated, generatedInstances, generateMs }),
    sharing: (patchBytes) => copyAccounting({ patches: slotOf.size, patchBytes, instances: counts.reduce((acc, arr) => acc + arr.reduce((x, y) => x + y, 0), 0) }),
  }
}
