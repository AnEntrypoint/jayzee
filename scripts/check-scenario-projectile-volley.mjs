import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { releaseWorld } from './lib/releaseWorld.mjs'
import { createTickTimer, writeTickTrace } from './lib/tickTrace.mjs'
import { SCENARIO_TIERS } from './lib/scenarioTiers.mjs'
import { PROJECTILE_VOLLEY, buildProjectileVolley } from './lib/scenarioWorlds.mjs'

const RADIUS = PROJECTILE_VOLLEY.radius
const SHOTS = PROJECTILE_VOLLEY.shots
const SPEED = PROJECTILE_VOLLEY.speed
const LAUNCH_Y = PROJECTILE_VOLLEY.launchY
const WALL_X = PROJECTILE_VOLLEY.wallX
const TICKS = PROJECTILE_VOLLEY.ticks
const TRAJECTORY_TICKS = 40
const GRAVITY = PROJECTILE_VOLLEY.gravity
const TRAJECTORY_TOLERANCE_M = 0.15
const TIERS = SCENARIO_TIERS

const scenario = async (tier) => {
  const { world, handles } = await buildProjectileVolley(tier)
  const timer = createTickTimer()
  const tickMs = timer.tickMs
  const trajectory = []
  const p = [0, 0, 0]
  for (let t = 0; t < TICKS; t++) {
    timer.start()
    world.step()
    timer.stop()
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
  await releaseWorld(world)
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
