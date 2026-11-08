import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gate, finish } from './lib/gate.mjs'
import { createJoltHost } from '../src/collision/joltHost.js'
import { createCollisionTileStreamer, characterConfigFrom } from '../src/netcode/collisionTileStreamer.js'
import { MSG } from '../src/protocol/messages.js'

const fx = JSON.parse(readFileSync(new URL('./fixtures/spoint/collision-tile-streamer.json', import.meta.url), 'utf8'))
const nameOf = (type) => Object.keys(MSG).find((k) => MSG[k] === type)
const summarize = (type, payload) => {
  if (type === MSG.COLLISION_TILE) return { tx: payload.tx, tz: payload.tz, h: payload.h, bytes: payload.v.byteLength, sha256: createHash('sha256').update(payload.v).digest('hex') }
  return JSON.parse(JSON.stringify(payload))
}
const same = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a !== b) throw new Error(what + ' differs from spoint (got ' + a.length + ' bytes, spoint ' + b.length + ' bytes)')
}

const host = await createJoltHost({ gravity: fx.gravity })
for (const body of fx.scene) host.addStaticTriangles(body.vertices, body.indices, body.position)

const physicsStub = { _charMgr: { _charShapes: new Map(fx.characters.charShapes), config: fx.characters.managerConfig } }
const integration = { playerBodies: new Map(fx.characters.playerBodies), config: fx.characters.integrationConfig }

let currentTick = 0
const sends = []
const clients = new Map()
const connections = {
  send(playerId, type, payload) { sends.push({ tick: currentTick, player: playerId, type: nameOf(type), payload: summarize(type, payload) }) },
  getClient(id) { if (!clients.has(id)) clients.set(id, { id }); return clients.get(id) },
}
const streamer = createCollisionTileStreamer({
  physics: host,
  physicsIntegration: integration,
  connections,
  getNetcodeConfig: () => ({ profile: 'authoritative' }),
  now: () => currentTick * 16,
  characterConfigOf: (id) => characterConfigFrom(physicsStub, integration, id),
})
for (let t = 0; t < fx.ticks.length; t++) {
  currentTick = t
  for (const id of fx.resets[String(t)] || []) streamer.reset(id)
  streamer.tick(t, fx.ticks[t].map((p) => ({ id: p.id, state: { position: p.position } })))
}

const configSends = sends.filter((s) => s.type === 'COLLISION_CONFIG')
const tileSends = sends.filter((s) => s.type === 'COLLISION_TILE')

gate('the streamer sends the same sequence of messages as spoint (tile list, hashes, bytes)', () => same(sends, fx.expect.sends, 'send sequence'))
gate('the trace is not empty: tile sends and config sends both occur', () => {
  if (tileSends.length < 10 || configSends.length < 2) throw new Error(tileSends.length + ' tile sends, ' + configSends.length + ' config sends')
})
gate('the COLLISION_CONFIG payloads match spoint', () => same(configSends, fx.expect.sends.filter((s) => s.type === 'COLLISION_CONFIG'), 'config payloads'))
gate('the tile sends match spoint, one tile list per player in order', () => same(tileSends, fx.expect.sends.filter((s) => s.type === 'COLLISION_TILE'), 'tile sends'))
gate('the stream counters (tilesSent, bytesSent) match spoint', () => same(streamer.stats, fx.expect.stats, 'stream stats'))
gate('a player with no character shape gets no config and no tiles', () => {
  if (characterConfigFrom(physicsStub, integration, 2) !== null) throw new Error('player 2 has a config')
  if (sends.some((s) => s.player === 2)) throw new Error('player 2 was sent something')
})
finish()
