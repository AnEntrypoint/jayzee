import { MSG } from '../protocol/messages.js'
import { snapshotChart, createChartTransfer } from '../chart-pure/chartAnchor.js'
import { createReexpressPass, clampTiltInducedUpward } from '../client/chartReexpress.js'
import { parsePlayerIdOfSession } from '../clusters-pure/clusterSession.js'
import { parseClusterLocalPlayerId, ClusterHandoffError, HANDOFF_UNKNOWN_CLUSTER_LOCAL_PLAYER } from './ClusterHandoff.js'

export const HANDOFF_NEEDS_PLANET_FRAME = 'handoff-needs-planet-frame'

function frameOf(server) {
  const frame = server.physics?._planetFrame
  if (!frame) throw new ClusterHandoffError(HANDOFF_NEEDS_PLANET_FRAME, 'the world has no terrain planet frame, so there is no chart to transfer between')
  return frame
}

function clusterLocalIdOrThrow(clusterLocalPlayerId) {
  const parsed = parseClusterLocalPlayerId(clusterLocalPlayerId)
  if (!parsed.ok) throw new ClusterHandoffError(parsed.reason, `clusterLocalPlayerId ${JSON.stringify(parsed.value)} is not a cluster-world-local player id`)
  return parsed.clusterLocalPlayerId
}

export function exportPlayerHandoff(server, clusterLocalPlayerId) {
  const id = clusterLocalIdOrThrow(clusterLocalPlayerId)
  const player = server.playerManager.getPlayer(id)
  if (!player) throw new ClusterHandoffError(HANDOFF_UNKNOWN_CLUSTER_LOCAL_PLAYER, `clusterLocalPlayerId ${id} is not in this world`)
  const s = player.state
  return {
    chart: snapshotChart(frameOf(server)),
    name: player.name,
    tick: server.tickSystem.currentTick,
    state: structuredClone({ position: s.position, velocity: s.velocity, rotation: s.rotation, lookYaw: s.lookYaw, lookPitch: s.lookPitch, onGround: s.onGround, groundNormal: s.groundNormal, health: s.health }),
    lastInput: player.lastInput ? structuredClone(player.lastInput) : null,
  }
}

export async function admitPlayerHandoff(server, handoff) {
  const transfer = createChartTransfer(handoff.chart, snapshotChart(frameOf(server)))
  const pass = createReexpressPass(transfer)
  const state = structuredClone(handoff.state)
  pass.point(state.position)
  pass.vector(state.velocity)
  if (state.onGround && state.groundNormal) pass.vector(state.groundNormal)
  pass.look(state, 'lookYaw', 'lookPitch')
  pass.yawRotation(state.rotation)
  if (state.onGround) clampTiltInducedUpward(transfer, state.velocity)
  const lastInput = handoff.lastInput ? structuredClone(handoff.lastInput) : null
  if (lastInput) pass.look(lastInput)
  const streamer = server.physics?._terrainStreamer
  if (streamer?.cover) await streamer.cover([[state.position[0], state.position[2]]])
  const token = server.sessions.create(null, { ...state, name: handoff.name })
  return { token, state, lastInput, transfer }
}

export function applyAdmittedInputs(server, token, lastInput) {
  const parsed = parsePlayerIdOfSession(server, token)
  if (!parsed.ok) throw new ClusterHandoffError(parsed.reason, `session token ${JSON.stringify(parsed.sessionToken)} names no connected player in this world`)
  const id = parsed.clusterLocalPlayerId
  if (lastInput) server.playerManager.getPlayer(id).lastInput = lastInput
  return id
}

export function releaseHandoffSource(server, clusterLocalPlayerId, destination = null) {
  const id = clusterLocalIdOrThrow(clusterLocalPlayerId)
  const client = server.connections.getClient(id)
  const token = client?.sessionToken
  if (destination?.url && destination?.sessionToken && client) {
    server.connections.send(id, MSG.CLUSTER_HANDOFF, { url: destination.url, sessionToken: destination.sessionToken, clusterId: destination.clusterId ?? null })
    if (token) server.sessions.destroy(token)
    return
  }
  if (token) server.sessions.destroy(token)
  client?.transport?.close()
}
