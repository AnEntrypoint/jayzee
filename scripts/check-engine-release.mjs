import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { glueUrl } from './lib/scenarioTiers.mjs'
import { loadEngineModule, releaseEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'

const MIB = 1024 * 1024
const THREADED = glueUrl('engine/out/engine-core-512mib-threads.mjs')
const FIXED = glueUrl('engine/out/engine-core-64mib.mjs')
const PLAN = { players: 1024, workers: 2, budgetBytes: 512 * MIB }
const INSTANCES = 3
const TICKS = 5
const SETTLE_MS = 50
const WRITTEN_FROM = 128 * MIB
const WRITTEN_MIB = 256

const settle = async () => {
  await new Promise((done) => setTimeout(done, SETTLE_MS))
  globalThis.gc()
  await new Promise((done) => setTimeout(done, SETTLE_MS))
  globalThis.gc()
}
const residentMb = () => process.memoryUsage().rss / MIB

const cycle = async (release) => {
  const refs = []
  const resident = []
  for (let i = 0; i < INSTANCES; i++) {
    let module = await loadEngineModule(THREADED, resolvePlan(PLAN))
    for (let t = 0; t < TICKS; t++) module._engine_tick(1)
    module.HEAPU8.fill(1, WRITTEN_FROM, WRITTEN_FROM + WRITTEN_MIB * MIB)
    refs.push(new WeakRef(module))
    await release(module)
    module = null
    await settle()
    resident.push(residentMb())
  }
  return { alive: refs.filter((ref) => ref.deref() !== undefined).length, resident }
}

if (typeof globalThis.gc !== 'function') throw new Error('run with node --expose-gc')
const freed = await cycle((module) => releaseEngineModule(module))
const kept = await cycle(async (module) => {
  const workers = [...module.PThread.runningWorkers, ...module.PThread.unusedWorkers]
  module.PThread.terminateAllThreads()
  await Promise.all(workers.map((worker) => worker.terminate()))
})
const threaded = await loadEngineModule(THREADED, resolvePlan(PLAN))
const threadedWorkers = await releaseEngineModule(threaded)
const fixed = await loadEngineModule(FIXED, resolvePlan({ players: 64, workers: 1, budgetBytes: 64 * MIB }))
const fixedWorkers = await releaseEngineModule(fixed)
console.log('resident MiB after each instance: released ' + freed.resident.map((mb) => mb.toFixed(0)).join(', ') + '; threads only terminated ' + kept.resident.map((mb) => mb.toFixed(0)).join(', '))

gate('control: a threaded instance whose threads are only terminated stays reachable, and each one adds the ' + WRITTEN_MIB + ' MiB it wrote', () => {
  assert.equal(kept.alive, INSTANCES)
  assert.ok(kept.resident[INSTANCES - 1] - kept.resident[0] > WRITTEN_MIB * (INSTANCES - 1) * 0.8, 'resident memory grew by ' + (kept.resident[INSTANCES - 1] - kept.resident[0]).toFixed(0) + ' MiB over ' + (INSTANCES - 1) + ' more instances')
})

gate('a released threaded instance is collected: none stays reachable and the later instances add under half of what one wrote', () => {
  assert.equal(freed.alive, 0)
  assert.ok(freed.resident[INSTANCES - 1] - freed.resident[0] < WRITTEN_MIB / 2, 'resident memory grew by ' + (freed.resident[INSTANCES - 1] - freed.resident[0]).toFixed(0) + ' MiB')
})

gate('release reports the workers it ended, and a fixed instance has none', () => {
  assert.ok(threadedWorkers >= PLAN.workers, 'ended ' + threadedWorkers + ' workers')
  assert.equal(fixedWorkers, 0)
})

finish()
