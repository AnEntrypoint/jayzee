import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { bodyPoolCapacity } from '../src/engine/poolPlan.js'
import { writeTickTrace } from './lib/tickTrace.mjs'
import { PLANET } from '../src/engine/sceneSetup.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const CHARACTER_RADIUS = 0.4
const CHARACTER_HALF_HEIGHT = 0.6
const CHECKPOINT_ARC_M = [20, 40, 60]
const CHECKPOINT_RADIUS_M = 2.5
const RUN_SPEED_M_S = 6
const SETTLE_TICKS = 30
const FINISH_LIMIT_TICKS = 900
const RADIAL_TOLERANCE_M = 0.1
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '512 MiB threaded, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])

const scenario = async (tier) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const anchor = world.height(0, PLANET.radius, 0)
  const centreRadius = PLANET.radius + anchor + CHARACTER_RADIUS + CHARACTER_HALF_HEIGHT
  world.follow([0, centreRadius, 0])
  world.addCharacter({ position: [0, centreRadius + 0.5, 0], radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT })
  const planetCentre = [0, -centreRadius, 0]
  const checkpoints = CHECKPOINT_ARC_M.map((arc) => {
    const angle = arc / centreRadius
    return [centreRadius * Math.sin(angle), centreRadius * Math.cos(angle) - centreRadius, 0]
  })
  const body = [0, 0, 0]
  const tickMs = []
  const radial = []
  const supported = []
  const reached = []
  let next = 0
  let finishTick = null
  let tick = 0
  for (; tick < FINISH_LIMIT_TICKS && next < checkpoints.length; tick++) {
    world.characterBodyPosition(0, body)
    const up = [body[0] - planetCentre[0], body[1] - planetCentre[1], body[2] - planetCentre[2]]
    const upLength = Math.hypot(...up)
    const normal = up.map((v) => v / upLength)
    const target = checkpoints[next]
    const toTarget = [target[0] - body[0], target[1] - body[1], target[2] - body[2]]
    if (Math.hypot(...toTarget) <= CHECKPOINT_RADIUS_M) {
      reached.push(tick)
      next += 1
      if (next === checkpoints.length) finishTick = tick
      continue
    }
    const along = toTarget[0] * normal[0] + toTarget[1] * normal[1] + toTarget[2] * normal[2]
    const tangent = toTarget.map((v, i) => v - along * normal[i])
    const tangentLength = Math.hypot(...tangent)
    world.setCharacterVelocity(0, tangentLength > 0 ? tangent.map((v) => (v / tangentLength) * RUN_SPEED_M_S) : [0, 0, 0])
    const started = performance.now()
    world.step()
    tickMs.push(performance.now() - started)
    radial.push(upLength - centreRadius)
    supported.push(world.characterSupported(0))
  }
  world.characterBodyPosition(0, body)
  return { reached, finishTick, body: body.slice(), tickMs, radial, supported, ticks: tick }
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
}

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  gate(tier.label + ': the runner reaches all checkpoints in order within the tick limit', () => {
    assert.equal(first.reached.length, CHECKPOINT_ARC_M.length, 'reached ' + first.reached.length + ' of ' + CHECKPOINT_ARC_M.length + ' checkpoints')
    assert.ok(first.finishTick !== null && first.finishTick < FINISH_LIMIT_TICKS, 'finish tick ' + first.finishTick)
    for (let i = 1; i < first.reached.length; i++) assert.ok(first.reached[i] > first.reached[i - 1], 'checkpoints out of order')
  })
  gate(tier.label + ': the runner stays on the planet surface within tolerance once it has landed', () => {
    for (let i = SETTLE_TICKS; i < first.radial.length; i++) {
      assert.ok(Math.abs(first.radial[i]) <= RADIAL_TOLERANCE_M, 'tick ' + i + ' radial error ' + first.radial[i])
      assert.equal(first.supported[i], true, 'tick ' + i + ' is not supported')
    }
  })
  gate(tier.label + ': two runs agree bit for bit on the finish tick and the final runner position', () => {
    assert.equal(second.finishTick, first.finishTick)
    assert.deepEqual(new Uint32Array(new Float32Array(second.body).buffer), new Uint32Array(new Float32Array(first.body).buffer))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, both runs)', () => {
    const trace = writeTickTrace('deathrun', tier.label, [first.tickMs, second.tickMs])
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

finish()
