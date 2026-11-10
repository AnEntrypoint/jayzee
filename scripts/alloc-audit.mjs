import { PerformanceObserver } from 'node:perf_hooks'
import { getHeapSpaceStatistics } from 'node:v8'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { Scene } from 'three'
import { createPlayerLodPlanner } from '../src/client-pure/playerLodPlanner.js'
import { createVsyncMonitor, createPerfTracker } from '../src/client-pure/frameMetrics.js'
import { tickBatch } from '../src/client-pure/transformLerp.js'
import { crowdPoseBuffer, decodeCrowdDotPoses } from '../src/client/crowdDots.js'
import { installPlayerLodRenderer } from '../src/client/playerLodRenderer.js'
import { PredictionEngine } from '../src/client/PredictionEngine.js'
import { SnapshotTimeline } from '../src/client/SnapshotTimeline.js'

const WARMUP_CALLS = 20000
const COLLECTION_ALLOWANCE = 1
const MEASURED_CALLS = 50000
const PLAYERS = 64

assert.equal(typeof globalThis.gc, 'function', 'run with node --expose-gc --max-semi-space-size=1')

const gcKinds = []
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) gcKinds.push(entry.detail ? entry.detail.kind : entry.kind)
})
observer.observe({ entryTypes: ['gc'] })
const settle = () => new Promise((done) => setTimeout(done, 20))

const newSpaceBytes = () => getHeapSpaceStatistics().find((space) => space.space_name === 'new_space').space_size / 2

const measure = async (name, tick) => {
  for (let i = 0; i < WARMUP_CALLS; i++) tick(i)
  globalThis.gc()
  globalThis.gc()
  await settle()
  gcKinds.length = 0
  for (let i = 0; i < MEASURED_CALLS; i++) tick(WARMUP_CALLS + i)
  await settle()
  const collections = gcKinds.length
  return { name, calls: MEASURED_CALLS, collections, bytesPerCallEstimate: Math.round((collections * newSpaceBytes()) / MEASURED_CALLS) }
}

const entries = Array.from({ length: PLAYERS }, (_, i) => ({ id: i + 1, x: 150 + i * 3, y: 0, z: (i % 8) * 4 }))
const viewer = { x: 0, y: 2, z: 0 }
const bucketDots = Array.from({ length: PLAYERS }, (_, i) => [i % 8, Math.floor(i / 8), (i % 5) + 1])

const planner = createPlayerLodPlanner()
const lod = installPlayerLodRenderer(new Scene(), {})
const vsync = createVsyncMonitor()
const frameStamps = ['boxed', ...Array.from({ length: WARMUP_CALLS + MEASURED_CALLS }, (_, i) => (i + 1) * 16.7)]
const sampleTimes = ['boxed', ...Array.from({ length: 50 }, (_, i) => 1250.5 + i)]
const perf = createPerfTracker()
const renderInfo = { calls: 10, triangles: 100 }
const lerpState = {}
const lerpRecords = Array.from({ length: PLAYERS }, (_, i) => ({ mesh: { position: { x: i, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }, target: { x: i + 1, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, rw: 1 }, last: { hasRot: true } }))
const poses = crowdPoseBuffer(PLAYERS)
const poseOptions = { viewerY: 0 }

let wall = 1000
let mono = 5000
const prediction = new PredictionEngine(60, { now: () => wall, renderNow: () => mono })
prediction.init('p1', { position: [0, 1, 0] })
const forward = { forward: true, yaw: 0 }

const timeline = new SnapshotTimeline({ tickRate: 10 })
const playerAt = (id, tick) => ({ id, position: [tick, 0, id], velocity: [0, 0, 0], rotation: [0, 0, 0, 1], onGround: false, health: 100, crouch: 0, expr: 0, weapon: 0 })
for (let tick = 10; tick < 14; tick++) timeline.addSnapshot({ tick, players: Array.from({ length: 16 }, (_, i) => playerAt(i + 1, tick)) }, 1000 + (tick - 10) * 100)

const cases = [
  ['player LOD planner, plan() over 64 remote players', () => planner.plan(entries, viewer, null)],
  ['player LOD renderer, tick() with fallback dots', () => lod.tick(entries, viewer, null, null)],
  ['player LOD renderer, tick() with server dots', () => lod.tick(entries, viewer, bucketDots, null)],
  ['vsync monitor, tick()', (i) => vsync.tick(frameStamps[i + 1], 4)],
  ['perf tracker, sample()', (i) => perf.sample(16 + (i % 3), renderInfo, PLAYERS, 10)],
  ['transform lerp, tickBatch() over 64 records', () => tickBatch(lerpState, lerpRecords, 0.5, 0.016)],
  ['crowd dots, decodeCrowdDotPoses() into a held buffer', () => decodeCrowdDotPoses(bucketDots, poseOptions, poses)],
  ['prediction engine, predict() and getRenderState()', (i) => {
    wall += 16
    mono += 16
    prediction.predict(forward)
    prediction.getRenderState(mono)
  }],
  ['snapshot timeline, sample()', (i) => timeline.sample(sampleTimes[(i % 50) + 1])],
]

const rows = []
for (const [name, tick] of cases) rows.push(await measure(name, tick))
observer.disconnect()
const outArg = process.argv.slice(2).find((arg) => arg.startsWith('--out='))
if (outArg) writeFileSync(outArg.slice(6), JSON.stringify(rows, null, 1) + '\n')
for (const row of rows) console.log(String(row.collections).padStart(5) + ' collections in ' + row.calls + ' calls, about ' + String(row.bytesPerCallEstimate).padStart(5) + ' bytes per call  ' + row.name)
for (const row of rows) {
  gate(row.name + ' runs ' + row.calls + ' calls with at most ' + COLLECTION_ALLOWANCE + ' garbage collection after warm-up', () => {
    assert.ok(row.collections <= COLLECTION_ALLOWANCE, row.collections + ' collections, about ' + row.bytesPerCallEstimate + ' bytes per call')
  })
}
finish()
