import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { releaseWorld } from './lib/releaseWorld.mjs'
import { PLANET } from '../src/engine/sceneSetup.js'
import { createTickTimer, writeTickTrace } from './lib/tickTrace.mjs'
import { SCENARIO_TIERS } from './lib/scenarioTiers.mjs'
import { PLANET_LANDING, buildPlanetLanding } from './lib/scenarioWorlds.mjs'

const RADIUS = PLANET_LANDING.radius
const BODIES = PLANET_LANDING.bodies
const TICKS = PLANET_LANDING.ticks
const SINK_LIMIT_M = 0.05
const FLOAT_LIMIT_M = 1.0
const TIERS = SCENARIO_TIERS

const scenario = async (tier) => {
  const { world, handles } = await buildPlanetLanding(tier)
  const timer = createTickTimer()
  const tickMs = timer.tickMs
  for (let t = 0; t < TICKS; t++) {
    timer.start()
    world.step()
    timer.stop()
  }
  const gaps = new Float64Array(BODIES)
  const p = [0, 0, 0]
  handles.forEach((handle, i) => {
    world.position(handle, p)
    const distance = Math.hypot(p[0], p[1], p[2])
    const ground = world.height(p[0], p[1], p[2])
    gaps[i] = distance - PLANET.radius - ground - RADIUS
  })
  await releaseWorld(world)
  return { gaps, tickMs }
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
}

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  gate(tier.label + ': no sphere sinks into the planet surface (gap to the surface plus radius at least -' + SINK_LIMIT_M + ' m)', () => {
    for (let i = 0; i < BODIES; i++) assert.ok(first.gaps[i] >= -SINK_LIMIT_M, 'sphere ' + i + ' sank by ' + -first.gaps[i] + ' m')
  })
  gate(tier.label + ': every sphere comes to rest on the surface (gap at most ' + FLOAT_LIMIT_M + ' m)', () => {
    for (let i = 0; i < BODIES; i++) assert.ok(first.gaps[i] <= FLOAT_LIMIT_M, 'sphere ' + i + ' floats ' + first.gaps[i] + ' m above the surface')
  })
  gate(tier.label + ': two runs agree bit for bit on every landing gap', () => {
    assert.deepEqual(new Uint32Array(new Float32Array(second.gaps).buffer), new Uint32Array(new Float32Array(first.gaps).buffer))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, both runs)', () => {
    const trace = writeTickTrace('planet-landing', tier.label, [first.tickMs, second.tickMs])
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

finish()
