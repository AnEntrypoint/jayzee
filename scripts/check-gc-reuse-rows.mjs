import { PerformanceObserver } from 'node:perf_hooks'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { decodeCrowdDots } from '../src/client/crowdDots.js'
import { MessageHandler } from '../src/client/MessageHandler.js'
import { MSG, DISCONNECT_REASONS } from '../src/protocol/messages.js'

const DOTS = 64
const WARMUP_ITERATIONS = 2000
const MEASURED_ITERATIONS = 20000
const CONTROL_ITERATIONS = 1000000

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

finish()
