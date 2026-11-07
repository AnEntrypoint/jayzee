import { HANDOFF_IDLE, PLAYER_IDENTITY_UNMINTED, HANDOFF_UNKNOWN_PLAYER } from './RegionRouter.js'

export function beginHandoff(player, handoff) {
  if (player.handoff) return false
  player.handoff = handoff
  return true
}

export function acceptHandoff(player, identity, sessionToken) {
  player.region = identity.region
  player.localPlayerId = identity.localPlayerId
  player.sessionToken = sessionToken
  player.handoff = HANDOFF_IDLE
  return player
}

export function refuseHandoff(player) {
  if (player) player.handoff = HANDOFF_IDLE
}

export function abandonHandoffsTo(players, regionId) {
  const abandoned = []
  for (const player of players) {
    if (player.handoff?.toRegion !== regionId) continue
    player.handoff = HANDOFF_IDLE
    abandoned.push(player)
  }
  return abandoned
}

export function handoffAcceptanceRefusal(entry, identity, token) {
  if (entry && identity && token.ok) return null
  if (!token.ok) return token.reason
  return entry ? PLAYER_IDENTITY_UNMINTED : HANDOFF_UNKNOWN_PLAYER
}
