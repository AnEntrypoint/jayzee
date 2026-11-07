import { parseRegionId, parseRegionCoords, DEFAULT_CELL_SIZE } from './RegionGrid.js'
import { ROUTER_PLAYER_ID_MALFORMED } from './ShardingRefusal.js'

export { ROUTER_PLAYER_ID_MALFORMED }

export const HANDOFF_IDLE = null
export const PLAYER_IDENTITY_UNMINTED = 'player-identity-unminted'
export const HANDOFF_UNMINTED = 'handoff-unminted'
export const HANDOFF_UNKNOWN_PLAYER = 'handoff-unknown-player'

export function playerIdentity(region, localPlayerId) {
  if (!parseRegionId(region).ok) return null
  if (!parseLocalPlayerId(localPlayerId).ok) return null
  return { region, localPlayerId }
}

export function handoffTo(toRegion, fromRegion, fromLocalId) {
  if (!parseRegionId(toRegion).ok || !parseRegionId(fromRegion).ok) return null
  if (!parseLocalPlayerId(fromLocalId).ok) return null
  return { toRegion, fromRegion, fromLocalId }
}

export const LOCAL_PLAYER_ID_MALFORMED = 'local-player-id-malformed'
export const SESSION_TOKEN_MALFORMED = 'session-token-malformed'

const SESSION_TOKEN_SHAPE = /^[0-9a-f]{32}$/

export function parseRouterPlayerId(value) {
  if (!Number.isInteger(value) || value < 1) return { ok: false, reason: ROUTER_PLAYER_ID_MALFORMED, value: value ?? null }
  return { ok: true, routerPlayerId: value }
}

export function parseLocalPlayerId(value) {
  if (!Number.isInteger(value) || value < 0) return { ok: false, reason: LOCAL_PLAYER_ID_MALFORMED, value: value ?? null }
  return { ok: true, localPlayerId: value }
}

export function parseSessionToken(value) {
  if (value === null || value === undefined) return { ok: true, sessionToken: null }
  if (typeof value === 'string' && SESSION_TOKEN_SHAPE.test(value)) return { ok: true, sessionToken: value }
  return { ok: false, reason: SESSION_TOKEN_MALFORMED, value: typeof value === 'string' ? value : null }
}

export function regionForSpawnPoint(spawnPoint, cellSize = DEFAULT_CELL_SIZE) {
  return parseRegionCoords(spawnPoint?.[0], spawnPoint?.[2], cellSize)
}
