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
const BOSS_ARC_M = 30
const BOSS_HEALTH = 200
const BOSS_SPEED_M_S = 5
const BOSS_CHASE_M = 50
const BOSS_STOP_M = 8
const BOSS_ATTACK_DAMAGE = 25
const BOSS_ATTACK_INTERVAL_TICKS = 120
const PLAYER_HEALTH = 100
const PLAYER_DAMAGE = 15
const PLAYER_RANGE_M = 30
const PLAYER_FIRE_INTERVAL_TICKS = 30
const SETTLE_TICKS = 60
const TICK_LIMIT = 1800
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
  const surfaceAt = (arc) => {
    const angle = arc / centreRadius
    return [centreRadius * Math.sin(angle), centreRadius * Math.cos(angle), 0]
  }
  const boss = { index: world.addCharacter({ position: surfaceAt(BOSS_ARC_M), radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT }), health: BOSS_HEALTH, cooldown: 0 }
  const player = { index: world.addCharacter({ position: surfaceAt(0), radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT }), health: PLAYER_HEALTH, cooldown: 0 }
  world.follow([0, centreRadius, 0])
  const planetCentre = [0, -centreRadius, 0]
  const bossBody = [0, 0, 0]
  const playerBody = [0, 0, 0]
  const tickMs = []
  const radial = []
  const bossHealth = []
  let closest = Infinity
  let tick = 0
  for (; tick < TICK_LIMIT; tick++) {
    world.characterBodyPosition(boss.index, bossBody)
    world.characterBodyPosition(player.index, playerBody)
    if (boss.health <= 0 || player.health <= 0) break
    const distance = Math.hypot(...bossBody.map((v, a) => v - playerBody[a]))
    closest = Math.min(closest, distance)
    if (distance <= PLAYER_RANGE_M && player.cooldown === 0) {
      boss.health -= PLAYER_DAMAGE
      player.cooldown = PLAYER_FIRE_INTERVAL_TICKS
    }
    if (player.cooldown > 0) player.cooldown -= 1
    if (distance <= BOSS_STOP_M) {
      world.setCharacterVelocity(boss.index, [0, 0, 0])
      if (boss.cooldown === 0) {
        player.health -= BOSS_ATTACK_DAMAGE
        boss.cooldown = BOSS_ATTACK_INTERVAL_TICKS
      }
    } else if (distance < BOSS_CHASE_M) {
      const up = [bossBody[0] - planetCentre[0], bossBody[1] - planetCentre[1], bossBody[2] - planetCentre[2]]
      const upLength = Math.hypot(...up)
      const normal = up.map((v) => v / upLength)
      const toPlayer = playerBody.map((v, a) => v - bossBody[a])
      const along = toPlayer[0] * normal[0] + toPlayer[1] * normal[1] + toPlayer[2] * normal[2]
      const tangent = toPlayer.map((v, a) => v - along * normal[a])
      const tangentLength = Math.hypot(...tangent)
      world.setCharacterVelocity(boss.index, tangentLength > 0 ? tangent.map((v) => (v / tangentLength) * BOSS_SPEED_M_S) : [0, 0, 0])
    } else {
      world.setCharacterVelocity(boss.index, [0, 0, 0])
    }
    if (boss.cooldown > 0) boss.cooldown -= 1
    world.setCharacterVelocity(player.index, [0, 0, 0])
    const started = performance.now()
    world.step()
    tickMs.push(performance.now() - started)
    world.characterBodyPosition(boss.index, bossBody)
    const r = Math.hypot(bossBody[0] - planetCentre[0], bossBody[1] - planetCentre[1], bossBody[2] - planetCentre[2])
    radial.push({ tick, error: r - centreRadius, supported: world.characterSupported(boss.index) })
    bossHealth.push(boss.health)
  }
  world.characterBodyPosition(boss.index, bossBody)
  world.characterBodyPosition(player.index, playerBody)
  return { boss: { health: boss.health }, player: { health: player.health }, closest, tick, radial, bossHealth, tickMs, final: [...bossBody, ...playerBody] }
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
}

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  gate(tier.label + ': the boss is defeated within the tick limit and the player survives', () => {
    assert.ok(first.boss.health <= 0, 'boss health ' + first.boss.health + ' after ' + first.tick + ' ticks')
    assert.ok(first.player.health > 0, 'player health ' + first.player.health)
  })
  gate(tier.label + ': the boss closes to its attack range before it dies (the chase and attack phases ran)', () => {
    assert.ok(first.closest <= BOSS_STOP_M, 'closest approach ' + first.closest + ' m')
  })
  gate(tier.label + ': the boss stays on the planet surface within tolerance and supported after the settle window', () => {
    for (const sample of first.radial) {
      if (sample.tick < SETTLE_TICKS) continue
      assert.ok(Math.abs(sample.error) <= RADIAL_TOLERANCE_M, 'tick ' + sample.tick + ' radial error ' + sample.error)
      assert.equal(sample.supported, true, 'tick ' + sample.tick + ' is not supported')
    }
  })
  gate(tier.label + ': two runs agree bit for bit on the boss health trail and the final positions', () => {
    assert.equal(second.tick, first.tick)
    assert.deepEqual(second.bossHealth, first.bossHealth)
    assert.deepEqual(new Uint32Array(new Float32Array(second.final).buffer), new Uint32Array(new Float32Array(first.final).buffer))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, both runs)', () => {
    const trace = writeTickTrace('boss-fight', tier.label, [first.tickMs, second.tickMs])
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

finish()
