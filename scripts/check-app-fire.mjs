import { finish, gate } from './lib/gate.mjs'
import { FIRE_APP_NAME, createAppFires, createFireLatticeSource } from '../src/apps/appFire.js'
import { createHookRunner } from '../src/apps/hookOrder.js'
import { FIRE_STATE } from '../src/fire/index.js'
import { createTrunkStreamer } from '../src/fire/trunkStreamer.js'
import { createColliderStreamer } from '../src/terrain-pure/colliderStreamer.js'
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
const LATTICE = { chunkM: 32, cellsPerChunk: 4 }
const TICK_DT = 1 / 60
const SPEC = { stepTicks: 4, leadTicks: 3, checksumEverySteps: 2, seed: 77, regrowSteps: 4000 }
const sampler = { radius: RADIUS, hashVersion: 1, heightAt: (d) => 6 + 4 * Math.sin(9 * d[0]) }
const SPOT_XZ = [30, -40]

const makeRuntime = (role, { trunkCapacity = 512, maxChunks = 4 } = {}) => {
  const frame = createPlanetFrame({ sampler, anchorDir: [0, 1, 0], offsetY: 0 })
  const state = { tick: 0 }
  const hooks = createHookRunner({ tickDt: TICK_DT })
  const fires = createAppFires({ hooks, tickOf: () => state.tick, tickDt: TICK_DT })
  const sent = []
  const appCtx = { send: (message) => sent.push(JSON.stringify(message)) }
  const trunks = createTrunkStreamer({ capacity: trunkCapacity, maxChunks })
  const source = createFireLatticeSource(LATTICE)
  const fire = fires.register(7, { ...SPEC, role }, { appCtx, frameOf: () => frame, latticeFor: source.latticeFor, trunks })
  const errors = []
  const step = (tick) => {
    state.tick = tick
    for (const error of hooks.tick(tick).errors) errors.push(error)
  }
  return { frame, state, hooks, fires, fire, sent, trunks, source, errors, step }
}

const placementsNear = (runtime, centreX, centreZ, span, stepM) => {
  const out = []
  const seen = new Set()
  const cell = { face: 0, I: 0, J: 0 }
  const F = runtime.fire.lattice.cellsPerFireCell
  for (let x = centreX - span; x <= centreX + span; x += stepM) {
    for (let z = centreZ - span; z <= centreZ + span; z += stepM) {
      const y = runtime.frame.groundHeightLocal(x, z)
      runtime.fire.cellOfPosition([x, y, z], cell)
      const trunkId = runtime.source.placement.cellId(cell.face, cell.I * F, cell.J * F)
      if (seen.has(trunkId)) continue
      seen.add(trunkId)
      out.push({ x, y, z, trunkId })
    }
  }
  return out
}

const loadForest = (runtime) => {
  const near = placementsNear(runtime, SPOT_XZ[0], SPOT_XZ[1], 40, 8)
  const far = placementsNear(runtime, SPOT_XZ[0] + 900, SPOT_XZ[1], 24, 8)
  if (!runtime.trunks.loadChunk(1, near)) fail('the near chunk was refused')
  if (!runtime.trunks.loadChunk(2, far)) fail('the far chunk was refused')
  return { near, far }
}

const runPair = (ticks, { deliver = true, onTick = () => {} } = {}) => {
  const authority = makeRuntime('authority')
  const mirror = makeRuntime('mirror')
  const forest = loadForest(authority)
  loadForest(mirror)
  const spot = [SPOT_XZ[0], authority.frame.groundHeightLocal(SPOT_XZ[0], SPOT_XZ[1]), SPOT_XZ[1]]
  let routed = 0
  for (let tick = 0; tick <= ticks; tick++) {
    authority.step(tick)
    if (tick === 0) authority.fire.ignite(spot)
    onTick(tick, authority, mirror)
    while (authority.sent.length > 0) {
      const message = JSON.parse(authority.sent.shift())
      if (deliver && mirror.fires.route(message)) routed++
    }
    mirror.step(tick)
  }
  return { authority, mirror, forest, spot, routed }
}

const burntTrunks = (runtime) => {
  let n = 0
  for (let i = 0; i < runtime.trunks.count; i++) if (runtime.trunks.stageAt(i) !== FIRE_STATE.UNBURNT) n++
  return n
}

gate('the app fire registry refuses a runtime with no hook runner, no tick reader or no tick length', () => {
  const hooks = createHookRunner({ tickDt: TICK_DT })
  refuses(() => createAppFires({ hooks: null, tickOf: () => 0, tickDt: TICK_DT }), 'needs the app hook runner', 'no hooks')
  refuses(() => createAppFires({ hooks, tickDt: TICK_DT }), 'needs tickOf', 'no tick reader')
  refuses(() => createAppFires({ hooks, tickOf: () => 0, tickDt: 0 }), 'tickDt must be a positive finite number', 'zero tick length')
  expect(FIRE_APP_NAME, 'fire', 'app name')
})

gate('a registered fire is a hook object of the app runtime: it starts on spawn at the runtime tick and a second fire on the same id is refused', () => {
  const runtime = makeRuntime('authority')
  expect([runtime.fires.size, runtime.hooks.has(7), runtime.hooks.isSpawned(7)], [1, true, false], 'before the first tick')
  refuses(() => runtime.fire.tick(1, TICK_DT), 'tick before start', 'the fire is not started before the runtime ticks')
  runtime.step(25)
  expect([runtime.hooks.isSpawned(7), runtime.fire.tickNumber], [true, 25], 'started at the runtime tick')
  runtime.step(26)
  expect(runtime.fire.tickNumber, 26, 'the update hook advances the fire')
  refuses(() => runtime.fires.register(7, { ...SPEC, role: 'authority' }, { appCtx: { send: () => {} }, frameOf: () => runtime.frame, lattice: LATTICE }), 'already has a fire', 'second fire')
  refuses(() => runtime.fires.register(8, { ...SPEC, role: 'authority' }, { appCtx: { send: () => {} }, frameOf: () => runtime.frame }), 'env.latticeFor or env.lattice', 'no lattice source')
  expect(runtime.errors, [], 'hook errors')
})

gate('the lattice source builds one fire lattice per radius and cell size from the placement lattice and reuses it', () => {
  const source = createFireLatticeSource(LATTICE)
  const first = source.latticeFor(RADIUS, 2)
  if (source.latticeFor(RADIUS, 2) !== first) fail('the same radius and cell size built a second lattice')
  expect(first.cellsPerFace, source.placement.cellsPerFace / 2, 'fire cells per face')
  if (source.latticeFor(RADIUS, 4) === first) fail('a different cell size reused the lattice')
  refuses(() => createFireLatticeSource({ chunkM: 0, cellsPerChunk: 4 }), 'chunk size', 'zero chunk')
  refuses(() => createFireLatticeSource({ chunkM: 32, cellsPerChunk: 0 }), 'cellsPerChunk', 'zero cells')
})

gate('the trunk streamer loads placement records by chunk into arrays sized once, compacts on unload and counts each change as a generation', () => {
  const trunks = createTrunkStreamer({ capacity: 6, maxChunks: 2 })
  const record = (trunkId) => ({ x: trunkId, y: 1, z: -trunkId, trunkId })
  expect(trunks.loadChunk(10, [record(100), record(101), record(102)]), true, 'first chunk')
  expect(trunks.loadChunk(11, [record(200), record(201)]), true, 'second chunk')
  expect([trunks.count, trunks.generation, trunks.chunkCount, trunks.cellIdAt(3)], [5, 2, 2, 200], 'after two loads')
  expect(trunks.loadChunk(12, [record(300)]), false, 'a third chunk is refused when both chunk slots are taken')
  trunks.setBurnStage(4, 2)
  expect(trunks.unloadChunk(10), true, 'unload')
  expect([trunks.count, trunks.generation, trunks.cellIdAt(0), trunks.cellIdAt(1), trunks.stageAt(1), trunks.positions[3]], [2, 3, 200, 201, 2, 201], 'the second chunk moved down with its stage and position')
  expect(trunks.loadChunk(12, [record(300), record(301), record(302), record(303), record(304)]), false, 'a chunk that does not fit is refused whole')
  expect([trunks.count, trunks.stats.refusedFull, trunks.stats.refusedChunks, trunks.hasChunk(12)], [2, 1, 1, false], 'nothing was loaded by the refusals')
  expect(trunks.unloadChunk(99), false, 'unloading an absent chunk')
  refuses(() => trunks.loadChunk(11, []), 'already loaded', 'duplicate chunk')
  refuses(() => trunks.loadChunk(13, [{ x: 0, y: 0, z: 0 }]), 'trunkId', 'placement with no trunk id')
  refuses(() => trunks.cellIdAt(2), 'outside the 2 loaded trunks', 'index past the count')
  refuses(() => trunks.setBurnStage(0, 256), 'a burn stage is a byte', 'stage out of range')
  refuses(() => createTrunkStreamer({ capacity: 0, maxChunks: 1 }), 'capacity', 'zero capacity')
})

gate('an authority and a mirror registered in two app runtimes hold equal checksums and equal trunk burn stages, fed only by routed fire messages', () => {
  const early = { near: -1, far: -1 }
  const { authority, mirror, routed } = runPair(400, {
    onTick: (tick, a) => {
      if (tick !== 40) return
      early.near = 0
      early.far = 0
      for (let i = 0; i < a.trunks.count; i++) if (a.trunks.stageAt(i) !== FIRE_STATE.UNBURNT) { if (a.trunks.positions[i * 3] > 500) early.far++; else early.near++ }
    },
  })
  if (!(early.near > 0 && early.far === 0)) fail(`at tick 40 the near chunk has ${early.near} burnt trunks and the far chunk ${early.far}`)
  expect(authority.errors.concat(mirror.errors), [], 'hook errors')
  expect(mirror.fire.kernel.checksum(), authority.fire.kernel.checksum(), 'final checksum')
  const ledger = mirror.fire.ledger.stats
  if (!(ledger.compared > 20)) fail(`only ${ledger.compared} checksums compared`)
  expect([ledger.mismatches, ledger.missed, mirror.fire.stats.refused], [0, 0, 0], 'mismatches, missed, refused rows')
  if (!(routed > 20)) fail(`only ${routed} messages were routed`)
  expect(mirror.fires.stats.routed, routed, 'routed count')
  const burnt = burntTrunks(authority)
  if (!(burnt > 10)) fail(`only ${burnt} of ${authority.trunks.count} trunks changed stage`)
  expect(Array.from(mirror.trunks.stages.subarray(0, mirror.trunks.count)), Array.from(authority.trunks.stages.subarray(0, authority.trunks.count)), 'trunk stages')
  for (let i = 0; i < authority.trunks.count; i++) {
    const p = [authority.trunks.positions[i * 3], authority.trunks.positions[i * 3 + 1], authority.trunks.positions[i * 3 + 2]]
    if (authority.fire.stateAt(p) !== authority.trunks.stageAt(i)) fail(`trunk ${i} holds stage ${authority.trunks.stageAt(i)} while its cell is ${authority.fire.stateAt(p)}`)
  }
})

gate('unloading a trunk chunk in the running app makes the fire rebind the remaining trunks to their cells on the next tick', () => {
  const { authority } = runPair(260, {
    onTick: (tick, a) => { if (tick === 200) a.trunks.unloadChunk(2) },
  })
  const fresh = runPair(260).authority
  expect(authority.fire.stats.trunkRefreshes, fresh.fire.stats.trunkRefreshes + 1, 'trunk refreshes')
  expect(authority.fire.trunkCount, authority.trunks.count, 'trunk count the fire holds')
  if (!(fresh.trunks.count > authority.trunks.count)) fail('the unload removed no trunk')
  expect(Array.from(authority.trunks.stages.subarray(0, authority.trunks.count)), Array.from(fresh.trunks.stages.subarray(0, authority.trunks.count)), 'stages of the near chunk')
})

gate('route ignores a message that is not a fire message, never feeds an authority, and removing the fire stops routing', () => {
  const mirror = makeRuntime('mirror')
  const authority = makeRuntime('authority')
  expect(mirror.fires.route({ type: 'chat', text: 'x' }), false, 'foreign type')
  expect(mirror.fires.route(null), false, 'null message')
  expect(authority.fires.route({ type: 'fire', rows: [] }), false, 'an authority takes no fire message')
  expect(authority.fires.stats.unrouted, 1, 'unrouted count')
  expect(mirror.fires.route({ type: 'fire', rows: [] }), true, 'mirror takes a fire message')
  expect(mirror.fires.route({ type: 'fire', rows: [] }, 99), false, 'no fire on that id')
  expect(mirror.fires.unregister(7), true, 'unregister')
  expect([mirror.fires.size, mirror.hooks.has(7), mirror.fires.get(7), mirror.fires.stats.removed], [0, false, null, 1], 'after removal')
  expect(mirror.fires.route({ type: 'fire', rows: [] }), false, 'nothing to route to')
  expect(mirror.fires.unregister(7), false, 'second unregister')
})

gate('negative control: a mirror runtime that is never routed a message stays unburnt and its trunks keep stage zero', () => {
  const { authority, mirror } = runPair(400, { deliver: false })
  if (mirror.fire.kernel.checksum() === authority.fire.kernel.checksum()) fail('the unfed mirror matches the authority')
  expect(burntTrunks(mirror), 0, 'burnt trunks on the unfed mirror')
  if (!(burntTrunks(authority) > 10)) fail('the authority did not burn')
})

gate('negative control: a fire that is defined but whose runtime never ticks burns nothing', () => {
  const runtime = makeRuntime('authority')
  loadForest(runtime)
  const spot = [SPOT_XZ[0], runtime.frame.groundHeightLocal(SPOT_XZ[0], SPOT_XZ[1]), SPOT_XZ[1]]
  refuses(() => runtime.fire.ignite(spot), 'emit before start', 'ignite before the runtime started the fire')
  expect([runtime.sent.length, burntTrunks(runtime), runtime.fire.kernel.activeCount, runtime.hooks.isSpawned(7)], [0, 0, 0, false], 'messages, burnt trunks, active cells, spawned')
  runtime.step(0)
  runtime.fire.ignite(spot)
  for (let tick = 1; tick <= 120; tick++) runtime.step(tick)
  if (!(runtime.sent.length > 0 && burntTrunks(runtime) > 0)) fail('the same fire did not burn once its runtime ticked')
})

let colliderQueue = Promise.resolve()
const inTurn = (run) => {
  const turn = colliderQueue.then(() => new Promise((resolve) => setImmediate(resolve))).then(run)
  colliderQueue = turn.then(() => {}, () => {})
  return turn
}

const makeColliderWorld = async (specOverrides = {}) => {
  const frame = createPlanetFrame({ sampler, anchorDir: [0, 1, 0], offsetY: 0 })
  const state = { tick: 0 }
  const hooks = createHookRunner({ tickDt: TICK_DT })
  const fires = createAppFires({ hooks, tickOf: () => state.tick, tickDt: TICK_DT })
  const source = createFireLatticeSource(LATTICE)
  const holder = { streamer: null }
  const warnings = []
  const fire = fires.register(7, { ...SPEC, role: 'authority', ...specOverrides }, { appCtx: { send: () => {} }, frameOf: () => frame, latticeFor: source.latticeFor, trunkStreamerOf: () => holder.streamer, warn: (text) => warnings.push(text) })
  const probe = { fire, frame, source }
  const trunkPlacements = placementsNear(probe, SPOT_XZ[0], SPOT_XZ[1], 40, 8).map((t) => ({ id: t.trunkId, x: t.x, y: t.y, z: t.z }))
  const bodies = new Map()
  const removed = []
  let nextBody = 1
  let handedOut = false
  const physics = {
    addBody(shape, args, position, type, opts) { const id = nextBody++; bodies.set(id, { position: [...position], rotation: [...opts.rotation] }); return id },
    removeBody(id) { bodies.delete(id); removed.push(id) },
    preallocatePool() {},
    getBodyPosition: (id) => bodies.get(id).position,
    getBodyRotation: (id) => bodies.get(id).rotation,
    setBodyTransform(id, position, rotation) { bodies.set(id, { position: [...position], rotation: [...rotation] }) },
  }
  const saved = { log: console.log, warn: console.warn, error: console.error }
  console.log = () => {}
  console.warn = () => {}
  const streamer = createColliderStreamer({
    physics, frame, latticeSpec: { CHUNK: 64, GRID: 4 }, idField: 'id',
    placementsFor: () => { if (handedOut) return []; handedOut = true; return trunkPlacements },
    bodyArgs: (p) => ({ shape: 'box', args: new Float32Array([0.3, 2, 0.3]), position: [p.x, p.y, p.z], rotation: [0, 0, 0, 1], shapeKey: 'trunk' }),
    setColliderIds() {},
    getCenters: () => [[SPOT_XZ[0], SPOT_XZ[1]]],
    radius: 150, cap: 512, intervalMs: 300000,
    now: () => performance.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle), yieldToLoop: () => new Promise((resolve) => setImmediate(resolve)), cpuUsage: () => process.cpuUsage(),
    logTag: '[gate]',
  })
  await streamer.start()
  console.log = saved.log
  console.warn = saved.warn
  const restore = () => {}
  const step = (tick) => { state.tick = tick; const result = hooks.tick(tick); if (result.errors.length > 0) fail('hook error: ' + result.errors[0].message) }
  return { frame, fire, holder, streamer, bodies, removed, trunkPlacements, warnings, step, restore, spot: [SPOT_XZ[0], frame.groundHeightLocal(SPOT_XZ[0], SPOT_XZ[1]), SPOT_XZ[1]] }
}

gate('with the real trunk collider streamer the fire follows spoint: it installs isTrunkCharred as the exclusion and sweeps the collider of each trunk whose cell has burnt out', () => inTurn(async () => {
  const w = await makeColliderWorld()
  try {
    const before = w.streamer.liveCount
    if (!(before > 20)) fail(`the collider streamer placed only ${before} trunks`)
    w.step(0)
    w.fire.ignite(w.spot)
    for (let tick = 1; tick <= 20; tick++) w.step(tick)
    expect([w.fire.stats.collidersSwept, w.streamer.liveCount], [0, before], 'no streamer is attached yet, so nothing is swept')
    w.holder.streamer = w.streamer
    let firstSweepTick = -1
    for (let tick = 21; tick <= 900; tick++) {
      w.step(tick)
      if (firstSweepTick === -1 && w.fire.stats.collidersSwept > 0) firstSweepTick = tick
    }
    if (firstSweepTick === -1) fail('no trunk collider was swept in 900 ticks')
    const charred = w.trunkPlacements.filter((t) => w.fire.isTrunkCharred(t.id))
    if (!(charred.length > 5)) fail(`only ${charred.length} trunks are charred`)
    expect(w.fire.stats.collidersSwept, w.removed.length, 'colliders swept against bodies removed')
    for (const t of charred) if (w.streamer._live.has(t.id)) fail(`charred trunk ${t.id} still has a collider`)
    for (const t of w.trunkPlacements) if (!w.fire.isTrunkCharred(t.id) && !w.streamer._live.has(t.id)) fail(`trunk ${t.id} is not charred but lost its collider`)
    expect(w.streamer.liveCount, before - w.removed.length, 'live colliders')
  } finally {
    w.restore()
    w.streamer.stop()
  }
}))

gate('negative control: a fire with no trunk collider streamer burns the same cells and removes no collider', () => inTurn(async () => {
  const w = await makeColliderWorld()
  try {
    w.step(0)
    w.fire.ignite(w.spot)
    for (let tick = 1; tick <= 900; tick++) w.step(tick)
    if (!(w.trunkPlacements.filter((t) => w.fire.isTrunkCharred(t.id)).length > 5)) fail('the fire did not char the trunks')
    expect([w.fire.stats.collidersSwept, w.removed.length], [0, 0], 'swept and removed')
  } finally {
    w.restore()
    w.streamer.stop()
  }
}))

gate('a trunk collider streamer that lacks sweepExcluded or refresh is refused when the fire first meets it, and trunkStreamerOf must be a function', () => {
  const frame = createPlanetFrame({ sampler, anchorDir: [0, 1, 0], offsetY: 0 })
  const hooks = createHookRunner({ tickDt: TICK_DT })
  const fires = createAppFires({ hooks, tickOf: () => 0, tickDt: TICK_DT })
  refuses(() => fires.register(1, { ...SPEC, role: 'authority' }, { appCtx: { send: () => {} }, frameOf: () => frame, lattice: LATTICE, trunkStreamerOf: 'streamer' }), 'trunkStreamerOf is a function', 'non-function supplier')
  const fire = fires.register(2, { ...SPEC, role: 'authority' }, { appCtx: { send: () => {} }, frameOf: () => frame, lattice: LATTICE, trunks: { setExclude() {} } })
  fire.start(0)
  refuses(() => fire.tick(1, TICK_DT), 'no sweepExcluded function', 'half a streamer')
})

finish()
