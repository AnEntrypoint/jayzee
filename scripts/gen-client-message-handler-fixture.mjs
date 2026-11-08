import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { MessageHandler } from '/workspace/spoint/src/client/MessageHandler.js'
import { createCollisionMirror } from '/workspace/spoint/src/client/CollisionMirror.js'
import { MSG, WIRE_PROTOCOL_VERSION, DISCONNECT_REASONS } from '/workspace/spoint/src/protocol/MessageTypes.js'
import { WIRE_STRUCT_HASH } from '/workspace/spoint/src/protocol/msgpack.js'

const OUT = new URL('./fixtures/spoint/client-message-handler.json', import.meta.url)
const CALLBACK_NAMES = ['onPlayerLeft', 'onWorldDef', 'onAppEvent', 'onHotReload', 'onAppModule', 'onAssetUpdate', 'onPeerRttTable', 'onEditorSelect', 'onMessage', 'onTerrainConfig', 'onTerrainSculptAck', 'onTerrainPaintBiomeAck', 'onGrassDecalSync', 'onTerrainSculptSync', 'onTimeOfDaySync', 'onWeatherSync', 'onEntityRemoved', 'onTeleportAck']
const CFG = { radius: 0.4, halfHeight: 0.9, crouchHalfHeight: 0.45, maxSlopeAngle: 0.7, maxStepHeight: 0.4, stickToFloorDistance: 0.25, mass: 70, gravity: [0, -9.81, 0], tileM: 16, marginM: 3, forgetRing: 2 }
const CFG2 = { ...CFG, maxStepHeight: 0.5 }
const bytes = (n, seed) => Array.from({ length: n }, (_, i) => (i * 37 + seed) & 255)

const MESSAGES = [
  { type: 'HANDSHAKE_ACK', payload: { version: WIRE_PROTOCOL_VERSION, structHash: WIRE_STRUCT_HASH, playerId: 7, tickRate: 20, sessionToken: 'tok-1' } },
  { type: 'WORLD_DEF', payload: { tickRate: 20, movement: { speed: 6 }, gravity: [0, -9.81, 0], player: { capsuleRadius: 0.4 }, netcode: null } },
  { type: 'COLLISION_CONFIG', payload: CFG },
  { type: 'COLLISION_TILE', payload: { tx: 0, tz: 0, h: 12345, v: bytes(72, 11) } },
  { type: 'COLLISION_TILE', payload: { tx: -1, tz: 2, h: 4294967295, v: bytes(36, 5) } },
  { type: 'COLLISION_TILE', payload: { tx: 3, tz: 3, h: 7, v: bytes(35, 9) } },
  { type: 'COLLISION_CONFIG', payload: CFG },
  { type: 'COLLISION_CONFIG', payload: CFG2 },
  { type: 'DISCONNECT_REASON', payload: { code: DISCONNECT_REASONS.INVALID_SESSION } },
  { type: 'DISCONNECT_REASON', payload: { code: DISCONNECT_REASONS.PROTOCOL_MISMATCH, version: 4 } },
  { type: 'PLAYER_LEAVE', payload: { playerId: 9 } },
  { type: 'SNAPSHOT', payload: { tick: 5, players: [] } },
  { type: 'STATE_RECOVERY', payload: { snapshot: { tick: 6 } } },
  { type: 'APP_EVENT', payload: { name: 'ping' } },
  { type: 'HOT_RELOAD', payload: { url: '/a.js' } },
  { type: 'APP_MODULE', payload: { path: 'b' } },
  { type: 'ASSET_UPDATE', payload: { id: 1 } },
  { type: 'PEER_RTT_TABLE', payload: { rtt: { 8: 20 }, pubkeys: { 8: 'k' } } },
  { type: 'EDITOR_SELECT', payload: { id: 2 } },
  { type: 'APP_LIST', payload: { apps: ['a'] } },
  { type: 'TERRAIN_CONFIG', payload: { seed: 1 } },
  { type: 'DESTROY_ENTITY', payload: { entityId: 5 } },
  { type: 'TELEPORT_ACK', payload: { op: 'to', phase: 'placed', ok: true, position: [0, 1, 0], velocity: [0, 0, 0], tick: 3 } },
  { type: 'RECONNECT_ACK', payload: { localPlayerId: 7, playerId: 7, position: [1, 2, 3], health: 100, tickRate: 20, sessionToken: 'tok-2', structHash: WIRE_STRUCT_HASH } },
  { type: 'COLLISION_CONFIG', payload: CFG },
  { type: 'COLLISION_TILE', payload: { tx: 0, tz: 0, h: 99, v: bytes(36, 3) } },
  { id: 254, payload: {} },
]

const plain = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)))
const sha = (b) => createHash('sha256').update(b).digest('hex')
const tileSummary = (p) => ({ tx: p.tx, tz: p.tz, h: p.h, bytes: p.v.byteLength, sha256: sha(p.v) })
const revive = (payload) => (payload && payload.v ? { ...payload, v: Uint8Array.from(payload.v) } : payload)

function tapMirror(mirror, log) {
  const configure = mirror.configure, sameConfig = mirror.sameConfig, onTile = mirror.onTile
  mirror.configure = (payload) => { log.push({ mirror: 'configure', args: [plain(payload)] }); return configure(payload) }
  mirror.sameConfig = (payload) => { log.push({ mirror: 'sameConfig', args: [plain(payload)] }); return sameConfig(payload) }
  mirror.onTile = (payload, nearPos) => { log.push({ mirror: 'onTile', args: [tileSummary(payload), plain(nearPos)] }); return onTile(payload, nearPos) }
  return mirror
}

async function settle(mirror) {
  if (!mirror) return
  const deadline = Date.now() + 10000
  while (!mirror.ready) {
    if (Date.now() > deadline) throw new Error('spoint collision mirror never became ready')
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function runSpoint(withMirror) {
  const log = []
  const callbacks = {}
  for (const name of CALLBACK_NAMES) callbacks[name] = (...args) => log.push({ cb: name, args: args.map(plain) })
  const config = { tickRate: 20, callbacks }
  if (!withMirror) config.collisionMirror = false
  const handler = new MessageHandler(config)
  if (withMirror) handler._collisionMirror = tapMirror(createCollisionMirror(), log)
  const snapProc = { removePlayer: (id) => log.push({ snap: 'removePlayer', args: [id] }), clear: () => log.push({ snap: 'clear', args: [] }) }
  const steps = []
  for (const m of MESSAGES) {
    const id = m.type ? MSG[m.type] : m.id
    const returns = handler.handleMessage(id, revive(m.payload), snapProc)
    if (m.type === 'COLLISION_CONFIG') await settle(handler.getCollisionMirror())
    steps.push({ type: m.type ?? null, id, returns: plain(returns), playerId: plain(handler.getPlayerId()), events: log.splice(0) })
  }
  return { steps, final: { hasMirror: handler.getCollisionMirror() !== null, playerId: plain(handler.getPlayerId()), structMismatch: plain(handler.getStructMismatch()) } }
}

const mirrorOn = await runSpoint(true)
const mirrorOff = await runSpoint(false)
writeFileSync(OUT, JSON.stringify({
  wireProtocolVersion: WIRE_PROTOCOL_VERSION,
  wireStructHash: WIRE_STRUCT_HASH,
  callbackNames: CALLBACK_NAMES,
  scenarios: {
    mirrorOn: { messages: MESSAGES, steps: mirrorOn.steps, final: mirrorOn.final },
    mirrorOff: { collisionMirror: false, messages: MESSAGES, steps: mirrorOff.steps, final: mirrorOff.final },
  },
}, null, 2) + '\n')
console.log('wrote client-message-handler.json: ' + mirrorOn.steps.length + ' steps (mirror on), ' + mirrorOff.steps.length + ' steps (mirror off)')
process.exit(0)
