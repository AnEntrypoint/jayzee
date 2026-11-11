import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { bodyPoolCapacity } from '../src/engine/poolPlan.js'
import { writeTickTrace } from './lib/tickTrace.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const BODIES = 256
const RADIUS = 0.5
const TICKS = 240
const SETTLE_WINDOW = 30
const DRIFT_LIMIT_M = 1e-3
const REST_TOLERANCE_M = 0.01
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '512 MiB threaded, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])

const scenario = async (tier) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -9.8, drag: 0, radius: RADIUS, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  const handles = []
  for (let i = 0; i < BODIES; i++) {
    handles.push(world.spawn([(i % 16) * 2 - 15, 2 + (i % 7) * 0.6, Math.floor(i / 16) * 2 - 15]))
  }
  const trail = []
  const tickMs = []
  const p = [0, 0, 0]
  for (let t = 0; t < TICKS; t++) {
    const started = performance.now()
    world.step()
    tickMs.push(performance.now() - started)
    if (t >= TICKS - SETTLE_WINDOW) {
      const frame = new Float64Array(BODIES * 3)
      handles.forEach((handle, i) => {
        world.position(handle, p)
        frame.set(p, i * 3)
      })
      trail.push(frame)
    }
  }
  return { trail, finalPositions: Array.from(trail[trail.length - 1]), tickMs }
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
}

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  gate(tier.label + ': the 256 bodies settle at the ground radius within tolerance', () => {
    for (let i = 0; i < BODIES; i++) {
      const y = first.finalPositions[i * 3 + 1]
      assert.ok(Math.abs(y - RADIUS) <= REST_TOLERANCE_M, 'body ' + i + ' rests at y ' + y)
    }
  })
  gate(tier.label + ': the settled bodies do not drift horizontally over the last 30 ticks', () => {
    const last = first.trail[first.trail.length - 1]
    const earliest = first.trail[0]
    for (let i = 0; i < BODIES; i++) {
      for (const axis of [0, 2]) {
        const drift = Math.abs(last[i * 3 + axis] - earliest[i * 3 + axis])
        assert.ok(drift <= DRIFT_LIMIT_M, 'body ' + i + ' axis ' + axis + ' drifted ' + drift)
      }
    }
  })
  gate(tier.label + ': two runs agree bit for bit on every settled position', () => {
    assert.deepEqual(new Uint32Array(new Float32Array(second.finalPositions).buffer), new Uint32Array(new Float32Array(first.finalPositions).buffer))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, both runs)', () => {
    const trace = writeTickTrace('settle', tier.label, [first.tickMs, second.tickMs])
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

finish()
