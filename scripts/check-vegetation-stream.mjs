import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { PLANET_RADIUS_M } from '../src/engine/sphere.js'
import { capAreaKm2 } from '../src/engine/population.js'
import { densityFor } from '../src/engine/populationDensity.js'
import { MATRIX_BYTES, createVegetationPool, patchSeed, planVegetationPool } from '../src/engine/vegetation.js'

const CAP = 1024
const CAP_RAD = 1.0e-5
const R = PLANET_RADIUS_M
const clock = () => { let t = 0; return () => (t += 1) }
const patchCentre = (id) => ({ latRad: 0.1 * (id % 5), lonRad: 0.2 * (id % 7), capRad: CAP_RAD })
const expectedCount = Math.round(densityFor('trees') * capAreaKm2(CAP_RAD))

const makePool = ({ slots = 4, heightAt = () => 3, seed = 42, budget } = {}) => createVegetationPool({
  plan: planVegetationPool({ maxBufferBytes: 1e12, residentPatches: slots, capacityPerPatch: CAP }),
  worldSeed: seed,
  heightAt,
  patchCentre,
  now: clock(),
  generatePerFrame: budget,
})

gate('the device limit is read once into a plan: a count bound by patches, a count bound by the device, and a refusal when no patch fits', () => {
  const a = planVegetationPool({ maxBufferBytes: 64 * 1024 * 1024, residentPatches: 100, capacityPerPatch: CAP })
  assert.equal(a.slots, 100)
  assert.equal(a.bound, 'patches')
  assert.equal(a.slotBytes, CAP * MATRIX_BYTES)
  const b = planVegetationPool({ maxBufferBytes: CAP * MATRIX_BYTES * 10, residentPatches: 100, capacityPerPatch: CAP })
  assert.equal(b.slots, 10)
  assert.equal(b.bound, 'device')
  assert.throws(() => planVegetationPool({ maxBufferBytes: 1000, residentPatches: 1, capacityPerPatch: CAP }), RangeError)
  assert.throws(() => planVegetationPool({ maxBufferBytes: 1e9, residentPatches: 0, capacityPerPatch: CAP }), RangeError)
})

gate('the pool refuses construction without its height store, its patch centres, its clock, or a budget that cannot hold one patch', () => {
  const plan = planVegetationPool({ maxBufferBytes: 1e12, residentPatches: 2, capacityPerPatch: CAP })
  const base = { plan, worldSeed: 1, heightAt: () => 0, patchCentre, now: clock() }
  assert.throws(() => createVegetationPool({ ...base, heightAt: undefined }), TypeError)
  assert.throws(() => createVegetationPool({ ...base, patchCentre: undefined }), TypeError)
  assert.throws(() => createVegetationPool({ ...base, now: undefined }), TypeError)
  assert.throws(() => createVegetationPool({ ...base, generatePerFrame: CAP - 1 }), RangeError)
})

gate('the instance buffers are allocated once and keep their identity and size through sync and step', () => {
  const pool = makePool({ slots: 3 })
  const before = pool.buffers()[0][0]
  const bytes = pool.bytes()
  pool.sync([1, 2, 3])
  pool.step()
  pool.sync([2, 3, 4])
  pool.step()
  assert.equal(pool.buffers()[0][0], before)
  assert.equal(pool.bytes(), bytes)
  assert.equal(bytes, 3 * CAP * MATRIX_BYTES)
})

gate('a patch enters a free slot, a patch that leaves frees its slot, and a full pool defers without growing', () => {
  const pool = makePool({ slots: 2 })
  pool.sync([10, 11, 12])
  assert.equal(pool.stats().resident, 2)
  assert.equal(pool.stats().deferred, 1)
  assert.equal(pool.slotOf(12), undefined)
  pool.sync([11, 12])
  assert.equal(pool.slotOf(10), undefined)
  assert.notEqual(pool.slotOf(12), undefined)
  assert.equal(pool.stats().resident, 2)
  assert.equal(pool.stats().deferred, 1)
})

gate('a patch generates within the per-frame budget, and a patch that does not fit waits for the next frame', () => {
  const pool = makePool({ slots: 3, budget: CAP })
  pool.sync([1, 2])
  assert.equal(pool.step(CAP).patches, 1)
  assert.equal(pool.stats().pending, 1)
  assert.equal(pool.step(CAP).patches, 1)
  assert.equal(pool.stats().pending, 0)
  assert.throws(() => pool.step(CAP - 1), RangeError)
  assert.ok(pool.stats().generatedInstances <= 2 * CAP)
  assert.equal(pool.stats().generatedInstances, 2 * expectedCount)
})

gate('a patch is generated once from its seed: the same patch id gives the same bytes in any slot, and a re-entering patch regenerates the same bytes', () => {
  const a = makePool({ slots: 2 })
  a.sync([7])
  a.step()
  const slotA = a.slotOf(7)
  const bytesA = Array.from(a.buffers()[0][slotA].subarray(0, expectedCount * 16))
  const b = makePool({ slots: 2 })
  b.sync([3, 7])
  b.step()
  b.step()
  const slotB = b.slotOf(7)
  const bytesB = Array.from(b.buffers()[0][slotB].subarray(0, expectedCount * 16))
  assert.deepEqual(bytesA, bytesB)
  a.sync([])
  a.sync([7])
  a.step()
  const again = Array.from(a.buffers()[0][a.slotOf(7)].subarray(0, expectedCount * 16))
  assert.deepEqual(again, bytesA)
  assert.notDeepEqual(patchSeed(42, 7), patchSeed(42, 8))
  assert.throws(() => patchSeed(42, 1.5), TypeError)
})

gate('each instance matrix is orthonormal in its 3 by 3 part, and its origin plus translation lies at the height store height', () => {
  const pool = makePool({ slots: 1, heightAt: () => 3 })
  pool.sync([7])
  pool.step()
  const m = pool.buffers()[0][pool.slotOf(7)]
  const base = 0
  const col = (k) => [m[base + k * 4], m[base + k * 4 + 1], m[base + k * 4 + 2]]
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(dot(col(i), col(i)) - 1) < 1e-5)
  assert.ok(Math.abs(dot(col(0), col(1))) < 1e-5)
  assert.ok(Math.abs(dot(col(0), col(2))) < 1e-5)
  assert.ok(Math.abs(dot(col(1), col(2))) < 1e-5)
  for (let i = 0; i < expectedCount; i++) {
    const w = pool.readWorld(0, pool.slotOf(7), i, [0, 0, 0])
    assert.ok(Math.abs(Math.hypot(w[0], w[1], w[2]) - (R + 3)) < 1e-3, 'instance ' + i)
  }
})

gate('the world position is read from the render buffer in place, and the translation stays small in float32 by its origin', () => {
  const pool = makePool({ slots: 1 })
  pool.sync([7])
  pool.step()
  const slot = pool.slotOf(7)
  const base = 0
  const buf = pool.buffers()[0][slot]
  for (let i = 0; i < expectedCount; i++) {
    assert.ok(Math.abs(buf[base + i * 16 + 12]) < 100, 'translation not small at ' + i)
  }
  const out = pool.readWorld(0, slot, 0, [0, 0, 0])
  const o = pool.origin(slot)
  assert.ok(Math.abs(out[0] - o[0] - buf[base + 12]) < 1e-6)
  assert.equal(buf, pool.buffers()[0][slot])
})

gate('draw ranges list one range per resident slot with its offset and count, with no allocation in the list', () => {
  const pool = makePool({ slots: 2 })
  pool.sync([1, 2])
  pool.step()
  pool.step()
  const out = new Uint32Array(4)
  const n = pool.drawRanges(0, out)
  assert.equal(n, 2)
  assert.deepEqual([out[0], out[1], out[2], out[3]], [0, expectedCount, 1, expectedCount])
  assert.throws(() => pool.drawRanges(5, out), RangeError)
})

gate('the sharing accounting counts the patch copies and the instance copies that the shared layout avoids', () => {
  const pool = makePool({ slots: 2 })
  pool.sync([1, 2])
  pool.step()
  pool.step()
  const acc = pool.sharing(400)
  assert.equal(acc.copiesSaved, 2 + 2 * expectedCount)
  assert.equal(acc.bytesSaved, 2 * 400 + 2 * expectedCount * 12)
  assert.equal(acc.sharedBytes, acc.renderBytes)
})

finish()
