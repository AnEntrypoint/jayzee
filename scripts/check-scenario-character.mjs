import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { releaseWorld } from './lib/releaseWorld.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { bodyPoolCapacity } from '../src/engine/poolPlan.js'
import { createTickTimer, writeTickTrace } from './lib/tickTrace.mjs'
import { SCENARIO_TIERS, glueUrl } from './lib/scenarioTiers.mjs'
import { PLANET } from '../src/engine/sceneSetup.js'

const CHARACTER_RADIUS = 0.4
const CHARACTER_HALF_HEIGHT = 0.6
const STAND_TICKS = 180
const WALK_TICKS = 60
const WALK_SPEED_M_S = 1
const SETTLE_WINDOW = 30
const DRIFT_LIMIT_M = 1e-3
const REST_TOLERANCE_M = 0.05
const WALK_TOLERANCE_M = 0.05
const TIERS = SCENARIO_TIERS

const scenario = async (tier) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const anchor = world.height(0, PLANET.radius, 0)
  const restingDistance = PLANET.radius + anchor + CHARACTER_RADIUS + CHARACTER_HALF_HEIGHT
  world.addCharacter({ position: [0, restingDistance + 0.5, 0], radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT })
  world.follow([0, restingDistance, 0])
  const timer = createTickTimer()
  const tickMs = timer.tickMs
  const trail = []
  const p = [0, 0, 0]
  const step = () => {
    timer.start()
    world.step()
    timer.stop()
  }
  for (let t = 0; t < STAND_TICKS; t++) {
    step()
    if (t >= STAND_TICKS - SETTLE_WINDOW) trail.push(Array.from(world.characterPosition(0, p)))
  }
  const standing = Array.from(world.characterPosition(0, p))
  const supportedStanding = world.characterSupported(0)
  const startWalk = standing.slice()
  world.setCharacterVelocity(0, [WALK_SPEED_M_S, 0, 0])
  for (let t = 0; t < WALK_TICKS; t++) {
    step()
    world.setCharacterVelocity(0, [WALK_SPEED_M_S, 0, 0])
  }
  const walked = Array.from(world.characterPosition(0, p))
  const supportedWalking = world.characterSupported(0)
  await releaseWorld(world)
  return { standing, startWalk, walked, trail, restingDistance, supportedStanding, supportedWalking, tickMs }
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
}

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  gate(tier.label + ': the character is supported on the planet after it stands (the capsule dispatch is hit)', () => {
    assert.equal(first.supportedStanding, true, 'character is not supported')
    assert.equal(first.supportedWalking, true, 'character is not supported after walking')
  })
  gate(tier.label + ': the character rests on the surface at the capsule height within tolerance', () => {
    const distance = Math.hypot(...first.standing)
    assert.ok(Math.abs(distance - first.restingDistance) <= REST_TOLERANCE_M, 'centre rests at distance ' + distance + ' expected ' + first.restingDistance)
  })
  gate(tier.label + ': the standing character does not drift horizontally over the last 30 ticks', () => {
    const last = first.trail[first.trail.length - 1]
    const earliest = first.trail[0]
    for (const axis of [0, 2]) {
      const drift = Math.abs(last[axis] - earliest[axis])
      assert.ok(drift <= DRIFT_LIMIT_M, 'axis ' + axis + ' drifted ' + drift)
    }
  })
  gate(tier.label + ': the character walks the commanded distance over the walk ticks within tolerance', () => {
    const travelled = Math.hypot(first.walked[0] - first.startWalk[0], first.walked[2] - first.startWalk[2])
    const expected = WALK_SPEED_M_S * WALK_TICKS / 60
    assert.ok(Math.abs(travelled - expected) <= WALK_TOLERANCE_M, 'travelled ' + travelled + ' m, expected ' + expected + ' m')
  })
  gate(tier.label + ': two runs agree bit for bit on the final character position', () => {
    assert.deepEqual(new Uint32Array(new Float32Array(second.walked).buffer), new Uint32Array(new Float32Array(first.walked).buffer))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, both runs)', () => {
    const trace = writeTickTrace('character', tier.label, [first.tickMs, second.tickMs])
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

finish()
