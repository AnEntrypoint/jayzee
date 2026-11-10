import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { THREADS_BODIES, runThreadsScenario } from './lib/threadsScenario.mjs'
import { loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glueUrl = (name) => pathToFileURL(join(root, 'engine/out', name)).href
const FIXED = glueUrl('engine-core-64mib.mjs')
const THREADED = glueUrl('engine-core-64mib-threads.mjs')
const WORKERS = 4

const fixed = await runThreadsScenario(FIXED, 1)
const threadedA = await runThreadsScenario(THREADED, WORKERS)
const threadedB = await runThreadsScenario(THREADED, WORKERS)

gate('the threaded build has a shared heap, and the single-threaded build does not', async () => {
  const threaded = await loadEngineModule(THREADED, resolvePlan({ workers: WORKERS }))
  const single = await loadEngineModule(FIXED, resolvePlan({ workers: 1 }))
  assert.ok(threaded.HEAPU8.buffer instanceof SharedArrayBuffer, 'the threaded heap is not a SharedArrayBuffer')
  assert.ok(!(single.HEAPU8.buffer instanceof SharedArrayBuffer), 'the single-threaded heap is shared')
})

gate('the scenario reports every body after its ticks', () => {
  assert.equal(threadedA.length, THREADS_BODIES * 3)
  assert.equal(fixed.length, THREADS_BODIES * 3)
})

gate('the scenario moves bodies, so the agreement below is not an empty comparison', () => {
  assert.ok(new Set(fixed).size > 100, 'the bodies did not move')
})

gate('the threaded build gives the same positions on two runs', () => {
  assert.deepEqual(threadedA, threadedB)
})

gate('the threaded build agrees with the single-threaded build within 1 mm after 600 ticks', () => {
  let worst = 0
  for (let i = 0; i < fixed.length; i++) worst = Math.max(worst, Math.abs(fixed[i] - threadedA[i]))
  assert.ok(worst < 1e-3, 'the worst deviation is ' + worst + ' m')
})

finish()
