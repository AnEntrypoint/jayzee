import { PerformanceObserver } from 'node:perf_hooks'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { World } from '../src/world/World.js'

const BODIES = 64
const WARMUP_TICKS = 2000
const MEASURED_TICKS = 20000
const CONTROL_TICKS = 20000

const kindOf = (entry) => (entry.detail && entry.detail.kind !== undefined ? entry.detail.kind : entry.kind)

const collectGc = async (run) => {
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

export const judgeGc = (kinds) => {
  assert.equal(kinds.length, 0, 'garbage collection ran in the measured window: ' + JSON.stringify(kinds))
}

const world = new World()
for (let id = 0; id < BODIES; id++) world.spawn([id, 5, 0], [0, 0, 0])
const position = new Array(3).fill(0)
const velocity = new Array(3).fill(0)

const reusedTick = () => {
  world.step()
  for (let id = 0; id < BODIES; id++) {
    world.position(id, position)
    world.velocity(id, velocity)
  }
}

for (let i = 0; i < WARMUP_TICKS; i++) reusedTick()

const measured = await collectGc(() => {
  for (let i = 0; i < MEASURED_TICKS; i++) reusedTick()
})

gate('the reused step, position and velocity reads run with no garbage collection after warm-up', () => {
  judgeGc(measured)
})

const allocating = await collectGc(() => {
  for (let i = 0; i < CONTROL_TICKS; i++) {
    for (let id = 0; id < BODIES; id++) world.position(id)
  }
})

gate('the control loop that allocates per call is seen as garbage collection', () => {
  assert.ok(allocating.length > 0, 'the witness saw no garbage collection in the allocating control, so it cannot detect churn')
})

gate('judgeGc refuses any garbage collection entry', () => {
  assert.throws(() => judgeGc([1]), /garbage collection ran/)
  assert.throws(() => judgeGc([1, 2, 4]), /garbage collection ran/)
})

gate('judgeGc accepts an empty window', () => {
  assert.doesNotThrow(() => judgeGc([]))
})

finish()
