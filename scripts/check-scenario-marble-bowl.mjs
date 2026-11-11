import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { createTickTimer, writeTickTrace } from './lib/tickTrace.mjs'
import { SCENARIO_TIERS } from './lib/scenarioTiers.mjs'
import { MARBLE_BOWL, buildMarbleBowl } from './lib/scenarioWorlds.mjs'

const RADIUS = MARBLE_BOWL.radius
const BODIES = MARBLE_BOWL.bodies
const TICKS = MARBLE_BOWL.ticks
const HALF = MARBLE_BOWL.half
const SPEED_LIMIT_MS = 0.5
const TIERS = SCENARIO_TIERS

const scenario = async (tier) => {
  const { world, handles } = await buildMarbleBowl(tier)
  const timer = createTickTimer()
  const tickMs = timer.tickMs
  for (let t = 0; t < TICKS; t++) {
    timer.start()
    world.step()
    timer.stop()
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
