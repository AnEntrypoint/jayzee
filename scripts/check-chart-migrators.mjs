import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runAll, playerScenario, anchorScenario, PLAYERS, FROM, TO, EMPTY_SPAWN_NO_SINGULAR } from './lib/chartMigratorScenarios.mjs'
import { createPlayerMigrator } from '../src/sdk/chartState/migratePlayers.js'
import { createWorldAnchorMigrator } from '../src/sdk/chartState/migrateWorldAnchors.js'
import { LagCompensator } from '../src/netcode/lagCompensation.js'
import { createChartTransfer } from '../src/client/chartTransfer.js'
import { createReexpressPass } from '../src/client/chartReexpress.js'
import { createChartReanchorService } from '../src/chart-pure/chartReanchorService.js'
import { createPlanetFrame } from '../src/terrain-pure/planetFrame.js'

const m = { createPlayerMigrator, createWorldAnchorMigrator, LagCompensator, createChartTransfer, createReexpressPass }
const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/chart-migrators.json', import.meta.url), 'utf8'))
const TOL = 1e-12

const ok = (condition, what) => {
  if (!condition) throw new Error(what)
}

const near = (got, want, path = '$') => {
  if (typeof want === 'number') {
    ok(typeof got === 'number' && Math.abs(got - want) <= TOL, `${path}: got ${got}, spoint ${want}`)
    return
  }
  if (Array.isArray(want)) {
    ok(Array.isArray(got) && got.length === want.length, `${path}: array length ${got?.length} vs ${want.length}`)
    want.forEach((v, i) => near(got[i], v, `${path}[${i}]`))
    return
  }
  if (want && typeof want === 'object') {
    ok(got && typeof got === 'object', `${path}: expected an object`)
    const keys = Object.keys(want).sort()
    ok(JSON.stringify(Object.keys(got).sort()) === JSON.stringify(keys), `${path}: keys ${Object.keys(got)} vs ${keys}`)
    keys.forEach((k) => near(got[k], want[k], `${path}.${k}`))
    return
  }
  ok(got === want, `${path}: got ${got}, spoint ${want}`)
}

const thrownOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return null
}

const normalize = (value) => JSON.parse(JSON.stringify(value))

const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

const fixtureOf = (name) => {
  const hit = fixture.result.anchors.find((a) => a.name === name)
  ok(hit, `fixture has no anchor scenario ${name}`)
  return hit.result
}

const jayzee = runAll(m, { spoint: false })

gate('fixture is the spoint run: two player counts and three anchor scenarios are recorded', () => {
  ok(fixture.result.players && fixture.result.anchors.length === 3, 'fixture shape')
  ok(fixture.result.players.counts.stateVelocityClamped === 1, 'the grounded tilt clamp must fire once in the fixture')
})

gate('player migrator counts match spoint: 3 players, 3 buffered inputs, 1 network player, 5 lag samples, 2 characters', () => {
  near(jayzee.players.counts, fixture.result.players.counts)
  ok(jayzee.players.counts.players === 3 && jayzee.players.counts.bufferedInputs === 3 && jayzee.players.counts.networkPlayers === 1 && jayzee.players.counts.lagSamples === 5 && jayzee.players.counts.characters === 2, 'counts')
})

gate('player and network states match spoint at 1e-12 after the migrator, including the grounded tilt clamp', () => {
  near(jayzee.players.players, fixture.result.players.players)
  near(jayzee.players.network, fixture.result.players.network)
})

gate('lag history samples match spoint at 1e-12 for both players', () => {
  near(jayzee.players.lag, fixture.result.players.lag)
})

gate('the default pass (migrate with only the event) gives the same player result as an explicit pass', () => {
  near(normalize(playerScenario(m, { defaultPass: true })), fixture.result.players)
})

gate('world anchor scenario with a spawn list, singular point ignored, rejoin states and stages matches spoint', () => {
  near(jayzee.anchors[0].result, fixtureOf(jayzee.anchors[0].name))
  ok(jayzee.anchors[0].result.counts.rejoinStates === 3, 'three rejoin states: two pending and the local one')
})

gate('world anchor scenario with an empty spawn list and a singular point matches spoint', () => {
  near(jayzee.anchors[1].result, fixtureOf(jayzee.anchors[1].name))
})

gate('world anchor scenario with no spawn list leaves the singular point and re-expresses only the stage', () => {
  near(jayzee.anchors[2].result, fixtureOf(jayzee.anchors[2].name))
  ok(jayzee.anchors[2].result.worldSpawnPoint[0] === 3 && jayzee.anchors[2].result.counts.spawnPoints === 0, 'singular point was touched')
})

gate('the default pass for world anchors gives the same result as an explicit pass', () => {
  near(normalize(anchorScenario(m, { ctx: { worldSpawnPoints: [[1, 2, 3], [4, 5, 6]], worldSpawnPoint: [9, 9, 9], pendingRejoin: [['p1', { position: [10, 1, 10], rotation: [0, 0.3, 0, 0.954] }], ['p2', { position: [-3, 0, 2], rotation: null }]], localRejoinState: { position: [0, 0, 0], rotation: [0, -0.6, 0, 0.825] } }, stages: [{ spawnPoint: [1, 0, 1] }, { spawnPoint: null }, { spawnPoint: [-2, 0, 4] }, {}] }, { defaultPass: true })), fixtureOf(jayzee.anchors[0].name))
})

gate('spoint throws a TypeError on an empty spawn list with no singular point; the port leaves worldSpawnPoint unset and reports no spawn points', () => {
  ok(fixture.emptySpawnNoSingular.threw === 'TypeError', `spoint result ${JSON.stringify(fixture.emptySpawnNoSingular)}`)
  const result = normalize(anchorScenario(m, EMPTY_SPAWN_NO_SINGULAR))
  ok(result.worldSpawnPoint === undefined, `worldSpawnPoint ${result.worldSpawnPoint}`)
  ok(result.counts.spawnPoints === 0 && result.worldSpawnPoints.length === 0, 'spawn count')
})

gate('negative control: moving the destination chart by 0.25 m in y changes player positions away from the spoint fixture', () => {
  const moved = normalize(playerScenario(m, { toChart: { ...TO, offsetY: TO.offsetY + 0.25 } }))
  const got = moved.players[0].state.position[1]
  const want = fixture.result.players.players[0].state.position[1]
  ok(Math.abs(got - want) > 0.2, `position y ${got} vs fixture ${want}`)
})

gate('an identity chart (same chart on both sides) leaves every player and network position and every lag sample where it was', () => {
  const same = normalize(playerScenario(m, { fromChart: FROM, toChart: FROM }))
  same.players.forEach((p, i) => {
    const input = PLAYERS.find((q) => q.id === p.id).state.position
    ok(p.state.position.every((c, k) => Math.abs(c - input[k]) <= 1e-9), `player ${p.id} moved to ${p.state.position}`)
  })
  same.lag.forEach((ring) => ring.samples.forEach((s) => ok(s.position.every((c) => Number.isFinite(c)), 'lag sample not finite')))
  const a = same.lag.find((r) => r.id === 'a').samples[0].position
  ok(a.every((c, k) => Math.abs(c - [1, 2, -1][k]) <= 1e-9), `lag sample a[0] moved to ${a}`)
})

const minimalPlayer = (position) => {
  const players = new Map([['x', { id: 'x', state: { position, velocity: [0, 0, 0], onGround: false, wallNormals: [], rotation: [0, 0, 0, 1] }, lastInput: null }]])
  const physics = { applyChartTransfer: () => null, charIdOf: () => null, isGrounded: () => false }
  return createPlayerMigrator({ playerManager: { players, getInputs: () => [] }, networkState: { players: new Map() }, lagCompensator: new LagCompensator(1000, 60), physics })
}

gate('the player migrator factory refuses a missing playerManager, network map, lag compensator or physics adapter', () => {
  const bad = [
    {},
    { playerManager: { players: new Map(), getInputs: () => [] }, networkState: { players: [] }, lagCompensator: new LagCompensator(1000, 60), physics: { applyChartTransfer() {}, charIdOf() {}, isGrounded() {} } },
    { playerManager: { players: new Map(), getInputs: () => [] }, networkState: { players: new Map() }, lagCompensator: {}, physics: { applyChartTransfer() {}, charIdOf() {}, isGrounded() {} } },
    { playerManager: { players: new Map(), getInputs: () => [] }, networkState: { players: new Map() }, lagCompensator: new LagCompensator(1000, 60), physics: { applyChartTransfer() {}, charIdOf() {} } },
    { playerManager: { players: new Map() }, networkState: { players: new Map() }, lagCompensator: new LagCompensator(1000, 60), physics: { applyChartTransfer() {}, charIdOf() {}, isGrounded() {} } },
  ]
  bad.forEach((deps, i) => ok(thrownOf(() => createPlayerMigrator(deps)) instanceof TypeError, `case ${i} was accepted`))
})

gate('the world anchor factory refuses a missing ctx or a stageLoader without allStages', () => {
  ok(thrownOf(() => createWorldAnchorMigrator({ ctx: null, stageLoader: { allStages: () => [] } })) instanceof TypeError, 'null ctx accepted')
  ok(thrownOf(() => createWorldAnchorMigrator({ ctx: {}, stageLoader: {} })) instanceof TypeError, 'stageLoader without allStages accepted')
})

gate('a chart transfer without look, or with a non-finite tilt, is refused before any player state moves', () => {
  const transfer = createChartTransfer(FROM, TO)
  const position = [221.7, -54.6, -251.4]
  for (const broken of [{ ...transfer, look: undefined }, { ...transfer, tiltRad: NaN }, null]) {
    const migrate = minimalPlayer(position)
    const before = JSON.stringify(position)
    ok(thrownOf(() => migrate({ transfer: broken })) instanceof TypeError, 'broken transfer accepted')
    ok(JSON.stringify(position) === before, 'position changed before the refusal')
  }
})

gate('a world-anchor transfer without point is refused before any ctx point moves', () => {
  const transfer = createChartTransfer(FROM, TO)
  const ctx = { worldSpawnPoints: [[1, 2, 3]], worldSpawnPoint: [1, 2, 3] }
  const migrate = createWorldAnchorMigrator({ ctx, stageLoader: { allStages: () => [] } })
  ok(thrownOf(() => migrate({ transfer: { ...transfer, point: 1 } })) instanceof TypeError, 'broken transfer accepted')
  ok(JSON.stringify(ctx) === JSON.stringify({ worldSpawnPoints: [[1, 2, 3]], worldSpawnPoint: [1, 2, 3] }), 'ctx changed before the refusal')
})

gate('a position shared by a player and a rejoin state is re-expressed once when both migrators share one pass', () => {
  const transfer = createChartTransfer(FROM, TO)
  const shared = [1, 2, 3]
  const expected = transfer.point([1, 2, 3])
  const players = new Map([['x', { id: 'x', state: { position: shared, velocity: [0, 0, 0], onGround: false, wallNormals: [], rotation: [0, 0, 0, 1] }, lastInput: null }]])
  const physics = { applyChartTransfer: () => null, charIdOf: () => null, isGrounded: () => false }
  const playersMigrate = createPlayerMigrator({ playerManager: { players, getInputs: () => [] }, networkState: { players: new Map() }, lagCompensator: new LagCompensator(1000, 60), physics })
  const anchorsMigrate = createWorldAnchorMigrator({ ctx: { pendingRejoinState: new Map([['r', { position: shared, rotation: null }]]) }, stageLoader: { allStages: () => [] } })
  const pass = createReexpressPass(transfer)
  playersMigrate({ transfer }, pass)
  anchorsMigrate({ transfer }, pass)
  ok(shared.every((c, i) => Math.abs(c - expected[i]) <= TOL), `shared position ${shared}, once-transformed ${expected}`)
})

gate('negative control: with a separate pass for each migrator the shared position is re-expressed twice and differs', () => {
  const transfer = createChartTransfer(FROM, TO)
  const shared = [1, 2, 3]
  const once = transfer.point([1, 2, 3])
  const players = new Map([['x', { id: 'x', state: { position: shared, velocity: [0, 0, 0], onGround: false, wallNormals: [], rotation: [0, 0, 0, 1] }, lastInput: null }]])
  const physics = { applyChartTransfer: () => null, charIdOf: () => null, isGrounded: () => false }
  createPlayerMigrator({ playerManager: { players, getInputs: () => [] }, networkState: { players: new Map() }, lagCompensator: new LagCompensator(1000, 60), physics })({ transfer }, createReexpressPass(transfer))
  createWorldAnchorMigrator({ ctx: { pendingRejoinState: new Map([['r', { position: shared, rotation: null }]]) }, stageLoader: { allStages: () => [] } })({ transfer }, createReexpressPass(transfer))
  ok(shared.some((c, i) => Math.abs(c - once[i]) > 1e-6), 'a second pass did not change the shared position')
})

gate('wired through the chart reanchor service, a real re-anchor event re-expresses the player position with the event transfer', () => {
  const RADIUS = 6371000
  const frame = createPlanetFrame({ sampler: { radius: RADIUS, heightAt: () => 0 }, anchorDir: [1, 0, 0] })
  const nearA = unit([1, 0.2, 0.1])
  const nearB = unit([1, 0.21, 0.09])
  const service = createChartReanchorService({ frame, radius: RADIUS, playerDirs: () => [nearA, nearB], warn: () => {} })
  const position = [1200.5, -340.25, 88.75]
  const players = new Map([['x', { id: 'x', state: { position, velocity: [0, 0, 0], onGround: false, wallNormals: [], rotation: [0, 0, 0, 1] }, lastInput: null }]])
  const physics = { applyChartTransfer: () => null, charIdOf: () => null, isGrounded: () => false }
  const seen = []
  const playersMigrate = createPlayerMigrator({ playerManager: { players, getInputs: () => [] }, networkState: { players: new Map() }, lagCompensator: new LagCompensator(1000, 60), physics })
  service.onReanchor((event) => seen.push(playersMigrate(event)))
  service.onReanchor(createWorldAnchorMigrator({ ctx: {}, stageLoader: { allStages: () => [] } }))
  const before = [...position]
  const event = service.step()
  ok(event !== null && event.epoch === 1, `no re-anchor event: ${event}`)
  ok(seen.length === 1 && seen[0].players === 1, 'the player migrator did not run once with one player')
  const expected = event.transfer.point(before)
  ok(position.every((c, i) => Math.abs(c - expected[i]) <= TOL), `position ${position} vs ${expected}`)
})

gate('the tilt clamp touches only a grounded body: an airborne body keeps a small upward velocity, a grounded one loses it (identity chart, bound 1e-3 m/s)', () => {
  const transfer = createChartTransfer(FROM, FROM)
  const body = (id) => ({ id, state: { position: [0, 0, 0], velocity: [0, 0.0005, 0], onGround: true, groundNormal: [0, 1, 0], wallNormals: [], rotation: [0, 0, 0, 1] }, lastInput: null })
  const players = new Map([['air', body('air')], ['ground', body('ground')]])
  const charIds = new Map([['air', 8], ['ground', 7]])
  const physics = { applyChartTransfer: () => null, charIdOf: (id) => charIds.get(id) ?? null, isGrounded: (charId) => charId === 7 }
  const migrate = createPlayerMigrator({ playerManager: { players, getInputs: () => [] }, networkState: { players: new Map() }, lagCompensator: new LagCompensator(1000, 60), physics })
  const counts = migrate({ transfer })
  ok(Math.abs(players.get('air').state.velocity[1] - 0.0005) <= 1e-9, `airborne velocity y ${players.get('air').state.velocity[1]}`)
  ok(players.get('ground').state.velocity[1] === 0, `grounded velocity y ${players.get('ground').state.velocity[1]}`)
  ok(counts.stateVelocityClamped === 1, `stateVelocityClamped ${counts.stateVelocityClamped}`)
})

gate('a rejoin rotation that is not a plain array is not re-expressed, as spoint Array.isArray guard leaves it; its position still is', () => {
  const transfer = createChartTransfer(FROM, TO)
  const rotation = new Float64Array([0, 0.3, 0, 0.954])
  const rejoin = { position: [1, 2, 3], rotation }
  const counts = createWorldAnchorMigrator({ ctx: { pendingRejoinState: new Map([['r', rejoin]]) }, stageLoader: { allStages: () => [] } })({ transfer }, createReexpressPass(transfer))
  ok(counts.rejoinStates === 1, `rejoinStates ${counts.rejoinStates}`)
  ok(Array.from(rotation).every((c, i) => c === [0, 0.3, 0, 0.954][i]), `rotation changed to ${Array.from(rotation)}`)
  ok(rejoin.position.every((c, i) => Math.abs(c - transfer.point([1, 2, 3])[i]) <= TOL), `position ${rejoin.position}`)
})

gate('the two new source files carry no comments and read no host globals', () => {
  for (const file of ['../src/sdk/chartState/migratePlayers.js', '../src/sdk/chartState/migrateWorldAnchors.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    ok(!/\/\/|\/\*/.test(source), `${file}: comment marker found`)
    for (const name of ['Date', 'performance', 'console', 'window', 'process', 'setTimeout', 'globalThis', 'Math.random']) ok(!source.includes(name), `${file}: ${name} found`)
  }
})

finish()
