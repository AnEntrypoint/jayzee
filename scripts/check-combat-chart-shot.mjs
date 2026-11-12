import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { createCombatRuntime } from '../src/behaviours/combatRuntime.js'
import { DEFAULT_COMBAT } from '../src/behaviours/combat.js'
import { snapshotChart } from '../src/chart-pure/chartAnchor.js'
import { createChartEpochLedger } from '../src/chart-pure/chartEpochLedger.js'
import { createChartReanchorService } from '../src/chart-pure/chartReanchorService.js'
import { FIRE_REQUEST_TYPE, createFireRequestWriter } from '../src/client/fireRequest.js'
import { DEFAULT_HITBOX } from '../src/netcode/hitscan.js'
import { LagCompensator } from '../src/netcode/lagCompensation.js'
import { NetworkState } from '../src/netcode/networkState.js'
import { PlayerManager } from '../src/netcode/playerManager.js'
import { SHOT_EPOCH_REFUSAL } from '../src/netcode/shotChartEpoch.js'
import { pack, unpack } from '../src/protocol/msgpack.js'
import { createPlayerMigrator } from '../src/sdk/chartState/migratePlayers.js'
import { createPlanetFrame } from '../src/terrain-pure/planetFrame.js'

const RADIUS = 6371000
const TICK_RATE = 60
const SHOOTER_AT = [0, 0, 0]
const TARGET_FROM = [60, 0, -30]
const SPAWNS = [SHOOTER_AT, TARGET_FROM]

const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

const targetPath = (tick) => [TARGET_FROM[0] + 0.2 * tick, TARGET_FROM[1], TARGET_FROM[2] - 0.1 * tick]

function arena({ withLedger = true } = {}) {
  let nowMs = 10000
  const now = () => nowMs
  const frame = createPlanetFrame({ sampler: { radius: RADIUS, heightAt: () => 0 }, anchorDir: [1, 0, 0] })
  const ledger = createChartEpochLedger({ frame })
  const lag = new LagCompensator(1000, TICK_RATE, now)
  const manager = new PlayerManager({ now, log: () => {} })
  const networkState = new NetworkState({ now })
  const sent = []
  const players = {
    list: () => manager.getAllPlayers(),
    get: (id) => manager.getPlayer(id),
    teleport: (id, position) => { const s = manager.getPlayer(id).state; s.position[0] = position[0]; s.position[1] = position[1]; s.position[2] = position[2] },
    applyImpulse: () => {},
  }
  const runtime = createCombatRuntime({
    players, now, lagComp: lag,
    send: (id, message) => sent.push([id, message]),
    broadcast: () => {},
    spawnPoints: SPAWNS,
    chartLedger: withLedger ? ledger : null,
  })
  const shooterId = manager.addPlayer(null, { position: SHOOTER_AT })
  const targetId = manager.addPlayer(null, { position: TARGET_FROM })
  for (const id of [shooterId, targetId]) {
    networkState.addPlayer(id, { position: manager.getPlayer(id).state.position })
    runtime.join(id)
  }
  assert.deepEqual(manager.getPlayer(targetId).state.position, TARGET_FROM)
  const migrate = createPlayerMigrator({ playerManager: manager, networkState, lagCompensator: lag, physics: { applyChartTransfer: () => null, charIdOf: () => null, isGrounded: () => false } })
  const dirs = { list: [unit([1, 0.01, 0.01]), unit([1, 0.011, 0.009])] }
  const service = createChartReanchorService({ frame, radius: RADIUS, playerDirs: () => dirs.list, warn: () => {} })
  service.onReanchor((event) => {
    migrate(event)
    ledger.record(snapshotChart(frame))
  })
  let tick = 0
  for (let k = 1; k <= 40; k++) {
    players.teleport(targetId, targetPath(k))
    tick++
    nowMs += 1000 / TICK_RATE
    lag.beginTick(tick)
    for (const id of [shooterId, targetId]) {
      const s = manager.getPlayer(id).state
      lag.recordPlayerPosition(id, s.position, s.rotation, s.velocity, tick)
    }
  }
  nowMs += DEFAULT_COMBAT.spawnInvulnMs + 1
  const reanchor = () => {
    dirs.list = [unit([1, 0.2, 0.1]), unit([1, 0.21, 0.09])]
    const event = service.step()
    assert.ok(event !== null, 'the service did not re-anchor')
    return event
  }
  const client = { epoch: 0, viewTick: 25 }
  const writer = createFireRequestWriter({ epochOf: () => client.epoch, viewTickOf: () => client.viewTick })
  const aim = () => {
    const eye = [SHOOTER_AT[0], SHOOTER_AT[1] + DEFAULT_HITBOX.centerHeight, SHOOTER_AT[2]]
    const p = targetPath(client.viewTick)
    return { origin: eye, direction: [p[0] - eye[0], p[1] + DEFAULT_HITBOX.centerHeight - eye[1], p[2] - eye[2]] }
  }
  const shootOverWire = () => {
    const { origin, direction } = aim()
    const message = writer.write(origin, direction)
    return unpack(pack(message))
  }
  return { runtime, ledger, lag, manager, shooterId, targetId, sent, reanchor, client, writer, aim, shootOverWire }
}

gate('the client fire request carries type, origin, direction, viewTick and chartEpoch, and reads back the same after msgpack', () => {
  const a = arena()
  const wire = a.shootOverWire()
  assert.equal(FIRE_REQUEST_TYPE, 'fire')
  assert.deepEqual(Object.keys(wire), ['type', 'origin', 'direction', 'viewTick', 'chartEpoch'])
  assert.equal(wire.type, 'fire')
  assert.equal(wire.chartEpoch, 0)
  assert.equal(wire.viewTick, 25)
  assert.deepEqual(wire.origin, a.aim().origin)
  assert.deepEqual(wire.direction, a.aim().direction)
})

gate('the writer reuses one message, holds a shot while the client has no chart epoch, and refuses a malformed aim', () => {
  const a = arena()
  const first = a.writer.write([0, 1, 0], [1, 0, 0])
  const second = a.writer.write([0, 2, 0], [0, 0, 1])
  assert.equal(first, second)
  assert.deepEqual(second.origin, [0, 2, 0])
  a.client.epoch = null
  assert.equal(a.writer.write([0, 1, 0], [1, 0, 0]), null)
  a.client.epoch = 3
  assert.equal(a.writer.write([0, 1, 0], [0, 0, 0]), null)
  assert.equal(a.writer.write([0, NaN, 0], [1, 0, 0]), null)
  assert.equal(a.writer.write([0, 1, 0], [1, 0, 0]).chartEpoch, 3)
  assert.deepEqual(a.writer.stats, { written: 3, heldNoEpoch: 1, refusedShape: 2 })
  assert.throws(() => createFireRequestWriter({ viewTickOf: () => 0 }), /needs epochOf/)
  assert.throws(() => createFireRequestWriter({ epochOf: () => 0 }), /needs viewTickOf/)
})

gate('before any re-anchor the combat fire handler takes the wire message and hits the rewound target for 20', () => {
  const a = arena()
  const result = a.runtime.handleMessage(a.shooterId, a.shootOverWire())
  assert.deepEqual({ ok: result.ok, hit: result.hit, target: result.target, damage: result.damage, rewound: result.rewound }, { ok: true, hit: true, target: a.targetId, damage: 20, rewound: true })
  assert.equal(a.runtime.getStats().reexpressed, 0)
})

gate('a fire message stamped with epoch 0 that arrives after a real re-anchor is re-expressed by the handler and hits the same target', () => {
  const a = arena()
  const wire = a.shootOverWire()
  const event = a.reanchor()
  assert.equal(a.ledger.currentEpoch, 1)
  assert.ok(event.transfer.tiltRad > 0.05, 'tilt ' + event.transfer.tiltRad)
  const result = a.runtime.handleMessage(a.shooterId, wire)
  assert.deepEqual({ ok: result.ok, hit: result.hit, target: result.target, damage: result.damage, rewound: result.rewound }, { ok: true, hit: true, target: a.targetId, damage: 20, rewound: true })
  assert.equal(a.runtime.getStats().reexpressed, 1)
  assert.equal(a.runtime.stateOf(a.targetId).hp, 80)
})

gate('negative control: a handler with no chart ledger takes the same stale message as if it were in the new chart and misses', () => {
  const a = arena({ withLedger: false })
  const wire = a.shootOverWire()
  a.reanchor()
  const result = a.runtime.handleMessage(a.shooterId, wire)
  assert.deepEqual({ ok: result.ok, hit: result.hit }, { ok: true, hit: false })
  assert.equal(a.runtime.stateOf(a.targetId).hp, 100)
})

gate('negative control: the same stale message with its chartEpoch stripped is read in the current chart and misses', () => {
  const a = arena()
  const wire = a.shootOverWire()
  a.reanchor()
  delete wire.chartEpoch
  const result = a.runtime.handleMessage(a.shooterId, wire)
  assert.deepEqual({ ok: result.ok, hit: result.hit }, { ok: true, hit: false })
})

gate('a client that adopted the new epoch aims in the new chart and its shot passes through without re-expression', () => {
  const a = arena()
  const event = a.reanchor()
  a.client.epoch = 1
  const aimed = a.aim()
  const message = a.writer.write(event.transfer.point(aimed.origin), event.transfer.vec(aimed.direction))
  const result = a.runtime.handleMessage(a.shooterId, unpack(pack(message)))
  assert.deepEqual({ ok: result.ok, hit: result.hit, target: result.target }, { ok: true, hit: true, target: a.targetId })
  assert.equal(a.runtime.getStats().reexpressed, 0)
})

gate('a shot from an epoch ahead of the server, or with a non-integer epoch, is refused and costs no round', () => {
  const a = arena()
  const wire = a.shootOverWire()
  const ammo = a.runtime.stateOf(a.shooterId).ammo
  assert.deepEqual(a.runtime.handleMessage(a.shooterId, { ...wire, chartEpoch: 5 }), { ok: false, reason: SHOT_EPOCH_REFUSAL.AHEAD })
  assert.deepEqual(a.runtime.handleMessage(a.shooterId, { ...wire, chartEpoch: 0.5 }), { ok: false, reason: SHOT_EPOCH_REFUSAL.EPOCH_SHAPE })
  assert.equal(a.runtime.stateOf(a.shooterId).ammo, ammo)
  assert.equal(a.runtime.getStats().shots, 0)
  assert.deepEqual(a.runtime.handleMessage(a.shooterId, { ...wire, direction: [0, 0, 0] }), { ok: false, reason: 'bad-direction' })
})

finish()
