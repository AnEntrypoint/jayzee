import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { LAYER_CONFIG, LAYER_DYNAMIC, LAYER_STATIC, LAYER_VERY_STATIC, createColliderSet } from '../src/engine/colliderLayers.js'
import { registerPopulation, registerTerrain } from '../src/engine/populationColliders.js'
import { PLACEMENT_GPU_QUERY, PLACEMENT_GROUND_QUERY, PLACEMENT_JOLT_HEIGHTFIELD, PLACEMENT_OPTIONS, chooseByMeasurement, createGpuQueryPlacement, createGroundQueryPlacement, createJoltHeightfieldPlacement } from '../src/engine/collisionPlacement.js'
import { TRANSFORM_POSITION_OFFSET, copyAccounting, createSharedHeightStore, transformStream } from '../src/engine/sharedData.js'

const ticking = () => {
  let t = 0
  return () => (t += 1)
}

gate('per-step work is only the dynamic layer: static layers have an update rate of zero and cost nothing per step', () => {
  assert.equal(LAYER_CONFIG[LAYER_VERY_STATIC].updateEverySteps, 0)
  assert.equal(LAYER_CONFIG[LAYER_STATIC].updateEverySteps, 0)
  assert.equal(LAYER_CONFIG[LAYER_DYNAMIC].updateEverySteps, 1)
  assert.equal(new Set(Object.values(LAYER_CONFIG).map((c) => c.broadphase)).size, 3)
  const set = createColliderSet()
  registerTerrain(set)
  registerPopulation(set, 'trees', 5)
  registerPopulation(set, 'rocks', 3)
  set.add('ball', 'body')
  assert.deepEqual(set.stepCost(), { [LAYER_VERY_STATIC]: 0, [LAYER_STATIC]: 0, [LAYER_DYNAMIC]: 1 })
})

gate('the population registers each object in its static layer, once, and refuses an unknown category', () => {
  const set = createColliderSet()
  const ids = registerPopulation(set, 'trees', 4)
  assert.deepEqual(ids, ['trees-0', 'trees-1', 'trees-2', 'trees-3'])
  assert.deepEqual(set.counts(), { [LAYER_VERY_STATIC]: 0, [LAYER_STATIC]: 4, [LAYER_DYNAMIC]: 0 })
  assert.throws(() => registerPopulation(set, 'bridges', 1), RangeError)
  assert.throws(() => registerPopulation(set, 'trees', 1), RangeError)
})

gate('static population colliders refit only on change, and a step does not touch them', () => {
  const set = createColliderSet()
  registerPopulation(set, 'rocks', 2)
  assert.deepEqual(set.flush().build.sort(), ['rocks-0', 'rocks-1'])
  set.step()
  assert.deepEqual(set.flush(), { build: [], refit: [] })
  set.change('rocks-1')
  assert.deepEqual(set.flush(), { build: [], refit: ['rocks-1'] })
  assert.equal(set.stepCost()[LAYER_STATIC], 0)
})

gate('the ground query path samples the height store and times each query with the injected clock', () => {
  assert.throws(() => createGroundQueryPlacement({ sampleHeight: () => 0 }), TypeError)
  const p = createGroundQueryPlacement({ sampleHeight: (x, y, z) => x + y + z, now: ticking() })
  assert.equal(p.name, PLACEMENT_GROUND_QUERY)
  assert.equal(p.query(1, 2, 3), 6)
  for (let i = 0; i < 3; i++) p.query(0, 0, 0)
  assert.deepEqual(p.measure(), { count: 4, p50Ms: 1, p99Ms: 1, maxMs: 1 })
})

gate('the Jolt heightfield path builds once, queries through the raycast, and refuses a missing builder or raycast', () => {
  assert.throws(() => createJoltHeightfieldPlacement({ raycastDown: () => 0, now: ticking() }), TypeError)
  assert.throws(() => createJoltHeightfieldPlacement({ buildHeightfield: () => 1, now: ticking() }), TypeError)
  let built = 0
  const p = createJoltHeightfieldPlacement({ buildHeightfield: (samples, cellM) => { built += 1; return { n: samples.length, cellM } }, raycastDown: (x, z) => x - z, now: ticking() })
  assert.equal(p.name, PLACEMENT_JOLT_HEIGHTFIELD)
  assert.deepEqual(p.build(new Float32Array(9), 4), { n: 9, cellM: 4 })
  assert.equal(p.query(5, 2), 3)
  assert.equal(built, 1)
  assert.equal(p.measure().count, 1)
})

gate('the GPU path refuses a missing dispatch and records its dispatches', () => {
  assert.throws(() => createGpuQueryPlacement({ now: ticking() }), TypeError)
  const p = createGpuQueryPlacement({ dispatch: (positions) => positions.map((v) => v * 2), now: ticking() })
  assert.equal(p.name, PLACEMENT_GPU_QUERY)
  assert.deepEqual(p.query([1, 2]), [2, 4])
  assert.equal(p.measure().count, 1)
})

gate('no option is preferred in code: the three options are listed in a fixed order, and nothing is chosen without a measurement', () => {
  assert.deepEqual([...PLACEMENT_OPTIONS].sort(), [PLACEMENT_GPU_QUERY, PLACEMENT_GROUND_QUERY, PLACEMENT_JOLT_HEIGHTFIELD].sort())
  const none = [{ name: PLACEMENT_GPU_QUERY, measure: { count: 0 }, errorM: 0 }]
  assert.deepEqual(chooseByMeasurement(none, { maxErrorM: 0.1 }), { name: null, reason: 'no option has a measurement' })
})

gate('the choice is the lowest measured p99 among options within the error tolerance, with a name tie-break', () => {
  const results = [
    { name: PLACEMENT_JOLT_HEIGHTFIELD, measure: { count: 9, p50Ms: 0.1, p99Ms: 0.5, maxMs: 1 }, errorM: 0.02 },
    { name: PLACEMENT_GROUND_QUERY, measure: { count: 9, p50Ms: 0.2, p99Ms: 0.4, maxMs: 1 }, errorM: 0.02 },
    { name: PLACEMENT_GPU_QUERY, measure: { count: 9, p50Ms: 0.05, p99Ms: 0.01, maxMs: 0.1 }, errorM: 0.5 },
  ]
  assert.equal(chooseByMeasurement(results, { maxErrorM: 0.1 }).name, PLACEMENT_GROUND_QUERY)
  assert.equal(chooseByMeasurement(results, { maxErrorM: 1, metric: 'p50Ms' }).name, PLACEMENT_GPU_QUERY)
  assert.equal(chooseByMeasurement(results, { maxErrorM: 0.001 }).name, null)
  const tie = [{ name: 'b', measure: { count: 1, p99Ms: 1 }, errorM: 0 }, { name: 'a', measure: { count: 1, p99Ms: 1 }, errorM: 0 }]
  assert.equal(chooseByMeasurement(tie, { maxErrorM: 0 }).name, 'a')
  assert.throws(() => chooseByMeasurement(results, { maxErrorM: -1 }), RangeError)
  assert.throws(() => chooseByMeasurement(results, { maxErrorM: 0.1, metric: 'mean' }), RangeError)
})

gate('the render and physics views of the height store are the same buffers, not copies', () => {
  const store = createSharedHeightStore({ patchCount: 2, patchSide: 4, cellM: 1 })
  const r = store.renderView()
  const p = store.physicsView()
  assert.equal(r.heights.buffer, p.heights.buffer)
  assert.equal(r.normals.buffer, p.normals.buffer)
  assert.equal(r.heights, store.heights)
})

gate('normals from a flat store point up, and a ramp tilts them against the slope', () => {
  const flat = createSharedHeightStore({ patchCount: 1, patchSide: 4, cellM: 1 })
  flat.normalsFromHeights()
  for (let i = 0; i < 16; i++) {
    assert.equal(flat.normals[i * 3], 0)
    assert.equal(flat.normals[i * 3 + 1], 1)
    assert.equal(flat.normals[i * 3 + 2], 0)
  }
  const ramp = createSharedHeightStore({ patchCount: 1, patchSide: 4, cellM: 1 })
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) ramp.heights[j * 4 + i] = 0.5 * i
  ramp.normalsFromHeights()
  const o = (1 * 4 + 1) * 3
  const len = Math.hypot(0.5, 1)
  assert.ok(Math.abs(ramp.normals[o] + 0.5 / len) < 1e-6)
  assert.ok(Math.abs(ramp.normals[o + 1] - 1 / len) < 1e-6)
  assert.ok(Math.abs(ramp.normals[o + 2]) < 1e-6)
})

gate('a physics position is read in place from the render transform stream, on the same buffer', () => {
  const s = transformStream(3)
  s.data[2 * 16 + TRANSFORM_POSITION_OFFSET] = 7
  s.data[2 * 16 + TRANSFORM_POSITION_OFFSET + 1] = 8
  s.data[2 * 16 + TRANSFORM_POSITION_OFFSET + 2] = 9
  const pos = s.physicsPosition(2)
  assert.deepEqual([...pos], [7, 8, 9])
  assert.equal(pos.buffer, s.renderView().buffer)
  assert.throws(() => transformStream(-1), RangeError)
})

gate('the copy accounting counts the physics copies that the shared layout avoids', () => {
  const a = copyAccounting({ patches: 10, patchBytes: 400, instances: 1000 })
  assert.equal(a.renderBytes, 10 * 400 + 1000 * 64)
  assert.equal(a.physicsBytesIfCopied, 10 * 400 + 1000 * 12)
  assert.equal(a.bytesSaved, a.physicsBytesIfCopied)
  assert.equal(a.sharedBytes, a.renderBytes)
  assert.equal(a.copiesSaved, 1010)
  assert.throws(() => copyAccounting({ patches: -1, patchBytes: 1, instances: 0 }), RangeError)
})

finish()
