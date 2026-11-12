import { gate, finish } from './lib/gate.mjs'
import { defineFire, terrainAccessors, createEmitSlots, createFireLattice, decodeFireEvent, FIRE_STATE, FIRE_EVENT, FIRE_SEQ_RANGE, FIRE_MAX_ROWS_PER_MESSAGE, FIRE_MAX_TICK } from '../src/fire/index.js'
import { createPlacementLattice } from '../src/terrain-pure/placementLattice.js'
import { createPlanetFrame } from '../src/terrain-pure/planetFrame.js'

const fail = (what) => { throw new Error(what) }
const expect = (actual, expected, what) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) fail(`${what}: expected ${e} got ${a}`)
}
const refuses = (fn, fragment, what) => {
  let thrown = null
  try { fn() } catch (error) { thrown = error }
  if (!thrown) fail(`${what}: did not throw`)
  if (!thrown.message.includes(fragment)) fail(`${what}: message "${thrown.message}" lacks "${fragment}"`)
}

const RADIUS = 2000
const CHUNK_M = 32
const CELLS_PER_CHUNK = 4
const placement = createPlacementLattice(RADIUS, CHUNK_M, CELLS_PER_CHUNK)
const sampler = { radius: RADIUS, hashVersion: 1, heightAt: (d) => 6 + 4 * Math.sin(9 * d[0]) - 40 * Math.max(0, d[2] - 0.05) }
const latticeCalls = []
const latticeFor = (radius, cellsPerFireCell) => { latticeCalls.push([radius, cellsPerFireCell]); return createFireLattice(createPlacementLattice(radius, CHUNK_M, CELLS_PER_CHUNK), cellsPerFireCell) }

const makeTrunks = (capacity) => {
  const cellIds = new Float64Array(capacity)
  const stages = new Uint8Array(capacity)
  const t = {
    capacity, count: 0, generation: 0, writes: 0, stages,
    cellIdAt: (i) => cellIds[i],
    setBurnStage(i, stage) { stages[i] = stage; t.writes++ },
    load(ids) { for (let i = 0; i < ids.length; i++) { cellIds[i] = ids[i]; stages[i] = 0 } t.count = ids.length; t.generation++ },
  }
  return t
}

const SPEC = { stepTicks: 4, leadTicks: 3, checksumEverySteps: 2, seed: 77, regrowSteps: 4000 }

const makeSide = (role, overrides = {}, ctxOverrides = {}) => {
  const frame = createPlanetFrame({ sampler, anchorDir: [0, 1, 0], offsetY: 0 })
  const sent = []
  const playerMessages = []
  const appCtx = {
    send: (message) => sent.push(JSON.stringify(message)),
    terrainHeightAt: (x, z) => frame.groundHeightLocal(x, z),
    seaLevelAt: () => 0,
    terrainKindAt: (x, z) => (Math.abs(x + 200) < 12 ? 'road' : null),
    sendPlayer: (id, message) => playerMessages.push([id, message.type]),
    sendEntity: () => {},
    applyImpulse: () => {},
    ...ctxOverrides,
  }
  const trunks = makeTrunks(256)
  const fire = defineFire({ ...SPEC, role, ...overrides }, { appCtx, frameOf: () => frame, latticeFor, trunks })
  return { fire, frame, appCtx, sent, trunks, playerMessages }
}

const drain = (from, to, keep = () => true) => {
  let delivered = 0
  while (from.sent.length > 0) {
    const text = from.sent.shift()
    if (!keep(JSON.parse(text))) continue
    to.fire.receive(JSON.parse(text))
    delivered++
  }
  return delivered
}

const antipodeId = (side) => {
  const c = side.fire.lattice.cellOfDir(0, -1, 0, { face: 0, I: 0, J: 0 })
  return placement.cellId(c.face, c.I * 2, c.J * 2)
}

const placementIdOf = (side, position) => {
  const c = side.fire.cellOfPosition(position, { face: 0, I: 0, J: 0 })
  return placement.cellId(c.face, c.I * 2, c.J * 2)
}

gate('terrainAccessors reads terrainHeightAt, seaLevelAt and terrainKindAt off the app ctx, keeps the ctx as this, and gives null for an absent sampler', () => {
  const ctx = { bias: 5, terrainHeightAt(x, z) { return this.bias + x + z }, seaLevelAt: () => 1 }
  const t = terrainAccessors(ctx)
  expect([t.heightAt(1, 2), t.seaLevelAt(0, 0), t.kindAt], [8, 1, null], 'accessors')
  refuses(() => terrainAccessors({ terrainKindAt: 'road' }), 'appCtx.terrainKindAt is string', 'non-function sampler')
  refuses(() => terrainAccessors(null), 'needs the app ctx', 'no ctx')
})

gate('emit slots count up inside one tick, never go back in time, roll into the next tick after 4096 events, and stop at the wire tick limit', () => {
  const slots = createEmitSlots()
  const first = { ...slots.take(10) }, second = { ...slots.take(10) }, earlier = { ...slots.take(7) }, later = { ...slots.take(12) }
  expect([first.tick, first.seq, second.seq, earlier.tick, earlier.seq, later.tick, later.seq], [10, 0, 1, 10, 2, 12, 0], 'slots')
  let last = later.id
  for (let i = 1; i < FIRE_SEQ_RANGE + 5; i++) {
    const s = slots.take(12)
    if (!(s.id > last)) fail(`slot id ${s.id} does not follow ${last}`)
    if (s.seq >= FIRE_SEQ_RANGE) fail(`seq ${s.seq} is outside the wire range`)
    last = s.id
  }
  expect([slots.tick, slots.seq], [13, 5], 'the 4097th event of tick 12 took tick 13')
  refuses(() => slots.take(-1), 'non-negative integer tick', 'negative tick')
  refuses(() => createEmitSlots().take(FIRE_MAX_TICK + 1), 'beyond the wire limit', 'tick past the limit')
})

gate('defineFire refuses a missing environment, app ctx, send, frame, lattice, trunk capacity and weather reading', () => {
  const frame = createPlanetFrame({ sampler, anchorDir: [0, 1, 0] })
  const env = { appCtx: { send: () => {} }, frameOf: () => frame, latticeFor }
  refuses(() => defineFire({}, null), 'needs its environment', 'no env')
  refuses(() => defineFire({}, { ...env, appCtx: null }), 'env.appCtx', 'no ctx')
  refuses(() => defineFire({}, { ...env, appCtx: {} }), 'appCtx.send is missing', 'no send')
  refuses(() => defineFire({}, { ...env, frameOf: null }), 'env.frameOf', 'no frame')
  refuses(() => defineFire({}, { ...env, latticeFor: null }), 'env.latticeFor', 'no lattice builder')
  refuses(() => defineFire({}, { ...env, latticeFor: () => ({}) }), 'returned no fire lattice', 'bad lattice')
  refuses(() => defineFire({}, { ...env, trunks: { cellIdAt: () => 0, setBurnStage: () => {} } }), 'capacity', 'trunks with no capacity')
  refuses(() => defineFire({ weather: {} }, env), 'spec.weather needs a weather reading', 'weather with no source')
  refuses(() => defineFire({ firebreaks: {} }, env), 'firebreaks.water needs both a height and a sea-level sampler', 'water breaks with no terrain samplers on the ctx')
  refuses(() => defineFire({ bogus: 1 }, env), 'unknown key', 'unknown spec key')
  refuses(() => defineFire({}, { ...env, frameOf: () => ({}) }), 'needs a planet radius', 'frame with no radius')
})

gate('the fire builds its lattice from the planet frame radius and the spec cell size through the injected latticeFor', () => {
  latticeCalls.length = 0
  const side = makeSide('authority', { cellsPerFireCell: 4 })
  expect(latticeCalls, [[RADIUS, 4]], 'latticeFor call')
  expect(side.fire.lattice.cellsPerFace, placement.cellsPerFace / 4, 'fire cells per face')
  expect(makeSide('authority', { radius: 4000 }).fire.lattice.cellsPerFace, createPlacementLattice(4000, CHUNK_M, CELLS_PER_CHUNK).cellsPerFace / 2, 'a spec radius overrides the frame radius')
})

const runPair = (ticks, { keep = () => true, mirrorSpec = {}, onTick = () => {} } = {}) => {
  const authority = makeSide('authority'), mirror = makeSide('mirror', mirrorSpec)
  authority.fire.start(0)
  mirror.fire.start(0)
  const spot = [30, authority.frame.groundHeightLocal(30, -40), -40]
  authority.fire.ignite(spot)
  let messages = 0, maxRows = 0, rows = 0
  for (let t = 1; t <= ticks; t++) {
    onTick(t, authority, mirror)
    authority.fire.tick(t, 1 / 60)
    for (const text of authority.sent) {
      const m = JSON.parse(text)
      messages++
      if (m.rows) { rows += m.rows.length; maxRows = Math.max(maxRows, m.rows.length); for (const row of m.rows) decodeFireEvent(authority.fire.lattice, row) }
    }
    drain(authority, mirror, keep)
    mirror.fire.tick(t, 1 / 60)
  }
  return { authority, mirror, spot, messages, maxRows, rows }
}

gate('an ignition at a chart position burns the cell under it after the lead ticks and spreads to its neighbours', () => {
  const side = makeSide('authority')
  side.fire.start(0)
  const spot = [30, side.frame.groundHeightLocal(30, -40), -40]
  const id = side.fire.ignite(spot)
  expect(id, (0 + SPEC.leadTicks) * FIRE_SEQ_RANGE, 'the event id is its slot')
  side.fire.tick(SPEC.leadTicks - 1, 1 / 60)
  expect(side.fire.stateAt(spot), FIRE_STATE.UNBURNT, 'before the lead tick')
  for (let t = SPEC.leadTicks; t <= 40; t++) side.fire.tick(t, 1 / 60)
  if (side.fire.stateAt(spot) === FIRE_STATE.UNBURNT) fail('the ignited cell never burned')
  for (let t = 41; t <= 200; t++) side.fire.tick(t, 1 / 60)
  if (!(side.fire.kernel.activeCount > 8)) fail(`only ${side.fire.kernel.activeCount} cells are active after 200 ticks`)
  const near = [30 + side.fire.lattice.cellM * 2, spot[1], -40]
  if (side.fire.stateAt(near) === FIRE_STATE.UNBURNT) fail('the fire did not reach a cell two cells away')
  expect(JSON.parse(side.sent[0]).rows.length, 1, 'the first message carries the ignition row')
})

gate('a mirror fed the authority messages as JSON holds the same checksum on every compared step and at the end', () => {
  const { authority, mirror, messages, rows } = runPair(400)
  expect(mirror.fire.kernel.checksum(), authority.fire.kernel.checksum(), 'final checksum')
  const ledger = mirror.fire.ledger.stats
  if (!(ledger.compared > 20)) fail(`only ${ledger.compared} checksums compared`)
  expect([ledger.mismatches, ledger.missed, mirror.fire.stats.refused], [0, 0, 0], 'mismatches, missed, refused rows')
  if (!(authority.fire.kernel.activeCount > 20)) fail('the authority fire did not grow')
  if (!(messages > 20 && rows >= 1)) fail(`${messages} messages, ${rows} rows`)
  refuses(() => mirror.fire.ignite([0, 0, 0]), 'a mirror does not emit', 'mirror emit')
  refuses(() => authority.fire.receive({ type: 'fire', rows: [] }), 'the authority received a fire message', 'authority receive')
  expect(mirror.fire.receive({ type: 'chat' }), false, 'a message of another type is not consumed')
})

gate('negative control: a mirror that never gets the ignition row reports checksum mismatches against the authority', () => {
  const { authority, mirror } = runPair(200, { keep: (m) => !m.rows })
  if (mirror.fire.kernel.checksum() === authority.fire.kernel.checksum()) fail('the starved mirror still matches')
  if (!(mirror.fire.ledger.stats.mismatches > 0)) fail('the ledger saw no mismatch')
  expect(mirror.fire.ledger.stats.firstMismatch.local === mirror.fire.ledger.stats.firstMismatch.remote, false, 'first mismatch carries two different hashes')
})

gate('a row that arrives after its tick makes the mirror rewind and still end on the authority checksum', () => {
  const held = []
  const { authority, mirror } = runPair(240, {
    keep: (m) => { if (m.rows && held.length === 0) { held.push(m); return false } return true },
    onTick: (t, a, m) => { if (t === 12 && held.length === 1) { m.fire.receive(held[0]); held.push('done') } },
  })
  if (!(mirror.fire.timeline.stats.rewinds >= 1)) fail('the late row did not rewind the mirror')
  expect(mirror.fire.kernel.checksum(), authority.fire.kernel.checksum(), 'final checksum')
})

gate('a late joiner adopts a keyframe taken mid-fire and then follows the authority to the same checksum', () => {
  const authority = makeSide('authority'), joiner = makeSide('mirror')
  authority.fire.start(0)
  authority.fire.ignite([30, authority.frame.groundHeightLocal(30, -40), -40])
  for (let t = 1; t <= 150; t++) authority.fire.tick(t, 1 / 60)
  authority.fire.setWind([6, 0, -3])
  authority.sent.length = 0
  const frame = JSON.parse(JSON.stringify(authority.fire.keyframe()))
  expect([frame.type, frame.keyframe[0], typeof frame.keyframe[2]], ['fire', 150, 'string'], 'keyframe row')
  joiner.fire.receive(frame)
  expect([joiner.fire.tickNumber, joiner.fire.stats.keyframesAdopted], [150, 1], 'adopted')
  expect(joiner.fire.kernel.checksum(), authority.fire.kernel.checksum(), 'checksum at adoption')
  for (let t = 151; t <= 320; t++) { authority.fire.tick(t, 1 / 60); drain(authority, joiner); joiner.fire.tick(t, 1 / 60) }
  expect(joiner.fire.kernel.checksum(), authority.fire.kernel.checksum(), 'checksum after following')
  expect(joiner.fire.kernel.wind, authority.fire.kernel.wind, 'the wind set before the keyframe took effect on both')
  const tampered = JSON.parse(JSON.stringify(authority.fire.keyframe()))
  tampered.keyframe[1] = (tampered.keyframe[1] + 1) >>> 0
  refuses(() => makeSide('mirror').fire.receive(tampered), 'the authority stated', 'keyframe with a wrong stated checksum')
})

gate('syncWeather turns a rain reading into rain, moisture and wind events at step ticks only, and stays silent while the reading is steady', () => {
  let reading = { type: 'rain', intensity: 0.5, wind: [3.4, 0, -2.2] }
  const side = makeSide('authority', { weather: { wetPerStep: 16, hysteresis: 8 } }, { weather: () => reading })
  side.fire.start(0)
  const kindsAt = new Map()
  for (let t = 1; t <= 80; t++) {
    side.fire.tick(t, 1 / 60)
    for (const text of side.sent.splice(0)) for (const row of JSON.parse(text).rows ?? []) kindsAt.set(t, [...(kindsAt.get(t) ?? []), row[0]])
  }
  for (const t of kindsAt.keys()) if (t % SPEC.stepTicks !== 0) fail(`weather emitted at tick ${t}, which is not a step tick`)
  expect(kindsAt.get(4), [FIRE_EVENT.RAIN, FIRE_EVENT.MOISTURE, FIRE_EVENT.WIND], 'the first step emits rain, moisture and wind')
  expect([side.fire.weather.emittedRain, side.fire.weather.emittedWind], [128, [3, 0, -2]], 'emitted rain byte and rounded wind')
  expect(side.fire.kernel.wind, [3, 0, -2], 'the kernel wind is the weather wind')
  const all = [...kindsAt.values()].flat()
  expect(all.filter((k) => k === FIRE_EVENT.RAIN).length, 1, 'rain is emitted once while it is steady')
  expect(all.filter((k) => k === FIRE_EVENT.WIND).length, 1, 'wind is emitted once while it is steady')
  const moistureEvents = all.filter((k) => k === FIRE_EVENT.MOISTURE).length
  if (!(moistureEvents >= 3 && moistureEvents <= 20)) fail(`${moistureEvents} moisture events for 20 steps`)
  const emittedBefore = side.fire.stats.emitted
  reading = { type: 'rain', intensity: 0.5, wind: [3.4, 0, -2.2] }
  for (let t = 81; t <= 400; t++) side.fire.tick(t, 1 / 60)
  const settled = side.fire.stats.emitted
  for (let t = 401; t <= 480; t++) side.fire.tick(t, 1 / 60)
  expect(side.fire.stats.emitted, settled, 'no event once moisture has reached its ceiling')
  if (!(settled > emittedBefore)) fail('moisture stopped rising before its ceiling')
  reading = null
  side.sent.length = 0
  for (let t = 481; t <= 484; t++) side.fire.tick(t, 1 / 60)
  expect(JSON.parse(side.sent[0]).rows.map((r) => r[0]), [FIRE_EVENT.RAIN], 'the rain stopping is one rain event')
  expect(side.fire.syncWeather(485), 0, 'a tick that is not a step tick emits nothing')
})

gate('syncTrunks writes a trunk only when its cell changes stage, and the trunks end charred where the fire passed and untouched elsewhere', () => {
  const side = makeSide('authority')
  side.fire.start(0)
  const y = side.frame.groundHeightLocal(30, -40)
  const cellM = side.fire.lattice.cellM
  const nearTrunks = [0, 1, 2, 3].map((k) => placementIdOf(side, [30 + k * cellM, y, -40]))
  const farTrunks = [antipodeId(side), antipodeId(side) + 2]
  side.trunks.load([...nearTrunks, ...farTrunks])
  side.fire.tick(1, 1 / 60)
  expect([side.fire.trunkCount, side.fire.stats.trunkRefreshes, side.trunks.writes], [6, 1, 6], 'the first sync refreshes every trunk')
  side.trunks.writes = 0
  side.fire.tick(2, 1 / 60)
  expect(side.trunks.writes, 0, 'a tick with no fire writes no trunk')
  side.fire.ignite([30, y, -40])
  const seen = new Set()
  let writingTicks = 0
  for (let t = 3; t <= 700; t++) {
    const before = side.trunks.writes
    side.fire.tick(t, 1 / 60)
    if (side.trunks.writes !== before) writingTicks++
    for (let i = 0; i < 4; i++) seen.add(i + ':' + side.trunks.stages[i])
  }
  for (let i = 0; i < 4; i++) {
    if (!seen.has(i + ':' + FIRE_STATE.BURNING)) fail(`trunk ${i} was never shown burning`)
    expect(side.trunks.stages[i], FIRE_STATE.BURNT, `trunk ${i} ends charred`)
  }
  expect([side.trunks.stages[4], side.trunks.stages[5]], [FIRE_STATE.UNBURNT, FIRE_STATE.UNBURNT], 'far trunks')
  expect(side.trunks.writes, 8, 'each near trunk was written twice: burning, then burnt')
  if (!(writingTicks <= 8)) fail(`${writingTicks} ticks wrote trunks`)
  expect(side.fire.stats.trunkRefreshes, 1, 'no refresh while the streamer generation is unchanged')
})

gate('refreshTrunks runs when the trunk streamer loads a new set, and gives trunks streamed into burnt ground their stage at once', () => {
  const side = makeSide('authority')
  side.fire.start(0)
  const y = side.frame.groundHeightLocal(30, -40)
  side.fire.ignite([30, y, -40])
  for (let t = 1; t <= 500; t++) side.fire.tick(t, 1 / 60)
  expect(side.fire.trunkCount, 0, 'no trunks yet')
  side.trunks.load([placementIdOf(side, [30, y, -40]), antipodeId(side)])
  side.fire.tick(501, 1 / 60)
  expect([side.fire.trunkCount, side.fire.stats.trunkRefreshes], [2, 2], 'refreshed on the new generation')
  expect([side.trunks.stages[0], side.trunks.stages[1]], [FIRE_STATE.BURNT, FIRE_STATE.UNBURNT], 'stages after the refresh')
  side.trunks.stages[0] = 0
  expect(side.fire.syncTrunks(), 0, 'negative control: without a new generation a sync leaves the stale trunk alone')
  expect(side.fire.refreshTrunks(), 2, 'an explicit refresh rewrites every trunk')
  expect(side.trunks.stages[0], FIRE_STATE.BURNT, 'the stale trunk is corrected')
  side.trunks.count = 999
  refuses(() => side.fire.refreshTrunks(), 'for a capacity of 256', 'a count beyond capacity')
})

gate('a mirror that rewinds for a late row refreshes its trunks and ends with the same trunk stages as the authority', () => {
  const held = []
  const authority = makeSide('authority'), mirror = makeSide('mirror')
  authority.fire.start(0)
  mirror.fire.start(0)
  const y = authority.frame.groundHeightLocal(30, -40)
  const ids = [0, 1, 2, 3, 4, 5].map((k) => placementIdOf(authority, [30 + k * authority.fire.lattice.cellM, y, -40]))
  authority.trunks.load(ids)
  mirror.trunks.load(ids)
  authority.fire.ignite([30, y, -40])
  for (let t = 1; t <= 600; t++) {
    authority.fire.tick(t, 1 / 60)
    drain(authority, mirror, (m) => { if (m.rows && held.length === 0) { held.push(m); return false } return true })
    if (t === 14) mirror.fire.receive(held[0])
    mirror.fire.tick(t, 1 / 60)
  }
  if (!(mirror.fire.timeline.stats.rewinds >= 1 && mirror.fire.stats.trunkRefreshes >= 2)) fail(`rewinds ${mirror.fire.timeline.stats.rewinds}, refreshes ${mirror.fire.stats.trunkRefreshes}`)
  expect(Array.from(mirror.trunks.stages.subarray(0, 6)), Array.from(authority.trunks.stages.subarray(0, 6)), 'trunk stages')
  if (!Array.from(authority.trunks.stages.subarray(0, 6)).includes(FIRE_STATE.BURNT)) fail('no trunk burned in this run')
})

gate('firebreaks read the app ctx terrain: sea, a road kind and a cleared circle hold no fuel and do not burn', () => {
  const side = makeSide('authority', { firebreaks: { cleared: [{ center: [300, 300], radiusM: 40 }] } })
  side.fire.start(0)
  const at = (x, z) => [x, side.frame.groundHeightLocal(x, z), z]
  const sea = at(0, 600), road = at(-200, 50), cleared = at(300, 300), land = at(30, -40)
  if (!(sea[1] < 0)) fail(`the sea sample is at ${sea[1]}, not below sea level`)
  const fuelAt = (p) => { const c = side.fire.cellOfPosition(p); return side.fire.kernel.cellState(c.face, c.I, c.J).fuel }
  expect([fuelAt(sea), fuelAt(road), fuelAt(cleared)], [0, 0, 0], 'fuel in the sea, on the road and in the clearing')
  if (!(fuelAt(land) > 0)) fail('open land has no fuel')
  for (const p of [sea, road, cleared, land]) side.fire.ignite(p)
  for (let t = 1; t <= 60; t++) side.fire.tick(t, 1 / 60)
  expect([side.fire.stateAt(sea), side.fire.stateAt(road), side.fire.stateAt(cleared)], [0, 0, 0], 'break cells after ignition')
  if (side.fire.stateAt(land) === FIRE_STATE.UNBURNT) fail('open land did not burn')
  const open = makeSide('authority')
  if (!(fuelAt.call(null, sea) === 0 && (() => { const c = open.fire.cellOfPosition(sea); return open.fire.kernel.cellState(c.face, c.I, c.J).fuel })() > 0)) fail('negative control: without firebreaks the sea cell should carry fuel')
})

gate('more than 256 events in one tick leave in messages of at most 256 rows, in slot order', () => {
  const side = makeSide('authority')
  side.fire.start(0)
  for (let i = 0; i < 600; i++) side.fire.igniteCell(0, 10 + (i % 60), 10 + Math.floor(i / 60))
  side.fire.tick(1, 1 / 60)
  const sizes = side.sent.map((text) => JSON.parse(text).rows.length)
  expect(sizes, [256, 256, 88], 'message sizes')
  const ids = side.sent.flatMap((text) => JSON.parse(text).rows.map((row) => row[1] * FIRE_SEQ_RANGE + row[2]))
  for (let i = 1; i < ids.length; i++) if (!(ids[i] > ids[i - 1])) fail(`row ${i} is out of slot order`)
  expect(FIRE_MAX_ROWS_PER_MESSAGE, 256, 'row limit')
  refuses(() => side.fire.igniteCell(9, 0, 0), 'outside the lattice', 'a face that does not exist')
  refuses(() => side.fire.setWind([99, 0, 0]), 'wind must be', 'wind beyond the limit')
})

gate('gameplay bound through the app ctx hurts a player standing in the fire and tells that player', () => {
  const holder = { health: 100 }
  let position = [30, 0, -40]
  const side = makeSide('authority', { gameplay: { damageEveryTicks: 5, targets: () => [{ id: 'p1', position, holder }] } })
  position = [30, side.frame.groundHeightLocal(30, -40), -40]
  side.fire.start(0)
  side.fire.ignite(position)
  for (let t = 1; t <= 120; t++) side.fire.tick(t, 1 / 60)
  if (!(holder.health < 100)) fail('the player took no damage')
  expect(side.playerMessages[0], ['p1', 'fire_burn'], 'the player is told it is burning')
  const onIgnite = []
  const hooked = makeSide('authority', { onIgnite: (e) => onIgnite.push(e.id), onExtinguish: (e) => onIgnite.push(-e.radius) })
  hooked.fire.start(0)
  hooked.fire.ignite(position)
  hooked.fire.extinguish(position, hooked.fire.lattice.cellM * 3)
  expect(onIgnite, [SPEC.leadTicks * FIRE_SEQ_RANGE, -3], 'the spec hooks see the ignition id and the extinguish radius in cells')
})

finish()
