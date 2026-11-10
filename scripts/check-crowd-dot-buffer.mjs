import 'three/tsl'
import { PerformanceObserver } from 'node:perf_hooks'
import assert from 'node:assert/strict'
import { Scene } from 'three'
import { gate, finish } from './lib/gate.mjs'
import { CROWD_POSE_STRIDE, crowdPoseBuffer, crowdPoseBufferFor, decodeCrowdDotPoses, decodeCrowdDots } from '../src/client/crowdDots.js'
import { createCrowdDotRendererWebGL } from '../src/client/playerLodRenderer.js'

const DOTS = 64
const WARMUP_ITERATIONS = 2000
const MEASURED_ITERATIONS = 20000

assert.equal(typeof globalThis.gc, 'function', 'run with node --expose-gc so the heap can be settled before each window')

const kindOf = (entry) => (entry.detail && entry.detail.kind !== undefined ? entry.detail.kind : entry.kind)

const collectGc = async (run) => {
  globalThis.gc()
  globalThis.gc()
  const kinds = []
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) kinds.push(kindOf(entry))
  })
  observer.observe({ entryTypes: ['gc'] })
  run()
  await new Promise((done) => setTimeout(done, 50))
  for (const entry of observer.takeRecords()) kinds.push(kindOf(entry))
  observer.disconnect()
  return kinds
}

const dots = Array.from({ length: DOTS }, (_, i) => [i % 8, Math.floor(i / 8), (i % 5) + 1])
const options = { viewerY: 0 }
const poses = crowdPoseBuffer(DOTS)
const objects = []

const bufferTick = () => decodeCrowdDotPoses(dots, options, poses)
const objectTick = () => decodeCrowdDots(dots, options, objects)
const allocatingTick = () => decodeCrowdDots(dots, options)
for (let i = 0; i < WARMUP_ITERATIONS; i++) {
  bufferTick()
  objectTick()
}
await collectGc(() => {})
const bufferGc = await collectGc(() => {
  for (let i = 0; i < MEASURED_ITERATIONS; i++) bufferTick()
})
const objectGc = await collectGc(() => {
  for (let i = 0; i < MEASURED_ITERATIONS; i++) objectTick()
})
const allocatingGc = await collectGc(() => {
  for (let i = 0; i < MEASURED_ITERATIONS; i++) allocatingTick()
})

const renderer = createCrowdDotRendererWebGL(new Scene(), {})
const rendererTick = () => renderer.update(dots, 0, null)
for (let i = 0; i < WARMUP_ITERATIONS; i++) rendererTick()
await collectGc(() => {})
const rendererGc = await collectGc(() => {
  for (let i = 0; i < MEASURED_ITERATIONS; i++) rendererTick()
})

gate('with three/tsl loaded, decodeCrowdDotPoses into a held Float64Array runs with no garbage collection after warm-up', () => {
  assert.equal(bufferGc.length, 0, 'garbage collection ran in the measured window: ' + JSON.stringify(bufferGc))
})
gate('with three/tsl loaded, decodeCrowdDots with a reused out array runs with no garbage collection after warm-up', () => {
  assert.equal(objectGc.length, 0, 'garbage collection ran in the measured window: ' + JSON.stringify(objectGc))
})
gate('with three/tsl loaded, decodeCrowdDots without out is seen as garbage collection, so the window can detect churn', () => {
  assert.ok(allocatingGc.length > 0, 'the allocating form made no garbage collection, so this process cannot detect churn')
})
gate('with three/tsl loaded, the WebGL crowd-dot renderer updates its instances with no garbage collection after warm-up', () => {
  assert.equal(rendererGc.length, 0, 'garbage collection ran in the measured window: ' + JSON.stringify(rendererGc))
})
gate('the buffer form and the object form give the same poses, for bucket dots and flat dots', () => {
  const flat = [{ x: 1.5, y: 2, z: -3 }, { x: 0, y: 0, z: 9 }]
  for (const [list, opts] of [[dots, { viewerY: 3, groundHeightFn: (x, z) => x + z }], [flat, { viewerY: 99, dotSize: 2 }]]) {
    const buffer = crowdPoseBuffer(list.length)
    assert.equal(decodeCrowdDotPoses(list, opts, buffer), list.length)
    const fromObjects = decodeCrowdDots(list, opts).flatMap((pose) => [pose.x, pose.y, pose.z, pose.scale])
    assert.deepEqual([...buffer], fromObjects)
  }
})
gate('an empty list decodes to zero dots, and a buffer that is too small or not a Float64Array is refused', () => {
  assert.equal(decodeCrowdDotPoses([], options, poses), 0)
  assert.equal(decodeCrowdDotPoses(null, options, poses), 0)
  assert.throws(() => decodeCrowdDotPoses(dots, options, crowdPoseBuffer(DOTS - 1)), RangeError)
  assert.throws(() => decodeCrowdDotPoses(dots, options, []), TypeError)
})
gate('crowdPoseBufferFor keeps a buffer that fits and at least doubles one that does not', () => {
  assert.equal(crowdPoseBufferFor(poses, DOTS), poses)
  assert.equal(crowdPoseBufferFor(poses, DOTS + 1).length, DOTS * 2 * CROWD_POSE_STRIDE)
  assert.equal(crowdPoseBufferFor(poses, DOTS * 5).length, DOTS * 5 * CROWD_POSE_STRIDE)
})
gate('the renderer sets one instance per dot and grows past its first capacity', () => {
  renderer.update(dots, 0, null)
  assert.equal(renderer.instancedMesh.count, DOTS)
  const small = createCrowdDotRendererWebGL(new Scene(), { capacity: 4 })
  small.update(dots, 0, null)
  assert.equal(small.count, DOTS)
})

finish()
