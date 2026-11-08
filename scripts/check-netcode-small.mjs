import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { PlayerManager } from '../src/netcode/playerManager.js'
import { NetworkState } from '../src/netcode/networkState.js'
import { vecOK, vec3, vec4, num, nonNeg } from '../src/netcode/vecGuard.js'
import { isPlayerOwner, playerIdOf } from '../src/sessions-pure/playerOwner.js'
import { unpack } from '../src/protocol/msgpack.js'

const clockAt = (start) => {
  const clock = { t: start }
  clock.now = () => clock.t
  return clock
}

const lines = []
const log = (line) => lines.push(line)

const transport = ({ accepted = true, throws = null, isOpen } = {}) => {
  const sent = []
  const t = {
    sent,
    send(data) {
      sent.push(data)
      if (throws) throw throws
      return accepted
    },
  }
  if (isOpen !== undefined) t.isOpen = isOpen
  return t
}

const newManager = (start = 5000) => {
  const clock = clockAt(start)
  lines.length = 0
  return { clock, manager: new PlayerManager({ now: clock.now, log }) }
}

const newState = (start = 1234) => {
  const clock = clockAt(start)
  return { clock, state: new NetworkState({ now: clock.now }) }
}

gate('playerManager refuses a missing clock or log', () => {
  assert.throws(() => new PlayerManager(), TypeError)
  assert.throws(() => new PlayerManager({ now: () => 0 }), TypeError)
  assert.throws(() => new PlayerManager({ log }), TypeError)
  assert.doesNotThrow(() => new PlayerManager({ now: () => 0, log }))
})

gate('playerManager ids start at 1 and count up', () => {
  const { manager } = newManager()
  assert.equal(manager.addPlayer(null), 1)
  assert.equal(manager.addPlayer(null), 2)
  assert.equal(manager.nextPlayerId, 3)
  assert.equal(manager.getPlayerCount(), 2)
})

gate('playerManager names are trimmed and capped at 32 characters', () => {
  const { manager } = newManager()
  const a = manager.addPlayer(null, { name: '  Ada  ' })
  const b = manager.addPlayer(null, { name: 'x'.repeat(40) })
  assert.equal(manager.getPlayer(a).name, 'Ada')
  assert.equal(manager.getPlayer(b).name.length, 32)
  assert.equal(manager.getPlayer(b).name, 'x'.repeat(32))
})

gate('playerManager falls back to Player id for blank or non-string names', () => {
  const { manager } = newManager()
  const blank = manager.addPlayer(null, { name: '   ' })
  const numeric = manager.addPlayer(null, { name: 42 })
  assert.equal(manager.getPlayer(blank).name, 'Player 1')
  assert.equal(manager.getPlayer(numeric).name, 'Player 2')
  assert.equal(manager.getPlayer(numeric).state.health, 100)
})

gate('playerManager default state matches spoint player defaults', () => {
  const { manager } = newManager()
  const id = manager.addPlayer(null)
  const p = manager.getPlayer(id)
  assert.deepEqual(p.state.position, [0, 0, 0])
  assert.deepEqual(p.state.rotation, [0, 0, 0, 1])
  assert.deepEqual(p.state.velocity, [0, 0, 0])
  assert.equal(p.state.onGround, false)
  assert.equal(p.state.health, 100)
  assert.equal(p.connected, true)
  assert.equal(p.inputSequence, 0)
  assert.equal(p.lastClientSeq, null)
})

gate('playerManager keeps an explicit zero health and copies the position', () => {
  const { manager } = newManager()
  const position = [1, 2, 3]
  const id = manager.addPlayer(null, { position, health: 0 })
  position[0] = 99
  assert.equal(manager.getPlayer(id).state.health, 0)
  assert.deepEqual(manager.getPlayer(id).state.position, [1, 2, 3])
})

gate('playerManager stamps joinTime from the injected clock', () => {
  const { manager, clock } = newManager(7300)
  const id = manager.addPlayer(null)
  assert.equal(manager.getPlayer(id).joinTime, 7300)
  clock.t = 9000
  const later = manager.addPlayer(null)
  assert.equal(manager.getPlayer(later).joinTime, 9000)
})

gate('playerManager mints an owner only for a live player', () => {
  const { manager } = newManager()
  const id = manager.addPlayer(null)
  const owner = manager.ownerOf(id)
  assert.equal(isPlayerOwner(owner), true)
  assert.equal(playerIdOf(owner), id)
  assert.throws(() => manager.ownerOf(99), new Error('[playerManager] no live player 99 to own'))
  manager.removePlayer(id)
  assert.throws(() => manager.ownerOf(id), Error)
})

gate('playerManager stamps unsequenced inputs with the next sequence', () => {
  const { manager } = newManager(4000)
  const id = manager.addPlayer(null)
  manager.addInput(id, 'left', undefined)
  manager.addInput(id, 'right', NaN)
  const inputs = manager.getInputs(id)
  assert.deepEqual(inputs.map(i => i.sequence), [1, 2])
  assert.deepEqual(inputs.map(i => i.timestamp), [4000, 4000])
  assert.equal(manager.getPlayer(id).inputSequence, 2)
  assert.equal(manager.getPlayer(id).lastInputTime, 4000)
})

gate('playerManager caps the input buffer at 128 and drops the oldest', () => {
  const { manager } = newManager()
  const id = manager.addPlayer(null)
  for (let i = 0; i < 130; i++) manager.addInput(id, i, undefined)
  const inputs = manager.getInputs(id)
  assert.equal(inputs.length, 128)
  assert.equal(inputs[0].sequence, 3)
  assert.equal(inputs[127].sequence, 130)
})

gate('playerManager inserts client sequences in order and drops duplicates', () => {
  const { manager } = newManager()
  const id = manager.addPlayer(null)
  manager.addInput(id, 'a', 5)
  manager.addInput(id, 'b', 3)
  manager.addInput(id, 'c', 4)
  assert.deepEqual(manager.getInputs(id).map(i => i.sequence), [3, 4, 5])
  assert.equal(manager.getPlayer(id).lastClientSeq, 5)
  manager.addInput(id, 'd', 4)
  assert.equal(manager.getInputs(id).length, 3)
})

gate('playerManager ignores client sequences at or below the acknowledged one', () => {
  const { manager } = newManager()
  const id = manager.addPlayer(null)
  manager.getPlayer(id).ackSequence = 4
  manager.addInput(id, 'e', 4)
  manager.addInput(id, 'f', 2)
  assert.equal(manager.getInputs(id).length, 0)
  manager.addInput(id, 'g', 6)
  assert.deepEqual(manager.getInputs(id).map(i => i.sequence), [6])
  assert.equal(manager.ackSequenceOf(id), 4)
  assert.equal(manager.ackSequenceOf(99), 0)
})

gate('playerManager clearInputs and removePlayer empty the input buffer', () => {
  const { manager } = newManager()
  const id = manager.addPlayer(null)
  manager.addInput(id, 'a', undefined)
  manager.clearInputs(id)
  assert.deepEqual(manager.getInputs(id), [])
  manager.addInput(id, 'b', undefined)
  manager.removePlayer(id)
  assert.deepEqual(manager.getInputs(id), [])
  assert.equal(manager.getPlayer(id), undefined)
})

gate('playerManager broadcast packs the message and reports skipped players', () => {
  const { manager } = newManager()
  const withSocket = transport()
  const a = manager.addPlayer(withSocket)
  manager.addPlayer(null)
  const outcome = manager.broadcast({ type: 'hi', n: 1 })
  assert.deepEqual(outcome, { delivered: 1, failed: [], skipped: 1 })
  assert.equal(withSocket.sent.length, 1)
  assert.ok(withSocket.sent[0] instanceof Uint8Array)
  assert.deepEqual(unpack(withSocket.sent[0]), { type: 'hi', n: 1 })
  assert.equal(manager.getPlayer(a).connected, true)
})

gate('playerManager broadcastBinary hands the buffer over unchanged', () => {
  const { manager } = newManager()
  const t = transport()
  manager.addPlayer(t)
  const buffer = new Uint8Array([7, 8, 9])
  assert.deepEqual(manager.broadcastBinary(buffer), { delivered: 1, failed: [], skipped: 0 })
  assert.equal(t.sent[0], buffer)
})

gate('playerManager marks a closed peer disconnected and logs the reason once', () => {
  const { manager } = newManager()
  const closed = transport({ accepted: false, isOpen: false })
  const id = manager.addPlayer(closed)
  const first = manager.broadcast({ type: 'x' })
  assert.deepEqual(first, { delivered: 0, failed: [{ playerId: id, reason: 'peer-not-open' }], skipped: 0 })
  assert.equal(manager.getPlayer(id).connected, false)
  assert.deepEqual(manager.getConnectedPlayers(), [])
  assert.deepEqual(manager.broadcast({ type: 'y' }), { delivered: 0, failed: [], skipped: 0 })
  assert.equal(closed.sent.length, 1)
  assert.equal(manager.sendFailures, 1)
  assert.equal(manager.sendToPlayer(id, { type: 'direct' }), false)
  assert.equal(closed.sent.length, 2)
  assert.equal(manager.sendFailures, 2)
  assert.equal(lines.length, 1)
  assert.equal(lines[0], `[player-manager] send to player ${id} did not deliver (peer-not-open)`)
})

gate('playerManager reports a refusing open peer without disconnecting it', () => {
  const { manager } = newManager()
  const refusing = transport({ accepted: false })
  const id = manager.addPlayer(refusing)
  assert.deepEqual(manager.sendToPlayer(id, { type: 'z' }), false)
  assert.equal(manager.getPlayer(id).connected, true)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /\(transport-refused\)$/)
})

gate('playerManager reports a throwing transport and appends its message', () => {
  const { manager } = newManager()
  const id = manager.addPlayer(transport({ throws: new Error('boom') }))
  const outcome = manager.broadcast({ type: 'w' })
  assert.deepEqual(outcome, { delivered: 0, failed: [{ playerId: id, reason: 'send-threw' }], skipped: 0 })
  assert.equal(lines[0], `[player-manager] send to player ${id} did not deliver (send-threw) -- boom`)
})

gate('playerManager sendToPlayer reports delivery for a known player only', () => {
  const { manager } = newManager()
  const t = transport()
  const id = manager.addPlayer(t)
  assert.equal(manager.sendToPlayer(id, { k: 1 }), true)
  assert.equal(manager.sendToPlayer(99, { k: 1 }), false)
  assert.equal(manager.sendBinaryToPlayer(id, new Uint8Array([1])), true)
  assert.equal(manager.sendBinaryToPlayer(99, new Uint8Array([1])), false)
  assert.equal(t.sent.length, 2)
})

gate('playerManager control: an unpackable message is refused before any send', () => {
  const { manager } = newManager()
  const t = transport()
  manager.addPlayer(t)
  assert.throws(() => manager.broadcast({ f: () => 1 }), /^Error: \[player-manager\] encode-failed/)
  assert.equal(t.sent.length, 0)
  assert.equal(manager.sendFailures, 0)
})

gate('playerManager connected-player cache follows add and remove', () => {
  const { manager } = newManager()
  const first = manager.addPlayer(null)
  assert.deepEqual(manager.getConnectedPlayers().map(p => p.id), [first])
  const second = manager.addPlayer(null)
  assert.deepEqual(manager.getConnectedPlayers().map(p => p.id), [first, second])
  manager.removePlayer(first)
  assert.deepEqual(manager.getConnectedPlayers().map(p => p.id), [second])
})

gate('playerManager merges state and movement overrides by id', () => {
  const { manager } = newManager()
  const id = manager.addPlayer(null)
  manager.updatePlayerState(id, { onGround: true, health: 40 })
  assert.equal(manager.getPlayer(id).state.onGround, true)
  assert.equal(manager.getPlayer(id).state.health, 40)
  manager.updatePlayerState(99, { health: 1 })
  assert.equal(manager.setMovementOverride(99, { speed: 2 }), false)
  assert.equal(manager.setMovementOverride(id, { speed: 2 }), true)
  assert.deepEqual(manager.getMovementOverride(id), { speed: 2 })
  assert.equal(manager.setMovementOverride(id, null), true)
  assert.equal(manager.getMovementOverride(id), null)
})

gate('playerManager snapshot and restore round-trip the player record', () => {
  const { manager } = newManager()
  const id = manager.addPlayer(null, { position: [1, 2, 3] })
  manager.addInput(id, 'a', 2)
  manager.setMovementOverride(id, { speed: 3 })
  const snap = manager.snapshotState()
  manager.updatePlayerState(id, { health: 1 })
  manager.setMovementOverride(id, null)
  manager.restoreState(snap)
  const p = manager.getPlayer(id)
  assert.equal(p.state.health, 100)
  assert.deepEqual(p.state.position, [1, 2, 3])
  assert.equal(p.lastClientSeq, 2)
  assert.deepEqual(p.movementOverride, { speed: 3 })
  manager.restoreState(new Map([[id, { state: p.state, inputSequence: 0, lastClientSeq: null, ackSequence: 0 }]]))
  assert.equal(manager.getPlayer(id).movementOverride, undefined)
})

gate('playerManager control: restore skips ids that are no longer live', () => {
  const { manager } = newManager()
  const id = manager.addPlayer(null)
  const snap = manager.snapshotState()
  manager.removePlayer(id)
  manager.restoreState(snap)
  assert.equal(manager.getPlayer(id), undefined)
  assert.equal(manager.getPlayerCount(), 0)
})

gate('networkState refuses a missing clock', () => {
  assert.throws(() => new NetworkState(), TypeError)
  assert.throws(() => new NetworkState({}), TypeError)
})

gate('networkState addPlayer applies spoint defaults and stamps lastUpdate', () => {
  const { state } = newState(1234)
  state.addPlayer(7)
  const p = state.getPlayer(7)
  assert.deepEqual(p.position, [0, 0, 0])
  assert.deepEqual(p.rotation, [0, 0, 0, 1])
  assert.deepEqual(p.velocity, [0, 0, 0])
  assert.equal(p.onGround, false)
  assert.equal(p.health, 100)
  assert.equal(p.inputBuffer, 0)
  assert.equal(p.groundNormal, null)
  assert.equal(p.wallNormals, null)
  assert.equal(p.lastUpdate, 1234)
})

gate('networkState addPlayer keeps an explicit onGround false and health zero', () => {
  const { state } = newState()
  state.addPlayer(8, { onGround: true, health: 0 })
  state.addPlayer(9, { onGround: false })
  assert.equal(state.getPlayer(8).onGround, true)
  assert.equal(state.getPlayer(8).health, 0)
  assert.equal(state.getPlayer(9).onGround, false)
})

gate('networkState updatePlayer takes valid vectors and defaults expr and weapon to zero', () => {
  const { state } = newState()
  state.addPlayer(7)
  state.updatePlayer(7, [1, 2, 3], [0, 0, 0, 1], [4, 5, 6], true, 90, 12, 1, 0.5, -0.5, undefined, null, 3, [0, 1, 0], [[1, 0, 0]])
  const p = state.getPlayer(7)
  assert.deepEqual(p.position, [1, 2, 3])
  assert.deepEqual(p.velocity, [4, 5, 6])
  assert.equal(p.onGround, true)
  assert.equal(p.health, 90)
  assert.equal(p.inputSequence, 12)
  assert.equal(p.crouch, 1)
  assert.equal(p.expr, 0)
  assert.equal(p.weapon, 0)
  assert.equal(p.inputBuffer, 3)
  assert.deepEqual(p.groundNormal, [0, 1, 0])
  assert.deepEqual(p.wallNormals, [[1, 0, 0]])
})

gate('networkState updatePlayer keeps the previous vector when the new one is invalid', () => {
  const { state } = newState()
  state.addPlayer(7, { position: [9, 9, 9], rotation: [0, 0, 0, 1], velocity: [1, 1, 1] })
  state.updatePlayer(7, [1, NaN, 3], [0, 0, 1], 'fast', false, 100, 1, 0, 0, 0, 0, 0)
  const p = state.getPlayer(7)
  assert.deepEqual(p.position, [9, 9, 9])
  assert.deepEqual(p.rotation, [0, 0, 0, 1])
  assert.deepEqual(p.velocity, [1, 1, 1])
  assert.equal(p.onGround, false)
})

gate('networkState updatePlayer ignores an unknown id', () => {
  const { state } = newState()
  state.updatePlayer(99, [0, 0, 0], [0, 0, 0, 1], [0, 0, 0], true, 1, 1, 0, 0, 0, 0, 0)
  assert.equal(state.getPlayer(99), undefined)
  assert.equal(state.getAllPlayers().length, 0)
})

gate('networkState setTick takes its timestamp from the clock by default', () => {
  const { state, clock } = newState(555)
  state.setTick(5)
  assert.equal(state.tick, 5)
  assert.equal(state.timestamp, 555)
  clock.t = 600
  state.setTick(6)
  assert.equal(state.timestamp, 600)
  state.setTick(7, 99)
  assert.equal(state.timestamp, 99)
})

gate('networkState getSnapshot reuses one record per player and one output object', () => {
  const { state } = newState()
  state.addPlayer(7, { position: [1, 0, 0] })
  state.addPlayer(8)
  state.setTick(4, 40)
  const first = state.getSnapshot()
  const firstRecord = first.players[0]
  const second = state.getSnapshot()
  assert.equal(second, first)
  assert.equal(second.players[0], firstRecord)
  assert.equal(second.tick, 4)
  assert.equal(second.timestamp, 40)
  assert.deepEqual(second.players.map(p => p.id), [7, 8])
  assert.deepEqual(second.players[0].position, [1, 0, 0])
  assert.equal(second.players[0].groundNormal, null)
})

gate('networkState getSnapshot prunes removed players', () => {
  const { state } = newState()
  state.addPlayer(7)
  state.addPlayer(8)
  state.getSnapshot()
  state.removePlayer(7)
  const snap = state.getSnapshot()
  assert.deepEqual(snap.players.map(p => p.id), [8])
})

gate('networkState snapshot and restore round-trip tick and players', () => {
  const { state } = newState()
  state.addPlayer(7, { position: [1, 2, 3] })
  state.setTick(9, 90)
  const snap = state.snapshotState()
  state.setTick(10, 100)
  state.updatePlayer(7, [5, 5, 5], [0, 0, 0, 1], [0, 0, 0], false, 1, 2, 0, 0, 0, 0, 0)
  state.restoreState(snap)
  assert.equal(state.tick, 9)
  assert.equal(state.timestamp, 90)
  assert.deepEqual(state.getPlayer(7).position, [1, 2, 3])
})

gate('networkState restore accepts a plain object of players and skips unknown ids', () => {
  const { state } = newState()
  state.addPlayer(7)
  const restored = { tick: 3, timestamp: 30, players: { 7: { id: 7, health: 42, position: [0, 0, 0] }, 99: { id: 99, health: 1 } } }
  state.restoreState(restored)
  assert.equal(state.getPlayer(7).health, 42)
  assert.equal(state.getPlayer(99), undefined)
  assert.equal(state.getAllPlayers().length, 1)
})

gate('networkState clear removes every player', () => {
  const { state } = newState()
  state.addPlayer(7)
  state.addPlayer(8)
  state.clear()
  assert.equal(state.getAllPlayers().length, 0)
})

gate('vecOK accepts only arrays of the exact length with finite numbers', () => {
  assert.equal(vecOK([1, 2, 3], 3), true)
  assert.equal(vecOK([0, 0, 0, 1], 4), true)
  assert.equal(vecOK([1, 2], 3), false)
  assert.equal(vecOK([1, '2', 3], 3), false)
  assert.equal(vecOK([Infinity, 0, 0], 3), false)
  assert.equal(vecOK([1, NaN, 3], 3), false)
  assert.equal(vecOK(null, 3), false)
  assert.equal(vecOK({ 0: 1, 1: 2, 2: 3, length: 3 }, 3), false)
})

gate('vec3 and vec4 return the value or throw the spoint message', () => {
  const v = [1, 2, 3]
  assert.equal(vec3(v, 'pos'), v)
  assert.throws(() => vec3([1, 2], 'pos'), new TypeError('entity.pos must be a length-3 array of finite numbers'))
  assert.equal(vec4([0, 0, 0, 1], 'rot')[3], 1)
  assert.throws(() => vec4([0, 0, 1], 'rot'), TypeError)
})

gate('num and nonNeg reject non-numbers, NaN and infinities', () => {
  assert.equal(num(2.5, 'x'), 2.5)
  assert.throws(() => num(NaN, 'x'), new TypeError('x must be a finite number'))
  assert.throws(() => num('1', 'x'), TypeError)
  assert.equal(nonNeg(0, 'x'), 0)
  assert.throws(() => nonNeg(-1, 'x'), new TypeError('x must be a non-negative finite number'))
  assert.throws(() => nonNeg(Infinity, 'x'), TypeError)
})

finish()
