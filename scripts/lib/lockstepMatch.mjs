import { createEngineWorld } from '../../src/engine/EngineWorld.js'
import { PLANET } from '../../src/engine/sceneSetup.js'
import { glueUrl, tierWorldOptions } from './scenarioTiers.mjs'
import { seededRandom } from './seededRandom.mjs'
import { FNV_OFFSET, fnvWordsInto } from './stateHash1024.mjs'

const CHARACTER_RADIUS = 0.4
const CHARACTER_HALF_HEIGHT = 0.6
const SQUADS = 2
const PER_SQUAD = 4
const UNITS = SQUADS * PER_SQUAD
const SPEED_M_S = 4
const SIGHT_M = 9
const ATTACK_M = 1.6
const SEPARATION_M = 1.1
const SEPARATION_GAIN = 6
const DAMAGE = 12
const ATTACK_COOLDOWN_TICKS = 36
const ENGINE_WORDS_PER_UNIT = 7
const NEVER = -1

export const LOCKSTEP = Object.freeze({ units: UNITS, squads: SQUADS, baseArcM: 12, maxHp: 100, inputDelay: 3, checkpointTicks: 30, matchTicks: 360, divergeIssueTick: 90, lateArrivalTick: 70 })

const BASE_ORDERS = Object.freeze([
  Object.freeze({ tick: 0, squad: 0, arc: LOCKSTEP.baseArcM }),
  Object.freeze({ tick: 0, squad: 1, arc: -LOCKSTEP.baseArcM }),
  Object.freeze({ tick: 60, squad: 0, arc: LOCKSTEP.baseArcM * 0.5 }),
])

const length3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z)

const onTime = (orders) => orders.map((order) => ({ ...order, arrives: order.tick }))

export const lockstepSchedule = (variant, seed = 1) => {
  if (variant === 'agreed') return onTime(BASE_ORDERS)
  if (variant === 'delayed') {
    const random = seededRandom(seed)
    return BASE_ORDERS.map((order) => ({ ...order, arrives: order.tick + Math.floor(random() * (LOCKSTEP.inputDelay + 1)) })).reverse()
  }
  if (variant === 'diverged') return onTime([...BASE_ORDERS, { tick: LOCKSTEP.divergeIssueTick, squad: 0, arc: 0 }])
  if (variant === 'dropped') return onTime(BASE_ORDERS.slice(0, 2))
  if (variant === 'reordered') return onTime([{ ...BASE_ORDERS[0], arc: BASE_ORDERS[2].arc }, BASE_ORDERS[1], { ...BASE_ORDERS[2], arc: BASE_ORDERS[0].arc }])
  if (variant === 'late') return BASE_ORDERS.map((order, at) => ({ ...order, arrives: at === 2 ? LOCKSTEP.lateArrivalTick : order.tick }))
  throw new RangeError('no lockstep schedule named ' + variant)
}

export const createLockstepMatch = async (tier, schedule) => {
  const world = await createEngineWorld(tierWorldOptions(tier, { radius: 0.5 }), glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const anchor = world.height(0, PLANET.radius, 0)
  const centreRadius = PLANET.radius + anchor + CHARACTER_RADIUS + CHARACTER_HALF_HEIGHT
  const squadOf = new Int32Array(UNITS)
  const index = new Int32Array(UNITS)
  const hp = new Int32Array(UNITS)
  const cooldown = new Int32Array(UNITS)
  for (let squad = 0; squad < SQUADS; squad++) {
    const angle = (squad === 0 ? -LOCKSTEP.baseArcM : LOCKSTEP.baseArcM) / centreRadius
    for (let k = 0; k < PER_SQUAD; k++) {
      const unit = squad * PER_SQUAD + k
      const lateral = (k - (PER_SQUAD - 1) / 2) * 1.2
      squadOf[unit] = squad
      hp[unit] = LOCKSTEP.maxHp
      index[unit] = world.addCharacter({ position: [centreRadius * Math.sin(angle), centreRadius * Math.cos(angle), lateral], radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT })
    }
  }
  world.follow([0, centreRadius, 0])

  const orderCount = schedule.length
  const orderTick = Int32Array.from(schedule, (order) => order.tick)
  const orderSquad = Int32Array.from(schedule, (order) => order.squad)
  const orderArc = Float64Array.from(schedule, (order) => order.arc)
  const orderArrives = Int32Array.from(schedule, (order) => order.arrives)
  const orderApplied = new Int32Array(orderCount).fill(NEVER)
  const squadArc = new Float64Array(SQUADS)
  const squadOrdered = new Uint8Array(SQUADS)
  const squadOrderTick = new Int32Array(SQUADS).fill(NEVER)
  const positions = new Float64Array(UNITS * 3)
  const read = [0, 0, 0]
  const command = [0, 0, 0]
  const engineFloats = new Float32Array(UNITS * ENGINE_WORDS_PER_UNIT + 1)
  const engineWords = new Uint32Array(engineFloats.buffer)
  const gameWords = new Uint32Array(UNITS * 2)
  const checkpointCount = Math.floor(LOCKSTEP.matchTicks / LOCKSTEP.checkpointTicks)
  const checkpointEngine = new Uint32Array(checkpointCount)
  const checkpointGame = new Uint32Array(checkpointCount)
  let tick = 0
  let checkpoints = 0

  const applyOrders = () => {
    for (let o = 0; o < orderCount; o++) {
      if (orderApplied[o] !== NEVER) continue
      const due = orderTick[o] + LOCKSTEP.inputDelay
      if (tick < due || tick < orderArrives[o]) continue
      const squad = orderSquad[o]
      orderApplied[o] = tick
      if (squadOrderTick[squad] > orderTick[o]) continue
      squadOrderTick[squad] = orderTick[o]
      squadArc[squad] = orderArc[o]
      squadOrdered[squad] = 1
    }
  }

  const readPositions = () => {
    for (let i = 0; i < UNITS; i++) {
      world.characterBodyPosition(index[i], read)
      positions[i * 3] = read[0]
      positions[i * 3 + 1] = read[1]
      positions[i * 3 + 2] = read[2]
    }
  }

  const distance = (i, j) => length3(positions[j * 3] - positions[i * 3], positions[j * 3 + 1] - positions[i * 3 + 1], positions[j * 3 + 2] - positions[i * 3 + 2])

  const halt = (i) => {
    command[0] = 0
    command[1] = 0
    command[2] = 0
    world.setCharacterVelocity(index[i], command)
  }

  const steer = (i) => {
    const hx = positions[i * 3]
    const hy = positions[i * 3 + 1]
    const hz = positions[i * 3 + 2]
    let enemy = -1
    let enemyDistance = Infinity
    for (let j = 0; j < UNITS; j++) {
      if (squadOf[j] === squadOf[i] || hp[j] <= 0) continue
      const d = distance(i, j)
      if (d < enemyDistance) {
        enemy = j
        enemyDistance = d
      }
    }
    let gx = 0
    let gy = 0
    let gz = 0
    if (enemy >= 0 && enemyDistance <= SIGHT_M) {
      gx = positions[enemy * 3]
      gy = positions[enemy * 3 + 1]
      gz = positions[enemy * 3 + 2]
    } else {
      const angle = (squadOrdered[squadOf[i]] === 1 ? squadArc[squadOf[i]] : 0) / centreRadius
      gx = centreRadius * Math.sin(angle)
      gy = centreRadius * Math.cos(angle) - centreRadius
    }
    let sx = 0
    let sy = 0
    let sz = 0
    for (let j = 0; j < UNITS; j++) {
      if (j === i || hp[j] <= 0) continue
      const d = distance(i, j)
      if (d < SEPARATION_M && d > 0) {
        const push = (SEPARATION_M - d) / SEPARATION_M
        sx += ((hx - positions[j * 3]) / d) * push
        sy += ((hy - positions[j * 3 + 1]) / d) * push
        sz += ((hz - positions[j * 3 + 2]) / d) * push
      }
    }
    const tx = gx - hx
    const ty = gy - hy
    const tz = gz - hz
    const ux = hx
    const uy = hy + centreRadius
    const uz = hz
    const upLength = length3(ux, uy, uz)
    const nx = ux / upLength
    const ny = uy / upLength
    const nz = uz / upLength
    const along = tx * nx + ty * ny + tz * nz
    const px = tx - along * nx
    const py = ty - along * ny
    const pz = tz - along * nz
    const tangentLength = length3(px, py, pz)
    const engaged = enemy >= 0 && enemyDistance <= ATTACK_M
    if (engaged) {
      halt(i)
    } else {
      command[0] = (tangentLength > 0 ? (px / tangentLength) * SPEED_M_S : 0) + SEPARATION_GAIN * sx
      command[1] = (tangentLength > 0 ? (py / tangentLength) * SPEED_M_S : 0) + SEPARATION_GAIN * sy
      command[2] = (tangentLength > 0 ? (pz / tangentLength) * SPEED_M_S : 0) + SEPARATION_GAIN * sz
      world.setCharacterVelocity(index[i], command)
    }
    if (cooldown[i] > 0) cooldown[i] -= 1
    if (engaged && cooldown[i] === 0) {
      hp[enemy] -= DAMAGE
      cooldown[i] = ATTACK_COOLDOWN_TICKS
    }
  }

  const decide = () => {
    applyOrders()
    readPositions()
    for (let i = 0; i < UNITS; i++) {
      if (hp[i] <= 0) halt(i)
      else steer(i)
    }
  }

  const engineState = () => {
    for (let i = 0; i < UNITS; i++) {
      const at = i * ENGINE_WORDS_PER_UNIT
      world.characterBodyPosition(index[i], read)
      engineFloats[at] = read[0]
      engineFloats[at + 1] = read[1]
      engineFloats[at + 2] = read[2]
      world.characterPosition(index[i], read)
      engineFloats[at + 3] = read[0]
      engineFloats[at + 4] = read[1]
      engineFloats[at + 5] = read[2]
      engineFloats[at + 6] = world.characterSupported(index[i]) ? 1 : 0
    }
    engineFloats[UNITS * ENGINE_WORDS_PER_UNIT] = world.controlTick
    return engineFloats
  }

  const hashScratch = new Uint32Array(1)
  const writeEngineHash = (out, at) => {
    engineState()
    fnvWordsInto(FNV_OFFSET, engineWords, out, at)
  }
  const engineHash = () => {
    writeEngineHash(hashScratch, 0)
    return hashScratch[0]
  }

  const writeGameHash = (out, at) => {
    for (let i = 0; i < UNITS; i++) {
      gameWords[i * 2] = hp[i]
      gameWords[i * 2 + 1] = cooldown[i]
    }
    fnvWordsInto(FNV_OFFSET, gameWords, out, at)
  }
  const gameHash = () => {
    writeGameHash(hashScratch, 0)
    return hashScratch[0]
  }

  const record = () => {
    tick += 1
    if (tick % LOCKSTEP.checkpointTicks !== 0 || checkpoints >= checkpointCount) return
    writeEngineHash(checkpointEngine, checkpoints)
    writeGameHash(checkpointGame, checkpoints)
    checkpoints += 1
  }

  const step = () => world.step()

  return {
    world,
    decide,
    step,
    record,
    advance() {
      decide()
      step()
      record()
    },
    engineState,
    engineHash,
    gameHash,
    hp,
    squadOf,
    positions,
    checkpointEngine,
    checkpointGame,
    get tick() {
      return tick
    },
    get checkpoints() {
      return checkpoints
    },
    applied: () => schedule.map((order, o) => ({ issued: order.tick, applied: orderApplied[o], squad: order.squad })),
  }
}
