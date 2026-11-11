import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { bodyPoolCapacity } from '../src/engine/poolPlan.js'
import { writeTickTrace } from './lib/tickTrace.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const RADIUS = 0.2
const SHOTS = 128
const SPEED = 40
const LAUNCH_Y = 6
const WALL_X = 40
const WALL_HALF_Z = 6
const WALL_TOP = 6
const TICKS = 120
const TRAJECTORY_TICKS = 40
const GRAVITY = 9.8
const TRAJECTORY_TOLERANCE_M = 0.15
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '1024 tier, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])
const BOXES = Object.freeze([
  [-2, -1, -20, 120, 0, 20],
  [WALL_X, 0, -WALL_HALF_Z, WALL_X + 1, WALL_TOP, WALL_HALF_Z],
])

const COLUMNS = 16
const launchPoint = (i) => [0, LAUNCH_Y + Math.floor(i / COLUMNS) * 0.5, -5.625 + (i % COLUMNS) * 0.75]

const scenario = async (tier) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -GRAVITY, drag: 0, radius: RADIUS, restitution: 0, boxes: BOXES, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  const handles = []
  for (let i = 0; i < SHOTS; i++) handles.push(world.spawn(launchPoint(i), [SPEED, 0, 0]))
  const tickMs = []
  const trajectory = []
  const p = [0, 0, 0]
  for (let t = 0; t < TICKS; t++) {
    const started = performance.now()
    world.step()
    tickMs.push(performance.now() - started)
    if (t < TRAJECTORY_TICKS) {
      world.position(handles[0], p)
      trajectory.push(p.slice())
    }
  }
  const finals = new Float64Array(SHOTS * 3)
  handles.forEach((handle, i) => {
    world.position(handle, p)
    finals.set(p, i * 3)
  })
  return { finals, trajectory, tickMs }
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
}

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  gate(tier.label + ': every shot reaches the wall face and none passes through', () => {
    for (let i = 0; i < SHOTS; i++) {
      const x = first.finals[i * 3]
      assert.ok(x <= WALL_X - RADIUS + 0.05, 'shot ' + i + ' passed the wall at x ' + x)
      assert.ok(x >= WALL_X - 2, 'shot ' + i + ' never reached the wall, stopped at x ' + x)
    }
  })
  gate(tier.label + ': the first shot follows the ballistic drop before contact, within ' + TRAJECTORY_TOLERANCE_M + ' m', () => {
    const dt = 1 / 60
    for (let t = 0; t < TRAJECTORY_TICKS; t++) {
      const elapsed = (t + 1) * dt
      const expectedY = LAUNCH_Y - 0.5 * GRAVITY * elapsed * elapsed
      const expectedX = SPEED * elapsed
      if (expectedX > WALL_X - RADIUS) break
      assert.ok(Math.abs(first.trajectory[t][1] - expectedY) <= TRAJECTORY_TOLERANCE_M, 'tick ' + t + ' y ' + first.trajectory[t][1] + ' against ' + expectedY)
      assert.ok(Math.abs(first.trajectory[t][0] - expectedX) <= TRAJECTORY_TOLERANCE_M, 'tick ' + t + ' x ' + first.trajectory[t][0] + ' against ' + expectedX)
    }
  })
  gate(tier.label + ': two runs agree bit for bit on every final shot position', () => {
    assert.deepEqual(new Uint32Array(new Float32Array(second.finals).buffer), new Uint32Array(new Float32Array(first.finals).buffer))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, both runs)', () => {
    const trace = writeTickTrace('projectile-volley', tier.label, [first.tickMs, second.tickMs])
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

finish()
