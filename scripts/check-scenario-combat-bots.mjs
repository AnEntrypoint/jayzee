import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { bodyPoolCapacity } from '../src/engine/poolPlan.js'
import { writeTickTrace } from './lib/tickTrace.mjs'
import { SCENARIO_TIERS, glueUrl } from './lib/scenarioTiers.mjs'
import { PLANET } from '../src/engine/sceneSetup.js'
import { createPoleTerrain } from './lib/polePages.mjs'

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
const DUEL_GAP_M = 12
const DUEL_TICKS = 150
const WALL_HEIGHT_M = 3
const WALL_HALF_THICKNESS_M = 0.25
const WALL_HALF_WIDTH_M = 3
const RIDGE_HEIGHT_M = 3
const RIDGE_HALF_WIDTH_M = 8 / 3
const TIERS = SCENARIO_TIERS

const sightLine = (world, origin, from, to, hit) => {
  const start = [from[0] + origin[0], from[1] + origin[1], from[2] + origin[2]]
  const aim = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  return world.raycast(start, aim, Math.hypot(aim[0], aim[1], aim[2]), hit) === null
}

const ridgeHeight = (alongU) => RIDGE_HEIGHT_M * Math.max(0, 1 - Math.abs(alongU) / RIDGE_HALF_WIDTH_M)

const duel = async (tier, obstacle) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const terrain = createPoleTerrain(world, PLANET, { cells: 1, heightOf: (alongU) => (obstacle === 'terrain' ? ridgeHeight(alongU) : 0) })
  const centreRadius = PLANET.radius + CHARACTER_RADIUS + CHARACTER_HALF_HEIGHT
  const origin = [0, centreRadius, 0]
  world.follow(origin)
  if (obstacle === 'wall') world.addBox([-WALL_HALF_THICKNESS_M, PLANET.radius - 1, -WALL_HALF_WIDTH_M, WALL_HALF_THICKNESS_M, PLANET.radius + WALL_HEIGHT_M, WALL_HALF_WIDTH_M])
  const duellists = [-1, 1].map((side) => ({ index: world.addCharacter({ position: terrain.point(side * DUEL_GAP_M / 2, 0, CHARACTER_RADIUS + CHARACTER_HALF_HEIGHT + 0.05), radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT }), health: MAX_HEALTH, cooldown: 0 }))
  const positions = duellists.map(() => [0, 0, 0])
  const hit = { distance: 0, position: [0, 0, 0], normal: [0, 0, 0], kind: 'none', handle: 0 }
  const blockers = new Set()
  let shots = 0
  let blocked = 0
  for (let t = 0; t < SETTLE_TICKS; t++) world.step()
  world.markWarmup()
  for (let t = 0; t < DUEL_TICKS; t++) {
    duellists.forEach((bot, i) => world.characterBodyPosition(bot.index, positions[i]))
    duellists.forEach((bot, i) => {
      const other = duellists[1 - i]
      if (bot.health <= 0 || other.health <= 0) return
      if (bot.cooldown > 0) bot.cooldown -= 1
      if (bot.cooldown !== 0) return
      bot.cooldown = FIRE_INTERVAL_TICKS
      if (sightLine(world, origin, positions[i], positions[1 - i], hit)) {
        other.health -= DAMAGE
        shots += 1
      } else {
        blocked += 1
        blockers.add(hit.kind)
      }
    })
    world.step()
  }
  return { health: duellists.map((bot) => bot.health), shots, blocked, blockers: [...blockers].sort(), gap: Math.hypot(...positions[0].map((v, a) => v - positions[1][a])), allocations: world.allocationsSinceWarmup() }
}

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
  const origin = [0, centreRadius, 0]
  const sight = { distance: 0, position: [0, 0, 0], normal: [0, 0, 0], kind: 'none', handle: 0 }
  let blockedShots = 0
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
      if (bot.cooldown === 0 && nearestDistance <= WEAPON_RANGE_M && !sightLine(world, origin, here, target, sight)) {
        blockedShots += 1
        bot.cooldown = FIRE_INTERVAL_TICKS
      }
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
  return { bots: bots.map((bot) => ({ health: bot.health, shotsFired: bot.shotsFired })), kills, radial, tickMs, finalPositions, ticks: tick, health, blockedShots }
}

const runs = new Map()
const duels = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
  duels.set(tier.label, { open: await duel(tier, 'none'), wall: await duel(tier, 'wall'), terrain: await duel(tier, 'terrain'), again: await duel(tier, 'wall') })
}

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  gate(tier.label + ': at least half of the bots are eliminated within the tick limit', () => {
    const dead = first.bots.filter((bot) => bot.health <= 0).length
    assert.ok(dead >= BOTS / 2, 'eliminated ' + dead + ' of ' + BOTS + ' in ' + first.ticks + ' ticks')
    assert.ok(first.kills.length === dead, 'kill log has ' + first.kills.length + ' entries for ' + dead + ' deaths')
  })
  gate(tier.label + ': every shot is tested by a ray cast, and on open ground no shot is blocked', () => {
    const fired = first.bots.reduce((sum, bot) => sum + bot.shotsFired, 0)
    assert.ok(fired > 0, 'no shot was fired')
    assert.equal(first.blockedShots, 0)
  })
  gate(tier.label + ': line of sight: two bots ' + DUEL_GAP_M + ' m apart kill each other on open ground, and the same shots are blocked by a wall between them and by a terrain ridge between them', () => {
    const { open, wall, terrain, again } = duels.get(tier.label)
    console.log('  ' + tier.label + ' duel: open ' + open.shots + ' hits, ' + open.blocked + ' blocked, health ' + open.health + '; wall ' + wall.shots + ' hits, ' + wall.blocked + ' blocked by ' + wall.blockers + ', health ' + wall.health + '; ridge ' + terrain.shots + ' hits, ' + terrain.blocked + ' blocked by ' + terrain.blockers + ', health ' + terrain.health)
    assert.ok(Math.abs(open.gap - DUEL_GAP_M) <= 0.1 && Math.abs(wall.gap - DUEL_GAP_M) <= 0.1 && Math.abs(terrain.gap - DUEL_GAP_M) <= 0.1, 'the duellists moved')
    assert.equal(open.blocked, 0)
    assert.ok(open.health.some((value) => value <= 0), 'the open duel left both alive: ' + open.health)
    assert.equal(wall.shots, 0)
    assert.ok(wall.blocked > 0, 'the wall blocked no shot')
    assert.deepEqual(wall.blockers, ['static'])
    assert.deepEqual(wall.health, [MAX_HEALTH, MAX_HEALTH])
    assert.equal(terrain.shots, 0)
    assert.ok(terrain.blocked > 0, 'the ridge blocked no shot')
    assert.deepEqual(terrain.blockers, ['planet'])
    assert.deepEqual(terrain.health, [MAX_HEALTH, MAX_HEALTH])
    assert.deepEqual(again, wall)
    assert.equal(open.allocations + wall.allocations + terrain.allocations, 0)
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
