import { enforceMovementEnvelope } from '../anticheat/InputGuard.js'
import {
  CROUCH_WIRE_BIT,
  DEFAULT_TICK_RATE_HZ,
  INPUT_BUFFER_CATCHUP_DEPTH,
  MAX_CATCHUP_STEPS_PER_TICK,
  PHYSICS_MAX_ACCUM_DT,
  PHYSICS_PLAYER_DIVISOR,
  STARVE_HOLD_SECONDS,
  SWIMMING_WIRE_BIT,
} from './constants.js'
import { accrueStepBudget, neutralInput, sequenceGapAhead, takeNextInput, waitForSequenceGap } from './inputSequence.js'

const defaultClock = () => performance.now()

let lastYaw = NaN
let lastSinHalf = 0
let lastCosHalf = 1

export function buildMovementDeps({
  tickRate = DEFAULT_TICK_RATE_HZ,
  playerManager,
  physicsIntegration,
  lagCompensator,
  networkState,
  applyMovement,
  defaultMovement = {},
  movementOverrides = {},
  stepTeleportHold,
  eventLog = null,
  transformRingWriter = null,
  clock = defaultClock,
}) {
  return {
    playerManager,
    physicsIntegration,
    lagCompensator,
    networkState,
    applyMovement,
    movement: { ...defaultMovement, ...movementOverrides },
    stepTeleportHold,
    eventLog,
    transformRingWriter: transformRingWriter || null,
    starveHoldTicks: Math.max(1, Math.round(tickRate * STARVE_HOLD_SECONDS)),
    tickMs: 1000 / tickRate,
    clock,
  }
}

export function createMovementState() {
  return { playerIdleCounts: new Map(), playerAccumDt: new Map() }
}

export function snapshotMovementState(state) {
  return { playerIdleCounts: new Map(state.playerIdleCounts), playerAccumDt: new Map(state.playerAccumDt) }
}

export function restoreMovementState(state, snapshot) {
  if (!snapshot) return
  state.playerIdleCounts.clear()
  for (const [id, count] of snapshot.playerIdleCounts) state.playerIdleCounts.set(id, count)
  state.playerAccumDt.clear()
  for (const [id, dt] of snapshot.playerAccumDt) state.playerAccumDt.set(id, dt)
}

export function stepPlayerMovement(player, deps, tick, dt, playerIdleCounts, playerAccumDt) {
  const { playerManager, physicsIntegration, applyMovement, movement, stepTeleportHold } = deps
  const st = player.state
  const inp = player.lastInput || null
  if (inp) {
    const yaw = inp.yaw || 0
    if (yaw !== lastYaw) {
      const half = yaw / 2
      lastSinHalf = Math.sin(half)
      lastCosHalf = Math.cos(half)
      lastYaw = yaw
    }
    st.rotation[0] = 0
    st.rotation[1] = lastSinHalf
    st.rotation[2] = 0
    st.rotation[3] = lastCosHalf
    st.crouch = inp.crouch ? 1 : 0
    st.lookPitch = inp.pitch || 0
    st.lookYaw = yaw
    st.expr = inp.expr || 0
  }
  if (player.teleportHold && stepTeleportHold(player, physicsIntegration)) {
    playerIdleCounts.delete(player.id)
    playerAccumDt.delete(player.id)
    return
  }
  applyMovement(st, inp, movement, dt, playerManager.getMovementOverride?.(player.id) || null)
  if (inp) physicsIntegration.setCrouch(player.id, !!inp.crouch)
  const wishedVx = st.velocity[0]
  const wishedVz = st.velocity[2]
  const hasInput = inp && (inp.forward || inp.backward || inp.left || inp.right || inp.jump)
  const atRest = wishedVx * wishedVx + wishedVz * wishedVz < 1e-4
  const isIdle = !hasInput && st.onGround && atRest
  const idleCount = playerIdleCounts.get(player.id) || 0
  if (isIdle && idleCount >= 1) {
    playerIdleCounts.set(player.id, idleCount + 1)
    playerAccumDt.delete(player.id)
    return
  }
  const accumDt = Math.min(PHYSICS_MAX_ACCUM_DT, (playerAccumDt.get(player.id) || 0) + dt)
  if (hasInput || !atRest || !st.onGround || (tick + player.id) % PHYSICS_PLAYER_DIVISOR === 0) {
    physicsIntegration.updatePlayerPhysics(player.id, st, accumDt)
    st.velocity[0] = wishedVx
    st.velocity[2] = wishedVz
    playerAccumDt.delete(player.id)
  } else {
    playerAccumDt.set(player.id, accumDt)
  }
  playerIdleCounts.set(player.id, isIdle ? idleCount + 1 : 0)
}

export function recordPlayerTick(player, deps, tick) {
  const { lagCompensator, networkState, movement, eventLog, transformRingWriter } = deps
  const st = player.state
  if (enforceMovementEnvelope(st, movement)) {
    eventLog?.record('anticheat_envelope_clamp', { playerId: player.id, position: [...st.position] }, { actor: player.id, reason: 'movement_envelope' })
  }
  lagCompensator.recordPlayerPosition(player.id, st.position, st.rotation, st.velocity, tick)
  const crouchFlags = (st.crouch ? CROUCH_WIRE_BIT : 0) | (st.swimming ? SWIMMING_WIRE_BIT : 0)
  networkState.updatePlayer(player.id, st.position, st.rotation, st.velocity, st.onGround, st.health, player.ackSequence ?? player.inputSequence, crouchFlags, st.lookPitch || 0, st.lookYaw || 0, st.expr || 0, st.weapon || 0, player.inputBufferDepth || 0, st.groundNormal || null, st.wallNormals || null)
  if (transformRingWriter) transformRingWriter.write(player.id, st.position, st.rotation, st.velocity)
}

export function processPlayerMovement(players, deps, tick, dt, playerIdleCounts, playerAccumDt, explicitInputs = null) {
  const { playerManager, clock = defaultClock } = deps
  for (const player of players) {
    const inputs = playerManager.getInputs(player.id)
    if (explicitInputs) {
      player.lastInput = explicitInputs.get(player.id) ?? null
      stepPlayerMovement(player, deps, tick, dt, playerIdleCounts, playerAccumDt)
      recordPlayerTick(player, deps, tick)
      continue
    }
    let holdForInput = false
    if (inputs.length > 0 && !waitForSequenceGap(player, inputs)) {
      takeNextInput(player, inputs)
      player.starvedTicks = 0
    } else if (player.hasSentInput) {
      player.inputStarves = (player.inputStarves || 0) + 1
      player.starvedTicks = (player.starvedTicks || 0) + 1
      holdForInput = player.starvedTicks <= deps.starveHoldTicks
      if (!holdForInput && player.lastInput) player.lastInput = neutralInput(player.lastInput)
    }
    if (!holdForInput) stepPlayerMovement(player, deps, tick, dt, playerIdleCounts, playerAccumDt)
    accrueStepBudget(player, deps.tickMs, holdForInput ? 0 : 1, clock())
    let extra = 0
    while (inputs.length > INPUT_BUFFER_CATCHUP_DEPTH && extra < MAX_CATCHUP_STEPS_PER_TICK && player.inputStepBudget >= 1 && !sequenceGapAhead(player, inputs)) {
      takeNextInput(player, inputs)
      player.inputStepBudget -= 1
      player.inputCatchUps = (player.inputCatchUps || 0) + 1
      stepPlayerMovement(player, deps, tick, dt, playerIdleCounts, playerAccumDt)
      extra++
    }
    player.inputBufferDepth = inputs.length
    recordPlayerTick(player, deps, tick)
  }
}
