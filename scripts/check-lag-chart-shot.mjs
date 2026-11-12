import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { LagCompensator } from '../src/netcode/lagCompensation.js'
import { findHitLinear, findHitSpatial, DEFAULT_HITBOX } from '../src/netcode/hitscan.js'
import { PlayerManager } from '../src/netcode/playerManager.js'
import { NetworkState } from '../src/netcode/networkState.js'
import { createShotEpochResolver, SHOT_EPOCH_REFUSAL } from '../src/netcode/shotChartEpoch.js'
import { createPlayerMigrator } from '../src/sdk/chartState/migratePlayers.js'
import { createChartEpochLedger } from '../src/chart-pure/chartEpochLedger.js'
import { createChartReanchorService } from '../src/chart-pure/chartReanchorService.js'
import { snapshotChart } from '../src/chart-pure/chartAnchor.js'
import { createPlanetFrame } from '../src/terrain-pure/planetFrame.js'

const RADIUS = 6371000
const TICK_RATE = 60
const SHOOTER_AT = [0, 0, 0]
const RANGE = 400

const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

const mulberry = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const targetPath = (index, tick) => [30 + 12 * index + 0.05 * tick, 0.2 * index, -40 + 9 * index - 0.03 * tick]

function world() {
  let nowMs = 0
  const now = () => nowMs
  const frame = createPlanetFrame({ sampler: { radius: RADIUS, heightAt: () => 0 }, anchorDir: [1, 0, 0] })
  const ledger = createChartEpochLedger({ frame })
  const lag = new LagCompensator(1000, TICK_RATE, now)
  const playerManager = new PlayerManager({ now, log: () => {} })
  const networkState = new NetworkState({ now })
  const shooterId = playerManager.addPlayer(null, { position: SHOOTER_AT })
  const targetIds = [0, 1, 2, 3, 4].map((i) => playerManager.addPlayer(null, { position: targetPath(i, 0) }))
  for (const id of [shooterId, ...targetIds]) networkState.addPlayer(id, { position: playerManager.getPlayer(id).state.position })
  const physics = { applyChartTransfer: () => null, charIdOf: () => null, isGrounded: () => false }
  const migrate = createPlayerMigrator({ playerManager, networkState, lagCompensator: lag, physics })
  const dirs = { list: [unit([1, 0.01, 0.01]), unit([1, 0.011, 0.009])] }
  const service = createChartReanchorService({ frame, radius: RADIUS, playerDirs: () => dirs.list, warn: () => {} })
  const events = []
  service.onReanchor((event) => {
    events.push({ event, counts: migrate(event) })
    ledger.record(snapshotChart(frame))
  })
  let tick = 0
  const stepTick = () => {
    tick++
    nowMs += 1000 / TICK_RATE
    lag.beginTick(tick)
    for (const id of [shooterId, ...targetIds]) {
      const s = playerManager.getPlayer(id).state
      lag.recordPlayerPosition(id, s.position, s.rotation, s.velocity, tick)
    }
  }
  const moveTargets = (pathTick) => {
    targetIds.forEach((id, i) => {
      const p = targetPath(i, pathTick)
      const s = playerManager.getPlayer(id).state
      s.position[0] = p[0]; s.position[1] = p[1]; s.position[2] = p[2]
    })
  }
  for (let k = 1; k <= 40; k++) {
    moveTargets(k)
    stepTick()
  }
  const reanchor = () => {
    dirs.list = [unit([1, 0.2, 0.1]), unit([1, 0.21, 0.09])]
    const event = service.step()
    assert.ok(event !== null, 'the service did not re-anchor')
    return event
  }
  const players = () => playerManager.getAllPlayers()
  const shooterPosition = () => playerManager.getPlayer(shooterId).state.position
  return { frame, ledger, lag, playerManager, networkState, shooterId, targetIds, events, stepTick, reanchor, players, shooterPosition, get tick() { return tick }, advanceMs(ms) { nowMs += ms } }
}

const aimAt = (w, targetIndex, viewTick) => {
  const eye = [SHOOTER_AT[0], SHOOTER_AT[1] + DEFAULT_HITBOX.centerHeight, SHOOTER_AT[2]]
  const p = targetPath(targetIndex, viewTick)
  const centre = [p[0], p[1] + DEFAULT_HITBOX.centerHeight, p[2]]
  return { origin: eye, direction: [centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]], viewTick, chartEpoch: w.ledger.currentEpoch }
}

const fire = (w, resolver, msg, finder = findHitSpatial) => {
  const shot = resolver.resolve(w.shooterId, w.shooterPosition(), msg)
  if (!shot.ok) return { shot, hit: null }
  const hit = finder(w.players(), { shooterId: w.shooterId, origin: shot.origin, direction: shot.direction, range: RANGE, lagComp: w.lag, viewTick: shot.viewTick })
  return { shot, hit }
}

gate('before any re-anchor a shot stamped with the current epoch is passed through untouched and hits the rewound target', () => {
  const w = world()
  const resolver = createShotEpochResolver({ ledger: w.ledger, lagComp: w.lag })
  const msg = aimAt(w, 2, 25)
  const { shot, hit } = fire(w, resolver, msg)
  assert.equal(shot.reexpressed, false)
  assert.equal(shot.viewTick, 25)
  assert.ok(hit, 'no hit')
  assert.equal(hit.target.id, w.targetIds[2])
  assert.ok(hit.rewound && hit.rewound.tick === 25, 'the hit was not resolved at the rewound tick')
})

gate('a real re-anchor runs the player migrator once and moves the lag history: 6 players and 240 lag samples', () => {
  const w = world()
  const event = w.reanchor()
  assert.equal(event.epoch, 1)
  assert.equal(w.events.length, 1)
  assert.equal(w.events[0].counts.players, 6)
  assert.equal(w.events[0].counts.lagSamples, 240)
  assert.equal(w.ledger.currentEpoch, 1)
  assert.ok(event.transfer.tiltRad > 0.05, 'the re-anchor tilt is ' + event.transfer.tiltRad)
})

gate('a shot stamped with epoch 0 that arrives after the re-anchor is re-expressed and hits the same target at the same range', () => {
  const w = world()
  const resolver = createShotEpochResolver({ ledger: w.ledger, lagComp: w.lag })
  const msg = aimAt(w, 2, 25)
  const before = fire(w, resolver, msg)
  w.reanchor()
  const after = fire(w, resolver, msg)
  assert.equal(after.shot.reexpressed, true)
  assert.equal(after.shot.shotEpoch, 0)
  assert.equal(after.shot.chartEpoch, 1)
  assert.ok(after.hit, 'the re-expressed shot missed')
  assert.equal(after.hit.target.id, before.hit.target.id)
  assert.ok(Math.abs(after.hit.dot - before.hit.dot) < 0.05, 'range ' + before.hit.dot + ' became ' + after.hit.dot)
  assert.ok(after.hit.rewound && after.hit.rewound.tick === 25, 'the hit was not resolved at the rewound tick')
})

gate('negative control: the same epoch 0 shot taken as if it were in the new chart misses every target', () => {
  const w = world()
  const resolver = createShotEpochResolver({ ledger: w.ledger, lagComp: w.lag })
  const msg = aimAt(w, 2, 25)
  w.reanchor()
  const wrong = fire(w, resolver, { ...msg, chartEpoch: 1 })
  assert.equal(wrong.shot.reexpressed, false)
  assert.equal(wrong.hit, null)
})

gate('the re-expressed origin stays within the 2 m drift bound of the migrated shooter, so the client origin is kept', () => {
  const w = world()
  const resolver = createShotEpochResolver({ ledger: w.ledger, lagComp: w.lag })
  const msg = aimAt(w, 0, 30)
  const event = w.reanchor()
  const shot = resolver.resolve(w.shooterId, w.shooterPosition(), msg)
  const expected = event.transfer.point(msg.origin)
  assert.ok(shot.origin.every((c, i) => Math.abs(c - expected[i]) < 1e-9), 'origin ' + shot.origin + ' vs ' + expected)
})

gate('over 200 seeded shots after the re-anchor the linear and the spatial finder name the same target at the same range', () => {
  const w = world()
  const resolver = createShotEpochResolver({ ledger: w.ledger, lagComp: w.lag })
  const random = mulberry(44)
  const messages = []
  for (let i = 0; i < 200; i++) {
    const msg = aimAt(w, Math.floor(random() * 5), 5 + Math.floor(random() * 35))
    msg.direction[0] += (random() - 0.5) * 2
    msg.direction[2] += (random() - 0.5) * 2
    messages.push(msg)
  }
  w.reanchor()
  let hits = 0
  for (const msg of messages) {
    w.advanceMs(100)
    const shot = resolver.resolve(w.shooterId, w.shooterPosition(), msg)
    const base = { shooterId: w.shooterId, origin: shot.origin, direction: shot.direction, range: RANGE, lagComp: w.lag, viewTick: shot.viewTick }
    const linear = findHitLinear(w.players(), base)
    const spatial = findHitSpatial(w.players(), base)
    assert.equal(linear === null, spatial === null, 'one finder hit and the other missed')
    if (linear === null) continue
    hits++
    assert.equal(linear.target.id, spatial.target.id)
    assert.equal(linear.dot, spatial.dot)
  }
  assert.ok(hits >= 40 && hits <= 190, 'the seeded set gave ' + hits + ' hits, so it does not reach both outcomes')
})

gate('the hit capsule stands on the chart up axis, so a re-anchor of tilt t may move it by 0.9 * 2 sin(t / 2): of 200 seeded shots, each that clears that margin keeps its outcome', () => {
  const shots = () => {
    const w = world()
    const resolver = createShotEpochResolver({ ledger: w.ledger, lagComp: w.lag })
    const random = mulberry(7)
    const messages = []
    for (let i = 0; i < 200; i++) {
      const msg = aimAt(w, Math.floor(random() * 5), 5 + Math.floor(random() * 35))
      msg.direction[0] += (random() - 0.5) * 10
      messages.push(msg)
    }
    return { w, resolver, messages }
  }
  const moved = shots()
  const tilt = moved.w.reanchor().transfer.tiltRad
  const shift = DEFAULT_HITBOX.centerHeight * 2 * Math.sin(tilt / 2) + 1e-6
  const radius = Math.sqrt(DEFAULT_HITBOX.radiusSq)
  const inner = { ...DEFAULT_HITBOX, radiusSq: (radius - shift) ** 2 }
  const outer = { ...DEFAULT_HITBOX, radiusSq: (radius + shift) ** 2 }
  const still = shots()
  let sureHits = 0, sureMisses = 0, edge = 0
  for (let i = 0; i < 200; i++) {
    still.w.advanceMs(100)
    moved.w.advanceMs(100)
    const before = still.resolver.resolve(still.w.shooterId, still.w.shooterPosition(), still.messages[i])
    const base = { shooterId: still.w.shooterId, origin: before.origin, direction: before.direction, range: RANGE, lagComp: still.w.lag, viewTick: before.viewTick }
    const tight = findHitLinear(still.w.players(), { ...base, hitbox: inner })
    const loose = findHitLinear(still.w.players(), { ...base, hitbox: outer })
    const after = fire(moved.w, moved.resolver, moved.messages[i]).hit
    if (tight !== null) {
      sureHits++
      assert.ok(after !== null, 'shot ' + i + ' cleared the margin and missed after the re-anchor')
      assert.equal(after.target.id, tight.target.id, 'shot ' + i)
    } else if (loose === null) {
      sureMisses++
      assert.equal(after, null, 'shot ' + i + ' missed by more than the margin and hit after the re-anchor')
    } else edge++
  }
  assert.ok(sureHits >= 20 && sureMisses >= 20, sureHits + ' sure hits and ' + sureMisses + ' sure misses do not reach both outcomes')
  assert.ok(edge < 100, edge + ' edge shots')
})

gate('a shot stamped with an epoch ahead of the server is refused and no rewind token is spent', () => {
  const w = world()
  const resolver = createShotEpochResolver({ ledger: w.ledger, lagComp: w.lag })
  const result = resolver.resolve(w.shooterId, w.shooterPosition(), { ...aimAt(w, 1, 20), chartEpoch: 3 })
  assert.equal(result.ok, false)
  assert.equal(result.reason, SHOT_EPOCH_REFUSAL.AHEAD)
  assert.equal(w.lag._rewindBuckets.has(w.shooterId), false)
})

gate('a shot from an epoch the ledger no longer retains is refused, not guessed', () => {
  const frame = createPlanetFrame({ sampler: { radius: RADIUS, heightAt: () => 0 }, anchorDir: [1, 0, 0] })
  const ledger = createChartEpochLedger({ frame, retainedEpochs: 1 })
  const base = snapshotChart(frame)
  for (let epoch = 1; epoch <= 4; epoch++) ledger.record({ ...base, chartEpoch: epoch })
  const resolver = createShotEpochResolver({ ledger })
  const result = resolver.reexpress({ origin: [0, 1, 0], direction: [1, 0, 0], chartEpoch: 1 })
  assert.equal(result.ok, false)
  assert.equal(result.reason, SHOT_EPOCH_REFUSAL.NOT_RETAINED)
  assert.equal(resolver.reexpress({ origin: [0, 1, 0], direction: [1, 0, 0], chartEpoch: 3 }).ok, true)
})

gate('a fractional epoch and a zero direction are refused; a missing epoch is read as the current one', () => {
  const w = world()
  const resolver = createShotEpochResolver({ ledger: w.ledger, lagComp: w.lag })
  assert.equal(resolver.reexpress({ direction: [1, 0, 0], chartEpoch: 0.5 }).reason, SHOT_EPOCH_REFUSAL.EPOCH_SHAPE)
  assert.equal(resolver.reexpress({ direction: [0, 0, 0], chartEpoch: 0 }).reason, SHOT_EPOCH_REFUSAL.DIRECTION)
  const plain = resolver.reexpress({ direction: [0, 0, 2] })
  assert.equal(plain.ok, true)
  assert.deepEqual(plain.direction, [0, 0, 1])
  assert.equal(plain.reexpressed, false)
  assert.deepEqual(resolver.getStats(), { resolved: 0, reexpressed: 0, refused: 2 })
})

gate('the message is not changed: its origin and direction arrays hold the same numbers after it is resolved', () => {
  const w = world()
  const resolver = createShotEpochResolver({ ledger: w.ledger, lagComp: w.lag })
  const msg = aimAt(w, 3, 12)
  const copy = JSON.stringify(msg)
  w.reanchor()
  resolver.resolve(w.shooterId, w.shooterPosition(), msg)
  assert.equal(JSON.stringify(msg), copy)
})

gate('a resolver built without a ledger, or with a lag compensator that cannot validate an origin, is refused', () => {
  assert.throws(() => createShotEpochResolver({ ledger: {} }), TypeError)
  const w = world()
  assert.throws(() => createShotEpochResolver({ ledger: w.ledger, lagComp: {} }), TypeError)
})

gate('the module carries no comments and reads no host globals', () => {
  const source = readFileSync(new URL('../src/netcode/shotChartEpoch.js', import.meta.url), 'utf8')
  assert.equal(source.includes('//') || source.includes('/*'), false)
  for (const host of ['Date', 'performance', 'process', 'console', 'globalThis', 'Math.random']) assert.equal(source.includes(host), false, host)
})

finish()
