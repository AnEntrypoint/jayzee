import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createConnectionHost } from '../src/sessions-host/connectionHost.js'
import { createTickHost } from '../src/tick-host/tickHost.js'
import { createGroundCharacterWorld } from '../src/tick-host/groundCharacterWorld.js'
import { createSimSocketPair } from '../src/transport/simSocketPair.js'
import { ReconnectManager } from '../src/client/ReconnectManager.js'
import { DISCONNECT_REASONS, MSG } from '../src/protocol/messages.js'
import { pack, unpack } from '../src/protocol/msgpack.js'
import { SnapshotEncoder } from '../src/snapshot-lod-pure/snapshotEncoder.js'

const TICK_MS = 1000 / 60

const rig = ({ profile = {} } = {}) => {
  const clock = { t: 50000 }
  const now = () => clock.t
  const tickHost = createTickHost({ now, physicsWorld: createGroundCharacterWorld() })
  const standY = tickHost.physicsIntegration.standingCentreY(0)
  let fillByte = 0
  const randomFill = (bytes) => { for (let i = 0; i < bytes.length; i++) bytes[i] = (fillByte = (fillByte * 73 + 41) & 255) }
  const host = createConnectionHost({ tickHost, now, snapSpawn: () => [0, standY, 0], randomFill })
  const pairs = []
  const timers = []
  const dial = () => {
    const pair = createSimSocketPair({ now, seed: 3 + pairs.length * 2, profile })
    pairs.push(pair)
    host.attach(pair.server)
    const inbox = []
    const closes = []
    pair.client.onMessage = (bytes) => inbox.push(unpack(bytes))
    pair.client.onClose = () => closes.push(clock.t)
    const transport = { isOpen: () => pair.client.isOpen, send: (message) => pair.client.send(pack(message)) }
    return { pair, inbox, closes, transport, take: () => inbox.splice(0), close: () => pair.client.close() }
  }
  const pump = () => { for (const pair of pairs) pair.pump() }
  const run = (ticks) => {
    for (let i = 0; i < ticks; i++) {
      clock.t += TICK_MS
      pump()
      for (const timer of timers.splice(0)) {
        if (timer.at <= clock.t && !timer.cancelled) timer.callback()
        else if (!timer.cancelled) timers.push(timer)
      }
      tickHost.tick()
      pump()
    }
  }
  const wait = (ms) => {
    clock.t += ms
    pump()
  }
  const setTimer = (callback, delayMs) => {
    const timer = { at: clock.t + delayMs, callback, cancelled: false }
    timers.push(timer)
    return timer
  }
  const clearTimer = (timer) => { timer.cancelled = true }
  const join = () => {
    const conn = dial()
    conn.transport.send({ type: MSG.HANDSHAKE, payload: { name: 'ada' } })
    run(2)
    const ack = conn.take().find((m) => m.type === MSG.HANDSHAKE_ACK)
    assert.ok(ack, 'no handshake ack arrived')
    return { conn, ack: ack.payload }
  }
  return { clock, tickHost, host, dial, pump, run, wait, join, setTimer, clearTimer, standY }
}

const snapshots = (messages) => messages.filter((m) => m.type === MSG.SNAPSHOT).map((m) => SnapshotEncoder.decode(m.payload))
const walk = (r, conn, fromSeq, count) => {
  for (let i = 0; i < count; i++) {
    conn.transport.send({ type: MSG.INPUT, payload: { seq: fromSeq + i, input: { forward: true, yaw: 0 } } })
    r.run(1)
  }
}

gate('a handshake over the simulated link is acked with a player id, a 32-hex session token and the 30 s session TTL, and snapshots follow', () => {
  const r = rig({ profile: { latencyMs: 80 } })
  const conn = r.dial()
  conn.transport.send({ type: MSG.HANDSHAKE, payload: { name: 'ada' } })
  r.run(4)
  assert.equal(r.tickHost.playerManager.getPlayerCount(), 0, 'the handshake arrived before the link latency')
  r.run(3)
  assert.equal(r.tickHost.playerManager.getPlayerCount(), 1)
  assert.equal(conn.inbox.length, 0, 'the ack arrived before the link latency')
  r.run(8)
  const messages = conn.take()
  const ack = messages.find((m) => m.type === MSG.HANDSHAKE_ACK).payload
  assert.equal(ack.playerId, 1)
  assert.match(ack.sessionToken, /^[0-9a-f]{32}$/)
  assert.equal(ack.sessionTtlMs, 30000)
  assert.ok(snapshots(messages).length > 0)
  assert.equal(r.tickHost.playerManager.getPlayer(1).name, 'ada')
})

gate('a dropped socket removes the player and keeps the session, and the client reconnect restores its position on a new socket', () => {
  const r = rig()
  const { conn, ack } = r.join()
  walk(r, conn, 1, 40)
  const before = [...r.tickHost.playerManager.getPlayer(ack.playerId).state.position]
  assert.ok(before[2] > 1, 'the player did not walk')
  const manager = new ReconnectManager({ setTimer: r.setTimer, clearTimer: r.clearTimer })
  manager.setSessionToken(ack.sessionToken)
  manager.onConnected()
  conn.close()
  r.run(1)
  assert.equal(r.tickHost.playerManager.getPlayerCount(), 0)
  assert.equal(r.host.stats.disconnects, 1)
  assert.equal(r.host.sessions.getActiveCount(), 1)
  let next = null
  manager.onDisconnected(() => {
    next = r.dial()
    assert.equal(manager.sendReconnectMessage(next.transport), true)
  })
  assert.equal(manager.state, 'waiting')
  r.run(30)
  assert.equal(next, null, 'the retry fired before its 1000 ms delay')
  r.run(40)
  assert.ok(next, 'the retry never fired')
  const messages = next.take()
  const reAck = messages.find((m) => m.type === MSG.RECONNECT_ACK).payload
  manager.onConnected()
  assert.equal(manager.state, 'connected')
  assert.equal(reAck.sessionToken, ack.sessionToken)
  assert.notEqual(reAck.playerId, ack.playerId)
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(reAck.position[i] - before[i]) < 1e-9, 'restored axis ' + i)
  const player = r.tickHost.playerManager.getPlayer(reAck.playerId)
  assert.equal(player.name, 'ada')
  assert.deepEqual(player.state.velocity.map((v) => Math.abs(v) < 1e-9), [true, true, true], 'the player came back moving')
  assert.equal(r.tickHost.playerManager.getPlayerCount(), 1)
  const seen = snapshots(messages)
  assert.ok(seen.length > 0, 'no snapshot on the new socket')
  const self = seen[seen.length - 1].players.find((p) => p.id === reAck.playerId)
  assert.ok(Math.abs(self.position[2] - before[2]) < 0.05, 'the snapshot does not show the restored position')
  assert.ok(Math.abs(self.position[2]) > 1, 'control: the player was respawned at the origin')
  assert.equal(r.host.stats.reconnects, 1)
  walk(r, next, 1, 10)
  assert.ok(player.state.position[2] > before[2] + 0.5, 'inputs on the new socket do not move the player')
})

gate('a session is alive exactly 30 s after the socket drops and dead one millisecond later, and a connected session does not age', () => {
  const attempt = (afterMs, connectedMs = 0) => {
    const r = rig()
    const { conn, ack } = r.join()
    if (connectedMs > 0) r.wait(connectedMs)
    conn.close()
    r.pump()
    r.wait(afterMs)
    const next = r.dial()
    next.transport.send({ type: MSG.RECONNECT, payload: { sessionToken: ack.sessionToken } })
    r.pump()
    r.pump()
    return { r, next, messages: next.take() }
  }
  const alive = attempt(30000)
  assert.ok(alive.messages.some((m) => m.type === MSG.RECONNECT_ACK), 'refused at exactly the TTL')
  const dead = attempt(30001)
  assert.ok(!dead.messages.some((m) => m.type === MSG.RECONNECT_ACK))
  assert.equal(dead.messages.find((m) => m.type === MSG.DISCONNECT_REASON).payload.code, DISCONNECT_REASONS.INVALID_SESSION)
  assert.equal(dead.next.pair.client.isOpen, false, 'the refused socket stayed open')
  assert.equal(dead.next.closes.length, 1)
  assert.equal(dead.r.tickHost.playerManager.getPlayerCount(), 0)
  assert.equal(dead.r.host.sessions.getActiveCount(), 0)
  const longPlay = attempt(29000, 120000)
  assert.ok(longPlay.messages.some((m) => m.type === MSG.RECONNECT_ACK), 'a session aged while its player was connected')
})

gate('an unknown token, a short token and an undecodable or unexpected first message are refused and the socket is closed', () => {
  const r = rig()
  const refusedWith = (send) => {
    const conn = r.dial()
    send(conn)
    r.pump()
    r.pump()
    const reason = conn.take().find((m) => m.type === MSG.DISCONNECT_REASON)
    assert.equal(conn.pair.client.isOpen, false)
    return reason.payload.code
  }
  assert.equal(refusedWith((c) => c.transport.send({ type: MSG.RECONNECT, payload: { sessionToken: 'f'.repeat(32) } })), DISCONNECT_REASONS.INVALID_SESSION)
  assert.equal(refusedWith((c) => c.transport.send({ type: MSG.RECONNECT, payload: { sessionToken: 'abc' } })), DISCONNECT_REASONS.INVALID_SESSION)
  assert.equal(refusedWith((c) => c.transport.send({ type: MSG.MIGRATE, payload: { sessionToken: 'f'.repeat(32) } })), DISCONNECT_REASONS.INVALID_SESSION)
  assert.equal(refusedWith((c) => c.pair.client.send(Uint8Array.of(0xc1, 0xc1, 0xc1))), DISCONNECT_REASONS.PROTOCOL_MISMATCH)
  assert.equal(refusedWith((c) => c.transport.send({ type: MSG.INPUT, payload: { seq: 1, input: {} } })), DISCONNECT_REASONS.PROTOCOL_MISMATCH)
  assert.equal(r.host.stats.refusals, 5)
  assert.equal(r.host.connectionCount, 0)
  assert.equal(r.tickHost.playerManager.getPlayerCount(), 0)
})

gate('a migrate moves the live player to the new socket: same player, same input sequence, snapshots only on the new path', () => {
  const r = rig()
  const { conn, ack } = r.join()
  walk(r, conn, 1, 20)
  const player = r.tickHost.playerManager.getPlayer(ack.playerId)
  const ackBefore = player.ackSequence
  const zBefore = player.state.position[2]
  assert.equal(ackBefore, 20)
  conn.take()
  const next = r.dial()
  next.transport.send({ type: MSG.MIGRATE, payload: { sessionToken: ack.sessionToken } })
  r.run(2)
  const migrated = next.take()
  const migrateAck = migrated.find((m) => m.type === MSG.MIGRATE_ACK).payload
  assert.deepEqual({ playerId: migrateAck.playerId, resumed: migrateAck.resumed }, { playerId: ack.playerId, resumed: true })
  assert.equal(r.tickHost.playerManager.getPlayer(ack.playerId), player, 'the player was rebuilt')
  assert.equal(r.tickHost.playerManager.getPlayerCount(), 1)
  assert.equal(r.host.stats.disconnects, 0)
  assert.equal(conn.pair.client.isOpen, false, 'the old path stayed open')
  assert.equal(r.host.playerIdOf(next.pair.server), ack.playerId)
  assert.equal(r.host.playerIdOf(conn.pair.server), null)
  conn.take()
  walk(r, next, 21, 10)
  assert.equal(player.ackSequence, 30)
  assert.ok(player.state.position[2] > zBefore + 0.5)
  assert.equal(snapshots(conn.take()).length, 0, 'snapshots still reach the old path')
  const seen = snapshots(next.take())
  assert.ok(seen.length >= 10)
  assert.equal(seen[seen.length - 1].me.inputSequence, 30)
  next.close()
  r.run(1)
  assert.equal(r.tickHost.playerManager.getPlayerCount(), 0)
  assert.equal(r.host.stats.disconnects, 1)
})

gate('a migrate after the old path has died resumes from the saved session, and a reconnect with a live token takes the player over', () => {
  const r = rig()
  const { conn, ack } = r.join()
  walk(r, conn, 1, 20)
  const z = r.tickHost.playerManager.getPlayer(ack.playerId).state.position[2]
  conn.close()
  r.run(1)
  const next = r.dial()
  next.transport.send({ type: MSG.MIGRATE, payload: { sessionToken: ack.sessionToken } })
  r.run(2)
  const migrateAck = next.take().find((m) => m.type === MSG.MIGRATE_ACK).payload
  assert.equal(migrateAck.resumed, false)
  assert.ok(Math.abs(r.tickHost.playerManager.getPlayer(migrateAck.playerId).state.position[2] - z) < 0.2)
  const third = r.dial()
  third.transport.send({ type: MSG.RECONNECT, payload: { sessionToken: ack.sessionToken } })
  r.run(2)
  assert.ok(third.take().some((m) => m.type === MSG.RECONNECT_ACK))
  assert.equal(next.pair.client.isOpen, false, 'the socket that was taken over stayed open')
  assert.equal(r.tickHost.playerManager.getPlayerCount(), 1)
  assert.equal(r.host.connectionCount, 1)
})

gate('a heartbeat is answered with its own timestamp and the server time, and the host refuses a missing tick host or clock', () => {
  const r = rig()
  const { conn } = r.join()
  conn.take()
  conn.transport.send({ type: MSG.HEARTBEAT, payload: { timestamp: 1234 } })
  r.run(1)
  const beat = conn.take().find((m) => m.type === MSG.HEARTBEAT_ACK).payload
  assert.equal(beat.timestamp, 1234)
  assert.ok(beat.serverTime > 50000)
  assert.throws(() => createConnectionHost({ now: () => 0 }), TypeError)
  assert.throws(() => createConnectionHost({ tickHost: r.tickHost }), TypeError)
  assert.throws(() => r.host.connect({}), TypeError)
  assert.throws(() => createSimSocketPair({}), TypeError)
})

finish()
