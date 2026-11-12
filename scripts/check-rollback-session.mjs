import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { ROLLBACK_CTRL_PREFIX } from '../src/control-frame-pure/controlFrame.js'
import { resolveNetcodeProfile } from '../src/lockstep-pure/netcodeProfile.js'
import { PEER_LOOP_FACTORIES, PEER_SIMULATED_PROFILES } from '../src/lockstep-pure/peerLoops.js'
import { createPeerSimSession } from '../src/lockstep-pure/peerSimSession.js'
import { buildRollbackPeerLoop } from '../src/rollback-pure/peerSimRuntime.js'

const fakeTickSystem = () => {
  let handler = null
  let n = 0
  const state = { started: false, stopped: false }
  return {
    state,
    onTick(fn) { handler = fn },
    start() { state.started = true },
    stop() { state.stopped = true },
    fire() { n += 1; handler(n, 1 / 60) },
  }
}

const fakeBridge = (pubkey, others) => {
  const sent = []
  const data = Object.assign(new EventTarget(), {
    broadcast(text) { sent.push(text); return others.length },
    peers: new Map(others.map((pk) => [pk, { dc: { readyState: 'open' } }])),
  })
  return { pubkey, data, sent, cursor: 0 }
}

const fakeCtx = ({ drift = 0 } = {}) => {
  const players = new Map()
  const queues = new Map()
  const bodies = new Map([[1, { position: [0, 0, 0], rotation: [0, 0, 0, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] }]])
  const log = { flushes: 0, simulated: 0, restores: 0 }
  let nextId = 1
  const playerManager = {
    addPlayer(socket, { position }) {
      const id = nextId++
      players.set(id, { id, socket, state: { position: [...position], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] } })
      queues.set(id, [])
      return id
    },
    getPlayer: (id) => players.get(id),
    getInputs: (id) => queues.get(id),
    snapshotState: () => new Map([...players].map(([id, p]) => [id, { state: { position: [...p.state.position], velocity: [...p.state.velocity] } }])),
    restoreState(snap) {
      log.restores += 1
      for (const [id, s] of snap) {
        const st = players.get(id).state
        st.position = [...s.state.position]
        st.velocity = [...s.state.velocity]
      }
    },
  }
  const physics = {
    snapshotBodies: () => new Map([...bodies].map(([id, b]) => [id, { position: [...b.position], rotation: [...b.rotation], velocity: [...b.velocity], angularVelocity: [...b.angularVelocity] }])),
    restoreBodies(snap) { for (const [id, b] of snap) bodies.set(id, { position: [...b.position], rotation: [...b.rotation], velocity: [...b.velocity], angularVelocity: [...b.angularVelocity] }) },
  }
  const ctx = {
    currentWorldDef: { netcode: { profile: 'rollback', rollback: { checksumIntervalTicks: 5 } } },
    worldSpawnPoints: [[0, 0, 0], [10, 0, 0]],
    playerManager,
    networkState: { addPlayer() {} },
    physicsIntegration: { addPlayerCollider() {}, setPlayerPosition() {} },
    physics,
    lagCompensator: { recordPlayerPosition() {} },
    connections: { flushAll() { log.flushes += 1 } },
    handlerState: {
      fn(tick, dt, inputs) {
        log.simulated += 1
        for (const [id, input] of inputs) {
          const st = players.get(id).state
          const dx = input ? input.dx : 0
          st.position[0] += dx + drift
          st.velocity[0] = dx
        }
        bodies.get(1).position[1] += 0.25
      },
    },
    appRuntime: { entities: new Map() },
  }
  return { ctx, log, players, queues, bodies }
}

const pair = ({ driftB = 0 } = {}) => {
  const a = fakeCtx()
  const b = fakeCtx({ drift: driftB })
  const bridgeA = fakeBridge('A', ['B'])
  const bridgeB = fakeBridge('B', ['A'])
  const tickA = fakeTickSystem()
  const tickB = fakeTickSystem()
  const sessionA = createPeerSimSession(a.ctx, { roster: ['B', 'A'], localPubkey: 'A', bridge: bridgeA, tickSystem: tickA, now: () => 0 })
  const sessionB = createPeerSimSession(b.ctx, { roster: ['A', 'B'], localPubkey: 'B', bridge: bridgeB, tickSystem: tickB, now: () => 0 })
  const deliver = (from, to, fromKey) => {
    while (from.cursor < from.sent.length) {
      to.data.dispatchEvent(new CustomEvent('data', { detail: { data: from.sent[from.cursor], peerPubkey: fromKey } }))
      from.cursor += 1
    }
  }
  const press = (side, session, input) => side.queues.get(session.localPlayerId).push({ data: input })
  return {
    a, b, bridgeA, bridgeB, tickA, tickB, sessionA, sessionB,
    aToB: () => deliver(bridgeA, bridgeB, 'A'),
    bToA: () => deliver(bridgeB, bridgeA, 'B'),
    stepA: (input) => { press(a, sessionA, input); tickA.fire() },
    stepB: (input) => { press(b, sessionB, input); tickB.fire() },
  }
}

gate('the peer loop factory map lists rollback beside lockstep, and a rollback world resolves as peer-simulated', () => {
  assert.deepEqual(Object.keys(PEER_LOOP_FACTORIES).sort(), ['lockstep', 'rollback'])
  assert.equal(PEER_LOOP_FACTORIES.rollback, buildRollbackPeerLoop)
  assert.equal(PEER_SIMULATED_PROFILES.has('rollback'), true)
  assert.equal(resolveNetcodeProfile({ netcode: { profile: 'rollback' } }).peerSimulated, true)
})

gate('control: an authoritative world is still refused as not peer-simulated', () => {
  assert.equal(PEER_SIMULATED_PROFILES.has('authoritative'), false)
  const { ctx } = fakeCtx()
  ctx.currentWorldDef = { netcode: { profile: 'authoritative' } }
  assert.throws(() => createPeerSimSession(ctx, { roster: ['A', 'B'], localPubkey: 'A', bridge: fakeBridge('A', ['B']), tickSystem: fakeTickSystem(), now: () => 0 }), { message: "[PeerSimSession] world netcode profile 'authoritative' is not peer-simulated" })
})

gate('a rollback world builds a session with no consensus voter, and start sends rollback input frames on the bridge', () => {
  const env = pair()
  assert.equal(env.sessionA.getStats().profile, 'rollback')
  assert.equal(env.sessionA.localPlayerId, 1)
  assert.equal(env.sessionB.localPlayerId, 2)
  env.sessionA.start()
  assert.equal(env.tickA.state.started, true)
  assert.ok(env.bridgeA.sent.length > 0 && env.bridgeA.sent.every((text) => text.startsWith(ROLLBACK_CTRL_PREFIX)))
  env.sessionA.stop()
  assert.equal(env.tickA.state.stopped, true)
})

gate('a late remote input rolls the session back through the captured ring and replays to the corrected position', () => {
  const env = pair()
  env.sessionA.start()
  env.sessionB.start()
  for (let i = 0; i < 5; i++) env.stepB({ dx: 1 })
  for (let i = 0; i < 5; i++) env.stepA({ dx: 0 })
  assert.equal(env.a.players.get(2).state.position[0], 10)
  assert.equal(env.a.log.restores, 0)
  const flushesBefore = env.a.log.flushes
  const simulatedBefore = env.a.log.simulated
  env.bToA()
  env.stepA({ dx: 0 })
  const stats = env.sessionA.getStats()
  assert.equal(stats.loop.rollbacks, 1)
  assert.equal(env.a.log.restores, 1)
  assert.ok(env.a.log.simulated - simulatedBefore > 1)
  assert.equal(env.a.log.flushes - flushesBefore, 1)
  assert.ok(env.a.players.get(2).state.position[0] > 10)
  assert.equal(stats.corrections.remoteMaxM > 0, true)
  assert.equal(stats.corrections.count, 2)
  assert.equal(env.a.bodies.get(1).position[1], 0.25 * env.sessionA.loop.simTick)
})

gate('two rollback sessions exchanging frames compare checksums and report no desync', () => {
  const env = pair()
  env.sessionA.start()
  env.sessionB.start()
  for (let i = 0; i < 60; i++) {
    env.stepA({ dx: i % 3 })
    if (i % 4 === 0) env.aToB()
    env.stepB({ dx: (i % 5) - 2 })
    if (i % 3 === 0) env.bToA()
  }
  env.aToB()
  env.bToA()
  for (let i = 0; i < 6; i++) { env.stepA({ dx: 0 }); env.aToB(); env.stepB({ dx: 0 }); env.bToA() }
  const sa = env.sessionA.getStats().loop
  const sb = env.sessionB.getStats().loop
  assert.ok(sa.rollbacks > 0 && sb.rollbacks > 0)
  assert.ok(sa.checksumsCompared >= 5 && sb.checksumsCompared >= 5)
  assert.equal(sa.desyncs, 0)
  assert.equal(sb.desyncs, 0)
})

gate('control: a peer whose simulation drifts is reported as a desync by the checksum compare', () => {
  const env = pair({ driftB: 0.5 })
  env.sessionA.start()
  env.sessionB.start()
  for (let i = 0; i < 30; i++) { env.stepA({ dx: 1 }); env.aToB(); env.stepB({ dx: 1 }); env.bToA() }
  assert.ok(env.sessionA.getStats().loop.desyncs > 0)
})

const fakeTimer = () => {
  const timers = new Map()
  let next = 1
  return {
    timers,
    schedule(fn, every) { const handle = next++; timers.set(handle, { fn, every }); return handle },
    cancel(handle) { timers.delete(handle) },
    tick() { for (const t of [...timers.values()]) t.fn() },
  }
}

gate('the session posts PEER_STATS on an injected 1000 ms interval and the post carries the live loop counters', () => {
  const env = pair()
  const timer = fakeTimer()
  const posted = []
  env.sessionA.start()
  env.sessionA.startStats({ post: (message) => posted.push(message), schedule: timer.schedule, cancel: timer.cancel })
  assert.equal(env.sessionA.statsRunning, true)
  assert.deepEqual([...timer.timers.values()].map((t) => t.every), [1000])
  assert.equal(posted.length, 0)
  timer.tick()
  env.stepA({ dx: 1 })
  env.stepA({ dx: 1 })
  timer.tick()
  assert.deepEqual(posted.map((m) => m.type), ['PEER_STATS', 'PEER_STATS'])
  assert.equal(posted[0].stats.loop.ticksSimulated, 0)
  assert.equal(posted[1].stats.loop.ticksSimulated, 2)
  assert.equal(posted[1].stats.profile, 'rollback')
})

gate('stopping the session cancels the stats interval, and the returned stop is safe to call twice', () => {
  const env = pair()
  const timer = fakeTimer()
  const posted = []
  env.sessionA.start()
  const stop = env.sessionA.startStats({ post: (message) => posted.push(message), schedule: timer.schedule, cancel: timer.cancel, every: 250 })
  assert.deepEqual([...timer.timers.values()].map((t) => t.every), [250])
  env.sessionA.stop()
  assert.equal(timer.timers.size, 0)
  assert.equal(env.sessionA.statsRunning, false)
  timer.tick()
  assert.equal(posted.length, 0)
  assert.equal(stop(), false)
})

gate('control: a second stats interval, a missing timer and a non-positive interval are refused', () => {
  const env = pair()
  const timer = fakeTimer()
  const args = { post: () => {}, schedule: timer.schedule, cancel: timer.cancel }
  assert.throws(() => env.sessionA.startStats({ post: () => {} }), { message: '[PeerSimSession] startStats needs post, schedule and cancel' })
  assert.throws(() => env.sessionA.startStats({ ...args, every: 0 }), { message: '[PeerSimSession] startStats interval must be a positive number of milliseconds' })
  env.sessionA.startStats(args)
  assert.throws(() => env.sessionA.startStats(args), { message: '[PeerSimSession] stats interval is already running' })
  assert.equal(timer.timers.size, 1)
})

finish()
