import { createEngineWorld } from '../../src/engine/EngineWorld.js'
import { PLANET } from '../../src/engine/sceneSetup.js'
import { glueUrl, tierWorldOptions } from './scenarioTiers.mjs'

const CHARACTER_RADIUS = 0.4
const CHARACTER_HALF_HEIGHT = 0.6
const FEET_TO_CENTRE_M = CHARACTER_RADIUS + CHARACTER_HALF_HEIGHT
const SPAWN_DROP_M = 0.5
const ROUTE_WORDS = 4
const ROUTE_LIMIT = 64
const POSITION_WORDS = 4
const FEET_HEIGHT = 3
const FALL_LIMIT = 8
const DETOUR = -1
const DECK_THICKNESS_M = 1

export const DEATHRUN_STATUS = Object.freeze({ running: 0, finished: 1, outOfRespawns: 2, tickLimit: 3 })

export const DEATHRUN = Object.freeze({
  checkpointArcM: Object.freeze([20, 40, 60]),
  checkpointRadiusM: 2.5,
  detourRadiusM: 0.5,
  runSpeedMS: 6,
  deckHeightM: 3,
  deckKillHeightM: 1.5,
  surfaceKillHeightM: -2,
  deckMinZ: -3,
  deckMaxZ: 7,
  bridgeMinZ: 5,
  bridgeZ: 6,
  livesPerSpawn: 2,
  tickLimit: 1800,
})

export const DEATHRUN_COURSES = Object.freeze({
  surface: Object.freeze({ deck: false, gap: null, bridge: false }),
  pit: Object.freeze({ deck: true, gap: Object.freeze([26, 32]), bridge: true }),
  'early-pit': Object.freeze({ deck: true, gap: Object.freeze([8, 14]), bridge: true }),
  'no-bridge': Object.freeze({ deck: true, gap: Object.freeze([26, 32]), bridge: false }),
})

const deckBoxes = (course, surface) => {
  if (!course.deck) return []
  const bottom = surface + DEATHRUN.deckHeightM - DECK_THICKNESS_M
  const top = surface + DEATHRUN.deckHeightM
  const boxes = [
    [-4, bottom, DEATHRUN.deckMinZ, course.gap[0], top, DEATHRUN.deckMaxZ],
    [course.gap[1], bottom, DEATHRUN.deckMinZ, 66, top, DEATHRUN.deckMaxZ],
  ]
  if (course.bridge) boxes.push([course.gap[0], bottom, DEATHRUN.bridgeMinZ, course.gap[1], top, DEATHRUN.deckMaxZ])
  return boxes
}

const pushRoute = (route, count, x, y, z, kind) => {
  const at = count * ROUTE_WORDS
  route[at] = x
  route[at + 1] = y
  route[at + 2] = z
  route[at + 3] = kind
  return count + 1
}

const pushLegs = (route, count, checkpoints, course, fromX, nextCheckpoint, avoidGap) => {
  let length = count
  let x = fromX
  for (let c = nextCheckpoint; c * 3 < checkpoints.length; c++) {
    const targetX = checkpoints[c * 3]
    if (avoidGap && x < course.gap[1] && targetX > course.gap[0]) {
      length = pushRoute(route, length, course.gap[0] - 1, checkpoints[c * 3 + 1], DEATHRUN.bridgeZ, DETOUR)
      length = pushRoute(route, length, course.gap[1] + 1, checkpoints[c * 3 + 1], DEATHRUN.bridgeZ, DETOUR)
    }
    length = pushRoute(route, length, targetX, checkpoints[c * 3 + 1], checkpoints[c * 3 + 2], c)
    x = targetX
  }
  return length
}

const readRunner = (r) => {
  const { read, frame, position, ground } = r
  r.world.characterBodyPosition(r.state.runner, read)
  position[0] = read[0] + frame[0]
  position[1] = read[1] + frame[1]
  position[2] = read[2] + frame[2]
  const up = position[1] + ground
  position[FEET_HEIGHT] = Math.sqrt(position[0] * position[0] + up * up + position[2] * position[2]) - ground - FEET_TO_CENTRE_M
}

const halt = (r, index) => {
  const command = r.command
  command[0] = 0
  command[1] = 0
  command[2] = 0
  r.world.setCharacterVelocity(index, command)
}

const respawn = (r) => {
  const { state, position, standbyUsed, lives } = r
  const spawn = state.lastCheckpoint + 1
  if (state.fallCount < FALL_LIMIT) {
    r.falls.set(position, state.fallCount * POSITION_WORDS)
    r.fallTick[state.fallCount] = state.tick
    r.respawnSpawn[state.fallCount] = spawn
  }
  state.fallCount += 1
  halt(r, state.runner)
  if (standbyUsed[spawn] >= lives) {
    state.status = DEATHRUN_STATUS.outOfRespawns
    return
  }
  state.runner = r.standby[spawn * lives + standbyUsed[spawn]]
  standbyUsed[spawn] += 1
  state.respawnCount += 1
  state.spawnedAtTick = state.tick
  state.routeBegin = r.respawnRouteBegin[spawn]
  state.routeEnd = r.respawnRouteBegin[spawn + 1]
  state.routeAt = state.routeBegin
  readRunner(r)
  if (state.respawnCount <= FALL_LIMIT) r.respawnAt.set(position, (state.respawnCount - 1) * POSITION_WORDS)
}

export const decideDeathrun = (r) => {
  const { state, route, position, command, ground } = r
  if (state.status !== DEATHRUN_STATUS.running) return false
  if (state.tick >= r.tickLimit) {
    state.status = DEATHRUN_STATUS.tickLimit
    return false
  }
  readRunner(r)
  if (position[FEET_HEIGHT] < r.killHeightM) {
    respawn(r)
    if (state.status !== DEATHRUN_STATUS.running) return false
  }
  const at = state.routeAt * ROUTE_WORDS
  const dx = route[at] - position[0]
  const dy = route[at + 1] - position[1]
  const dz = route[at + 2] - position[2]
  const kind = route[at + 3]
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= (kind === DETOUR ? DEATHRUN.detourRadiusM : DEATHRUN.checkpointRadiusM)) {
    state.routeAt += 1
    if (kind !== DETOUR) {
      if (r.reached[kind] < 0) r.reached[kind] = state.tick
      state.lastCheckpoint = kind
    }
    if (state.routeAt === state.routeEnd) {
      if (r.course.shuttle === true) {
        state.routeAt = state.routeBegin
        state.laps += 1
      } else {
        state.finishTick = state.tick
        state.status = DEATHRUN_STATUS.finished
      }
    }
    state.tick += 1
    return false
  }
  const ux = position[0]
  const uy = position[1] + ground
  const uz = position[2]
  const upLength = Math.sqrt(ux * ux + uy * uy + uz * uz)
  const along = (dx * ux + dy * uy + dz * uz) / upLength
  const px = dx - (along * ux) / upLength
  const py = dy - (along * uy) / upLength
  const pz = dz - (along * uz) / upLength
  const tangentLength = Math.sqrt(px * px + py * py + pz * pz)
  command[0] = tangentLength > 0 ? (px / tangentLength) * DEATHRUN.runSpeedMS : 0
  command[1] = tangentLength > 0 ? (py / tangentLength) * DEATHRUN.runSpeedMS : 0
  command[2] = tangentLength > 0 ? (pz / tangentLength) * DEATHRUN.runSpeedMS : 0
  r.world.setCharacterVelocity(state.runner, command)
  return true
}

export const recordDeathrun = (r) => {
  const state = r.state
  state.supported = r.world.characterSupported(state.runner)
  state.tick += 1
  state.steps += 1
}

export const advanceDeathrun = (r) => {
  if (!decideDeathrun(r)) return r.state.status === DEATHRUN_STATUS.running
  r.world.step()
  recordDeathrun(r)
  return true
}

export const createDeathrun = async (tier, courseName = 'surface', { tickLimit = DEATHRUN.tickLimit } = {}) => {
  const course = typeof courseName === 'string' ? DEATHRUN_COURSES[courseName] : courseName
  if (course === undefined) throw new RangeError('no deathrun course named ' + courseName)
  const surface = PLANET.radius
  const world = await createEngineWorld(tierWorldOptions(tier, { radius: 0.5, boxes: deckBoxes(course, surface) }), glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const ground = surface + world.height(0, PLANET.radius, 0)
  const floorM = course.deck ? DEATHRUN.deckHeightM : 0
  const standRadius = ground + floorM + FEET_TO_CENTRE_M
  world.follow([0, ground + FEET_TO_CENTRE_M, 0])

  const checkpointCount = DEATHRUN.checkpointArcM.length
  const spawnCount = checkpointCount
  const spawnPoints = new Float64Array(spawnCount * 3)
  const checkpoints = new Float64Array(checkpointCount * 3)
  for (let c = 0; c < checkpointCount; c++) {
    const angle = DEATHRUN.checkpointArcM[c] / standRadius
    checkpoints[c * 3] = standRadius * Math.sin(angle)
    checkpoints[c * 3 + 1] = standRadius * Math.cos(angle) - ground
    checkpoints[c * 3 + 2] = 0
  }
  spawnPoints[1] = standRadius - ground
  for (let s = 1; s < spawnCount; s++) {
    spawnPoints[s * 3] = checkpoints[(s - 1) * 3]
    spawnPoints[s * 3 + 1] = checkpoints[(s - 1) * 3 + 1]
    spawnPoints[s * 3 + 2] = checkpoints[(s - 1) * 3 + 2]
  }

  const route = new Float64Array(ROUTE_LIMIT * ROUTE_WORDS)
  const firstRouteEnd = pushLegs(route, 0, checkpoints, course, 0, 0, false)
  const respawnRouteBegin = new Int32Array(spawnCount + 1)
  let routeLength = firstRouteEnd
  for (let s = 0; s < spawnCount; s++) {
    respawnRouteBegin[s] = routeLength
    if (course.gap !== null) routeLength = pushLegs(route, routeLength, checkpoints, course, spawnPoints[s * 3], s, true)
  }
  respawnRouteBegin[spawnCount] = routeLength

  const addAt = (spawn) => world.addCharacter({ position: [spawnPoints[spawn * 3], spawnPoints[spawn * 3 + 1] + ground + SPAWN_DROP_M, spawnPoints[spawn * 3 + 2]], radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT })
  const read = [0, 0, 0]
  const firstRunner = addAt(0)
  world.characterBodyPosition(firstRunner, read)
  const frame = [spawnPoints[0] - read[0], spawnPoints[1] + SPAWN_DROP_M - read[1], spawnPoints[2] - read[2]]
  const lives = course.gap === null ? 0 : DEATHRUN.livesPerSpawn
  const standby = new Int32Array(spawnCount * Math.max(lives, 1)).fill(-1)
  for (let s = 0; s < spawnCount; s++) {
    for (let life = 0; life < lives; life++) standby[s * lives + life] = addAt(s)
  }

  const run = {
    world,
    course,
    ground,
    floorM,
    killHeightM: course.deck ? DEATHRUN.deckKillHeightM : DEATHRUN.surfaceKillHeightM,
    tickLimit,
    lives,
    read,
    frame,
    command: [0, 0, 0],
    position: new Float64Array(POSITION_WORDS),
    checkpoints,
    spawnPoints,
    standby,
    standbyUsed: new Int32Array(spawnCount),
    route,
    respawnRouteBegin,
    reached: new Int32Array(checkpointCount).fill(-1),
    falls: new Float64Array(FALL_LIMIT * POSITION_WORDS),
    fallTick: new Int32Array(FALL_LIMIT).fill(-1),
    respawnSpawn: new Int32Array(FALL_LIMIT).fill(-1),
    respawnAt: new Float64Array(FALL_LIMIT * POSITION_WORDS),
    state: {
      tick: 0,
      steps: 0,
      status: DEATHRUN_STATUS.running,
      runner: firstRunner,
      routeBegin: 0,
      routeEnd: firstRouteEnd,
      routeAt: 0,
      lastCheckpoint: -1,
      finishTick: -1,
      fallCount: 0,
      respawnCount: 0,
      laps: 0,
      supported: false,
      spawnedAtTick: 0,
    },
    get over() {
      return run.state.status !== DEATHRUN_STATUS.running
    },
    get feetHeightM() {
      return run.position[FEET_HEIGHT]
    },
    decide: () => decideDeathrun(run),
    step: () => world.step(),
    record: () => recordDeathrun(run),
    advance: () => advanceDeathrun(run),
  }
  return run
}
