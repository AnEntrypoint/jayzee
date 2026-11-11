import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { releaseWorld } from './lib/releaseWorld.mjs'
import { createTickTimer, writeTickTrace } from './lib/tickTrace.mjs'
import { SCENARIO_TIERS } from './lib/scenarioTiers.mjs'
import { SETTLE, buildSettle } from './lib/scenarioWorlds.mjs'

const BODIES = SETTLE.bodies
const RADIUS = SETTLE.radius
const TICKS = SETTLE.ticks
const SETTLE_WINDOW = 30
const DRIFT_LIMIT_M = 1e-3
const REST_TOLERANCE_M = 0.01
const TIERS = SCENARIO_TIERS

const scenario = async (tier) => {
  const { world, handles } = await buildSettle(tier)
  const trail = []
  const timer = createTickTimer()
  const tickMs = timer.tickMs
  const p = [0, 0, 0]
  for (let t = 0; t < TICKS; t++) {
    timer.start()
    world.step()
    timer.stop()
    if (t >= TICKS - SETTLE_WINDOW) {
      const frame = new Float64Array(BODIES * 3)
      handles.forEach((handle, i) => {
        world.position(handle, p)
        frame.set(p, i * 3)
      })
      trail.push(frame)
    }
  }
  await releaseWorld(world)
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
