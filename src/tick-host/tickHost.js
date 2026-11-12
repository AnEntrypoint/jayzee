import { clearInputBucket, isInputRateLimited, sanitizeInputPayload } from '../anticheat/InputGuard.js'
import { MSG } from '../protocol/messages.js'
import { pack } from '../protocol/msgpack.js'
import { PlayerManager } from '../netcode/playerManager.js'
import { NetworkState } from '../netcode/networkState.js'
import { LagCompensator } from '../netcode/lagCompensation.js'
import { PhysicsIntegration } from '../netcode/PhysicsIntegration.js'
import { applyPlayerCollisions } from '../netcode/playerCollisions.js'
import { newRecordMemo, packSnapshotBytes } from '../netcode/SnapshotPacker.js'
import { applyMovement, DEFAULT_MOVEMENT } from '../motion-pure/movement.js'
import { beginTeleportHold, stepTeleportHold, TELEPORT_HOLD_MAX_MS } from '../sessions-pure/teleportHold.js'
import { encodeEntity } from '../snapshot-lod-pure/entityDelta.js'
import { encodePlayersOnce, filterEncodedPlayersAtRate } from '../snapshot-lod-pure/playerLod.js'
import { encodeSelfBlock } from '../snapshot-lod-pure/selfBlock.js'
import { DEFAULT_TICK_RATE_HZ } from '../tick-authority-pure/constants.js'
import { buildMovementDeps, createMovementState, processPlayerMovement } from '../tick-authority-pure/movementStep.js'
import { planSnapshotGroups, selectServedPlayers } from '../tick-authority-pure/snapshotPlan.js'
import { createSnapshotRateController } from '../tick-authority-pure/snapshotRate.js'
import { runTickOrder } from '../tick-authority-pure/tickOrder.js'

const LAG_HISTORY_MS = 1000
const NO_ENTITIES = Object.freeze([])
const isPosition = (p) => Array.isArray(p) && p.length === 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])

export function createTickHost({
  now,
  log = () => {},
  tickRate = DEFAULT_TICK_RATE_HZ,
  physicsWorld = null,
  bodyWorld = null,
  gravity = [0, -9.81, 0],
  movement = {},
  netcodeConfig = () => undefined,
  entities = () => NO_ENTITIES,
  relevantIds = null,
  chartEpoch = () => 0,
  chartReanchor = () => {},
  appRuntimeTick = () => {},
  collisionTiles = () => {},
  onSnapshotRate = () => {},
  eventLog = null,
  onStep = null,
} = {}) {
  if (typeof now !== 'function') throw new TypeError('[tickHost] now must be a clock function in milliseconds')
  if (!(Number.isFinite(tickRate) && tickRate > 0)) throw new RangeError('[tickHost] tickRate must be a rate above zero')
  const dt = 1 / tickRate
  const playerManager = new PlayerManager({ now, log })
  const networkState = new NetworkState({ now })
  const lagCompensator = new LagCompensator(LAG_HISTORY_MS, tickRate, now)
  const physicsIntegration = new PhysicsIntegration({ physicsWorld, gravity })
  const snapshotRate = createSnapshotRateController({ tickRate, getNetcodeConfig: netcodeConfig })
  const movementState = createMovementState()
  const holdStep = (player, physics) => stepTeleportHold(player, physics, now)
  const deps = buildMovementDeps({
    tickRate,
    playerManager,
    physicsIntegration,
    lagCompensator,
    networkState,
    applyMovement,
    defaultMovement: DEFAULT_MOVEMENT,
    movementOverrides: movement,
    stepTeleportHold: holdStep,
    eventLog,
    clock: now,
  })
  const minDist = physicsIntegration.config.capsuleRadius * 2
  const collisionGrid = new Map()
  const collisionCells = new Map()
  const playersById = new Map()
  const allIds = []
  const memo = newRecordMemo()
  const stats = { inputsAccepted: 0, inputsRateLimited: 0, ticks: 0, snapshots: 0, snapshotBytes: 0, snapshotsRefused: 0, teleports: 0, teleportReleases: 0 }
  const releases = []
  let tick = 0
  let snapshotSeq = 0

  const note = onStep ? (name) => onStep(name, tick) : () => {}

  const buildAndSendSnapshots = (snapTick, players) => {
    const startedAt = now()
    memo.byRef = new WeakMap()
    const snap = networkState.getSnapshot()
    const encoded = encodePlayersOnce(snap.players)
    playersById.clear()
    allIds.length = 0
    for (const p of snap.players) {
      playersById.set(p.id, p)
      allIds.push(p.id)
    }
    const entityList = entities()
    const entityRecords = []
    for (const entity of entityList) entityRecords.push(encodeEntity(entity))
    const plan = planSnapshotGroups(players.length, snap.players.length + entityList.length, snapshotSeq)
    const served = selectServedPlayers(players, plan.snapGroups, plan.curGroup, false)
    const clientHz = tickRate / snapshotRate.interval / plan.snapGroups
    for (const player of served) {
      const self = playersById.get(player.id)
      if (!self) continue
      const ids = relevantIds ? relevantIds(player, allIds) : allIds
      const tiered = filterEncodedPlayersAtRate(encoded, playersById, ids, player.id, self.position, plan.clientSeq, clientHz)
      const body = { tick: snapTick, serverTime: snap.timestamp, players: tiered.players, entities: entityRecords, removed: undefined, delta: 0, dots: tiered.dots.length ? tiered.dots : undefined }
      const me = encodeSelfBlock(self)
      const epoch = chartEpoch()
      let bytes = packSnapshotBytes(MSG.SNAPSHOT, plan.clientSeq, body, me, epoch, memo)
      if (bytes === null) {
        stats.snapshotsRefused++
        bytes = pack({ type: MSG.SNAPSHOT, payload: { seq: plan.clientSeq, tick: body.tick, serverTime: body.serverTime, players: body.players, entities: body.entities, removed: body.removed, delta: body.delta, dots: body.dots, me, chartEpoch: epoch } })
      }
      if (playerManager.sendBinaryToPlayer(player.id, bytes)) {
        stats.snapshots++
        stats.snapshotBytes += bytes.length
      }
    }
    snapshotSeq++
    snapshotRate.recordSnapshotCost(now() - startedAt)
  }

  const steps = {
    beginTick(t) {
      note('beginTick')
      lagCompensator.beginTick(t)
    },
    setTick(t) {
      note('setTick')
      networkState.setTick(t, now())
    },
    connectedPlayers() {
      note('connectedPlayers')
      return playerManager.getConnectedPlayers()
    },
    updateStall() {
      note('updateStall')
    },
    adjustSnapshotRate(t, players) {
      note('adjustSnapshotRate')
      const change = snapshotRate.beginTick(t, players, players.length > 0)
      if (change) onSnapshotRate(change)
    },
    movement(players, t, stepDt, explicitInputs) {
      note('movement')
      processPlayerMovement(players, deps, t, stepDt, movementState.playerIdleCounts, movementState.playerAccumDt, explicitInputs)
    },
    playerCollisions(players, stepDt) {
      note('playerCollisions')
      applyPlayerCollisions(players, collisionGrid, collisionCells, minDist, minDist * minDist, minDist, stepDt, physicsIntegration)
    },
    chartReanchor(t) {
      note('chartReanchor')
      chartReanchor(t)
    },
    physicsStep(stepDt) {
      note('physicsStep')
      if (physicsWorld && typeof physicsWorld.step === 'function') physicsWorld.step(stepDt)
      if (bodyWorld) bodyWorld.step()
    },
    appRuntimeTick(t, stepDt) {
      note('appRuntimeTick')
      appRuntimeTick(t, stepDt)
    },
    get hasConnections() {
      return playerManager.getConnectedPlayers().length > 0
    },
    collisionTiles(t, players) {
      note('collisionTiles')
      collisionTiles(t, players)
    },
    snapshotInterval: () => snapshotRate.interval,
    snapshot(t, players) {
      note('snapshot')
      buildAndSendSnapshots(t, players)
    },
  }
  if (physicsWorld && typeof physicsWorld.drainBodyQueue === 'function') {
    steps.drainBodyQueue = () => {
      note('drainBodyQueue')
      physicsWorld.drainBodyQueue()
    }
  }

  const addPlayer = (socket, initialState = {}) => {
    const position = initialState.position || [0, 0, 0]
    if (!isPosition(position)) throw new RangeError('[tickHost] a player needs a finite position')
    const id = playerManager.addPlayer(socket, { ...initialState, position })
    const player = playerManager.getPlayer(id)
    networkState.addPlayer(id, { position: player.state.position, rotation: player.state.rotation, velocity: player.state.velocity, health: player.state.health })
    physicsIntegration.addPlayerCollider(id, physicsIntegration.config.capsuleRadius)
    physicsIntegration.setPlayerPosition(id, player.state.position)
    return id
  }

  const removePlayer = (id) => {
    if (!playerManager.getPlayer(id)) return false
    physicsIntegration.removePlayerCollider(id)
    networkState.removePlayer(id)
    lagCompensator.clearPlayerHistory(id)
    movementState.playerIdleCounts.delete(id)
    movementState.playerAccumDt.delete(id)
    clearInputBucket(playerManager.getPlayer(id))
    playerManager.removePlayer(id)
    return true
  }

  const receiveInput = (id, input, clientSeq) => {
    const player = playerManager.getPlayer(id)
    if (!player) return false
    if (isInputRateLimited(player, now())) {
      stats.inputsRateLimited++
      return false
    }
    playerManager.addInput(id, sanitizeInputPayload(input), clientSeq)
    stats.inputsAccepted++
    return true
  }

  const teleport = (id, position, { maxMs = TELEPORT_HOLD_MAX_MS, probeGroundY = null } = {}) => {
    const player = playerManager.getPlayer(id)
    if (!player) throw new RangeError('[tickHost] no player ' + id + ' to teleport')
    if (!isPosition(position)) throw new RangeError('[tickHost] a teleport needs a finite position')
    const st = player.state
    st.position[0] = position[0]; st.position[1] = position[1]; st.position[2] = position[2]
    st.velocity[0] = 0; st.velocity[1] = 0; st.velocity[2] = 0
    physicsIntegration.setPlayerPosition(id, st.position)
    playerManager.clearInputs(id)
    lagCompensator.clearPlayerHistory(id)
    stats.teleports++
    beginTeleportHold(player, {
      maxMs,
      probeGroundY,
      onRelease: (info) => {
        if (info.groundHit) {
          st.position[1] = physicsIntegration.standingCentreY(info.groundY)
          physicsIntegration.setPlayerPosition(id, st.position)
        }
        stats.teleportReleases++
        releases.push({ playerId: id, tick, groundHit: info.groundHit, groundY: info.groundY, heldMs: info.heldMs })
        playerManager.sendToPlayer(id, { type: MSG.TELEPORT_ACK, payload: { groundHit: info.groundHit, heldMs: info.heldMs, position: [st.position[0], st.position[1], st.position[2]] } })
      },
    }, now)
    playerManager.sendToPlayer(id, { type: MSG.TELEPORT, payload: { position: [position[0], position[1], position[2]] } })
  }

  const runTick = (explicitInputs = null) => {
    tick++
    const players = runTickOrder(steps, tick, dt, explicitInputs)
    stats.ticks++
    return players
  }

  return {
    addPlayer,
    removePlayer,
    receiveInput,
    teleport,
    tick: runTick,
    steps,
    playerManager,
    networkState,
    lagCompensator,
    physicsIntegration,
    snapshotRate,
    stats,
    teleportReleases: releases,
    dt,
    get tickNumber() { return tick },
    get snapshotSeq() { return snapshotSeq },
  }
}
