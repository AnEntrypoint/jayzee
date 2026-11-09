import { PerformanceObserver } from 'node:perf_hooks'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { Scene } from 'three'
import { gate, finish } from './lib/gate.mjs'
import { ClockSync } from '../src/client/ClockSync.js'
import { decodeCrowdDots } from '../src/client/crowdDots.js'
import { createCrowdDotRendererWebGL } from '../src/client/playerLodRenderer.js'
import { MessageHandler } from '../src/client/MessageHandler.js'
import { MSG, DISCONNECT_REASONS } from '../src/protocol/messages.js'
import { createBridge } from '../src/engine/bridge.js'
import { loadEngineModule } from '../src/engine/EngineWorld.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glue = pathToFileURL(join(root, 'engine/out/engine-core-64mib.mjs')).href
const DOTS = 64
const WARMUP_ITERATIONS = 2000
const MEASURED_ITERATIONS = 20000
const CONTROL_ITERATIONS = 1000000
const CLOCK_SAMPLES = 200000
const CLOCK_HEAP_GROWTH_LIMIT = 256 * 1024

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

const judgeGc = (kinds) => {
  assert.equal(kinds.length, 0, 'garbage collection ran in the measured window: ' + JSON.stringify(kinds))
}

const dots = Array.from({ length: DOTS }, (_, i) => [i % 8, Math.floor(i / 8), (i % 5) + 1])
const dotOptions = { viewerY: 0 }
const dotOut = []
const dotTick = () => decodeCrowdDots(dots, dotOptions, dotOut)
for (let i = 0; i < WARMUP_ITERATIONS; i++) dotTick()
await collectGc(() => {})
const reusedDots = await collectGc(() => {
  for (let i = 0; i < MEASURED_ITERATIONS; i++) dotTick()
})
const allocatingDots = await collectGc(() => {
  for (let i = 0; i < MEASURED_ITERATIONS; i++) decodeCrowdDots(dots, dotOptions)
})

gate('decodeCrowdDots with a reused out array runs with no garbage collection after warm-up', () => {
  judgeGc(reusedDots)
})

gate('decodeCrowdDots without out is seen as garbage collection', () => {
  assert.ok(allocatingDots.length > 0, 'the witness saw no garbage collection in the allocating control, so it cannot detect churn')
})

gate('decodeCrowdDots writes into the out array it is given and returns it', () => {
  const returned = decodeCrowdDots(dots, dotOptions, dotOut)
  assert.equal(returned, dotOut)
  assert.equal(dotOut.length, DOTS)
})

const lodRenderer = createCrowdDotRendererWebGL(new Scene(), {})
const lodTick = () => lodRenderer.update(dots, 0, null)
for (let i = 0; i < WARMUP_ITERATIONS; i++) lodTick()
await collectGc(() => {})
const reusedLod = await collectGc(() => {
  for (let i = 0; i < MEASURED_ITERATIONS; i++) lodTick()
})
const allocatingLod = await collectGc(() => {
  for (let i = 0; i < MEASURED_ITERATIONS; i++) lodRenderer.update(dots, 0, (x) => [x][0])
})

gate('the WebGL crowd-dot renderer updates its instances with no garbage collection after warm-up', () => {
  judgeGc(reusedLod)
})

gate('a ground function that allocates per dot is seen as garbage collection in the crowd-dot renderer', () => {
  assert.ok(allocatingLod.length > 0, 'the witness saw no garbage collection in the allocating control, so it cannot detect churn')
})

gate('the WebGL crowd-dot renderer sets one instance per dot', () => {
  lodRenderer.update(dots, 0, null)
  assert.equal(lodRenderer.instancedMesh.count, DOTS)
})

const handler = new MessageHandler({ now: () => 0, renderNow: () => 0, collisionMirror: false })
const snapshot = { tick: 1 }
const leave = { playerId: 7 }
const snapProc = { removePlayer() {} }
const handlerTick = () => {
  handler.handleMessage(MSG.SNAPSHOT, snapshot)
  handler.handleMessage(MSG.PLAYER_LEAVE, leave, snapProc)
}
for (let i = 0; i < WARMUP_ITERATIONS; i++) handlerTick()
await collectGc(() => {})
const reusedMessages = await collectGc(() => {
  for (let i = 0; i < MEASURED_ITERATIONS; i++) handlerTick()
})
const allocatingMessages = await collectGc(() => {
  for (let i = 0; i < CONTROL_ITERATIONS; i++) handler.handleMessage(MSG.DISCONNECT_REASON, { code: DISCONNECT_REASONS.INVALID_SESSION })
})

gate('handleMessage for a snapshot and a player leave runs with no garbage collection after warm-up', () => {
  judgeGc(reusedMessages)
})

gate('handleMessage for an invalid session allocates per call and is seen as garbage collection', () => {
  assert.ok(allocatingMessages.length > 0, 'the witness saw no garbage collection in the allocating control, so it cannot detect churn')
})

gate('handleMessage returns the snapshot payload it was given', () => {
  assert.equal(handler.handleMessage(MSG.SNAPSHOT, snapshot), snapshot)
})

gate('handleMessage reports an invalid session as invalidate', () => {
  assert.deepEqual(handler.handleMessage(MSG.DISCONNECT_REASON, { code: DISCONNECT_REASONS.INVALID_SESSION }), { invalidate: true })
})

const clock = new ClockSync({ maxSamples: 8 })
const feedClock = (count, base) => {
  for (let i = 0; i < count; i++) {
    const t0 = base + i * 10
    clock.addSample(t0, t0 + 5, t0 + 10, t0 + 4)
  }
}
feedClock(WARMUP_ITERATIONS, 0)
globalThis.gc()
const clockHeapBefore = process.memoryUsage().heapUsed
feedClock(CLOCK_SAMPLES, WARMUP_ITERATIONS * 10)
globalThis.gc()
const clockHeapGrowth = process.memoryUsage().heapUsed - clockHeapBefore

gate('ClockSync.addSample keeps the heap flat: 200000 samples after warm-up grow it by under 256 KiB', () => {
  assert.ok(clockHeapGrowth < CLOCK_HEAP_GROWTH_LIMIT, 'the heap grew by ' + clockHeapGrowth + ' bytes, so the retained samples are not bounded')
})

gate('ClockSync.addSample refuses a non-finite time and accepts a finite one', () => {
  assert.equal(clock.addSample(Number.NaN, 5, 10, 4), false)
  assert.equal(clock.addSample(0, 5, 10, 4), true)
})

const engine = await loadEngineModule(glue)
assert.equal(engine._engine_world_configure(4, 64, -18, 0.1, 0.35, 0.2, 8), 0)
assert.equal(engine._engine_spawn(0, 5, 0, 0, 0, 0), 0)
const bridge = createBridge(engine)
const bridgeTick = () => bridge.transform(0)
for (let i = 0; i < WARMUP_ITERATIONS; i++) bridgeTick()
await collectGc(() => {})
const reusedTransform = await collectGc(() => {
  for (let i = 0; i < MEASURED_ITERATIONS; i++) bridgeTick()
})
const allocatingTransform = await collectGc(() => {
  for (let i = 0; i < CONTROL_ITERATIONS; i++) new Float32Array(7)
})

gate('bridge.transform reads its cached view with no garbage collection after warm-up', () => {
  judgeGc(reusedTransform)
})

gate('bridge.transform returns the same view for a body on every call', () => {
  assert.equal(bridge.transform(0), bridge.transform(0))
})

gate('a typed array allocated per call is seen as garbage collection', () => {
  assert.ok(allocatingTransform.length > 0, 'the witness saw no garbage collection in the allocating control, so it cannot detect churn')
})

finish()
