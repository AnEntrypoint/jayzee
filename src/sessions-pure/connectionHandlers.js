import { playerDefault } from '../player-defaults-pure/playerDefaults.js'
import { MSG } from '../protocol/messages.js'
import { unpack } from '../protocol/msgpack.js'

export const MAX_TRACKED_RTT_MS = 10000
export const SERVER_ONLY_APP_EVENT_TYPES = new Set(['player_join', 'player_leave', 'player_teleport', 'damage'])
export const SOCKET_ADMISSION = Object.freeze({
  AUTH_RESPONSE: 'auth-response',
  MIGRATE: 'migrate',
  NEW_PLAYER: 'new-player',
})
export const ADMISSION_REFUSAL = Object.freeze({
  AUTH_REQUIRED: 'auth-required',
  UNDECODABLE: 'undecodable-first-message',
})
const MIGRATE_PEEK_GRACE_FLOOR_MS = 50
const MIGRATE_PEEK_GRACE_CEIL_MS = 1500
const MIN_SESSION_TOKEN_LENGTH = 8
const VOICE_PUBKEY_MAX_LENGTH = 128
const MAX_TRIMESH_VERTS = 300000
const MAX_TRIMESH_TRIS = 200000

export function admitFirstMessage(data, authPending) {
  let message
  try { message = unpack(data) } catch (e) { return { refusal: ADMISSION_REFUSAL.UNDECODABLE } }
  if (authPending) {
    return message?.type === MSG.NOSTR_AUTH_RESPONSE
      ? { way: SOCKET_ADMISSION.AUTH_RESPONSE, message }
      : { refusal: ADMISSION_REFUSAL.AUTH_REQUIRED }
  }
  return message?.type === MSG.MIGRATE
    ? { way: SOCKET_ADMISSION.MIGRATE, message }
    : { way: SOCKET_ADMISSION.NEW_PLAYER, message }
}

export function migratePeekGraceMs(dilationFactor) {
  return (typeof dilationFactor === 'number' && dilationFactor > 0 && dilationFactor < 1)
    ? Math.min(MIGRATE_PEEK_GRACE_CEIL_MS, Math.round(MIGRATE_PEEK_GRACE_FLOOR_MS / dilationFactor))
    : MIGRATE_PEEK_GRACE_FLOOR_MS
}

export function isSessionTokenShape(token) {
  return typeof token === 'string' && token.length >= MIN_SESSION_TOKEN_LENGTH
}

export function smoothRtt(previous, sentAt, now) {
  const rtt = now - sentAt
  let next = previous != null ? Math.round(previous * 0.7 + rtt * 0.3) : rtt
  if (next < 0) next = 0
  if (next > MAX_TRACKED_RTT_MS) next = MAX_TRACKED_RTT_MS
  return next
}

export function heartbeatAckPayload(timestamp, now) {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return { timestamp, serverTime: now }
  return {}
}

const isVector = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite)
const vectorOrUndefined = (v, n) => (isVector(v, n) ? v : undefined)

export function reconnectRestore(savedState, playerConfig, snapSpawn) {
  let sp = savedState.position
  if (!Array.isArray(sp) || sp.length !== 3 || sp.some(x => !Number.isFinite(x))) sp = snapSpawn()
  const maxHealth = playerDefault(playerConfig, 'health')
  const health = (Number.isFinite(savedState.health) && savedState.health >= 0)
    ? Math.min(savedState.health, maxHealth)
    : maxHealth
  return {
    position: sp,
    health,
    velocity: vectorOrUndefined(savedState.velocity, 3),
    rotation: vectorOrUndefined(savedState.rotation, 4),
    name: typeof savedState.name === 'string' ? savedState.name : undefined,
  }
}

export function isValidTrimeshPayload(vertices, indices) {
  if (!vertices || !indices) return false
  if (!Array.isArray(vertices) || !Array.isArray(indices)) return false
  if (vertices.length === 0 || vertices.length % 3 !== 0 || vertices.length / 3 > MAX_TRIMESH_VERTS) return false
  if (indices.length === 0 || indices.length % 3 !== 0 || indices.length / 3 > MAX_TRIMESH_TRIS) return false
  const vertCount = vertices.length / 3
  for (let i = 0; i < vertices.length; i++) if (!Number.isFinite(vertices[i])) return false
  for (let i = 0; i < indices.length; i++) {
    const ix = indices[i]
    if (!Number.isInteger(ix) || ix < 0 || ix >= vertCount) return false
  }
  return true
}

export function isServerOnlyAppEvent(type) {
  return SERVER_ONLY_APP_EVENT_TYPES.has(type)
}

export function voiceIdentityPubkey(payload) {
  if (payload?.type === 'voice_identity' && typeof payload?.pubkey === 'string' && payload.pubkey) {
    return payload.pubkey.slice(0, VOICE_PUBKEY_MAX_LENGTH)
  }
  return null
}

export function createWarnThrottle({
  intervalMs = 1000,
  maxTracked = 1024,
  now = Date.now,
  warn = (message) => console.warn(message),
} = {}) {
  const lastWarnAt = new Map()
  return function warnThrottled(clientId, message) {
    const at = now()
    if (at - (lastWarnAt.get(clientId) || 0) < intervalMs) return false
    if (lastWarnAt.size > maxTracked) lastWarnAt.clear()
    lastWarnAt.set(clientId, at)
    warn(message)
    return true
  }
}
