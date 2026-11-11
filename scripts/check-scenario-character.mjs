import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { PLANET } from '../src/engine/sceneSetup.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const CHARACTER_RADIUS = 0.4
const CHARACTER_HALF_HEIGHT = 0.6
const STAND_TICKS = 180
const WALK_TICKS = 60
const WALK_SPEED_M_S = 1
const SETTLE_WINDOW = 30
const DRIFT_LIMIT_M = 1e-3
const REST_TOLERANCE_M = 0.05
const WALK_TOLERANCE_M = 0.05
const TICK_BUDGET_MS = 16.7
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '512 MiB threaded, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])

const scenario = async (tier) => {
  const world = await createEngineWorld({ capacity: 8, tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const anchor = world.height(0, PLANET.radius, 0)
  const restingDistance = PLANET.radius + anchor + CHARACTER_RADIUS + CHARACTER_HALF_HEIGHT
  world.addCharacter({ position: [0, restingDistance + 0.5, 0], radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT })
  world.follow([0, restingDistance, 0])
  const tickMs = []
  const trail = []
  const p = [0, 0, 0]
  const step = () => {
    const started = performance.now()
    world.step()
    tickMs.push(performance.now() - started)
  }
  for (let t = 0; t < STAND_TICKS; t++) {
    step()
    if (t >= STAND_TICKS - SETTLE_WINDOW) trail.push(Array.from(world.characterPosition(p)))
  }
  const standing = Array.from(world.characterPosition(p))
  const supportedStanding = world.characterSupported()
  const startWalk = standing.slice()
  world.setCharacterVelocity([WALK_SPEED_M_S, 0, 0])
  for (let t = 0; t < WALK_TICKS; t++) {
    step()
    world.setCharacterVelocity([WALK_SPEED_M_S, 0, 0])
  }
  const walked = Array.from(world.characterPosition(p))
  const supportedWalking = world.characterSupported()
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
  gate(tier.label + ': the worst tick work time is within the 16.7 ms budget (measured inside the step call, both runs)', () => {
    const worst = Math.max(...first.tickMs, ...second.tickMs)
    assert.ok(worst <= TICK_BUDGET_MS, 'worst tick work ' + worst.toFixed(2) + ' ms')
  })
}

finish()
