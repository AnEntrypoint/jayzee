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
const BOTS = 8
const RING_ARC_M = 10
const MAX_HEALTH = 100
const DAMAGE = 20
const FIRE_INTERVAL_TICKS = 15
const WEAPON_RANGE_M = 40
const STOP_DISTANCE_M = 8
const MOVE_SPEED_M_S = 3.5
const SETTLE_TICKS = 60
const TICK_LIMIT = 2400
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
  const theta = RING_ARC_M / centreRadius
  const bots = []
  for (let k = 0; k < BOTS; k++) {
    const phi = (2 * Math.PI * k) / BOTS
    const at = [centreRadius * Math.sin(theta) * Math.cos(phi), centreRadius * Math.cos(theta), centreRadius * Math.sin(theta) * Math.sin(phi)]
  world.follow([0, centreRadius, 0])
    bots.push({ index: world.addCharacter({ position: at, radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT }), health: MAX_HEALTH, cooldown: 0, shotsFired: 0 })
  }
  const planetCentre = [0, -centreRadius, 0]
  const body = [0, 0, 0]
  const positions = bots.map(() => [0, 0, 0])
  const tickMs = []
  const radial = []
  const supported = []
  const health = []
  const kills = []
  let tick = 0
  for (; tick < TICK_LIMIT; tick++) {
    bots.forEach((bot, i) => world.characterBodyPosition(bot.index, positions[i]))
    const alive = bots.filter((bot) => bot.health > 0)
    if (alive.length <= 1) break
    for (const bot of bots) {
      if (bot.health <= 0) {
        world.setCharacterVelocity(bot.index, [0, 0, 0])
        continue
      }
      const here = positions[bots.indexOf(bot)]
      let nearest = null
      let nearestDistance = Infinity
      for (const other of bots) {
        if (other === bot || other.health <= 0) continue
        const d = Math.hypot(...positions[bots.indexOf(other)].map((v, a) => v - here[a]))
        if (d < nearestDistance) {
          nearest = other
          nearestDistance = d
        }
      }
      if (nearest === null) {
        world.setCharacterVelocity(bot.index, [0, 0, 0])
        continue
      }
      const target = positions[bots.indexOf(nearest)]
      const up = [here[0] - planetCentre[0], here[1] - planetCentre[1], here[2] - planetCentre[2]]
      const upLength = Math.hypot(...up)
      const normal = up.map((v) => v / upLength)
      const toTarget = [target[0] - here[0], target[1] - here[1], target[2] - here[2]]
      const along = toTarget[0] * normal[0] + toTarget[1] * normal[1] + toTarget[2] * normal[2]
      const tangent = toTarget.map((v, a) => v - along * normal[a])
      const tangentLength = Math.hypot(...tangent)
      if (nearestDistance > STOP_DISTANCE_M && tangentLength > 0) {
        world.setCharacterVelocity(bot.index, tangent.map((v) => (v / tangentLength) * MOVE_SPEED_M_S))
      } else {
        world.setCharacterVelocity(bot.index, [0, 0, 0])
      }
      if (bot.cooldown > 0) bot.cooldown -= 1
      if (bot.cooldown === 0 && nearestDistance <= WEAPON_RANGE_M) {
        nearest.health -= DAMAGE
        bot.shotsFired += 1
        bot.cooldown = FIRE_INTERVAL_TICKS
        if (nearest.health <= 0) kills.push({ tick, killer: bots.indexOf(bot), victim: bots.indexOf(nearest) })
      }
    }
    const started = performance.now()
    world.step()
    tickMs.push(performance.now() - started)
    bots.forEach((bot, i) => {
      world.characterBodyPosition(bot.index, body)
      if (bot.health > 0) {
        const r = Math.hypot(body[0] - planetCentre[0], body[1] - planetCentre[1], body[2] - planetCentre[2])
        radial.push({ tick, bot: i, error: r - centreRadius, supported: world.characterSupported(bot.index) })
      }
    })
    health.push(bots.map((bot) => bot.health))
  }
  const finalPositions = []
  for (const bot of bots) {
    world.characterBodyPosition(bot.index, body)
    finalPositions.push(...body)
  }
  return { bots: bots.map((bot) => ({ health: bot.health, shotsFired: bot.shotsFired })), kills, radial, tickMs, finalPositions, ticks: tick, health }
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
}

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  gate(tier.label + ': at least half of the bots are eliminated within the tick limit', () => {
    const dead = first.bots.filter((bot) => bot.health <= 0).length
    assert.ok(dead >= BOTS / 2, 'eliminated ' + dead + ' of ' + BOTS + ' in ' + first.ticks + ' ticks')
    assert.ok(first.kills.length === dead, 'kill log has ' + first.kills.length + ' entries for ' + dead + ' deaths')
  })
  gate(tier.label + ': the living bots stay on the planet surface within tolerance and supported after the settle window', () => {
    for (const sample of first.radial) {
      if (sample.tick < SETTLE_TICKS) continue
      assert.ok(Math.abs(sample.error) <= RADIAL_TOLERANCE_M, 'tick ' + sample.tick + ' bot ' + sample.bot + ' radial error ' + sample.error)
      assert.equal(sample.supported, true, 'tick ' + sample.tick + ' bot ' + sample.bot + ' is not supported')
    }
  })
  gate(tier.label + ': two runs agree bit for bit on every health value and the final positions', () => {
    assert.equal(second.ticks, first.ticks)
    assert.deepEqual(new Uint32Array(new Float32Array(second.health.flat()).buffer), new Uint32Array(new Float32Array(first.health.flat()).buffer))
    assert.deepEqual(new Uint32Array(new Float32Array(second.finalPositions).buffer), new Uint32Array(new Float32Array(first.finalPositions).buffer))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, both runs)', () => {
    const trace = writeTickTrace('combat-bots', tier.label, [first.tickMs, second.tickMs])
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

finish()
