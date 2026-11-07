export const CLUSTER_LOCAL_PLAYER_ID_MALFORMED = 'cluster-local-player-id-malformed'
export const HANDOFF_UNKNOWN_CLUSTER_LOCAL_PLAYER = 'handoff-unknown-cluster-local-player'
export const HANDOFF_SESSION_NOT_JOINED = 'handoff-session-not-joined'

export function parseClusterLocalPlayerId(value) {
  if (!Number.isInteger(value) || value < 0) return { ok: false, reason: CLUSTER_LOCAL_PLAYER_ID_MALFORMED, value: value ?? null }
  return { ok: true, clusterLocalPlayerId: value }
}

export class ClusterHandoffError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'ClusterHandoffError'
    this.code = code
  }
}
