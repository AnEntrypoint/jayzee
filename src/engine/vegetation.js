import { capAreaKm2 } from './population.js'
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
const UINT32_SPAN = 4294967296
const NO_SLOT = -1
const FREE = -1
const DRAWS_PER_INSTANCE = 3
const POLE_REFERENCE_LIMIT = 0.9
const HIDDEN_DETAIL = 31
export const VEG_HIDDEN_INSTANCES = 64
const BASIS_FLOATS = 12
const HIDDEN_FREE = -1

const isCount = (v, name, min) => {
  if (!Number.isInteger(v) || v < min) throw new RangeError(name + ' must be a whole number at least ' + min)
}

const highWord = (id) => Math.trunc(id / UINT32_SPAN) | 0

const seedBits = (worldSeed, low, high, species) => {
  let h = ((worldSeed | 0) ^ 0x7eed) >>> 0
  h = Math.imul(h ^ low, 0x9e3779b1) >>> 0
  if (high !== 0) h = Math.imul(h ^ high, 0xc2b2ae35) >>> 0
  h = Math.imul(h ^ species, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  return h | 0
}

export const patchSeed = (worldSeed, patchId, species = 0) => {
  if (!Number.isSafeInteger(patchId)) throw new TypeError('patchId must be a safe integer')
  return seedBits(worldSeed, patchId | 0, highWord(patchId), species) >>> 0
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
  heightInto,
  patchCentre,
  densityOf = (s) => densityFor('trees'),
  generatePerFrame = VEG_GEN_INSTANCES_PER_FRAME,
  now,
  radiusM = PLANET_RADIUS_M,
  cullRadiusM,
  allocate = defaultAllocate,
  hiddenCapacity = VEG_HIDDEN_INSTANCES,
}) => {
  if (!(cullRadiusM >= 0) || !Number.isFinite(cullRadiusM)) throw new TypeError('createVegetationPool needs cullRadiusM, the bounding radius of one patch in metres')
  if (!plan || !Number.isInteger(plan.slots)) throw new TypeError('createVegetationPool needs a plan from planVegetationPool')
  if (typeof heightAt !== 'function') throw new TypeError('createVegetationPool needs heightAt(n), the patch height store')
  if (heightInto !== undefined && typeof heightInto !== 'function') throw new TypeError('heightInto must be a function (n, out) that writes the height to out[0]')
  if (typeof patchCentre !== 'function') throw new TypeError('createVegetationPool needs patchCentre(patchId, out) returning { latRad, lonRad, capRad }')
  if (typeof now !== 'function') throw new TypeError('createVegetationPool needs now(), the injected clock')
  if (!Number.isInteger(worldSeed)) throw new TypeError('worldSeed must be an integer')
  isCount(generatePerFrame, 'generatePerFrame', 1)
  isCount(hiddenCapacity, 'hiddenCapacity', 1)
  if (generatePerFrame < plan.capacityPerPatch) throw new RangeError('generatePerFrame must be at least one patch capacity, or a full patch never generates')
  const slots = plan.slots
  const capacity = plan.capacityPerPatch
  const block = allocate('f32', species.length * slots * capacity * TRANSFORM_STRIDE_FLOATS)
  const perPatch = capacity * TRANSFORM_STRIDE_FLOATS
  const buffers = species.map((_, s) => Array.from({ length: slots }, (__, slot) => block.subarray((s * slots + slot) * perPatch, (s * slots + slot + 1) * perPatch)))
  const countsBlock = allocate('u32', species.length * slots)
  const counts = species.map((_, s) => countsBlock.subarray(s * slots, (s + 1) * slots))
  const dirty = allocate('u8', slots)
  const generatedBlock = new Uint32Array(species.length * slots)
  const detail = new Uint8Array(slots)
  const ownerLow = new Int32Array(slots)
  const ownerHigh = new Int32Array(slots).fill(FREE)
  const home = new Int32Array(slots)
  const stamp = new Uint32Array(slots)
  const freeStack = new Int32Array(slots)
  for (let s = 0; s < slots; s++) freeStack[s] = slots - 1 - s
  let freeTop = slots
  let tableBits = 2
  while ((1 << tableBits) < slots * 2) tableBits += 1
  const tableMask = (1 << tableBits) - 1
  const tableShift = 32 - tableBits
  const table = new Int32Array(1 << tableBits).fill(NO_SLOT)
  const pendingQueue = new Int32Array(slots)
  let pendingHead = 0
  let pendingCount = 0
  let resident = 0
  let epoch = 0
  let deferred = 0
  let generated = 0
  let generatedInstances = 0
  const timing = new Float64Array(1)
  const nrm = new Float64Array(3)
  const draws = new Float64Array(DRAWS_PER_INSTANCE)
  const heights = new Float64Array(1)
  const heightsByArray = heightInto !== undefined
  const centreScratch = { latRad: 0, lonRad: 0, capRad: 0 }
  const stepResult = { patches: 0, budgetInstances: 0 }
  const origins = allocate('f64', slots * 3)
  const hiddenLow = new Int32Array(hiddenCapacity)
  const hiddenHigh = new Int32Array(hiddenCapacity).fill(HIDDEN_FREE)
  const hiddenSpecies = new Uint32Array(hiddenCapacity)
  const hiddenIndex = new Uint32Array(hiddenCapacity)
  const hiddenBasis = new Float32Array(hiddenCapacity * BASIS_FLOATS)
  let hiddenCount = 0
  let hiddenRefused = 0

  const ownerOf = (slot) => ownerHigh[slot] * UINT32_SPAN + (ownerLow[slot] >>> 0)

  const bucketOf = (low, high) => Math.imul(low ^ Math.imul(high, 0x85ebca6b), 0x9e3779b1) >>> tableShift

  const findSlot = (low, high) => {
    let at = bucketOf(low, high)
    while (table[at] !== NO_SLOT) {
      const slot = table[at]
      if (ownerLow[slot] === low && ownerHigh[slot] === high) return slot
      at = (at + 1) & tableMask
    }
    return NO_SLOT
  }

  const insertSlot = (slot) => {
    let at = home[slot]
    while (table[at] !== NO_SLOT) at = (at + 1) & tableMask
    table[at] = slot
  }

  const removeSlot = (slot) => {
    let hole = home[slot]
    while (table[hole] !== slot) hole = (hole + 1) & tableMask
    let at = hole
    for (;;) {
      at = (at + 1) & tableMask
      const moved = table[at]
      if (moved === NO_SLOT) break
      const from = home[moved]
      const stays = hole <= at ? (hole < from && from <= at) : (hole < from || from <= at)
      if (stays) continue
      table[hole] = moved
      hole = at
    }
    table[hole] = NO_SLOT
  }

  const dequeue = (slot) => {
    let found = -1
    for (let k = 0; k < pendingCount; k++) {
      if (pendingQueue[(pendingHead + k) % slots] === slot) { found = k; break }
    }
    if (found === -1) return
    for (let k = found; k < pendingCount - 1; k++) pendingQueue[(pendingHead + k) % slots] = pendingQueue[(pendingHead + k + 1) % slots]
    pendingCount -= 1
  }

  const countCapRad = new Float64Array(species.length).fill(-1)
  const countAtCapRad = new Int32Array(species.length)

  const refreshCount = (s, capRad) => {
    countAtCapRad[s] = Math.round(densityOf(species[s]) * capAreaKm2(capRad, radiusM))
    countCapRad[s] = capRad
  }

  const generate = (slot) => {
    const patchId = ownerOf(slot)
    const c = patchCentre(patchId, centreScratch)
    const capRad = c.capRad
    const cosCap = Math.cos(capRad)
    const cl = Math.cos(c.latRad), sl = Math.sin(c.latRad)
    const cx = cl * Math.sin(c.lonRad), cy = sl, cz = cl * Math.cos(c.lonRad)
    origins[slot * 3] = radiusM * cx
    origins[slot * 3 + 1] = radiusM * cy
    origins[slot * 3 + 2] = radiusM * cz
    const offPole = Math.abs(cy) < POLE_REFERENCE_LIMIT
    const r0 = offPole ? 0 : 1, r1 = offPole ? 1 : 0, r2 = 0
    const a0x = r1 * cz - r2 * cy, a0y = r2 * cx - r0 * cz, a0z = r0 * cy - r1 * cx
    const al = Math.sqrt(a0x * a0x + a0y * a0y + a0z * a0z)
    const ax = a0x / al, ay = a0y / al, az = a0z / al
    const bx = cy * az - cz * ay, by = cz * ax - cx * az, bz = cx * ay - cy * ax
    let total = 0
    for (let s = 0; s < species.length; s++) {
      if (countCapRad[s] !== capRad) refreshCount(s, capRad)
      const count = countAtCapRad[s]
      if (count > capacity) throw new RangeError('patch ' + patchId + ' needs ' + count + ' instances, above the capacity ' + capacity)
      let state = seedBits(worldSeed, ownerLow[slot], ownerHigh[slot], s) >>> 0
      const buf = buffers[s][slot]
      for (let i = 0; i < count; i++) {
        for (let d = 0; d < DRAWS_PER_INSTANCE; d++) {
          state = (state + 0x6d2b79f5) >>> 0
          let t = state
          t = Math.imul(t ^ (t >>> 15), t | 1)
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
          draws[d] = ((t ^ (t >>> 14)) >>> 0) / UINT32_SPAN
        }
        const cosTheta = 1 - draws[0] * (1 - cosCap)
        const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta))
        const phi = draws[1] * 2 * Math.PI
        const cp = Math.cos(phi), sp = Math.sin(phi)
        let x = cosTheta * cx + sinTheta * (cp * ax + sp * bx)
        let y = cosTheta * cy + sinTheta * (cp * ay + sp * by)
        let z = cosTheta * cz + sinTheta * (cp * az + sp * bz)
        const len = Math.sqrt(x * x + y * y + z * z)
        x /= len; y /= len; z /= len
        nrm[0] = x; nrm[1] = y; nrm[2] = z
        if (heightsByArray) heightInto(nrm, heights)
        else heights[0] = heightAt(nrm)
        const r = radiusM + heights[0]
        const yaw = draws[2] * 2 * Math.PI
        const offPoleHere = Math.abs(y) < POLE_REFERENCE_LIMIT
        const n0 = offPoleHere ? 0 : 1, n1 = offPoleHere ? 1 : 0, n2 = 0
        let ex = n1 * z - n2 * y, ey = n2 * x - n0 * z, ez = n0 * y - n1 * x
        const el = Math.sqrt(ex * ex + ey * ey + ez * ez)
        ex /= el; ey /= el; ez /= el
        const nx = y * ez - z * ey, ny = z * ex - x * ez, nz = x * ey - y * ex
        const cw = Math.cos(yaw), sw = Math.sin(yaw)
        const fx = cw * ex + sw * nx, fy = cw * ey + sw * ny, fz = cw * ez + sw * nz
        const sx = y * fz - z * fy, sy = z * fx - x * fz, sz = x * fy - y * fx
        const o = i * TRANSFORM_STRIDE_FLOATS
        buf[o] = sx; buf[o + 1] = sy; buf[o + 2] = sz; buf[o + 3] = 0
        buf[o + 4] = x; buf[o + 5] = y; buf[o + 6] = z; buf[o + 7] = 0
        buf[o + 8] = fx; buf[o + 9] = fy; buf[o + 10] = fz; buf[o + 11] = 0
        buf[o + 12] = r * x - radiusM * cx
        buf[o + 13] = r * y - radiusM * cy
        buf[o + 14] = r * z - radiusM * cz
        buf[o + 15] = 1
      }
      generatedBlock[s * slots + slot] = count
      counts[s][slot] = detail[slot] >= HIDDEN_DETAIL ? 0 : count >>> detail[slot]
      total += count
    }
    dirty[slot] = 1
    generated += 1
    generatedInstances += total
    if (hiddenCount > 0) {
      for (let row = 0; row < hiddenCapacity; row++) {
        if (hiddenHigh[row] === ownerHigh[slot] && hiddenLow[row] === ownerLow[slot]) blank(row, slot)
      }
    }
  }

  const blank = (row, slot) => {
    const buf = buffers[hiddenSpecies[row]][slot]
    const o = hiddenIndex[row] * TRANSFORM_STRIDE_FLOATS
    for (let k = 0; k < BASIS_FLOATS; k++) {
      hiddenBasis[row * BASIS_FLOATS + k] = buf[o + k]
      buf[o + k] = 0
    }
    dirty[slot] = 1
  }

  const hiddenRow = (speciesIndex, slot, i) => {
    for (let row = 0; row < hiddenCapacity; row++) {
      if (hiddenHigh[row] === ownerHigh[slot] && hiddenLow[row] === ownerLow[slot] && hiddenSpecies[row] === speciesIndex && hiddenIndex[row] === i) return row
    }
    return HIDDEN_FREE
  }

  const checkInstance = (speciesIndex, slot, i) => {
    if (!(speciesIndex >= 0 && speciesIndex < species.length)) throw new RangeError('species index out of range')
    if (!(slot >= 0 && slot < slots) || ownerHigh[slot] === FREE) throw new RangeError('slot ' + slot + ' holds no patch')
    if (!(i >= 0 && i < generatedBlock[speciesIndex * slots + slot])) throw new RangeError('instance ' + i + ' is not generated in slot ' + slot)
  }

  const hide = (speciesIndex, slot, i) => {
    checkInstance(speciesIndex, slot, i)
    if (hiddenRow(speciesIndex, slot, i) !== HIDDEN_FREE) return true
    if (hiddenCount === hiddenCapacity) {
      hiddenRefused += 1
      return false
    }
    let row = 0
    while (hiddenHigh[row] !== HIDDEN_FREE) row += 1
    hiddenLow[row] = ownerLow[slot]
    hiddenHigh[row] = ownerHigh[slot]
    hiddenSpecies[row] = speciesIndex
    hiddenIndex[row] = i
    hiddenCount += 1
    blank(row, slot)
    return true
  }

  const reveal = (row) => {
    const slot = findSlot(hiddenLow[row], hiddenHigh[row])
    if (slot !== NO_SLOT && hiddenIndex[row] < generatedBlock[hiddenSpecies[row] * slots + slot]) {
      const buf = buffers[hiddenSpecies[row]][slot]
      const o = hiddenIndex[row] * TRANSFORM_STRIDE_FLOATS
      for (let k = 0; k < BASIS_FLOATS; k++) buf[o + k] = hiddenBasis[row * BASIS_FLOATS + k]
      dirty[slot] = 1
    }
    hiddenHigh[row] = HIDDEN_FREE
    hiddenCount -= 1
  }

  const unhide = (speciesIndex, slot, i) => {
    checkInstance(speciesIndex, slot, i)
    const row = hiddenRow(speciesIndex, slot, i)
    if (row === HIDDEN_FREE) return false
    reveal(row)
    return true
  }

  const unhideAll = () => {
    for (let row = 0; row < hiddenCapacity; row++) {
      if (hiddenHigh[row] !== HIDDEN_FREE) reveal(row)
    }
  }

  const nearest = (x, y, z, withinM, out) => {
    if (!(withinM >= 0) || !Number.isFinite(withinM)) throw new RangeError('withinM must be a finite distance in metres at zero or more')
    const reach = cullRadiusM + withinM
    let best = withinM * withinM
    let found = false
    for (let slot = 0; slot < slots; slot++) {
      if (ownerHigh[slot] === FREE) continue
      const ox = x - origins[slot * 3], oy = y - origins[slot * 3 + 1], oz = z - origins[slot * 3 + 2]
      if (ox * ox + oy * oy + oz * oz > reach * reach) continue
      for (let s = 0; s < species.length; s++) {
        const buf = buffers[s][slot]
        const count = generatedBlock[s * slots + slot]
        for (let i = 0; i < count; i++) {
          const o = i * TRANSFORM_STRIDE_FLOATS + 12
          const dx = ox - buf[o], dy = oy - buf[o + 1], dz = oz - buf[o + 2]
          const d = dx * dx + dy * dy + dz * dz
          if (d > best) continue
          best = d
          found = true
          out[0] = s
          out[1] = slot
          out[2] = i
        }
      }
    }
    return found
  }

  const sync = (patchIds) => {
    epoch += 1
    const wanted = patchIds.length
    for (let k = 0; k < wanted; k++) {
      const id = patchIds[k]
      if (!Number.isSafeInteger(id) || id < 0) throw new TypeError('patch ids must be safe integers at zero or more')
      const existing = findSlot(id | 0, highWord(id))
      if (existing !== NO_SLOT) stamp[existing] = epoch
    }
    for (let slot = 0; slot < slots; slot++) {
      if (ownerHigh[slot] === FREE || stamp[slot] === epoch) continue
      removeSlot(slot)
      ownerHigh[slot] = FREE
      resident -= 1
      for (let s = 0; s < counts.length; s++) {
        counts[s][slot] = 0
        generatedBlock[s * slots + slot] = 0
      }
      detail[slot] = 0
      freeStack[freeTop] = slot
      freeTop += 1
      dequeue(slot)
    }
    for (let k = 0; k < wanted; k++) {
      const id = patchIds[k]
      const low = id | 0
      const high = highWord(id)
      if (findSlot(low, high) !== NO_SLOT) continue
      if (freeTop === 0) { deferred += 1; continue }
      freeTop -= 1
      const slot = freeStack[freeTop]
      ownerLow[slot] = low
      ownerHigh[slot] = high
      home[slot] = bucketOf(low, high)
      insertSlot(slot)
      resident += 1
      stamp[slot] = epoch
      pendingQueue[(pendingHead + pendingCount) % slots] = slot
      pendingCount += 1
    }
  }

  const step = (budget = generatePerFrame) => {
    if (!(budget >= capacity)) throw new RangeError('budget must be at least one patch capacity')
    let spent = 0
    let done = 0
    if (pendingCount > 0) {
      const t0 = now()
      while (pendingCount > 0) {
        if (spent > 0 && spent + capacity > budget) break
        const slot = pendingQueue[pendingHead]
        pendingHead = (pendingHead + 1) % slots
        pendingCount -= 1
        generate(slot)
        spent += capacity
        done += 1
      }
      timing[0] += now() - t0
    }
    stepResult.patches = done
    stepResult.budgetInstances = spent
    return stepResult
  }

  const instanceTotal = () => {
    let total = 0
    for (let k = 0; k < generatedBlock.length; k++) total += generatedBlock[k]
    return total
  }

  const shownTotal = () => {
    let total = 0
    for (let k = 0; k < countsBlock.length; k++) total += countsBlock[k]
    return total
  }

  const generatedAt = (slot) => {
    let total = 0
    for (let s = 0; s < counts.length; s++) total += generatedBlock[s * slots + slot]
    return total
  }

  const setDetail = (slot, level) => {
    if (detail[slot] === level) return
    detail[slot] = level
    let grew = false
    for (let s = 0; s < counts.length; s++) {
      const shown = level >= HIDDEN_DETAIL ? 0 : generatedBlock[s * slots + slot] >>> level
      if (shown > counts[s][slot]) grew = true
      counts[s][slot] = shown
    }
    if (grew) dirty[slot] = 1
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
    setDetail,
    hide,
    unhide,
    unhideAll,
    nearest,
    isHidden: (speciesIndex, slot, i) => hiddenRow(speciesIndex, slot, i) !== HIDDEN_FREE,
    generatedAt,
    shownTotal,
    detailOf: (slot) => detail[slot],
    drawRanges,
    readWorld,
    origin: (slot) => [origins[slot * 3], origins[slot * 3 + 1], origins[slot * 3 + 2]],
    memory: () => ({ block, counts: countsBlock, dirty, origins, species: species.length, slots, capacity, radius: cullRadiusM }),
    buffers: () => buffers,
    counts: () => counts,
    slotOf: (id) => {
      const slot = Number.isSafeInteger(id) && id >= 0 ? findSlot(id | 0, highWord(id)) : NO_SLOT
      return slot === NO_SLOT ? undefined : slot
    },
    bytes: () => buffers.reduce((acc, arr) => acc + arr.reduce((x, b) => x + b.byteLength, 0), 0),
    stats: () => ({ resident, pending: pendingCount, deferred, generated, generatedInstances, generateMs: timing[0], hidden: hiddenCount, hiddenRefused }),
    sharing: (patchBytes) => copyAccounting({ patches: resident, patchBytes, instances: instanceTotal() }),
  }
}
