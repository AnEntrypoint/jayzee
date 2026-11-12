import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createTickHost } from '../src/tick-host/tickHost.js'
import { createGroundCharacterWorld } from '../src/tick-host/groundCharacterWorld.js'
import { World } from '../src/world/World.js'
import { MSG } from '../src/protocol/messages.js'
import { unpack } from '../src/protocol/msgpack.js'
import { SnapshotEncoder } from '../src/snapshot-lod-pure/snapshotEncoder.js'
import { PLAYER_TIER_REDUCED } from '../src/snapshot-lod-pure/records.js'
import { createSimLink } from '../src/transport/simTransport.js'
import { TELEPORT_HOLD_MAX_MS } from '../src/sessions-pure/teleportHold.js'

const TICK_MS = 1000 / 60
const QUANTUM = 0.02

const makeSocket = (clock, profile = {}) => {
  const link = createSimLink({ seed: 7, profile })
  let open = true
  return {
    get isOpen() { return open },
    send(bytes) {
      if (!open) return false
      return link.send(Uint8Array.from(bytes), clock.t)
    },
    close() { open = false },
    receive() { return link.advance(clock.t).map((entry) => unpack(entry.payload)) },
  }
}

const rig = (options = {}) => {
  const clock = { t: 1000 }
  const trace = []
  const state = { loaded: true }
  const characters = createGroundCharacterWorld({ heightAt: (x) => (x > 500 && !state.loaded ? null : 0) })
  const bodies = new World({ capacity: 4, gravity: -18, drag: 0.1, radius: 0.35, restitution: 0.2, solverIterations: 8 })
  const bodyPosition = [0, 0, 0]
  const entityRecord = { id: 'crate', model: 'crate.glb', position: bodyPosition, rotation: [0, 0, 0, 1], velocity: [0, 0, 0], bodyType: 'dynamic' }
  const host = createTickHost({
    now: () => clock.t,
    physicsWorld: characters,
    bodyWorld: options.bodies ? bodies : null,
    entities: () => {
      if (!options.bodies) return []
      bodies.position(0, bodyPosition)
      return [entityRecord]
    },
    netcodeConfig: () => options.netcode,
    onStep: (name) => trace.push(name),
  })
  if (options.bodies) bodies.spawn([0, 3, 0])
  const standY = host.physicsIntegration.standingCentreY(0)
  const join = (x, z, y = standY) => {
    const socket = makeSocket(clock)
    const id = host.addPlayer(socket, { position: [x, y, z] })
    return { id, socket, player: host.playerManager.getPlayer(id) }
  }
  const tick = () => {
    clock.t += TICK_MS
    trace.length = 0
    host.tick()
  }
  return { clock, trace, state, characters, bodies, host, join, tick, standY }
}

const snapshotsIn = (messages) => messages.filter((m) => m.type === MSG.SNAPSHOT).map((m) => ({ ...m.payload, decoded: SnapshotEncoder.decode(m.payload) }))
const lastSnapshot = (client) => {
  const all = snapshotsIn(client.socket.receive())
  assert.ok(all.length > 0, 'no snapshot arrived')
  return all[all.length - 1]
}
const playerIn = (snapshot, id) => snapshot.decoded.players.find((p) => p.id === id)
const close = (a, b, label, tolerance = QUANTUM) => assert.ok(Math.abs(a - b) <= tolerance, label + ' is ' + a + ', expected ' + b)
const closeVec = (a, b, label) => { for (let i = 0; i < 3; i++) close(a[i], b[i], label + '[' + i + ']') }

gate('one tick runs the real steps in the pinned order: movement, player collisions, re-anchor, physics, app tick, tiles, snapshot', () => {
  const r = rig()
  r.join(0, 0)
  r.tick()
  assert.deepEqual(r.trace, ['beginTick', 'setTick', 'connectedPlayers', 'updateStall', 'adjustSnapshotRate', 'movement', 'playerCollisions', 'chartReanchor', 'physicsStep', 'appRuntimeTick', 'collisionTiles', 'snapshot'])
  assert.equal(r.characters.stepCount, 1)
  const empty = rig()
  empty.tick()
  assert.ok(!empty.trace.includes('snapshot') && !empty.trace.includes('collisionTiles'), 'a host with no players sends nothing')
  assert.ok(r.trace.indexOf('movement') < r.trace.indexOf('playerCollisions') && r.trace.indexOf('playerCollisions') < r.trace.indexOf('physicsStep') && r.trace.indexOf('physicsStep') < r.trace.indexOf('snapshot'))
})

gate('the snapshot of a tick carries the position that tick moved the player to, and the input it consumed', () => {
  const r = rig()
  const a = r.join(0, 0)
  for (let i = 0; i < 5; i++) r.tick()
  a.socket.receive()
  const before = [...a.player.state.position]
  r.host.receiveInput(a.id, { forward: true, yaw: 0 }, 1)
  r.tick()
  const snapshot = lastSnapshot(a)
  const seen = playerIn(snapshot, a.id)
  assert.equal(snapshot.tick, r.host.tickNumber)
  assert.ok(a.player.state.position[2] > before[2] + 0.001, 'the player did not move forward')
  closeVec(seen.position, a.player.state.position, 'snapshot position')
  assert.ok(seen.position[2] > before[2], 'the snapshot shows the position from before the tick')
  assert.equal(seen.onGround, true)
  const me = SnapshotEncoder.decode({ ...snapshot, players: snapshot.players }).me
  assert.equal(me.inputSequence, 1)
  assert.equal(snapshot.me[0], 1)
})

gate('two overlapping players are pushed apart before the snapshot, and the character world holds the pushed positions', () => {
  const r = rig()
  const a = r.join(0, 0)
  const b = r.join(0.1, 0)
  const gapBefore = b.player.state.position[0] - a.player.state.position[0]
  r.tick()
  const snapshot = lastSnapshot(a)
  const seenA = playerIn(snapshot, a.id)
  const seenB = playerIn(snapshot, b.id)
  const gapAfter = b.player.state.position[0] - a.player.state.position[0]
  assert.ok(gapAfter > gapBefore + 0.001, 'the pair was not pushed apart: ' + gapAfter)
  close(seenB.position[0] - seenA.position[0], gapAfter, 'gap in the snapshot')
  assert.ok(seenB.position[0] - seenA.position[0] > gapBefore + 0.001, 'the snapshot shows the gap from before the collision step')
  closeVec(r.host.physicsIntegration.getPlayerPosition(a.id), a.player.state.position, 'character a')
  closeVec(r.host.physicsIntegration.getPlayerPosition(b.id), b.player.state.position, 'character b')
})

gate('the body world steps before the snapshot: the snapshot of a tick holds the falling body where that tick left it', () => {
  const r = rig({ bodies: true })
  const a = r.join(0, 0)
  const at = [0, 0, 0]
  for (let i = 0; i < 6; i++) {
    const beforeY = r.bodies.position(0, at)[1]
    r.tick()
    const afterY = r.bodies.position(0, at)[1]
    assert.ok(afterY < beforeY, 'the body did not fall on tick ' + i)
    const snapshot = lastSnapshot(a)
    assert.equal(snapshot.decoded.entities.length, 1)
    close(snapshot.decoded.entities[0].position[1], afterY, 'entity y on tick ' + i, 0.005)
    assert.ok(Math.abs(snapshot.decoded.entities[0].position[1] - beforeY) > 0.0005 || i === 0, 'the snapshot shows the body from before the step')
  }
})

gate('control: the same steps with the snapshot taken first send the state from before the tick', () => {
  const r = rig({ bodies: true })
  const a = r.join(0, 0)
  for (let i = 0; i < 5; i++) r.tick()
  a.socket.receive()
  r.host.receiveInput(a.id, { forward: true, yaw: 0 }, 1)
  const steps = r.host.steps
  const players = r.host.playerManager.getConnectedPlayers()
  const tick = r.host.tickNumber + 1
  const at = [0, 0, 0]
  const zBefore = a.player.state.position[2]
  const bodyBefore = r.bodies.position(0, at)[1]
  r.clock.t += TICK_MS
  steps.beginTick(tick)
  steps.setTick(tick)
  steps.snapshot(tick, players)
  steps.movement(players, tick, r.host.dt, null)
  steps.playerCollisions(players, r.host.dt)
  steps.physicsStep(r.host.dt)
  const stale = lastSnapshot(a)
  const bodyAfter = r.bodies.position(0, at)[1]
  assert.ok(a.player.state.position[2] > zBefore + 0.001)
  close(playerIn(stale, a.id).position[2], zBefore, 'stale z')
  assert.ok(Math.abs(playerIn(stale, a.id).position[2] - a.player.state.position[2]) > QUANTUM, 'the misordered snapshot matched the moved state')
  close(stale.decoded.entities[0].position[1], bodyBefore, 'stale body y', 0.005)
  assert.ok(Math.abs(stale.decoded.entities[0].position[1] - bodyAfter) > 0.005, 'the misordered snapshot matched the stepped body')
})

gate('a teleport onto ground that has not loaded holds the player in place, and releases onto the ground once it loads', () => {
  const r = rig()
  const a = r.join(0, 0)
  for (let i = 0; i < 3; i++) r.tick()
  a.socket.receive()
  r.state.loaded = false
  r.host.teleport(a.id, [600, 50, 0])
  r.host.receiveInput(a.id, { forward: true, yaw: 0 }, 1)
  for (let i = 0; i < 30; i++) {
    r.tick()
    assert.deepEqual(a.player.state.position, [600, 50, 0], 'held position on tick ' + i)
    assert.deepEqual(a.player.state.velocity, [0, 0, 0])
    assert.equal(a.player.state.onGround, true)
  }
  const held = a.socket.receive()
  assert.deepEqual(held.find((m) => m.type === MSG.TELEPORT).payload.position, [600, 50, 0])
  assert.ok(!held.some((m) => m.type === MSG.TELEPORT_ACK), 'released while the ground was missing')
  const heldSnapshots = snapshotsIn(held)
  assert.equal(heldSnapshots.length, 30)
  for (const snapshot of heldSnapshots) closeVec(playerIn(snapshot, a.id).position, [600, 50, 0], 'held snapshot position')
  r.state.loaded = true
  r.tick()
  const release = r.host.teleportReleases[0]
  assert.equal(release.groundHit, true)
  close(release.groundY, 0, 'ground y', 1e-6)
  close(release.heldMs, 31 * TICK_MS, 'held time', 1e-6)
  assert.equal(a.player.teleportHold, null)
  const after = a.socket.receive()
  const ack = after.find((m) => m.type === MSG.TELEPORT_ACK)
  assert.equal(ack.payload.groundHit, true)
  close(ack.payload.position[1], r.standY, 'released height', 1e-6)
  for (let i = 0; i < 5; i++) r.tick()
  assert.equal(a.player.state.onGround, true)
  close(a.player.state.position[1], r.standY, 'standing height after release', 1e-6)
  assert.ok(a.player.state.position[1] < 50, 'the player is still at the teleport height')
})

gate('a teleport hold with no ground ever gives up at its deadline, and only then does the player fall', () => {
  const r = rig()
  const a = r.join(0, 0)
  r.state.loaded = false
  r.host.teleport(a.id, [600, 50, 0], { maxMs: 500 })
  const holdTicks = Math.ceil(500 / TICK_MS)
  for (let i = 0; i < holdTicks - 1; i++) r.tick()
  assert.deepEqual(a.player.state.position, [600, 50, 0])
  assert.equal(r.host.teleportReleases.length, 0)
  for (let i = 0; i < 10; i++) r.tick()
  assert.equal(r.host.teleportReleases.length, 1)
  assert.equal(r.host.teleportReleases[0].groundHit, false)
  assert.ok(r.host.teleportReleases[0].heldMs >= 500)
  assert.ok(a.player.state.position[1] < 50, 'the player did not fall after the deadline')
  assert.equal(TELEPORT_HOLD_MAX_MS, 8000)
  const free = rig()
  const b = free.join(600, 0, 50)
  free.state.loaded = false
  for (let i = 0; i < 10; i++) free.tick()
  assert.ok(b.player.state.position[1] < 50, 'control: a player with no hold falls at once')
  assert.throws(() => r.host.teleport(99, [0, 0, 0]), RangeError)
  assert.throws(() => r.host.teleport(a.id, [0, NaN, 0]), RangeError)
})

gate('each connected client is sent one snapshot a tick with a rising sequence, and a closed socket is dropped from the send', () => {
  const r = rig()
  const a = r.join(0, 0)
  const b = r.join(5, 0)
  for (let i = 0; i < 10; i++) r.tick()
  const forA = snapshotsIn(a.socket.receive())
  const forB = snapshotsIn(b.socket.receive())
  assert.deepEqual(forA.map((s) => s.seq), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.deepEqual(forB.map((s) => s.tick), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(forA[9].decoded.players.length, 2)
  assert.equal(r.host.stats.snapshots, 20)
  b.socket.close()
  for (let i = 0; i < 5; i++) r.tick()
  assert.equal(b.player.connected, false)
  assert.equal(r.host.stats.snapshots, 25)
  assert.equal(snapshotsIn(a.socket.receive()).length, 5)
  assert.equal(r.host.removePlayer(b.id), true)
  assert.equal(r.host.removePlayer(b.id), false)
  assert.equal(r.characters.characterCount, 1)
})

gate('a configured 20 Hz snapshot rate sends on every third tick once the rate is adopted', () => {
  const r = rig({ netcode: { snapshotRate: 20 } })
  const a = r.join(0, 0)
  for (let i = 0; i < 64; i++) r.tick()
  a.socket.receive()
  assert.equal(r.host.snapshotRate.interval, 3)
  for (let i = 0; i < 60; i++) r.tick()
  const ticks = snapshotsIn(a.socket.receive()).map((s) => s.tick)
  assert.equal(ticks.length, 20)
  assert.ok(ticks.every((t) => t % 3 === 0), 'ticks ' + ticks)
})

gate('a crowd of 40 is sent as 30 full records, reduced poses five times a second and dots beyond 120 m, with mixed-sign dot cells intact', () => {
  const r = rig()
  const viewer = r.join(0, 0)
  for (let i = 1; i <= 30; i++) r.join(i * 1.5, 0)
  for (let i = 0; i < 4; i++) r.join(60 + i * 2, 20)
  for (let i = 0; i < 5; i++) r.join(760 + i, -740)
  for (let i = 0; i < 60; i++) r.tick()
  const snapshots = snapshotsIn(viewer.socket.receive())
  assert.equal(snapshots.length, 60)
  let reducedRecords = 0
  for (const snapshot of snapshots) {
    const full = snapshot.players.filter((p) => p.length === 8)
    assert.equal(full.length, 31)
    reducedRecords += snapshot.players.filter((p) => p.length === 5 && p[4] === PLAYER_TIER_REDUCED).length
    assert.deepEqual(snapshot.dots, [[30, -30, 5]])
  }
  assert.equal(reducedRecords, 4 * 5)
})

gate('the host refuses a missing clock, a bad tick rate and a non-finite spawn', () => {
  assert.throws(() => createTickHost({}), TypeError)
  assert.throws(() => createTickHost({ now: () => 0, tickRate: 0 }), RangeError)
  const host = createTickHost({ now: () => 0 })
  assert.throws(() => host.addPlayer(null, { position: [0, NaN, 0] }), RangeError)
})

finish()
