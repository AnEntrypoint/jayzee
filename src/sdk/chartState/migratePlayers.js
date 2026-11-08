import { clampTiltInducedUpward, createReexpressPass } from '../../client/chartReexpress.js'
import { applyChartTransfer } from '../../netcode/lagChartTransfer.js'

const TRANSFER_METHODS = ['point', 'vec', 'look']
const PHYSICS_METHODS = ['applyChartTransfer', 'charIdOf', 'isGrounded']

function requireMethods(value, names, label) {
  const missing = names.filter((name) => typeof value?.[name] !== 'function')
  if (missing.length > 0) throw new TypeError(`${label} needs ${missing.join(', ')}`)
}

function reexpressBody(pass, body) {
  pass.point(body.position)
  pass.vector(body.velocity)
  if (body.onGround) pass.vector(body.groundNormal)
  pass.clear(body.wallNormals)
  pass.look(body, 'lookYaw', 'lookPitch')
  pass.yawRotation(body.rotation)
}

export function createPlayerMigrator({ playerManager, networkState, lagCompensator, physics }) {
  if (!(playerManager?.players instanceof Map)) throw new TypeError('createPlayerMigrator needs playerManager.players as a Map')
  requireMethods(playerManager, ['getInputs'], 'createPlayerMigrator playerManager')
  if (!(networkState?.players instanceof Map)) throw new TypeError('createPlayerMigrator needs networkState.players as a Map')
  if (!(lagCompensator?.playerHistory instanceof Map)) throw new TypeError('createPlayerMigrator needs a LagCompensator with a playerHistory map')
  requireMethods(physics, PHYSICS_METHODS, 'createPlayerMigrator physics')

  return function migratePlayers(event, pass = createReexpressPass(event?.transfer)) {
    const transfer = event?.transfer
    requireMethods(transfer, TRANSFER_METHODS, 'createPlayerMigrator chart transfer')
    if (!Number.isFinite(transfer.tiltRad)) throw new TypeError('createPlayerMigrator chart transfer needs a finite tiltRad')

    const counts = { players: 0, bufferedInputs: 0, networkPlayers: 0, lagSamples: 0, characters: 0, stateVelocityClamped: 0 }
    for (const player of playerManager.players.values()) {
      reexpressBody(pass, player.state)
      pass.look(player.lastInput)
      const buffered = playerManager.getInputs(player.id)
      for (const input of buffered) pass.look(input.data)
      counts.players++
      counts.bufferedInputs += buffered.length
    }
    for (const networkPlayer of networkState.players.values()) {
      reexpressBody(pass, networkPlayer)
      counts.networkPlayers++
    }
    counts.lagSamples = applyChartTransfer(lagCompensator, transfer)
    const grounded = physics.applyChartTransfer(transfer)
    if (grounded) Object.assign(counts, grounded)
    for (const player of playerManager.players.values()) {
      const charId = physics.charIdOf(player.id)
      if (charId == null || !physics.isGrounded(charId)) continue
      if (clampTiltInducedUpward(transfer, player.state.velocity)) counts.stateVelocityClamped++
    }
    return counts
  }
}
