import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import {
  CLOCK_CALLS_IN_WINDOW, CLOCK_CALLS_TOTAL, CLOCK_MAIN_CALLS_IN_WINDOW, CLOCK_MAIN_HOOKS, CLOCK_WINDOW_OPEN, CLOCK_WORKER_HOOKS, clockCounters,
} from './lib/clockCount.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glueUrl = (name) => pathToFileURL(join(root, 'engine/out', name)).href
const FIXED = glueUrl('engine-core-512mib.mjs')
const THREADED = glueUrl('engine-core-512mib-threads.mjs')
const ISLANDS_PER_SIDE = 10
const ISLANDS = ISLANDS_PER_SIDE * ISLANDS_PER_SIDE
const BODIES_PER_ISLAND = 12
const BODIES = ISLANDS * BODIES_PER_ISLAND
const ISLAND_SPACING_M = 12
const TICKS = 300
const AGREEMENT_M = 1e-3
const WORLD = Object.freeze({ capacity: 2048, tickRate: 60, gravity: -9.8, drag: 0.1, radius: 0.35, restitution: 0.2, iterations: 8, players: 64, budgetBytes: 512 * 1024 * 1024 })

const counters = clockCounters()
assert.ok(counters && performance.now.clockCounted === true, 'run as: node --import ./scripts/lib/clockCount.mjs scripts/check-engine-job-wait.mjs')

const openWindow = () => Atomics.store(counters, CLOCK_WINDOW_OPEN, 1)
const closeWindow = () => Atomics.store(counters, CLOCK_WINDOW_OPEN, 0)
const inWindow = () => Atomics.load(counters, CLOCK_CALLS_IN_WINDOW)

const spawnIslands = (world) => {
  const handles = []
  for (let island = 0; island < ISLANDS; island++) {
    const cx = ((island % ISLANDS_PER_SIDE) - ISLANDS_PER_SIDE / 2) * ISLAND_SPACING_M
    const cz = (Math.floor(island / ISLANDS_PER_SIDE) - ISLANDS_PER_SIDE / 2) * ISLAND_SPACING_M
    for (let k = 0; k < BODIES_PER_ISLAND; k++) {
      const ring = k % 6
      const layer = Math.floor(k / 6)
      const angle = (ring / 6) * 2 * Math.PI + island * 0.37
      handles.push(world.spawn(
        [cx + Math.cos(angle) * 0.9, 1 + layer * 0.9 + ring * 0.05, cz + Math.sin(angle) * 0.9],
        [-Math.cos(angle) * 1.5, 0, -Math.sin(angle) * 1.5],
      ))
    }
  }
  return handles
}

const run = async (glue, workers) => {
  const hooksBefore = Atomics.load(counters, CLOCK_WORKER_HOOKS)
  const world = await createEngineWorld({ ...WORLD, workers }, glue)
  const handles = spawnIslands(world)
  const callsBefore = inWindow()
  const started = process.hrtime.bigint()
  openWindow()
  for (let t = 0; t < TICKS; t++) world.step()
  closeWindow()
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6
  const positions = []
  const p = [0, 0, 0]
  for (const handle of handles) {
    world.position(handle, p)
    positions.push(p[0], p[1], p[2])
  }
  return { workers, positions, clockCalls: inWindow() - callsBefore, workerHooks: Atomics.load(counters, CLOCK_WORKER_HOOKS) - hooksBefore, wallMs, hash: world.hash() }
}

const worstGap = (a, b) => {
  let worst = 0
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]))
  return worst
}

const fixed = await run(FIXED, 1)
const twoA = await run(THREADED, 2)
const twoB = await run(THREADED, 2)
const fourA = await run(THREADED, 4)
const fourB = await run(THREADED, 4)
const runs = [fixed, twoA, twoB, fourA, fourB]

for (const r of runs) {
  console.log('INFO ' + (r === fixed ? 'fixed build' : 'threaded build') + ', ' + r.workers + ' worker' + (r.workers === 1 ? '' : 's') + ': ' + TICKS + ' ticks of ' + BODIES + ' bodies in ' + ISLANDS + ' piles, ' + r.wallMs.toFixed(1) + ' ms wall, ' + (r.wallMs / TICKS).toFixed(3) + ' ms per tick, ' + r.clockCalls + ' clock calls in the ticks, ' + r.workerHooks + ' worker threads started with the clock counter, state hash ' + r.hash)
}
console.log('INFO worst gap to the fixed build: ' + worstGap(fixed.positions, twoA.positions) + ' m with 2 workers, ' + worstGap(fixed.positions, fourA.positions) + ' m with 4 workers; 2 workers to 4 workers: ' + worstGap(twoA.positions, fourA.positions) + ' m')

gate('the clock counter is installed on the main thread and in every worker thread the threaded build starts', () => {
  assert.equal(Atomics.load(counters, CLOCK_MAIN_HOOKS), 1)
  assert.equal(fixed.workerHooks, 0, 'the fixed build started worker threads')
  for (const r of [twoA, twoB, fourA, fourB]) assert.ok(r.workerHooks >= r.workers - 1, r.workers + ' workers started ' + r.workerHooks + ' counted threads; run with node --import ./scripts/lib/clockCount.mjs so each worker thread loads the counter')
})

gate('control: a clock read on the main thread inside an open window is counted, and one outside it is not', () => {
  const before = inWindow()
  const mainBefore = Atomics.load(counters, CLOCK_MAIN_CALLS_IN_WINDOW)
  const totalBefore = Atomics.load(counters, CLOCK_CALLS_TOTAL)
  performance.now()
  assert.equal(inWindow(), before)
  openWindow()
  performance.now()
  performance.now()
  closeWindow()
  assert.equal(inWindow() - before, 2)
  assert.equal(Atomics.load(counters, CLOCK_MAIN_CALLS_IN_WINDOW) - mainBefore, 2)
  assert.equal(Atomics.load(counters, CLOCK_CALLS_TOTAL) - totalBefore, 3)
})

gate('every run completes its ' + TICKS + ' ticks and reports ' + BODIES + ' bodies', () => {
  for (const r of runs) {
    assert.equal(r.positions.length, BODIES * 3)
    assert.ok(r.positions.every(Number.isFinite), 'a position is not finite')
  }
})

gate('the piles collide and move, so the agreement below is not an empty comparison', () => {
  assert.ok(new Set(fixed.positions).size > BODIES, 'the bodies did not move apart')
  const restingHeights = fixed.positions.filter((_, i) => i % 3 === 1).filter((y) => y < 1).length
  assert.ok(restingHeights > BODIES / 2, 'only ' + restingHeights + ' bodies came down')
})

gate('the threaded build with 2 workers gives the same positions and state hash on two runs, bit for bit', () => {
  assert.deepEqual(twoA.positions, twoB.positions)
  assert.equal(twoA.hash, twoB.hash)
})

gate('the threaded build with 4 workers gives the same positions and state hash on two runs, bit for bit', () => {
  assert.deepEqual(fourA.positions, fourB.positions)
  assert.equal(fourA.hash, fourB.hash)
})

gate('the threaded build agrees with the fixed build within 1 mm after ' + TICKS + ' ticks, with 2 workers and with 4', () => {
  assert.ok(worstGap(fixed.positions, twoA.positions) < AGREEMENT_M, 'worst gap with 2 workers is ' + worstGap(fixed.positions, twoA.positions) + ' m')
  assert.ok(worstGap(fixed.positions, fourA.positions) < AGREEMENT_M, 'worst gap with 4 workers is ' + worstGap(fixed.positions, fourA.positions) + ' m')
})

gate('no thread reads performance.now during the ticks of any run, fixed or threaded', () => {
  for (const r of runs) assert.equal(r.clockCalls, 0, r.workers + ' workers read the clock ' + r.clockCalls + ' times')
})

finish()
