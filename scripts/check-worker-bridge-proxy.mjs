import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { buildLockstepPeerLoop } from '../src/lockstep-pure/peerLoops.js'
import { LOCKSTEP_DEFAULTS } from '../src/lockstep-pure/lockstepGameLoop.js'
import { createRollbackBridgeTransport } from '../src/rollback-pure/rollbackInputTransport.js'
import { BRIDGE_BROADCAST, BRIDGE_REFUSAL, BRIDGE_SEND, WorkerBridgeProxy } from '../src/transport/workerBridgeProxy.js'
import { NETCODE_OPCODES, createNetcodeDispatch } from '../src/worker-dispatch-pure/workerDispatch.js'

const makeTickSystem = () => {
  let handler = null
  let driverTick = 0
  return { onTick(fn) { handler = fn }, start() {}, stop() {}, fire(dt = 1 / 60) { driverTick++; handler(driverTick, dt) } }
}

const makeWorker = (pubkey) => {
  const outbox = []
  const proxy = new WorkerBridgeProxy({ post: (message) => outbox.push(message), pubkey })
  const others = Object.fromEntries(NETCODE_OPCODES.filter((name) => !name.startsWith('PEER_') || name === 'PEER_MESSAGE' || name === 'PEER_DISCONNECT').map((name) => [name, () => null]))
  const dispatch = createNetcodeDispatch({ ...others, ...proxy.handlers() })
  return { pubkey, proxy, outbox, dispatch }
}

const relay = (from, to) => {
  let moved = 0
  for (const message of from.outbox.splice(0, from.outbox.length)) {
    if (message.type !== BRIDGE_BROADCAST) continue
    const outcome = to.dispatch({ type: 'PEER_FRAME', peerId: from.pubkey, data: message.data })
    assert.equal(outcome.status, 'dispatched')
    moved++
  }
  return moved
}

const makePair = ({ connect = true, checksumB = () => 'abc' } = {}) => {
  const a = makeWorker('A'), b = makeWorker('B')
  if (connect) {
    a.dispatch({ type: 'PEER_CONNECT', peerId: 'B' })
    b.dispatch({ type: 'PEER_CONNECT', peerId: 'A' })
  }
  const options = { ...LOCKSTEP_DEFAULTS, checksumIntervalTicks: 10 }
  for (const [side, checksum] of [[a, () => 'abc'], [b, checksumB]]) {
    side.tickSystem = makeTickSystem()
    side.simulated = []
    side.step = 0
    const built = buildLockstepPeerLoop({
      bridge: side.proxy, tickSystem: side.tickSystem, roster: ['A', 'B'], localPeerId: side.pubkey,
      simulate: (tick, dt, byPeer) => side.simulated.push([tick, JSON.stringify([...byPeer])]),
      getLocalInput: () => ({ buttons: side.step * (side.pubkey === 'A' ? 3 : 5) % 7 }),
      liveChecksum: checksum, options, now: () => 0,
    })
    side.loop = built.loop
    side.voter = built.voter
    side.loop.start()
  }
  const run = (steps) => {
    let frames = 0
    for (let step = 1; step <= steps; step++) {
      for (const side of [a, b]) side.step = step
      frames += relay(a, b) + relay(b, a)
      a.tickSystem.fire()
      b.tickSystem.fire()
    }
    return frames
  }
  return { a, b, run }
}

gate('the proxy is a bridge: it carries the local pubkey, an event target with broadcast and a peer table, and refuses a missing post or pubkey', () => {
  const { proxy, outbox } = makeWorker('A')
  assert.equal(proxy.pubkey, 'A')
  assert.ok(proxy.data instanceof EventTarget)
  assert.equal(proxy.data.broadcast('wwlockstep:{}'), 0)
  assert.deepEqual(outbox, [{ type: 'PEER_BROADCAST', data: 'wwlockstep:{}' }])
  assert.equal(BRIDGE_BROADCAST, 'PEER_BROADCAST')
  assert.throws(() => new WorkerBridgeProxy({ pubkey: 'A' }), /only through post/)
  assert.throws(() => new WorkerBridgeProxy({ post: () => {}, pubkey: '' }), /local pubkey/)
})

gate('PEER_CONNECT, PEER_FRAME and PEER_LEFT from the worker dispatch become peer-open, data and peer-close events with the peer pubkey', () => {
  const { proxy, dispatch } = makeWorker('A')
  const events = []
  for (const name of ['peer-open', 'data', 'peer-close']) proxy.data.addEventListener(name, ({ detail }) => events.push([name, detail.peerPubkey, detail.data ?? null]))
  dispatch({ type: 'PEER_CONNECT', peerId: 'B' })
  dispatch({ type: 'PEER_CONNECT', peerId: 'B' })
  assert.deepEqual([...proxy.data.peers.keys()], ['B'])
  assert.equal(proxy.data.peers.get('B').dc.readyState, 'open')
  dispatch({ type: 'PEER_FRAME', peerId: 'B', data: 'hello' })
  const bytes = Uint8Array.of(1, 2)
  dispatch({ type: 'PEER_FRAME', peerId: 'B', data: bytes })
  assert.equal(proxy.data.broadcast('x'), 1)
  dispatch({ type: 'PEER_LEFT', peerId: 'B' })
  assert.deepEqual(events, [['peer-open', 'B', null], ['data', 'B', 'hello'], ['data', 'B', bytes], ['peer-close', 'B', null]])
  assert.equal(proxy.data.peers.size, 0)
  assert.deepEqual({ opened: proxy.stats.opened, framesIn: proxy.stats.framesIn, left: proxy.stats.left }, { opened: 1, framesIn: 2, left: 1 })
})

gate('a frame from a peer that never connected, a frame that is not text or bytes, a connect naming the local pubkey and a send to an unknown peer are refused by name', () => {
  const { proxy, dispatch, outbox } = makeWorker('A')
  let heard = 0
  proxy.data.addEventListener('data', () => heard++)
  dispatch({ type: 'PEER_FRAME', peerId: 'Z', data: 'x' })
  assert.equal(proxy.lastRefusal, BRIDGE_REFUSAL.UNKNOWN_PEER)
  dispatch({ type: 'PEER_CONNECT', peerId: 'A' })
  assert.equal(proxy.lastRefusal, BRIDGE_REFUSAL.SELF)
  dispatch({ type: 'PEER_CONNECT', peerId: 7 })
  assert.equal(proxy.lastRefusal, BRIDGE_REFUSAL.PEER_ID)
  dispatch({ type: 'PEER_CONNECT', peerId: 'B' })
  dispatch({ type: 'PEER_FRAME', peerId: 'B', data: { not: 'a frame' } })
  assert.equal(proxy.lastRefusal, BRIDGE_REFUSAL.FRAME)
  assert.equal(proxy.data.send('Z', 'x'), false)
  assert.equal(proxy.data.send('B', 'direct'), true)
  assert.equal(proxy.data.broadcast({}), 0)
  assert.deepEqual(outbox, [{ type: BRIDGE_SEND, peerId: 'B', data: 'direct' }])
  assert.equal(heard, 0)
  assert.equal(proxy.stats.refused, 6)
})

gate('two lockstep peer loops in two workers, joined only by proxy posts relayed as PEER_FRAME, simulate the same ticks with the same inputs', () => {
  const { a, b, run } = makePair()
  const frames = run(120)
  assert.ok(frames > 200, 'only ' + frames + ' frames crossed the relay')
  assert.ok(a.simulated.length > 100 && b.simulated.length > 100, 'simulated ' + a.simulated.length + ' and ' + b.simulated.length + ' ticks')
  const shared = Math.min(a.simulated.length, b.simulated.length)
  assert.deepEqual(a.simulated.slice(0, shared), b.simulated.slice(0, shared))
  assert.ok(new Set(a.simulated.map(([, inputs]) => inputs)).size > 5, 'the inputs never changed')
  const stats = a.loop.getStats()
  assert.ok(stats.checksumsCompared >= 5 && stats.desyncs === 0, 'compared ' + stats.checksumsCompared + ', desyncs ' + stats.desyncs)
})

gate('the consensus voter reaches the other worker through the proxy: a peer with a different checksum is reported as a desync', () => {
  const { a, run } = makePair({ checksumB: () => 'zzz' })
  run(60)
  const stats = a.loop.getStats()
  assert.ok(stats.desyncs > 0, 'no desync was detected')
})

gate('a rollback bridge transport built on the proxy sees the connected peer as open and hears its frames', () => {
  const a = makeWorker('A'), b = makeWorker('B')
  a.dispatch({ type: 'PEER_CONNECT', peerId: 'B' })
  b.dispatch({ type: 'PEER_CONNECT', peerId: 'A' })
  const heard = []
  const ta = createRollbackBridgeTransport({ bridge: a.proxy })
  const tb = createRollbackBridgeTransport({ bridge: b.proxy, onRemoteInput: (peer, tick, input) => heard.push([peer, tick, input]) })
  assert.deepEqual(ta.getRoster(), ['B'])
  assert.equal(ta.submitLocalInput(4, { dx: 1 }, 0), 1)
  relay(a, b)
  assert.deepEqual(heard, [['A', 4, { dx: 1 }]])
  b.dispatch({ type: 'PEER_LEFT', peerId: 'A' })
  assert.deepEqual(tb.getRoster(), [])
})

gate('a closed proxy tells its listeners each peer left, then refuses to broadcast or take frames', () => {
  const { proxy, dispatch, outbox } = makeWorker('A')
  const left = []
  proxy.data.addEventListener('peer-close', ({ detail }) => left.push(detail.peerPubkey))
  dispatch({ type: 'PEER_CONNECT', peerId: 'B' })
  dispatch({ type: 'PEER_CONNECT', peerId: 'C' })
  assert.equal(proxy.close(), true)
  assert.equal(proxy.close(), false)
  assert.deepEqual(left, ['B', 'C'])
  assert.equal(proxy.data.broadcast('x'), 0)
  dispatch({ type: 'PEER_FRAME', peerId: 'B', data: 'x' })
  assert.equal(proxy.lastRefusal, BRIDGE_REFUSAL.CLOSED)
  assert.deepEqual(outbox, [])
})

gate('negative control: with the relay cut, neither worker simulates a tick and each waits on the other', () => {
  const { a, b } = makePair()
  for (let step = 1; step <= 120; step++) {
    a.outbox.length = 0
    b.outbox.length = 0
    a.tickSystem.fire()
    b.tickSystem.fire()
  }
  assert.ok(a.simulated.length === 0 && b.simulated.length === 0, 'simulated ' + a.simulated.length + ' and ' + b.simulated.length + ' ticks with no relay')
  const stats = a.loop.getStats()
  assert.deepEqual([stats.ticksSimulated, stats.connectingTicks, stats.waitingOn], [0, 120, ['B']])
})

finish()
