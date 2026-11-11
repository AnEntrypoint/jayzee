import { createEngineWorld } from '../../src/engine/EngineWorld.js'
import { PLANET } from '../../src/engine/sceneSetup.js'
import { glueUrl, tierWorldOptions } from './scenarioTiers.mjs'
import { seededRandom } from './seededRandom.mjs'

const CHARACTER_RADIUS = 0.4
const CHARACTER_HALF_HEIGHT = 0.6
const TICK_SECONDS = 1 / 60
const SHOT_WORDS = 7
const SHOT_POOL = 8
const WAYPOINTS = 16
const BOSS = 0
const PLAYER = 1

export const BOSS_FIGHT = Object.freeze({
  bossArcM: 30,
  bossHealth: 200,
  bossSpeedMS: 5,
  bossChaseM: 50,
  bossStopM: 8,
  bossAttackDamage: 25,
  bossAttackIntervalTicks: 120,
  playerHealth: 100,
  playerDamage: 15,
  playerRangeM: 30,
  playerFireIntervalTicks: 30,
  playerSpeedMS: 2.5,
  waypointMinArcM: 4,
  waypointMaxArcM: 12,
  waypointReachM: 1,
  waypointHoldTicks: 360,
  shotSpeedMS: 60,
  shotHitRadiusM: 0.6,
  tickLimit: 1800,
})

const ROLE_SPEED_M_S = Float64Array.of(BOSS_FIGHT.bossSpeedMS, BOSS_FIGHT.playerSpeedMS)

const steer = (r, role, from, target, at) => {
  const ux = from[0]
  const uy = from[1] + r.centreRadius
  const uz = from[2]
  const upLength = Math.sqrt(ux * ux + uy * uy + uz * uz)
  const nx = ux / upLength
  const ny = uy / upLength
  const nz = uz / upLength
  const dx = target[at] - from[0]
  const dy = target[at + 1] - from[1]
  const dz = target[at + 2] - from[2]
  const along = dx * nx + dy * ny + dz * nz
  const px = dx - along * nx
  const py = dy - along * ny
  const pz = dz - along * nz
  const tangentLength = Math.sqrt(px * px + py * py + pz * pz)
  const command = r.command
  const speed = ROLE_SPEED_M_S[role]
  command[0] = tangentLength > 0 ? (px / tangentLength) * speed : 0
  command[1] = tangentLength > 0 ? (py / tangentLength) * speed : 0
  command[2] = tangentLength > 0 ? (pz / tangentLength) * speed : 0
  r.world.setCharacterVelocity(r.characters[role], command)
}

const halt = (r, role) => {
  const command = r.command
  command[0] = 0
  command[1] = 0
  command[2] = 0
  r.world.setCharacterVelocity(r.characters[role], command)
}

const flyShots = (r) => {
  const { state, shots, shotLive, bossBody } = r
  const travel = r.shotSpeedMS * TICK_SECONDS
  for (let s = 0; s < SHOT_POOL; s++) {
    if (shotLive[s] === 0) continue
    const at = s * SHOT_WORDS
    const rx = bossBody[0] - shots[at]
    const ry = bossBody[1] - shots[at + 1]
    const rz = bossBody[2] - shots[at + 2]
    const along = Math.min(travel, Math.max(0, rx * shots[at + 3] + ry * shots[at + 4] + rz * shots[at + 5]))
    const mx = rx - along * shots[at + 3]
    const my = ry - along * shots[at + 4]
    const mz = rz - along * shots[at + 5]
    const miss = Math.sqrt(mx * mx + my * my + mz * mz)
    if (miss <= BOSS_FIGHT.shotHitRadiusM) {
      shotLive[s] = 0
      state.shotsHit += 1
      if (miss > state.worstHitM) state.worstHitM = miss
      state.bossHealth -= BOSS_FIGHT.playerDamage
      continue
    }
    shots[at] += shots[at + 3] * travel
    shots[at + 1] += shots[at + 4] * travel
    shots[at + 2] += shots[at + 5] * travel
    shots[at + 6] += travel
    if (shots[at + 6] > BOSS_FIGHT.playerRangeM + BOSS_FIGHT.bossStopM) {
      shotLive[s] = 0
      state.shotsMissed += 1
    }
  }
}

const movePlayer = (r) => {
  const { state, waypoints, playerBody } = r
  if (!r.moving) {
    halt(r, PLAYER)
    return
  }
  const at = state.waypoint * 3
  const gx = waypoints[at] - playerBody[0]
  const gy = waypoints[at + 1] - playerBody[1]
  const gz = waypoints[at + 2] - playerBody[2]
  const gap = Math.sqrt(gx * gx + gy * gy + gz * gz)
  state.waypointTicks += 1
  if (gap <= BOSS_FIGHT.waypointReachM || state.waypointTicks >= BOSS_FIGHT.waypointHoldTicks) {
    if (gap <= BOSS_FIGHT.waypointReachM) state.waypointsReached += 1
    state.waypoint = (state.waypoint + 1) % WAYPOINTS
    state.waypointTicks = 0
  }
  const next = state.waypoint * 3
  steer(r, PLAYER, playerBody, waypoints, next)
}

export const decideBossFight = (r) => {
  const { state, world, bossBody, playerBody, bossBefore, characters } = r
  world.characterBodyPosition(characters[BOSS], bossBody)
  world.characterBodyPosition(characters[PLAYER], playerBody)
  if (state.tick === 0) {
    bossBefore[0] = bossBody[0]
    bossBefore[1] = bossBody[1]
    bossBefore[2] = bossBody[2]
  }
  if (state.bossHealth <= 0 || state.playerHealth <= 0 || state.tick >= r.tickLimit) {
    state.over = true
    return false
  }
  const sx = bossBody[0] - playerBody[0]
  const sy = bossBody[1] - playerBody[1]
  const sz = bossBody[2] - playerBody[2]
  const distance = Math.sqrt(sx * sx + sy * sy + sz * sz)
  if (distance < state.closest) state.closest = distance
  if (distance <= BOSS_FIGHT.playerRangeM && state.playerCooldown === 0) {
    if (r.moving) {
      const { shots, shotLive, shotSpeedMS } = r
      let slot = -1
      for (let s = 0; s < SHOT_POOL; s++) {
        if (shotLive[s] === 0) {
          slot = s
          break
        }
      }
      if (slot < 0) {
        state.shotsDropped += 1
      } else {
        const vx = (bossBody[0] - bossBefore[0]) / TICK_SECONDS
        const vy = (bossBody[1] - bossBefore[1]) / TICK_SECONDS
        const vz = (bossBody[2] - bossBefore[2]) / TICK_SECONDS
        let ax = sx
        let ay = sy
        let az = sz
        for (let pass = 0; pass < 3; pass++) {
          const flight = Math.sqrt(ax * ax + ay * ay + az * az) / shotSpeedMS
          ax = sx + vx * flight
          ay = sy + vy * flight
          az = sz + vz * flight
        }
        const aimLength = Math.sqrt(ax * ax + ay * ay + az * az)
        const at = slot * SHOT_WORDS
        shots[at] = playerBody[0]
        shots[at + 1] = playerBody[1]
        shots[at + 2] = playerBody[2]
        shots[at + 3] = ax / aimLength
        shots[at + 4] = ay / aimLength
        shots[at + 5] = az / aimLength
        shots[at + 6] = 0
        shotLive[slot] = 1
        state.shotsFired += 1
      }
    } else {
      state.bossHealth -= BOSS_FIGHT.playerDamage
      state.shotsFired += 1
      state.shotsHit += 1
    }
    state.playerCooldown = BOSS_FIGHT.playerFireIntervalTicks
  }
  if (state.playerCooldown > 0) state.playerCooldown -= 1
  if (distance <= BOSS_FIGHT.bossStopM) {
    halt(r, BOSS)
    if (state.bossCooldown === 0) {
      state.playerHealth -= BOSS_FIGHT.bossAttackDamage
      state.bossAttacks += 1
      state.bossCooldown = BOSS_FIGHT.bossAttackIntervalTicks
    }
  } else if (distance < BOSS_FIGHT.bossChaseM) {
    steer(r, BOSS, bossBody, playerBody, 0)
  } else {
    halt(r, BOSS)
  }
  if (state.bossCooldown > 0) state.bossCooldown -= 1
  movePlayer(r)
  return true
}

export const recordBossFight = (r) => {
  const { state, world, bossBody, playerBody, bossBefore, centreRadius } = r
  const px = playerBody[0]
  const py = playerBody[1]
  const pz = playerBody[2]
  bossBefore[0] = bossBody[0]
  bossBefore[1] = bossBody[1]
  bossBefore[2] = bossBody[2]
  world.characterBodyPosition(r.characters[BOSS], bossBody)
  world.characterBodyPosition(r.characters[PLAYER], playerBody)
  const wx = playerBody[0] - px
  const wy = playerBody[1] - py
  const wz = playerBody[2] - pz
  const bossUp = bossBody[1] + centreRadius
  const playerUp = playerBody[1] + centreRadius
  state.playerPathM += Math.sqrt(wx * wx + wy * wy + wz * wz)
  state.bossRadialError = Math.sqrt(bossBody[0] * bossBody[0] + bossUp * bossUp + bossBody[2] * bossBody[2]) - centreRadius
  state.playerRadialError = Math.sqrt(playerBody[0] * playerBody[0] + playerUp * playerUp + playerBody[2] * playerBody[2]) - centreRadius
  state.bossSupported = world.characterSupported(r.characters[BOSS])
  state.playerSupported = world.characterSupported(r.characters[PLAYER])
  if (r.moving) flyShots(r)
  state.tick += 1
}

export const advanceBossFight = (r) => {
  if (!decideBossFight(r)) return false
  r.world.step()
  recordBossFight(r)
  return true
}

export const createBossFight = async (tier, { moving = false, seed = 1, shotSpeedMS = BOSS_FIGHT.shotSpeedMS, bossHealth = BOSS_FIGHT.bossHealth, playerHealth = BOSS_FIGHT.playerHealth, tickLimit = BOSS_FIGHT.tickLimit } = {}) => {
  const world = await createEngineWorld(tierWorldOptions(tier, { radius: 0.5 }), glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const anchor = world.height(0, PLANET.radius, 0)
  const centreRadius = PLANET.radius + anchor + CHARACTER_RADIUS + CHARACTER_HALF_HEIGHT
  const bossAngle = BOSS_FIGHT.bossArcM / centreRadius
  world.follow([0, centreRadius, 0])
  const boss = world.addCharacter({ position: [centreRadius * Math.sin(bossAngle), centreRadius * Math.cos(bossAngle), 0], radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT })
  const player = world.addCharacter({ position: [0, centreRadius, 0], radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT })
  const random = seededRandom(seed)
  const waypoints = new Float64Array(WAYPOINTS * 3)
  for (let w = 0; w < WAYPOINTS; w++) {
    const angle = (BOSS_FIGHT.waypointMinArcM + random() * (BOSS_FIGHT.waypointMaxArcM - BOSS_FIGHT.waypointMinArcM)) / centreRadius
    const bearing = random() * 2 * Math.PI
    waypoints[w * 3] = centreRadius * Math.sin(angle) * Math.cos(bearing)
    waypoints[w * 3 + 1] = centreRadius * Math.cos(angle) - centreRadius
    waypoints[w * 3 + 2] = centreRadius * Math.sin(angle) * Math.sin(bearing)
  }
  const state = {
    tick: 0,
    over: false,
    bossHealth,
    playerHealth,
    bossCooldown: 0,
    playerCooldown: 0,
    closest: Infinity,
    bossAttacks: 0,
    shotsFired: 0,
    shotsHit: 0,
    shotsMissed: 0,
    shotsDropped: 0,
    worstHitM: 0,
    waypoint: 0,
    waypointsReached: 0,
    waypointTicks: 0,
    playerPathM: 0,
    bossRadialError: 0,
    playerRadialError: 0,
    bossSupported: false,
    playerSupported: false,
  }
  const fight = {
    world,
    state,
    centreRadius,
    characters: Int32Array.of(boss, player),
    moving,
    shotSpeedMS,
    tickLimit,
    waypoints,
    bossBody: [0, 0, 0],
    playerBody: [0, 0, 0],
    bossBefore: [0, 0, 0],
    command: [0, 0, 0],
    shots: new Float64Array(SHOT_POOL * SHOT_WORDS),
    shotLive: new Uint8Array(SHOT_POOL),
    decide: () => decideBossFight(fight),
    step: () => world.step(),
    record: () => recordBossFight(fight),
    advance: () => advanceBossFight(fight),
  }
  return fight
}
