import { parseSessionToken, SESSION_TOKEN_MALFORMED, HANDOFF_SESSION_NOT_JOINED } from '../sharding/index.js'

export function parsePlayerIdOfSession(server, token) {
  const parsedToken = parseSessionToken(token)
  if (!parsedToken.ok) return { ok: false, reason: parsedToken.reason, sessionToken: parsedToken.value }
  if (parsedToken.sessionToken === null) return { ok: false, reason: SESSION_TOKEN_MALFORMED, sessionToken: null }
  for (const player of server.playerManager.players.values()) {
    if (server.connections.getClient(player.id)?.sessionToken === parsedToken.sessionToken) {
      return { ok: true, clusterLocalPlayerId: player.id, sessionToken: parsedToken.sessionToken }
    }
  }
  return { ok: false, reason: HANDOFF_SESSION_NOT_JOINED, sessionToken: parsedToken.sessionToken }
}
