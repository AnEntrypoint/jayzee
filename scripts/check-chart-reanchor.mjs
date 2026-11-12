import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { createChartAnchorLattice, chartAnchorForDir, chartAnchorKeyOfDir, chartAnchorDirOfKey, snapshotChart, createChartTransfer } from '../src/chart-pure/chartAnchor.js'
import * as policy from '../src/chart-pure/chartReanchorPolicy.js'
import { createChartReanchorService, ChartReanchorNoMigratorError } from '../src/chart-pure/chartReanchorService.js'
import { createTerrainReanchor, TerrainReanchorUnpreparedError } from '../src/terrain-pure/chartReanchorTerrain.js'
import * as tilt from '../src/terrain-pure/fieldLatticeTilt.js'
import { createPlanetFrame } from '../src/terrain-pure/planetFrame.js'

const RADIUS = 6371000
const SPOINT = {
  walkableLimitDeg: 45.00010522957485,
  centroid: [0.9788109294848412, 0.2047568100587926, 0.001952704680437629],
  reanchor: { anchorDir: [0.9731848442347202, 0.21853596472652712, 0.07178642680123747], centroidDir: [0.9754127556467344, 0.19995706292792828, 0.092666763766092], gainDeg: 11.125191393562543, worstPlayerAngleDeg: 2.0002886606919255 },
  spreadWorstDeg: 46.414869049928555,
  hysteresisGainDeg: 0.027843778805658248,
  anchorOfX: [0.9993979093591233, 0.024533841613307267, -0.024533841613307267],
  firstEvent: { epoch: 1, angleBeforeDeg: 12.731701254333366, angleAfterDeg: 1.6065098607708228 },
  secondGainDeg: 13.843424753771282,
  spreadWarning: '[chart-reanchor] refusing to re-anchor: party-spread-exceeds-walkable-chart (worst player 46.41 deg from the anchor, walkable limit 45.00 deg); players this far apart need per-cluster charts',
  constantSurfacePendingMm: 70486463.02472986,
  constantSurfaceResetStepMm: 190222127.85321566,
  probeOriginsY: [32, 4.99],
}

const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l] }
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol
const vecNear = (a, b, tol = 1e-12) => a.length === b.length && a.every((v, i) => near(v, b[i], tol))
const thrown = (fn) => { try { fn() } catch (e) { return e } return null }
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const lattice = createChartAnchorLattice(RADIUS, 32)
const sampler = { radius: RADIUS, heightAt: () => 0 }
const NEAR_A = unit([1, 0.2, 0.1])
const NEAR_B = unit([1, 0.21, 0.09])
const SPREAD = [[1, 0, 0], [0, 1, 0]]

const svcTrace = {}
{
  const frame = createPlanetFrame({ sampler, anchorDir: [1, 0, 0] })
  const warns = []
  const svc = createChartReanchorService({ frame, radius: RADIUS, playerDirs: () => [NEAR_A, NEAR_B], warn: (m) => warns.push(m) })
  svcTrace.noMigrator = thrown(() => svc.step())
  svcTrace.noMigratorUp = [...frame.up]
  const events = []
  const off = svc.onReanchor((e) => events.push(e))
  const ev = svc.step()
  svcTrace.first = { ev, up: [...frame.up], events: events.length, count: svc.reanchorCount }
  svcTrace.again = svc.step()
  svcTrace.spread = [svc.step(SPREAD), svc.step(SPREAD)]
  svcTrace.warns = warns.slice()
  svcTrace.refusals = { count: svc.refusalCount, byReason: svc.refusalsByReason, last: svc.lastRefusal.reason, lastEpoch: svc.lastRefusal.epoch }
  const gateEpochs = []
  const offTerrain = svc.addTerrainMigrator({ gate: (a) => { gateEpochs.push(a.epoch); return 'terrain-busy' }, migrate: () => { throw new Error('a refused gate must not migrate') } })
  const upBefore = [...frame.up]
  svcTrace.blocked = svc.step([unit([1, 0.5, 0.2])])
  svcTrace.blockedKeptUp = upBefore.every((v, i) => v === frame.up[i])
  svcTrace.blockedTally = svc.refusalsByReason
  svcTrace.gateEpochs = gateEpochs
  offTerrain()
  const order = []
  svc.addTerrainMigrator({ gate: () => null, migrate: (e) => order.push('terrain:' + e.epoch) })
  svc.onReanchor((e) => order.push('state:' + e.epoch))
  const ev2 = svc.step([unit([1, 0.5, 0.2])])
  svcTrace.second = { epoch: ev2.epoch, order, gainDeg: ev2.decision.gainDeg }
  off()
  svcTrace.migratorCount = svc.migratorCount
}

const makeTerrain = (overrides = {}) => {
  const clock = { t: 0 }
  const errors = []
  const frame = createPlanetFrame({ sampler, anchorDir: [1, 0, 0] })
  const calls = []
  const pending = {}
  const hs = {
    lattice: { anchor: { up: [1, 0, 0] }, tiltDeg: 3 },
    coverRadius: 100,
    fields: [1, 2, 3],
    surfaceY: 1.5,
    liveHeightFn: () => 2,
    placeAllFields: () => calls.push('placeAll'),
    setLattice: (l) => { calls.push('setLattice'); hs.lattice = l },
    prepareFields: (args) => {
      calls.push('prepare:' + args.players.length)
      hs.lastArgs = args
      return new Promise((resolve, reject) => { pending.resolve = resolve; pending.reject = reject })
    },
    preparedSurfaceY: () => hs.surfaceY,
    installPrepared: (p) => { calls.push('install'); return { installed: p.fields.length, removed: 0, retransformed: 0 } },
  }
  const hits = []
  const physics = {
    raycast: (o) => { hits.push(o[1]); return hits.length % 2 ? { hit: true, bodyId: 7, position: [o[0], 5, o[2]] } : { hit: true, bodyId: 9, position: [o[0], 1.55, o[2]] } },
    bodyMeta: new Map([[7, { shape: 'box' }], [9, { shape: 'heightfield' }]]),
  }
  const blocker = { reason: null }
  const tr = createTerrainReanchor({
    frame, sampler, offsetY: 0, reliefScale: 0.01, physics, heightStreamer: hs,
    colliderStreamers: [{ reanchor: (e) => 'moved:' + e.epoch }], getPlayers: () => [[0, 0]], blockers: [() => blocker.reason],
    now: () => (clock.t += 5), logError: (...a) => errors.push(a), ...overrides,
  })
  const resolveCovering = async () => { pending.resolve({ fields: hs.lastArgs.players.map((c) => ({ center: c })) }); await tick() }
  return { tr, frame, hs, calls, hits, blocker, errors, pending, resolveCovering }
}

const SMALL_TILT = unit([1, 0.05, 0])
const FAR = unit([1, 0.15, 0])
const FORCED = unit([1, 0.25, 0])

const terrainTrace = {}
{
  const t = makeTerrain()
  const { tr } = t
  terrainTrace.follow = tr.gate({ decision: { anchorDir: SMALL_TILT } })
  tr.migrate({ epoch: 1, from: {} })
  tr.migrate({ epoch: 1, from: {} })
  terrainTrace.followCost = tr.costs[0]
  terrainTrace.followCalls = t.calls.slice()
  terrainTrace.dupCosts = tr.costs.length
  t.frame.chartEpoch = 1
  t.blocker.reason = 'world-locked'
  terrainTrace.blocker = tr.gate({ decision: { anchorDir: SMALL_TILT } })
  t.blocker.reason = null
  terrainTrace.far1 = tr.gate({ decision: { anchorDir: FAR } })
  terrainTrace.preparing1 = tr.preparing
  terrainTrace.prepareAbortedBefore = t.hs.lastArgs.isAborted()
  terrainTrace.prepareHeightFinite = Number.isFinite(t.hs.lastArgs.heightFn(0, 0))
  terrainTrace.far2 = tr.gate({ decision: { anchorDir: FAR } })
  terrainTrace.prepareCalls = t.calls.filter((c) => c.startsWith('prepare')).length
  terrainTrace.other = tr.gate({ decision: { anchorDir: unit([1, 0, 0.15]) } })
  terrainTrace.unprepared = thrown(() => tr.migrate({ epoch: 2 }))
  await t.resolveCovering()
  terrainTrace.preparedBase = tr.prepared && tr.prepared.baseEpoch
  terrainTrace.prepareMs = tr.prepared && tr.prepared.prepareMs
  terrainTrace.quietConstant = tr.gate({ decision: { anchorDir: FAR } })
  terrainTrace.pendingConstantMm = tr.pendingResetStepMm
  terrainTrace.probeOriginsY = t.hits.slice(0, 2)
  const p = createChartTransfer(snapshotChart(t.frame), tr.prepared.shadowSnapshot).point([0, 1.55, 0])
  t.hs.surfaceY = p[1] + 0.01
  terrainTrace.quietSmall = tr.gate({ decision: { anchorDir: FAR } })
  terrainTrace.pendingSmallMm = tr.pendingResetStepMm
  t.hs.surfaceY = p[1] + 0.05
  terrainTrace.quietLarge = tr.gate({ decision: { anchorDir: FAR } })
  terrainTrace.pendingLargeMm = tr.pendingResetStepMm
  t.hs.surfaceY = 1.5
  terrainTrace.wrongEpoch = thrown(() => tr.migrate({ epoch: 3 }))
  terrainTrace.forcedNotReady = tr.gate({ decision: { anchorDir: FORCED } })
  await t.resolveCovering()
  terrainTrace.forced = tr.gate({ decision: { anchorDir: FORCED } })
  tr.migrate({ epoch: 2 })
  terrainTrace.resetCost = tr.costs[1]
  terrainTrace.migrateClears = tr.prepared
  terrainTrace.failNotReady = tr.gate({ decision: { anchorDir: FAR } })
  t.pending.reject(new Error('boom'))
  await tick()
  terrainTrace.failed = tr.gate({ decision: { anchorDir: FAR } })
  terrainTrace.failedOnce = tr.gate({ decision: { anchorDir: FAR } })
  terrainTrace.errors = t.errors.slice()
  const moved = makeTerrain()
  moved.tr.gate({ decision: { anchorDir: FAR } })
  moved.frame.chartEpoch = 5
  terrainTrace.abortedAfterEpochMove = moved.hs.lastArgs.isAborted()
  terrainTrace.staleEpoch = moved.tr.gate({ decision: { anchorDir: FAR } })
}

gate('policy constants keep spoint values: hysteresis 0.75 deg, walkable limit from the 0.7854 rad slope', () => {
  assert.equal(policy.CHART_REANCHOR_HYSTERESIS_DEG, 0.75)
  assert.equal(policy.WALKABLE_CHART_LIMIT_DEG, SPOINT.walkableLimitDeg)
  assert.equal(0.7854 * 180 / Math.PI, SPOINT.walkableLimitDeg)
})

gate('field lattice tilt constants and tiltDegBetween keep spoint values', () => {
  assert.equal(tilt.LATTICE_RESET_FORCED_TILT_DEG, 12)
  assert.equal(tilt.LATTICE_FOLLOW_TILT_DEG, 7.5)
  assert.equal(tilt.RESET_SURFACE_STEP_BOUND_M, 0.02)
  assert.equal(tilt.tiltDegBetween([1, 0, 0], unit([1, 1, 0])), 45.00000000000001)
  assert.equal(tilt.tiltDegBetween([1, 0, 0], [1.0000001, 0, 0]), 0, 'a dot product above 1 is clamped, not NaN')
  assert.equal(tilt.tiltDegBetween([1, 0, 0], [-1, 0, 0]), 180)
})

gate('playerCentroidDir matches spoint and does not depend on player order', () => {
  const dirs = [[1, 0.2, 0], [0.9, 0.3, 0.1], [1, 0.1, -0.1]]
  assert.deepEqual(policy.playerCentroidDir(dirs), SPOINT.centroid)
  assert.deepEqual(policy.playerCentroidDir([...dirs].reverse()), SPOINT.centroid)
  assert.equal(policy.playerCentroidDir([]), null)
  assert.notDeepEqual(policy.playerCentroidDir([[1, 0.2, 0], [0.9, 0.3, 0.1]]), SPOINT.centroid, 'dropping a player must move the centroid')
})

gate('playerCentroidDir refuses a non-list, a short vector, a zero vector and opposite players by name', () => {
  assert.equal(thrown(() => policy.playerCentroidDir(null)).reason, 'player-directions-not-a-list')
  assert.equal(thrown(() => policy.playerCentroidDir([[1, 0]])).reason, 'player-direction-not-a-vector')
  assert.equal(thrown(() => policy.playerCentroidDir([[0, 0, 0]])).reason, 'player-direction-has-no-length')
  assert.equal(thrown(() => policy.playerCentroidDir([[NaN, 0, 0]])).reason, 'player-direction-has-no-length')
  assert.ok(thrown(() => policy.playerCentroidDir([[1, 0, 0], [-1, 0, 0]])) instanceof policy.PlayersStraddlePlanetError)
})

gate('chartAnchorDecision re-anchors with spoint values when the party leaves the anchor cell', () => {
  const d = policy.chartAnchorDecision({ lattice, frame: { up: [1, 0, 0] }, dirs: [NEAR_A, NEAR_B] })
  assert.equal(d.kind, 'reanchor')
  assert.deepEqual(d.anchorDir, SPOINT.reanchor.anchorDir)
  assert.deepEqual(d.centroidDir, SPOINT.reanchor.centroidDir)
  assert.equal(d.gainDeg, SPOINT.reanchor.gainDeg)
  assert.equal(d.worstPlayerAngleDeg, SPOINT.reanchor.worstPlayerAngleDeg)
})

gate('chartAnchorDecision stays on the same anchor, with no players, and below the hysteresis', () => {
  const anchor = chartAnchorForDir(lattice, NEAR_A)
  assert.deepEqual(policy.chartAnchorDecision({ lattice, frame: { up: anchor }, dirs: [NEAR_A] }), { kind: 'stay', reason: 'anchor-unchanged', gainDeg: 0 })
  assert.deepEqual(policy.chartAnchorDecision({ lattice, frame: { up: [1, 0, 0] }, dirs: [] }), { kind: 'stay', reason: 'no-players' })
  const key = chartAnchorKeyOfDir(lattice, [1, 0, 0])
  const ka = chartAnchorDirOfKey(lattice, key)
  assert.deepEqual(ka, SPOINT.anchorOfX)
  const nb = chartAnchorDirOfKey(lattice, key + 1)
  const edge = unit([ka[0] + nb[0] * 1.02, ka[1] + nb[1] * 1.02, ka[2] + nb[2] * 1.02])
  assert.deepEqual(policy.chartAnchorDecision({ lattice, frame: { up: ka }, dirs: [edge] }), { kind: 'stay', reason: 'gain-below-hysteresis', gainDeg: SPOINT.hysteresisGainDeg })
  assert.equal(policy.chartAnchorDecision({ lattice, frame: { up: ka }, dirs: [edge], hysteresisDeg: 0 }).kind, 'reanchor', 'a zero hysteresis must let the same small gain re-anchor')
})

gate('chartAnchorDecision refuses a spread party, a straddling party and a zero direction, and throws without a lattice or frame up', () => {
  assert.deepEqual(policy.chartAnchorDecision({ lattice, frame: { up: [1, 0, 0] }, dirs: SPREAD }), { kind: 'refusal', reason: 'party-spread-exceeds-walkable-chart', worstPlayerAngleDeg: SPOINT.spreadWorstDeg, walkableLimitDeg: SPOINT.walkableLimitDeg })
  assert.notEqual(policy.chartAnchorDecision({ lattice, frame: { up: [1, 0, 0] }, dirs: SPREAD, walkableLimitDeg: 50 }).kind, 'refusal', 'a wider walkable limit must accept the same spread')
  assert.deepEqual(policy.chartAnchorDecision({ lattice, frame: { up: [1, 0, 0] }, dirs: [[1, 0, 0], [-1, 0, 0]] }), { kind: 'refusal', reason: 'players-straddle-the-planet' })
  assert.deepEqual(policy.chartAnchorDecision({ lattice, frame: { up: [1, 0, 0] }, dirs: [[0, 0, 0]] }), { kind: 'refusal', reason: 'player-direction-has-no-length' })
  assert.equal(thrown(() => policy.chartAnchorDecision({ lattice: null, frame: { up: [1, 0, 0] }, dirs: [] })).reason, 'decision-needs-a-lattice')
  assert.equal(thrown(() => policy.chartAnchorDecision({ lattice, frame: {}, dirs: [] })).reason, 'decision-needs-a-frame-up')
  assert.equal(thrown(() => policy.chartAnchorDecision({ lattice, frame: { up: [1, 0, 0] }, dirs: [[1, 0]] })).reason, 'player-direction-not-a-vector')
})

gate('the service refuses to step with no state migrator and leaves the frame alone', () => {
  assert.ok(svcTrace.noMigrator instanceof ChartReanchorNoMigratorError)
  assert.match(svcTrace.noMigrator.message, /no registered state migrator/)
  assert.deepEqual(svcTrace.noMigratorUp, [1, 0, 0])
})

gate('the service re-anchors a real planet frame with spoint values and bumps the epoch', () => {
  const { ev, up, events, count } = svcTrace.first
  assert.equal(ev.epoch, SPOINT.firstEvent.epoch)
  assert.equal(ev.from.chartEpoch, 0)
  assert.equal(ev.to.chartEpoch, 1)
  assert.equal(ev.decision.kind, 'reanchor')
  assert.ok(vecNear(ev.anchorDir, SPOINT.reanchor.anchorDir))
  assert.ok(vecNear(up, SPOINT.reanchor.anchorDir))
  assert.ok(near(ev.angleBeforeDeg, SPOINT.firstEvent.angleBeforeDeg, 1e-9))
  assert.ok(near(ev.angleAfterDeg, SPOINT.firstEvent.angleAfterDeg, 1e-9))
  assert.equal(typeof ev.transfer.point, 'function')
  assert.equal(events, 1)
  assert.equal(count, 1)
  assert.equal(svcTrace.again, null, 'a second step on the new anchor stays')
})

gate('the service counts refusals by reason and warns once per new reason through the injected warn', () => {
  assert.deepEqual(svcTrace.spread, [null, null])
  assert.deepEqual(svcTrace.warns, [SPOINT.spreadWarning])
  assert.deepEqual(svcTrace.refusals, { count: 2, byReason: { 'party-spread-exceeds-walkable-chart': 2 }, last: 'party-spread-exceeds-walkable-chart', lastEpoch: 1 })
})

gate('a terrain gate reason refuses the re-anchor, keeps the frame and is tallied', () => {
  assert.equal(svcTrace.blocked, null)
  assert.equal(svcTrace.blockedKeptUp, true)
  assert.deepEqual(svcTrace.blockedTally, { 'party-spread-exceeds-walkable-chart': 2, 'terrain-busy': 1 })
  assert.deepEqual(svcTrace.gateEpochs, [1])
})

gate('terrain migrators run before state migrators and unsubscribing removes a migrator', () => {
  assert.equal(svcTrace.second.epoch, 2)
  assert.deepEqual(svcTrace.second.order, ['terrain:2', 'state:2'])
  assert.ok(near(svcTrace.second.gainDeg, SPOINT.secondGainDeg, 1e-9))
  assert.equal(svcTrace.migratorCount, 1)
})

gate('createTerrainReanchor requires an injected clock', () => {
  assert.ok(thrown(() => createTerrainReanchor({ blockers: [] })) instanceof TypeError)
  assert.ok(thrown(() => makeTerrain({ now: 5 })) instanceof TypeError)
})

gate('a small tilt follows the lattice, records an injected-clock cost and skips a repeated epoch', () => {
  assert.equal(terrainTrace.follow, null)
  assert.deepEqual(terrainTrace.followCalls, ['placeAll'])
  assert.deepEqual(terrainTrace.followCost, { epoch: 1, fieldInstallMs: 5, colliderTransformMs: 5, totalMs: 10, fields: { installed: 0, removed: 0, retransformed: 3, tiltDeg: 3 }, collidersMoved: ['moved:1'], prepareMs: 0, mode: 'follow-lattice', resetStepMm: 0 })
  assert.equal(terrainTrace.dupCosts, 1)
})

gate('a permanent blocker refuses before any tilt is read', () => {
  assert.equal(terrainTrace.blocker, 'world-locked')
})

gate('a large tilt prepares heightfields once and refuses another anchor while preparing', () => {
  assert.equal(terrainTrace.far1, 'heightfields-not-ready')
  assert.equal(terrainTrace.preparing1, true)
  assert.equal(terrainTrace.prepareAbortedBefore, false)
  assert.equal(terrainTrace.prepareHeightFinite, true)
  assert.equal(terrainTrace.far2, 'heightfields-not-ready')
  assert.equal(terrainTrace.prepareCalls, 1)
  assert.equal(terrainTrace.other, 'heightfields-preparing-for-another-anchor')
})

gate('migrate refuses an epoch it has no prepared heightfields for', () => {
  assert.ok(terrainTrace.unprepared instanceof TerrainReanchorUnpreparedError)
  assert.equal(terrainTrace.unprepared.message, 'terrain reanchor to epoch 2 has no prepared heightfields for it (prepared base epoch none)')
  assert.equal(terrainTrace.wrongEpoch.message, 'terrain reanchor to epoch 3 has no prepared heightfields for it (prepared base epoch 1)')
})

gate('the reset gate probes past non-heightfield hits and waits for a quiet surface below 12 deg of tilt', () => {
  assert.equal(terrainTrace.preparedBase, 1)
  assert.equal(terrainTrace.prepareMs, 5)
  assert.equal(terrainTrace.quietConstant, 'waiting-for-quiet-surface')
  assert.equal(terrainTrace.pendingConstantMm, SPOINT.constantSurfacePendingMm)
  assert.deepEqual(terrainTrace.probeOriginsY, SPOINT.probeOriginsY)
  assert.equal(terrainTrace.quietSmall, null)
  assert.ok(near(terrainTrace.pendingSmallMm, 10, 1e-3))
  assert.equal(terrainTrace.quietLarge, 'waiting-for-quiet-surface')
  assert.ok(near(terrainTrace.pendingLargeMm, 50, 1e-3))
})

gate('a tilt above 12 deg forces the reset and migrate installs the prepared set', () => {
  assert.equal(terrainTrace.forcedNotReady, 'heightfields-not-ready')
  assert.equal(terrainTrace.forced, null)
  const c = terrainTrace.resetCost
  assert.equal(c.epoch, 2)
  assert.deepEqual(c.fields, { installed: 1, removed: 0, retransformed: 0 })
  assert.deepEqual(c.collidersMoved, ['moved:2'])
  assert.equal(c.mode, 'reset-lattice')
  assert.equal(c.resetStepMm, SPOINT.constantSurfaceResetStepMm)
  assert.equal(c.fieldInstallMs, 5)
  assert.equal(terrainTrace.migrateClears, null)
})

gate('a failed prepare is reported once through the injected logError and then prepares again', () => {
  assert.equal(terrainTrace.failNotReady, 'heightfields-not-ready')
  assert.equal(terrainTrace.failed, 'heightfield-prepare-failed: boom')
  assert.equal(terrainTrace.failedOnce, 'heightfields-not-ready')
  assert.deepEqual(terrainTrace.errors, [['[terrain] chart reanchor field prepare failed:', 'boom']])
})

gate('a prepare made on an old epoch aborts and is refused as preparing for another anchor', () => {
  assert.equal(terrainTrace.abortedAfterEpochMove, true)
  assert.equal(terrainTrace.staleEpoch, 'heightfields-preparing-for-another-anchor')
})

gate('following with no lattice builds the real field lattice on the chart the event left, with no factory passed in', () => {
  const own = makeTerrain()
  own.hs.lattice = null
  own.hs.liveHeightFn = (x, z) => own.frame.groundHeightLocal(x, z)
  const from = snapshotChart(own.frame)
  own.tr.gate({ decision: { anchorDir: SMALL_TILT } })
  own.frame.reanchor(SMALL_TILT)
  own.tr.migrate({ epoch: 1, from })
  assert.deepEqual(own.calls, ['setLattice'])
  const lattice = own.hs.lattice
  assert.deepEqual(lattice.anchor.up, from.up)
  const expectedTilt = tilt.tiltDegBetween(from.up, own.frame.up)
  assert.ok(expectedTilt > 1 && Math.abs(lattice.tiltDeg - expectedTilt) < 1e-9, 'tilt ' + lattice.tiltDeg)
  assert.equal(own.tr.costs[0].fields.tiltDeg, lattice.tiltDeg)
  assert.equal(own.tr.costs[0].mode, 'follow-lattice')
  const placed = lattice.placement(10, 20)
  assert.equal(placed.position.length, 3)
  assert.equal(placed.rotation.length, 4)
  const back = lattice.toLattice(...lattice.toChart(10, 20))
  assert.ok(Math.hypot(back[0] - 10, back[1] - 20) < 0.5, 'lattice round trip ' + back)
})

gate('control: a migrator told to use no lattice factory refuses to follow, and an injected factory receives the event chart', () => {
  const missing = makeTerrain({ createFieldLattice: null })
  missing.hs.lattice = null
  missing.tr.gate({ decision: { anchorDir: SMALL_TILT } })
  assert.ok(thrown(() => missing.tr.migrate({ epoch: 1, from: { tag: 'from' } })) instanceof TypeError)
  const seen = []
  const given = makeTerrain({ createFieldLattice: (args) => { seen.push(args); return { anchor: { up: [1, 0, 0] }, tiltDeg: 0.5 } } })
  given.hs.lattice = null
  given.tr.gate({ decision: { anchorDir: SMALL_TILT } })
  given.tr.migrate({ epoch: 1, from: { tag: 'from' } })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0].anchor, { tag: 'from' })
  assert.equal(seen[0].liveFrame, given.frame)
  assert.deepEqual(given.calls, ['setLattice'])
  assert.equal(given.tr.costs[0].fields.tiltDeg, 0.5)
})

gate('the ported sources carry no comments and read no host globals', () => {
  const files = ['src/chart-pure/chartReanchorService.js', 'src/terrain-pure/chartReanchorTerrain.js', 'src/terrain-pure/fieldLatticeTilt.js', 'src/chart-pure/chartReanchorPolicy.js']
  for (const f of files) {
    const text = readFileSync(new URL('../' + f, import.meta.url), 'utf8')
    assert.ok(!/\/\/|\/\*/.test(text.replace(/`[^`]*`|'[^']*'/g, '')), f + ' has a comment')
    assert.ok(!/\b(Date\.now|performance|console|window|process|setTimeout|globalThis|Math\.random)\b/.test(text), f + ' reads a host global')
  }
})

finish()
