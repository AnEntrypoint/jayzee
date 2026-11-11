import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { bodyPoolCapacity } from '../src/engine/poolPlan.js'
import { writeTickTrace } from './lib/tickTrace.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const RADIUS = 0.3
const COLUMNS = 16
const ROWS = 32
const BODIES = COLUMNS * ROWS
const TICKS = 600
const HALF = 6
const WALL = 0.5
const WALL_TOP = 4
const SPEED_LIMIT_MS = 0.5
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '1024 tier, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])
const BOWL = Object.freeze([
  [-HALF, -WALL, -HALF, HALF, 0, HALF],
  [-HALF - WALL, 0, -HALF - WALL, -HALF, WALL_TOP, HALF + WALL],
  [HALF, 0, -HALF - WALL, HALF + WALL, WALL_TOP, HALF + WALL],
  [-HALF - WALL, 0, -HALF - WALL, HALF + WALL, WALL_TOP, -HALF],
  [-HALF - WALL, 0, HALF, HALF + WALL, WALL_TOP, HALF + WALL],
])

const dropPoint = (i) => {
  const col = i % COLUMNS
  const row = Math.floor(i / COLUMNS)
  return [-5 + col * (10 / (COLUMNS - 1)), 8 + (i % 3) * 0.7, -5 + row * (10 / (ROWS - 1))]
}

const scenario = async (tier) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -9.8, drag: 0, radius: RADIUS, restitution: 0, boxes: BOWL, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  const handles = []
  for (let i = 0; i < BODIES; i++) handles.push(world.spawn(dropPoint(i)))
  const tickMs = []
  for (let t = 0; t < TICKS; t++) {
    const started = performance.now()
    world.step()
    tickMs.push(performance.now() - started)
  }
  const positions = new Float64Array(BODIES * 3)
  const speeds = new Float64Array(BODIES)
  const p = [0, 0, 0]
  const v = [0, 0, 0]
  handles.forEach((handle, i) => {
    world.position(handle, p)
    world.velocity(handle, v)
    positions.set(p, i * 3)
    speeds[i] = Math.hypot(v[0], v[1], v[2])
  })
  return { positions, speeds, tickMs }
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
}

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  gate(tier.label + ': all ' + BODIES + ' marbles stay inside the bowl walls and above the floor', () => {
    const limit = HALF - RADIUS + 0.05
    for (let i = 0; i < BODIES; i++) {
      const [x, y, z] = [first.positions[i * 3], first.positions[i * 3 + 1], first.positions[i * 3 + 2]]
      assert.ok(Math.abs(x) <= limit && Math.abs(z) <= limit, 'marble ' + i + ' left the bowl at ' + x + ',' + z)
      assert.ok(y >= -0.05, 'marble ' + i + ' fell through the floor at y ' + y)
    }
  })
  gate(tier.label + ': the pile settles, with the 90th-percentile marble speed under ' + SPEED_LIMIT_MS + ' m/s at tick ' + TICKS, () => {
    const sorted = Float64Array.from(first.speeds).sort()
    const p90 = sorted[Math.floor(sorted.length * 0.9)]
    assert.ok(p90 < SPEED_LIMIT_MS, 'p90 speed ' + p90 + ' m/s')
  })
  gate(tier.label + ': two runs agree bit for bit on every marble position', () => {
    assert.deepEqual(new Uint32Array(new Float32Array(second.positions).buffer), new Uint32Array(new Float32Array(first.positions).buffer))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, both runs)', () => {
    const trace = writeTickTrace('marble-bowl', tier.label, [first.tickMs, second.tickMs])
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

finish()
