import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { LEVEL_UNSET, createDisplayGovernor, lodOf } from '../src/engine/displayGovernor.js'
import { VEG_HIDDEN, createVegetationDetail } from '../src/engine/vegetationDetail.js'
import { createVegetationPool, planVegetationPool } from '../src/engine/vegetation.js'
import { sceneSpec } from '../src/engine/planetScene.js'
import { PLANET_RADIUS_M } from '../src/engine/sphere.js'

const random = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const costOf = (levels, weight, count, last) => {
  let cost = 0
  for (let i = 0; i < count; i++) if (levels[i] !== LEVEL_UNSET && levels[i] < last) cost += weight[i] >>> levels[i]
  return cost
}

gate('a scene inside the budget is shown at the level its distance asks for, with no bias', () => {
  const g = createDisplayGovernor({ capacity: 4, levels: 6, budget: 10000 })
  const s = g.select(4, Float32Array.of(0, 1.5, 2.9, 9), Uint32Array.of(1000, 1000, 1000, 1000))
  assert.deepEqual([...g.levels], [0, 1, 2, 5])
  assert.equal(s.cost, 1000 + 500 + 250)
  assert.equal(s.demand, 4000)
  assert.equal(s.bias, 0)
  assert.equal(s.shed, 0)
  assert.equal(lodOf(100, 150), 0)
  assert.equal(lodOf(600, 150), 2)
})

gate('a scene above the budget is coarsened until it fits, and the shown cost is at or under the budget on every frame of a moving view', () => {
  const N = 4096
  const BUDGET = 60000
  const g = createDisplayGovernor({ capacity: N, levels: 8, budget: BUDGET })
  const rand = random(7)
  const base = new Float32Array(N)
  const weight = new Uint32Array(N)
  const lod = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    base[i] = rand() * 5
    weight[i] = 64 + Math.floor(rand() * 192)
  }
  let worst = 0
  let biased = 0
  for (let frame = 0; frame < 600; frame++) {
    const sweep = Math.sin(frame / 40) * 2
    for (let i = 0; i < N; i++) lod[i] = Math.max(0, base[i] + sweep)
    const s = g.select(N, lod, weight)
    assert.equal(s.cost, costOf(g.levels, weight, N, g.lastLevel))
    assert.ok(s.cost <= BUDGET, 'frame ' + frame + ' shows ' + s.cost)
    if (s.cost > worst) worst = s.cost
    if (s.bias > 0) biased += 1
    assert.ok(s.demand > BUDGET * 4)
  }
  assert.ok(biased > 0, 'the bias never rose')
  assert.ok(worst > BUDGET * 0.5, 'the governor shows far less than the budget allows: ' + worst)
})

gate('an item that wavers across a level boundary keeps its level, and without the hysteresis band the same item flips', () => {
  const run = (hysteresis) => {
    const g = createDisplayGovernor({ capacity: 1, levels: 6, budget: 1000, hysteresis })
    const weight = Uint32Array.of(100)
    const lod = new Float32Array(1)
    let flips = 0
    let before = -1
    for (let frame = 0; frame < 100; frame++) {
      lod[0] = 2 + (frame % 2 === 0 ? 0.2 : -0.2)
      g.select(1, lod, weight)
      if (before !== -1 && g.levels[0] !== before) flips += 1
      before = g.levels[0]
    }
    return flips
  }
  assert.equal(run(0.25), 0)
  assert.equal(run(0), 99)
})

gate('when even the coarsest bias cannot fit near items, the last items are shed to hidden and the budget still holds', () => {
  const N = 64
  const g = createDisplayGovernor({ capacity: N, levels: 4, budget: 500, maxBias: 1 })
  const lod = new Float32Array(N).fill(-8)
  const weight = new Uint32Array(N).fill(100)
  const s = g.select(N, lod, weight)
  assert.ok(s.cost <= 500)
  assert.equal(s.cost, costOf(g.levels, weight, N, g.lastLevel))
  assert.ok(s.shed > 0)
  assert.equal(g.levels[0], 0)
  assert.equal(g.levels[N - 1], g.lastLevel)
})

gate('the bias falls back to zero when the load goes, holds still on a still scene, and an empty slot forgets its level', () => {
  const N = 256
  const g = createDisplayGovernor({ capacity: N, levels: 8, budget: 4000 })
  const lod = new Float32Array(N)
  const heavy = new Uint32Array(N).fill(200)
  const light = new Uint32Array(N).fill(8)
  let s = g.select(N, lod, heavy)
  assert.ok(s.bias > 0 && s.cost <= 4000)
  for (let frame = 0; frame < 40; frame++) s = g.select(N, lod, heavy)
  const settled = s.bias
  for (let frame = 0; frame < 40; frame++) {
    s = g.select(N, lod, heavy)
    assert.equal(s.bias, settled)
    assert.equal(s.changed, 0)
  }
  for (let frame = 0; frame < 64; frame++) s = g.select(N, lod, light)
  assert.equal(s.bias, 0)
  assert.equal(s.cost, N * 8)
  light[3] = 0
  g.select(N, lod, light)
  assert.equal(g.levels[3], LEVEL_UNSET)
})

gate('a selection reuses its arrays and its result, and a bad count, level count, band or budget is refused', () => {
  const g = createDisplayGovernor({ capacity: 8, levels: 4, budget: 100 })
  const levels = g.levels
  const a = g.select(8, new Float32Array(8), new Uint32Array(8).fill(5))
  const b = g.select(8, new Float32Array(8), new Uint32Array(8).fill(5))
  assert.equal(a, b)
  assert.equal(levels, g.levels)
  assert.throws(() => g.select(9, new Float32Array(9), new Uint32Array(9)), RangeError)
  assert.throws(() => createDisplayGovernor({ capacity: 0, levels: 4, budget: 1 }), RangeError)
  assert.throws(() => createDisplayGovernor({ capacity: 1, levels: 1, budget: 1 }), RangeError)
  assert.throws(() => createDisplayGovernor({ capacity: 1, levels: 17, budget: 1 }), RangeError)
  assert.throws(() => createDisplayGovernor({ capacity: 1, levels: 4, budget: 1.5 }), RangeError)
  assert.throws(() => createDisplayGovernor({ capacity: 1, levels: 4, budget: 1, hysteresis: 0.5 }), RangeError)
  g.setBudget(0)
  assert.equal(g.select(8, new Float32Array(8), new Uint32Array(8).fill(5)).cost, 0)
  const nan = createDisplayGovernor({ capacity: 1, levels: 4, budget: 100 })
  nan.select(1, Float32Array.of(NaN), Uint32Array.of(50))
  assert.equal(nan.levels[0], nan.lastLevel)
})

const CAP = 1024
const SLOTS = 32
const CAP_RAD = 1.0e-5
const R = PLANET_RADIUS_M
const patchCentre = (id, out = {}) => {
  out.latRad = 0
  out.lonRad = id * 4.0e-5
  out.capRad = CAP_RAD
  return out
}
const makePool = () => {
  let t = 0
  const pool = createVegetationPool({
    plan: planVegetationPool({ maxBufferBytes: 1e12, residentPatches: SLOTS, capacityPerPatch: CAP }),
    worldSeed: 5,
    heightAt: () => 0,
    patchCentre,
    now: () => (t += 1),
    cullRadiusM: R * CAP_RAD,
  })
  pool.sync(Array.from({ length: SLOTS }, (_, k) => k))
  while (pool.stats().pending > 0) pool.step()
  return pool
}

gate('vegetation patches are thinned by distance to a fixed shown-instance budget: the near patch stays whole, far patches show a prefix, and the total holds', () => {
  const pool = makePool()
  const full = pool.shownTotal()
  const perPatch = pool.generatedAt(pool.slotOf(0))
  assert.equal(full, perPatch * SLOTS)
  const budget = Math.floor(full / 4)
  const detail = createVegetationDetail({ pool, instanceBudget: budget, fullDetailM: 200 })
  const eye = [0, 0, R]
  let s
  for (let frame = 0; frame < 30; frame++) {
    s = detail.update(eye[0], eye[1], eye[2])
    assert.ok(pool.shownTotal() <= budget, 'frame ' + frame + ' shows ' + pool.shownTotal())
  }
  assert.ok(pool.shownTotal() <= s.cost)
  assert.ok(pool.shownTotal() > budget / 2)
  const near = pool.slotOf(0)
  const far = pool.slotOf(SLOTS - 1)
  assert.ok(pool.counts()[0][near] > pool.counts()[0][far])
  for (let id = 0; id < SLOTS; id++) {
    const slot = pool.slotOf(id)
    const level = pool.detailOf(slot)
    assert.equal(pool.counts()[0][slot], level >= VEG_HIDDEN ? 0 : perPatch >>> level)
    if (id > 0) assert.ok(pool.detailOf(slot) >= pool.detailOf(pool.slotOf(id - 1)), 'detail falls with distance')
  }
})

gate('raising the budget restores the full count and marks the grown patches for upload; no buffer is replaced', () => {
  const pool = makePool()
  const full = pool.shownTotal()
  const memory = pool.memory()
  const detail = createVegetationDetail({ pool, instanceBudget: Math.floor(full / 8), fullDetailM: 200 })
  for (let frame = 0; frame < 30; frame++) detail.update(0, 0, R)
  assert.ok(pool.shownTotal() <= Math.floor(full / 8))
  memory.dirty.fill(0)
  detail.setBudget(full)
  for (let frame = 0; frame < 80; frame++) detail.update(0, 0, R)
  assert.equal(detail.governor.stats.bias, 0)
  const far = pool.slotOf(SLOTS - 1)
  assert.equal(memory.dirty[far], 1)
  const again = pool.memory()
  assert.equal(again.block, memory.block)
  assert.equal(again.counts, memory.counts)
  const farM = Math.sqrt((again.origins[far * 3]) ** 2 + (again.origins[far * 3 + 2] - R) ** 2)
  assert.ok(farM > 200)
  assert.equal(pool.detailOf(far), Math.floor(lodOf(farM - again.radius, 200)))
})

gate('a patch that leaves its slot takes its detail level with it, and the next patch in the slot starts whole', () => {
  const pool = makePool()
  const detail = createVegetationDetail({ pool, instanceBudget: 100, fullDetailM: 200 })
  detail.update(0, 0, R)
  const slot = pool.slotOf(SLOTS - 1)
  assert.ok(pool.detailOf(slot) > 0)
  pool.sync(Array.from({ length: SLOTS - 1 }, (_, k) => k).concat([900]))
  assert.equal(pool.detailOf(slot), 0)
  assert.equal(pool.generatedAt(slot), 0)
  while (pool.stats().pending > 0) pool.step()
  assert.equal(pool.slotOf(900), slot)
  assert.equal(pool.counts()[0][slot], pool.generatedAt(slot))
  detail.update(0, 0, R)
  assert.ok(pool.shownTotal() <= 100)
})

gate('a scene takes its shown-instance budget as a whole number chosen once, or none', () => {
  assert.equal(sceneSpec().instanceBudget, null)
  assert.equal(sceneSpec({ instanceBudget: 4096 }).instanceBudget, 4096)
  assert.throws(() => sceneSpec({ instanceBudget: 1.5 }), RangeError)
  assert.throws(() => sceneSpec({ instanceBudget: -1 }), RangeError)
  assert.throws(() => sceneSpec({ fullDetailM: 0 }), RangeError)
})

finish()
