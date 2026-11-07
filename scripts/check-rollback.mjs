import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { canonicalJSON } from '../src/rollback-pure/canonicalJSON.js'
import { DEFAULT_WINDOW, createRollbackLoop } from '../src/rollback-pure/rollbackLoop.js'
import { ROLLBACK_DEFAULTS, createRollbackGameLoop } from '../src/rollback-pure/rollbackGameLoop.js'
import { ROLLBACK_CTRL_PREFIX, parseControlFrame } from '../src/control-frame-pure/controlFrame.js'
import { DEFAULT_STALL_TICKS, createRollbackInputTransport } from '../src/rollback-pure/rollbackInputTransport.js'

const fakeTickSystem = () => {
  let handler = null
  const state = { started: false, stopped: false }
  return {
    state,
    onTick(fn) { handler = fn },
    start() { state.started = true },
    stop() { state.stopped = true },
    fire(driverTick, dt = 1 / 60) { handler(driverTick, dt) },
  }
}

const fakeLoopTransport = () => {
  const log = { local: [], checksums: [] }
  return {
    log,
    onRemoteInput: null,
    onRemoteChecksum: null,
    submitLocalInput(tick, input, advantage) { log.local.push({ tick, input, advantage }) },
    submitChecksum(tick, checksum) { log.checksums.push({ tick, checksum }) },
  }
}

const loopParts = (overrides = {}) => ({
  tickSystem: fakeTickSystem(),
  transport: fakeLoopTransport(),
  rollback: createRollbackLoop({ capture: (tick) => ({ tick }), apply: () => {}, windowSize: DEFAULT_WINDOW }),
  roster: ['L'],
  localPeerId: 'L',
  simulate: () => {},
  getLocalInput: () => ({ buttons: 0 }),
  ...overrides,
})

const buildLoop = ({ roster = ['L'], options = {}, checksumOf = null, rollback = null, getLocalInput = () => ({ buttons: 0 }) } = {}) => {
  const parts = loopParts({ roster, getLocalInput })
  if (rollback) parts.rollback = rollback
  const simLog = []
  parts.simulate = (tick, dt, inputs, resim) => { simLog.push({ tick, inputs, resim }) }
  const loop = createRollbackGameLoop({ ...parts, checksumOf, options })
  loop.start()
  const feed = (peer, tick, input = null, advantage = 0) => parts.transport.onRemoteInput(peer, tick, input, advantage)
  return { loop, tickSystem: parts.tickSystem, transport: parts.transport, ring: parts.rollback, simLog, feed }
}

const feedAndFire = (env, peer, fromTick, toTick, input = null, advantage = 0) => {
  for (let k = fromTick; k <= toTick; k++) {
    env.feed(peer, k, input, advantage)
    env.tickSystem.fire(k)
  }
}

const lcg = (seed) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const wiredLoop = ({ openPeers = ['B'], checksumOf = null, rollbackWrap = null } = {}) => {
  const sent = []
  const link = { pubkey: 'L', broadcast: (s) => { sent.push(s); return 1 } }
  const transport = createRollbackInputTransport({ link, openPeers })
  const tickSystem = fakeTickSystem()
  let ring = createRollbackLoop({ capture: (tick) => ({ tick }), apply: () => {}, windowSize: DEFAULT_WINDOW })
  if (rollbackWrap) ring = rollbackWrap(ring)
  const simLog = []
  const loop = createRollbackGameLoop({
    tickSystem,
    transport,
    rollback: ring,
    roster: ['L', 'B'],
    localPeerId: 'L',
    simulate: (tick, dt, inputs, resim) => { simLog.push({ tick, inputs, resim }) },
    getLocalInput: () => ({ buttons: 0 }),
    checksumOf,
  })
  loop.start()
  const frame = (peer, body) => transport.handleFrame({ data: ROLLBACK_CTRL_PREFIX + JSON.stringify(body), peerPubkey: peer })
  return { loop, transport, tickSystem, sent, simLog, frame }
}

const inputFrame = (tick, input = null, adv = 0) => ({ type: 'input', tick, input, adv })

const runStress = ({ seed, inputFor, maxRollbackTicks = 12, ticks = 300, deliverChance = 0.7 }) => {
  const rng = lcg(seed)
  const env = buildLoop({ roster: ['L', 'B'], options: { maxRollbackTicks } })
  let nextB = 1
  let worstRunAhead = 0
  for (let k = 1; k <= ticks; k++) {
    while (nextB <= k && rng() < deliverChance) {
      env.feed('B', nextB, inputFor(rng))
      nextB++
    }
    env.tickSystem.fire(k)
    worstRunAhead = Math.max(worstRunAhead, env.loop.getStats().runAhead)
  }
  return { stats: env.loop.getStats(), worstRunAhead }
}

gate('ROLLBACK_DEFAULTS holds the spoint values and cannot be edited', () => {
  assert.deepEqual(ROLLBACK_DEFAULTS, { inputDelayTicks: 1, maxRollbackTicks: 12, checksumIntervalTicks: 30 })
  assert.equal(Object.isFrozen(ROLLBACK_DEFAULTS), true)
  assert.throws(() => { ROLLBACK_DEFAULTS.maxRollbackTicks = 13 }, TypeError)
})

gate('DEFAULT_STALL_TICKS is 180 and the input transport uses it when none is given', () => {
  assert.equal(DEFAULT_STALL_TICKS, 180)
  const t = createRollbackInputTransport({ link: { broadcast: () => 0 }, openPeers: ['B'] })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":100,"input":null,"adv":0}', peerPubkey: 'B' })
  assert.deepEqual(t.getStalledPeers(280).map(p => p.pubkey), [])
  assert.deepEqual(t.getStalledPeers(281).map(p => p.pubkey), ['B'])
})

gate('the default window is 32 ticks', () => {
  assert.equal(DEFAULT_WINDOW, 32)
  assert.equal(createRollbackLoop({ capture: (t) => t, apply: () => {} }).windowSize, 32)
})

gate('a non-default window changes the window the ring reports', () => {
  assert.equal(createRollbackLoop({ capture: (t) => t, apply: () => {}, windowSize: 4 }).windowSize, 4)
})

gate('the state ring keeps the newest 32 saves and evicts the rest', () => {
  const ring = createRollbackLoop({ capture: (t) => ({ t }), apply: () => {} })
  for (let t = 0; t <= 39; t++) ring.save(t)
  assert.equal(ring.has(7), false)
  assert.equal(ring.has(8), true)
  assert.equal(ring.oldestTick(), 8)
  assert.equal(ring.newestTick, 39)
})

gate('a window of 4 evicts sooner, so the 32-tick default is what keeps the older saves', () => {
  const ring = createRollbackLoop({ capture: (t) => ({ t }), apply: () => {}, windowSize: 4 })
  for (let t = 0; t <= 9; t++) ring.save(t)
  assert.equal(ring.oldestTick(), 6)
})

gate('restore applies the saved snapshot and drops every newer tick', () => {
  const applied = []
  const ring = createRollbackLoop({ capture: (t) => ({ t }), apply: (s) => applied.push(s) })
  for (let t = 0; t <= 5; t++) ring.save(t)
  ring.restore(3)
  assert.deepEqual(applied, [{ t: 3 }])
  assert.equal(ring.has(4), false)
  assert.equal(ring.has(3), true)
  assert.equal(ring.newestTick, 3)
})

gate('restore refuses a tick the ring has evicted, and accepts one it still holds', () => {
  const ring = createRollbackLoop({ capture: (t) => ({ t }), apply: () => {} })
  for (let t = 0; t <= 40; t++) ring.save(t)
  assert.throws(() => ring.restore(7), /\[RollbackLoop\] restore\(7\): not in ring/)
  assert.doesNotThrow(() => ring.restore(9))
})

gate('saving an older tick does not move the newest tick back', () => {
  const ring = createRollbackLoop({ capture: (t) => t, apply: () => {} })
  ring.save(10)
  ring.save(5)
  assert.equal(ring.newestTick, 10)
  ring.save(12)
  assert.equal(ring.newestTick, 12)
})

gate('createRollbackLoop refuses a missing capture or apply', () => {
  assert.throws(() => createRollbackLoop({ apply: () => {} }), /capture\(\) and apply\(snapshot\) are required/)
  assert.throws(() => createRollbackLoop({ capture: () => 0 }), /capture\(\) and apply\(snapshot\) are required/)
  assert.doesNotThrow(() => createRollbackLoop({ capture: () => 0, apply: () => {} }))
})

gate('canonicalJSON sorts object keys at every depth and keeps array order', () => {
  assert.equal(canonicalJSON({ b: 1, a: { d: 2, c: [3, 1] } }), '{"a":{"c":[3,1],"d":2},"b":1}')
  assert.equal(canonicalJSON(null), 'null')
  assert.notEqual(canonicalJSON({ a: 1 }), canonicalJSON({ a: 2 }))
  assert.notEqual(canonicalJSON([3, 1]), canonicalJSON([1, 3]))
})

gate('createRollbackGameLoop refuses each missing collaborator with its spoint message', () => {
  assert.throws(() => createRollbackGameLoop(loopParts({ tickSystem: null })), /\[RollbackGameLoop\] tickSystem is required/)
  assert.throws(() => createRollbackGameLoop(loopParts({ transport: {} })), /transport \(RollbackInputTransport\) is required/)
  assert.throws(() => createRollbackGameLoop(loopParts({ rollback: {} })), /rollback \(RollbackLoop state ring\) is required/)
  assert.throws(() => createRollbackGameLoop(loopParts({ roster: ['B'] })), /roster must list every peer pubkey including localPeerId/)
  assert.throws(() => createRollbackGameLoop(loopParts({ simulate: null })), /simulate\(tick, dt, inputsByPeer, resim\) and getLocalInput\(\) are required/)
  assert.doesNotThrow(() => createRollbackGameLoop(loopParts()))
})

gate('the loop refuses maxRollbackTicks+inputDelayTicks equal to the window and accepts one less', () => {
  const ringOf = (windowSize) => createRollbackLoop({ capture: (t) => t, apply: () => {}, windowSize })
  assert.throws(() => createRollbackGameLoop(loopParts({ rollback: ringOf(13) })), /must be < state ring window \(13\)/)
  assert.doesNotThrow(() => createRollbackGameLoop(loopParts({ rollback: ringOf(14) })))
})

gate('start saves tick 0 and submits inputDelayTicks null inputs for the first ticks', () => {
  const env = buildLoop({ options: { inputDelayTicks: 3 } })
  assert.equal(env.ring.has(0), true)
  assert.deepEqual(env.transport.log.local.map(e => [e.tick, e.input]), [[1, null], [2, null], [3, null]])
  assert.equal(env.tickSystem.state.started, true)
})

gate('the default input delay submits one start input, so a different delay changes the count', () => {
  const env = buildLoop()
  assert.deepEqual(env.transport.log.local.map(e => [e.tick, e.input]), [[1, null]])
})

gate('each driver tick simulates one tick and submits the local input inputDelayTicks ahead', () => {
  const env = buildLoop()
  env.tickSystem.fire(1)
  env.tickSystem.fire(2)
  env.tickSystem.fire(3)
  assert.equal(env.loop.simTick, 3)
  assert.deepEqual(env.transport.log.local.map(e => e.tick), [1, 2, 3, 4])
  assert.deepEqual(env.simLog.map(e => e.tick), [1, 2, 3])
})

gate('a single-player roster never stalls however long it runs', () => {
  const env = buildLoop()
  for (let k = 1; k <= 50; k++) env.tickSystem.fire(k)
  assert.equal(env.loop.simTick, 50)
  assert.equal(env.loop.getStats().stalls, 0)
})

const holdRemoteAdvantage = (env, peers) => {
  for (const peer of peers) env.feed(peer, 0, null, 100)
}

gate('a silent remote draws time-sync yields before it stalls the loop, because an unreported advantage counts as zero', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  for (let k = 1; k <= 12; k++) env.tickSystem.fire(k)
  assert.ok(env.loop.getStats().timeSyncYields > 0, 'no time-sync yield, got ' + env.loop.getStats().timeSyncYields)
})

gate('holding the silent remote advantage high removes those yields, so the stall rule is what remains', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  holdRemoteAdvantage(env, ['B'])
  for (let k = 1; k <= 12; k++) env.tickSystem.fire(k)
  assert.equal(env.loop.getStats().timeSyncYields, 0)
  assert.equal(env.loop.simTick, 12)
})

gate('a silent remote stalls the loop once it is more than maxRollbackTicks behind', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  holdRemoteAdvantage(env, ['B'])
  for (let k = 1; k <= 20; k++) env.tickSystem.fire(k)
  assert.equal(env.loop.simTick, 12)
  assert.equal(env.loop.getStats().stalls, 8)
})

gate('a remote exactly maxRollbackTicks behind is still simulated, and one tick further stalls', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  holdRemoteAdvantage(env, ['B'])
  for (let k = 1; k <= 12; k++) env.tickSystem.fire(k)
  assert.equal(env.loop.simTick, 12)
  assert.equal(env.loop.getStats().stalls, 0)
  env.tickSystem.fire(13)
  assert.equal(env.loop.simTick, 12)
  assert.equal(env.loop.getStats().stalls, 1)
})

gate('the stall rule follows the least-advanced remote, not the most advanced one', () => {
  const env = buildLoop({ roster: ['L', 'A', 'B'] })
  holdRemoteAdvantage(env, ['A', 'B'])
  for (let t = 1; t <= 100; t++) env.feed('A', t)
  for (let k = 1; k <= 20; k++) env.tickSystem.fire(k)
  assert.equal(env.loop.simTick, 12)
  assert.equal(env.loop.getStats().stalls, 8)
})

gate('the same stall does not happen once the least-advanced remote also reaches tick 100', () => {
  const env = buildLoop({ roster: ['L', 'A', 'B'] })
  for (let t = 1; t <= 100; t++) {
    env.feed('A', t)
    env.feed('B', t)
  }
  for (let k = 1; k <= 20; k++) env.tickSystem.fire(k)
  assert.equal(env.loop.simTick, 20)
  assert.equal(env.loop.getStats().stalls, 0)
})

gate('a maxRollbackTicks change moves the stall point, so a perturbed limit changes the result', () => {
  const at5 = buildLoop({ roster: ['L', 'B'], options: { maxRollbackTicks: 5 } })
  const at12 = buildLoop({ roster: ['L', 'B'], options: { maxRollbackTicks: 12 } })
  holdRemoteAdvantage(at5, ['B'])
  holdRemoteAdvantage(at12, ['B'])
  for (let k = 1; k <= 20; k++) {
    at5.tickSystem.fire(k)
    at12.tickSystem.fire(k)
  }
  assert.equal(at5.loop.simTick, 5)
  assert.equal(at12.loop.simTick, 12)
})

gate('a tick simulated before a remote confirms it counts as predicted for that remote', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  env.tickSystem.fire(1)
  env.tickSystem.fire(2)
  env.tickSystem.fire(3)
  assert.equal(env.loop.getStats().predictedTicks, 3)
})

gate('a remote input confirmed before its tick is simulated is not counted as predicted', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  env.feed('B', 1)
  env.tickSystem.fire(1)
  env.tickSystem.fire(2)
  env.tickSystem.fire(3)
  assert.equal(env.loop.getStats().predictedTicks, 2)
})

gate('a remote input that differs from its prediction rolls back to that tick and resimulates to the present', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  env.feed('B', 1)
  env.feed('B', 2)
  for (let k = 1; k <= 5; k++) env.tickSystem.fire(k)
  env.feed('B', 3, { buttons: 1 })
  env.tickSystem.fire(6)
  const resim = env.simLog.filter(e => e.resim)
  assert.deepEqual(resim.map(e => e.tick), [3, 4, 5])
  assert.deepEqual(env.simLog.at(-1), { tick: 6, inputs: env.simLog.at(-1).inputs, resim: false })
  assert.deepEqual(resim.map(e => e.inputs.get('B')), [{ buttons: 1 }, { buttons: 1 }, { buttons: 1 }])
  const stats = env.loop.getStats()
  assert.equal(stats.mispredictions, 1)
  assert.equal(stats.rollbacks, 1)
  assert.equal(stats.rollbackTicks, 3)
  assert.equal(stats.maxRollbackDepth, 3)
  assert.equal(stats.avgRollbackDepth, 3)
})

gate('a remote input that matches its prediction causes no rollback', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  env.feed('B', 1)
  env.feed('B', 2)
  for (let k = 1; k <= 5; k++) env.tickSystem.fire(k)
  env.feed('B', 3, null)
  env.tickSystem.fire(6)
  assert.equal(env.simLog.filter(e => e.resim).length, 0)
  assert.equal(env.loop.getStats().mispredictions, 0)
  assert.equal(env.loop.getStats().rollbacks, 0)
})

gate('a remote input for a tick the loop has not simulated yet does not roll back', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  env.feed('B', 1)
  env.feed('B', 2)
  for (let k = 1; k <= 5; k++) env.tickSystem.fire(k)
  env.feed('B', 9, { buttons: 1 })
  env.tickSystem.fire(6)
  assert.equal(env.simLog.filter(e => e.resim).length, 0)
  assert.equal(env.loop.getStats().mispredictions, 0)
})

gate('a second input for an already confirmed tick is ignored, so a later correction does not roll back', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  env.feed('B', 1)
  env.feed('B', 2)
  for (let k = 1; k <= 2; k++) env.tickSystem.fire(k)
  env.feed('B', 3, null)
  for (let k = 3; k <= 5; k++) env.tickSystem.fire(k)
  env.feed('B', 3, { buttons: 1 })
  env.tickSystem.fire(6)
  assert.equal(env.simLog.filter(e => e.resim).length, 0)
  assert.equal(env.loop.getStats().mispredictions, 0)
})

gate('a rollback whose base tick the ring no longer holds is counted as unrecoverable and not restored', () => {
  const inner = createRollbackLoop({ capture: (t) => ({ t }), apply: () => {} })
  const blocked = {
    save: (t) => inner.save(t),
    get: (t) => inner.get(t),
    has: () => false,
    restore: () => { throw new Error('restore must not run') },
    oldestTick: () => inner.oldestTick(),
    get windowSize() { return inner.windowSize },
  }
  const env = buildLoop({ roster: ['L', 'B'], rollback: blocked })
  env.feed('B', 1)
  env.feed('B', 2)
  for (let k = 1; k <= 5; k++) env.tickSystem.fire(k)
  env.feed('B', 3, { buttons: 1 })
  env.tickSystem.fire(6)
  const stats = env.loop.getStats()
  assert.equal(stats.unrecoverableRollbacks, 1)
  assert.equal(stats.rollbacks, 0)
  assert.equal(env.simLog.filter(e => e.resim).length, 0)
})

gate('the same unrecoverable scenario with a ring that holds the base tick is restored instead', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  env.feed('B', 1)
  env.feed('B', 2)
  for (let k = 1; k <= 5; k++) env.tickSystem.fire(k)
  env.feed('B', 3, { buttons: 1 })
  env.tickSystem.fire(6)
  assert.equal(env.loop.getStats().unrecoverableRollbacks, 0)
  assert.equal(env.loop.getStats().rollbacks, 1)
})

gate('a local checksum is emitted at the interval once both sides have settled past it', () => {
  const env = buildLoop({ roster: ['L', 'B'], checksumOf: (tick, snap) => `${snap.tick}:abc` })
  feedAndFire(env, 'B', 1, 29)
  assert.deepEqual(env.transport.log.checksums, [])
  env.feed('B', 30)
  env.tickSystem.fire(30)
  assert.deepEqual(env.transport.log.checksums, [{ tick: 30, checksum: '30:abc' }])
})

gate('no checksum is sent when the loop has no checksumOf', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  feedAndFire(env, 'B', 1, 30)
  assert.deepEqual(env.transport.log.checksums, [])
})

gate('a remote checksum that matches the local one is compared and is not a desync', () => {
  const env = buildLoop({ roster: ['L', 'B'], checksumOf: () => 'abc' })
  feedAndFire(env, 'B', 1, 30)
  env.transport.onRemoteChecksum('B', 30, 'abc')
  const stats = env.loop.getStats()
  assert.equal(stats.checksumsCompared, 1)
  assert.equal(stats.desyncs, 0)
  assert.equal(stats.firstDesyncTick, null)
})

gate('a remote checksum that differs from the local one is a desync at that tick and is logged', () => {
  const env = buildLoop({ roster: ['L', 'B'], checksumOf: () => 'abc' })
  feedAndFire(env, 'B', 1, 30)
  env.transport.onRemoteChecksum('B', 30, 'xyz')
  const stats = env.loop.getStats()
  assert.equal(stats.desyncs, 1)
  assert.equal(stats.firstDesyncTick, 30)
  assert.deepEqual(stats.desyncLog, [{ tick: 30, peer: 'B', mine: 'abc', theirs: 'xyz' }])
})

gate('a remote checksum that arrives before the local one is compared when the local one is emitted', () => {
  const env = buildLoop({ roster: ['L', 'B'], checksumOf: () => 'abc' })
  feedAndFire(env, 'B', 1, 29)
  env.transport.onRemoteChecksum('B', 30, 'xyz')
  env.feed('B', 30)
  env.tickSystem.fire(30)
  assert.equal(env.loop.getStats().desyncs, 1)
})

gate('the same early remote checksum that matches counts as compared with no desync', () => {
  const env = buildLoop({ roster: ['L', 'B'], checksumOf: () => 'abc' })
  feedAndFire(env, 'B', 1, 29)
  env.transport.onRemoteChecksum('B', 30, 'abc')
  env.feed('B', 30)
  env.tickSystem.fire(30)
  assert.equal(env.loop.getStats().checksumsCompared, 1)
  assert.equal(env.loop.getStats().desyncs, 0)
})

gate('a loop that is ahead of its remote yields to time sync only on a driver tick that is a multiple of 4', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  for (let t = 1; t <= 5; t++) env.feed('B', t, null, 0)
  for (let k = 1; k <= 8; k++) env.tickSystem.fire(k)
  assert.equal(env.loop.getStats().timeSyncYields, 1)
  assert.equal(env.loop.simTick, 7)
  env.tickSystem.fire(9)
  assert.equal(env.loop.simTick, 8)
  assert.equal(env.loop.getStats().timeSyncYields, 1)
})

gate('a remote advantage large enough to close the gap removes the time sync yield', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  for (let t = 1; t <= 5; t++) env.feed('B', t, null, 6)
  for (let k = 1; k <= 8; k++) env.tickSystem.fire(k)
  assert.equal(env.loop.getStats().timeSyncYields, 0)
  assert.equal(env.loop.simTick, 8)
})

gate('prune drops used inputs older than the window and keeps the boundary tick', () => {
  const env = buildLoop({ roster: ['L', 'B'] })
  feedAndFire(env, 'B', 1, 100)
  assert.equal(env.loop.inspectTick(67).used, null)
  assert.notEqual(env.loop.inspectTick(68).used, null)
  assert.notEqual(env.loop.inspectTick(100).used, null)
  assert.equal(env.loop.inspectTick(1).snapshot, null)
  assert.notEqual(env.loop.inspectTick(100).snapshot, null)
})

gate('stop forwards to the tick system and options returns a copy', () => {
  const env = buildLoop()
  env.loop.stop()
  assert.equal(env.tickSystem.state.stopped, true)
  const copy = env.loop.options
  copy.maxRollbackTicks = 99
  assert.equal(env.loop.options.maxRollbackTicks, 12)
})

gate('a seeded random stream of remote inputs never breaks the rollback bound or leaves an unrecoverable rollback', () => {
  const result = runStress({ seed: 7, inputFor: (r) => ({ buttons: r() < 0.5 ? 0 : 1 }) })
  assert.equal(result.stats.unrecoverableRollbacks, 0)
  assert.ok(result.stats.rollbacks > 0, 'expected at least one rollback, got ' + result.stats.rollbacks)
  assert.ok(result.worstRunAhead <= 12, 'run-ahead reached ' + result.worstRunAhead)
  assert.ok(result.stats.simTick > 0)
})

gate('the same stream with every input equal to its prediction causes no rollback', () => {
  const result = runStress({ seed: 7, inputFor: () => null })
  assert.equal(result.stats.rollbacks, 0)
  assert.equal(result.stats.mispredictions, 0)
})

gate('the run-ahead limit equals maxRollbackTicks, so a perturbed limit changes the reached run-ahead', () => {
  const at5 = runStress({ seed: 3, inputFor: () => null, maxRollbackTicks: 5, deliverChance: 0 })
  const at12 = runStress({ seed: 3, inputFor: () => null, maxRollbackTicks: 12, deliverChance: 0 })
  assert.equal(at5.worstRunAhead, 5)
  assert.equal(at12.worstRunAhead, 12)
})

gate('the wired transport delivers a peer input frame into the loop and a silent peer still stalls it', () => {
  const silent = wiredLoop()
  for (let k = 1; k <= 20; k++) silent.tickSystem.fire(k)
  assert.equal(silent.loop.simTick, 12)
  const chatty = wiredLoop()
  for (let k = 1; k <= 30; k++) {
    chatty.frame('B', inputFrame(k))
    chatty.tickSystem.fire(k)
  }
  assert.equal(chatty.loop.simTick, 30)
  assert.equal(chatty.loop.getStats().stalls, 0)
  assert.equal(chatty.transport.stats.received, 30)
})

gate('a checksum frame from the wired transport is sent with the spoint wire text and compared on arrival', () => {
  const env = wiredLoop({ checksumOf: () => 'abc' })
  for (let k = 1; k <= 30; k++) {
    env.frame('B', inputFrame(k))
    env.tickSystem.fire(k)
  }
  assert.ok(env.sent.includes('wwrollback:{"type":"checksum","tick":30,"checksum":"abc"}'))
  env.frame('B', { type: 'checksum', tick: 30, checksum: 'xyz' })
  assert.equal(env.loop.getStats().desyncs, 1)
})

gate('a misprediction arriving as a wire frame triggers the rollback', () => {
  const env = wiredLoop()
  env.frame('B', inputFrame(1))
  env.frame('B', inputFrame(2))
  for (let k = 1; k <= 5; k++) env.tickSystem.fire(k)
  env.frame('B', inputFrame(3, { buttons: 1 }))
  env.tickSystem.fire(6)
  assert.equal(env.loop.getStats().rollbacks, 1)
})

gate('a wire frame that matches the prediction does not trigger a rollback', () => {
  const env = wiredLoop()
  env.frame('B', inputFrame(1))
  env.frame('B', inputFrame(2))
  for (let k = 1; k <= 5; k++) env.tickSystem.fire(k)
  env.frame('B', inputFrame(3, null))
  env.tickSystem.fire(6)
  assert.equal(env.loop.getStats().rollbacks, 0)
})

gate('the transport broadcasts an input frame in spoint key order and returns the link count', () => {
  const sent = []
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: (s) => { sent.push(s); return 7 } } })
  assert.equal(t.submitLocalInput(5, { buttons: 2 }, -1), 7)
  assert.deepEqual(sent, ['wwrollback:{"type":"input","tick":5,"input":{"buttons":2},"adv":-1}'])
  assert.equal(t.stats.sent, 1)
})

gate('the transport refuses construction without a broadcast and submission before a pubkey exists', () => {
  assert.throws(() => createRollbackInputTransport({ link: {} }), /link\.broadcast required/)
  assert.throws(() => createRollbackInputTransport({}), /link\.broadcast required/)
  const t = createRollbackInputTransport({ link: { broadcast: () => 0 } })
  assert.throws(() => t.submitLocalInput(1, null), /link not connected \(no pubkey yet\)/)
  assert.doesNotThrow(() => createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 } }).submitLocalInput(1, null))
})

gate('the transport broadcasts a checksum frame and counts it', () => {
  const sent = []
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: (s) => { sent.push(s); return 1 } } })
  t.submitChecksum(30, 'abc')
  assert.deepEqual(sent, ['wwrollback:{"type":"checksum","tick":30,"checksum":"abc"}'])
  assert.equal(t.stats.checksumsSent, 1)
})

gate('a valid input frame reaches onRemoteInput with its finite advantage kept', () => {
  const calls = []
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, onRemoteInput: (...a) => calls.push(a) })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":4,"input":{"buttons":1},"adv":5}', peerPubkey: 'B' })
  assert.deepEqual(calls, [['B', 4, { buttons: 1 }, 5]])
  assert.equal(t.stats.received, 1)
})

gate('a non-numeric or missing advantage is read as zero, so a perturbed advantage changes the result', () => {
  const calls = []
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, onRemoteInput: (...a) => calls.push(a) })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":4,"input":null,"adv":"x"}', peerPubkey: 'B' })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":5,"input":null}', peerPubkey: 'B' })
  assert.deepEqual(calls.map(c => c[3]), [0, 0])
})

gate('a frame that fails the contract is counted under its status and never applied', () => {
  const calls = []
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, onRemoteInput: (...a) => calls.push(a) })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":1.5,"input":null,"adv":0}', peerPubkey: 'B' })
  t.handleFrame({ data: 'wwlockstep:{"type":"input","tick":1}', peerPubkey: 'B' })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{', peerPubkey: 'B' })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"drop","tick":1}', peerPubkey: 'B' })
  const stats = t.getStats()
  assert.equal(stats.rejects['invalid-field'], 1)
  assert.equal(stats.rejects['foreign-prefix'], 1)
  assert.equal(stats.rejects['malformed-payload'], 1)
  assert.equal(stats.rejects['unknown-kind'], 1)
  assert.equal(stats.unknownKind, 1)
  assert.equal(stats.received, 0)
  assert.deepEqual(calls, [])
})

gate('a well-formed input frame is applied, so the rejects above come from the contract and not from the wiring', () => {
  const calls = []
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, onRemoteInput: (...a) => calls.push(a) })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":1,"input":null,"adv":0}', peerPubkey: 'B' })
  assert.equal(calls.length, 1)
  assert.deepEqual(t.getStats().rejects, {})
})

gate('the parse contract admits zero and negative integer ticks, as spoint does', () => {
  assert.equal(parseControlFrame(ROLLBACK_CTRL_PREFIX, ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":-1}').status, 'accepted')
  assert.equal(parseControlFrame(ROLLBACK_CTRL_PREFIX, ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":0}').status, 'accepted')
  assert.equal(parseControlFrame(ROLLBACK_CTRL_PREFIX, ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":"3"}').status, 'invalid-field')
})

gate('a frame from the local peer is refused as self-echo and never applied', () => {
  const calls = []
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, onRemoteInput: (...a) => calls.push(a) })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":1,"input":null,"adv":0}', peerPubkey: 'L' })
  assert.equal(t.getStats().rejects['self-echo'], 1)
  assert.deepEqual(calls, [])
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":1,"input":null,"adv":0}', peerPubkey: 'B' })
  assert.equal(calls.length, 1)
})

gate('a frame with no sender is refused as unattributed', () => {
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 } })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":1,"input":null,"adv":0}' })
  assert.equal(t.getStats().rejects['unattributed-sender'], 1)
})

gate('a stale or duplicate input is counted but still reaches the loop, because the transport does not drop it', () => {
  const calls = []
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, onRemoteInput: (...a) => calls.push(a) })
  for (const tick of [5, 5, 4]) t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + `{"type":"input","tick":${tick},"input":null,"adv":0}`, peerPubkey: 'B' })
  const stats = t.getStats()
  assert.equal(stats.duplicateIgnored, 1)
  assert.equal(stats.staleIgnored, 1)
  assert.equal(calls.length, 3)
})

gate('frames that advance in order are not counted as stale or duplicate', () => {
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 } })
  for (const tick of [5, 6, 7]) t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + `{"type":"input","tick":${tick},"input":null,"adv":0}`, peerPubkey: 'B' })
  const stats = t.getStats()
  assert.equal(stats.staleIgnored, 0)
  assert.equal(stats.duplicateIgnored, 0)
  assert.equal(stats.lastTickByPeer.B, 7)
})

gate('a checksum frame reaches onRemoteChecksum and never moves the input clock', () => {
  const sums = []
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, onRemoteChecksum: (...a) => sums.push(a) })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"checksum","tick":30,"checksum":"abc"}', peerPubkey: 'B' })
  assert.deepEqual(sums, [['B', 30, 'abc']])
  assert.equal(t.getStats().checksumsReceived, 1)
  assert.deepEqual(t.getStats().lastTickByPeer, {})
})

gate('an input frame moves the input clock, so the same peer then reports its last tick', () => {
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 } })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":1,"input":null,"adv":0}', peerPubkey: 'B' })
  assert.deepEqual(t.getStats().lastTickByPeer, { B: 1 })
})

gate('getStalledPeers reports a peer silent for more than the stall window, including one never heard from', () => {
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, openPeers: ['A', 'B'] })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":100,"input":null,"adv":0}', peerPubkey: 'B' })
  assert.deepEqual(t.getStalledPeers(280), [{ pubkey: 'A', lastTick: -1 }])
  assert.deepEqual(t.getStalledPeers(281), [{ pubkey: 'A', lastTick: -1 }, { pubkey: 'B', lastTick: 100 }])
})

gate('a shorter stall window reports a peer sooner, so a perturbed window changes the result', () => {
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, openPeers: ['B'], stallTicks: 10 })
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":100,"input":null,"adv":0}', peerPubkey: 'B' })
  assert.deepEqual(t.getStalledPeers(110), [])
  assert.deepEqual(t.getStalledPeers(111), [{ pubkey: 'B', lastTick: 100 }])
})

gate('dropPeer removes a peer from the roster and an arriving input admits it again', () => {
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, openPeers: ['A', 'B'] })
  t.dropPeer('B')
  assert.deepEqual(t.getRoster(), ['A'])
  assert.deepEqual(t.getStalledPeers(1000).map(p => p.pubkey), ['A'])
  t.handleFrame({ data: ROLLBACK_CTRL_PREFIX + '{"type":"input","tick":1,"input":null,"adv":0}', peerPubkey: 'B' })
  assert.deepEqual(t.getRoster(), ['A', 'B'])
})

gate('dropPeer ignores a missing pubkey, so nothing is dropped', () => {
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, openPeers: ['A'] })
  t.dropPeer(undefined)
  assert.deepEqual(t.getRoster(), ['A'])
})

gate('peerOpened and peerClosed follow the link lifecycle and ignore a missing pubkey', () => {
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 } })
  t.peerOpened('C')
  assert.deepEqual(t.getRoster(), ['C'])
  t.peerOpened(undefined)
  assert.deepEqual(t.getRoster(), ['C'])
  t.peerClosed('C')
  assert.deepEqual(t.getRoster(), [])
  assert.deepEqual(t.getStats().dropped, ['C'])
})

gate('getStats reports the roster, the dropped set and the per-peer clock in the spoint shape', () => {
  const t = createRollbackInputTransport({ link: { pubkey: 'L', broadcast: () => 0 }, openPeers: ['A'] })
  const stats = t.getStats()
  assert.deepEqual(stats.roster, ['A'])
  assert.deepEqual(stats.dropped, [])
  assert.deepEqual(stats.lastTickByPeer, {})
  assert.equal(stats.staleIgnored, 0)
  assert.equal(stats.duplicateIgnored, 0)
})

finish()
