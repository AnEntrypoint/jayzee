import assert from 'node:assert/strict'
import { createSimSocketPair } from '../../src/transport/simSocketPair.js'
import { MSG } from '../../src/protocol/messages.js'
import { pack, unpack } from '../../src/protocol/msgpack.js'
import { SnapshotEncoder } from '../../src/snapshot-lod-pure/snapshotEncoder.js'

export const makeClock = (start = 50000) => {
  const clock = { t: start }
  return { clock, now: () => clock.t }
}

export const randomFillFrom = (seed = 0) => {
  let fillByte = seed
  return (bytes) => { for (let i = 0; i < bytes.length; i++) bytes[i] = (fillByte = (fillByte * 73 + 41) & 255) }
}

export const clientRig = (server, clock, now) => {
  const pairs = []
  const tickMs = 1000 / server.config.tickRate
  const pump = () => { for (const pair of pairs) pair.pump() }
  const run = (ticks) => {
    for (let i = 0; i < ticks; i++) {
      clock.t += tickMs
      pump()
      server.tick()
      pump()
    }
  }
  const dial = () => {
    const pair = createSimSocketPair({ now, seed: 3 + pairs.length * 2 })
    pairs.push(pair)
    server.attach(pair.server)
    const inbox = []
    pair.client.onMessage = (bytes) => inbox.push(unpack(bytes))
    return { pair, inbox, send: (message) => pair.client.send(pack(message)), take: () => inbox.splice(0) }
  }
  const join = (name = 'ada') => {
    const conn = dial()
    conn.send({ type: MSG.HANDSHAKE, payload: { name } })
    run(2)
    const ack = conn.take().find((m) => m.type === MSG.HANDSHAKE_ACK)
    assert.ok(ack, 'no handshake ack arrived')
    return { conn, playerId: ack.payload.playerId, ack: ack.payload }
  }
  const snapshots = (messages) => messages.filter((m) => m.type === MSG.SNAPSHOT).map((m) => ({ raw: m.payload, decoded: SnapshotEncoder.decode(m.payload) }))
  return { run, dial, join, pump, snapshots }
}
