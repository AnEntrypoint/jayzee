import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { gate, finish } from './lib/gate.mjs'
import { ALREADY_INITIALISED, NOT_INITIALISED, TICK_HANDLER_RELOAD_UNSUPPORTED, createBrowserServer, createBrowserServerClient, isSingleplayer } from '../src/transport/browserServer.js'
import { NETCODE_OUTBOUND } from '../src/worker-dispatch-pure/workerDispatch.js'
import { MSG } from '../src/protocol/messages.js'
import { pack, unpack } from '../src/protocol/msgpack.js'
import { SnapshotEncoder } from '../src/snapshot-lod-pure/snapshotEncoder.js'

const fixture = (name) => new URL('./fixtures/browser-server/' + name, import.meta.url).href
const config = { tickRate: 64, entities: [{ id: 'counter', app: 'counter' }, { id: 'ball', bodyType: 'dynamic', position: [0, 4, 0] }] }
const apps = { counter: fixture('counter-v1.mjs') }

const inProcess = () => {
  const clock = { t: 1000 }
  const posted = []
  let loads = 0
  const host = createBrowserServer({
    post: (message, transfer) => posted.push(structuredClone(message, { transfer: transfer || [] })),
    now: () => clock.t,
    importApp: (url) => import(url + '?load=' + (loads++)),
  })
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) {
      clock.t += 1000 / 64
      host.server.tick()
    }
  }
  const take = (type) => posted.splice(0).filter((message) => message.type === type)
  const send = (message) => {
    const bytes = pack(message)
    const copy = Uint8Array.from(bytes)
    return host.handle({ type: 'CLIENT_MESSAGE', data: copy.buffer })
  }
  return { host, posted, clock, tick, take, send }
}

const decodeAll = (messages) => messages.map((message) => unpack(new Uint8Array(message.data)))
const snapshotsOf = (messages) => decodeAll(messages).filter((m) => m.type === MSG.SNAPSHOT).map((m) => SnapshotEncoder.decode(m.payload))

gate('the singleplayer flag is read from the query or the hash query, and an explicit off value turns it off', () => {
  assert.equal(isSingleplayer('?singleplayer'), true)
  assert.equal(isSingleplayer('?world=arena&singleplayer=1'), true)
  assert.equal(isSingleplayer('', '#/play?singleplayer'), true)
  assert.equal(isSingleplayer('?singleplayer=0'), false)
  assert.equal(isSingleplayer('?singleplayer=false'), false)
  assert.equal(isSingleplayer('?world=arena'), false)
  assert.equal(isSingleplayer('?multiplayer'), false)
})

gate('INIT imports the app modules, builds the whole server behind the port and answers WORKER_READY, and only outbound names are ever posted', async () => {
  const { host, posted } = inProcess()
  assert.equal(host.ready, false)
  await host.handle({ type: 'INIT', config, apps }).result
  assert.equal(host.ready, true)
  assert.deepEqual(posted.map((message) => [message.type, message.tickRate, message.entities, message.apps]), [['WORKER_READY', 64, 2, ['counter']]])
  assert.deepEqual([...host.server.subsystems].slice(0, 7), ['bus', 'world', 'queries', 'characters', 'appRuntime', 'tickHost', 'connections'])
  assert.ok(posted.every((message) => NETCODE_OUTBOUND.includes(message.type)))
})

gate('a client message through the port joins the game, and every snapshot comes back as a SEND_CLIENT frame whose buffer was transferred', async () => {
  const { host, tick, take, send } = inProcess()
  await host.handle({ type: 'INIT', config, apps }).result
  take('WORKER_READY')
  assert.equal(send({ type: MSG.HANDSHAKE, payload: { name: 'solo' } }).result, true)
  tick(3)
  const frames = take('SEND_CLIENT')
  const decoded = decodeAll(frames)
  assert.ok(decoded.some((m) => m.type === MSG.HANDSHAKE_ACK), 'no handshake ack came back through the port')
  const snaps = snapshotsOf(frames)
  assert.equal(snaps.length, 3)
  assert.deepEqual(snaps.at(-1).entities.map((entity) => entity.id), ['counter', 'ball'])
  assert.deepEqual(snaps.at(-1).entities[0].custom, { count: 3, version: 1 })
  assert.ok(snaps.at(-1).entities[1].position[1] < 4, 'the ball did not fall inside the worker-side server')
  assert.ok(frames.every((frame) => frame.data instanceof ArrayBuffer && frame.data.byteLength > 0))
})

gate('HMR_APP swaps an app inside the running server, keeps its state and answers HMR_RESULT, and a broken module is refused with the old code still running', async () => {
  const { host, tick, take, send } = inProcess()
  await host.handle({ type: 'INIT', config, apps }).result
  send({ type: MSG.HANDSHAKE, payload: { name: 'solo' } })
  tick(2)
  await host.handle({ type: 'HMR_APP', name: 'counter', url: fixture('counter-v2.mjs') }).result
  tick(1)
  await host.handle({ type: 'HMR_APP', name: 'counter', url: fixture('broken.mjs') }).result
  tick(1)
  const results = take('HMR_RESULT')
  assert.deepEqual(results.map((message) => [message.ok, message.reloaded ?? null, message.code ?? null]), [[true, 1, null], [false, null, 'app-invalid']])
  assert.deepEqual(host.server.getEntity('counter').custom, { count: 4, version: 2 })
})

gate('messages before INIT are dropped and counted, a reload before INIT is refused by name, a second INIT is refused, and the tick handler reload is refused by name', async () => {
  const { host, posted, take } = inProcess()
  assert.equal(host.handle({ type: 'CLIENT_MESSAGE', data: new ArrayBuffer(4) }).result, false)
  assert.equal(host.stats.dropped, 1)
  await host.handle({ type: 'HMR_APP', name: 'counter', url: fixture('counter-v2.mjs') }).result
  assert.equal(take('HMR_RESULT')[0].code, NOT_INITIALISED)
  await host.handle({ type: 'INIT', config, apps }).result
  await host.handle({ type: 'INIT', config, apps }).result
  assert.equal(take('INIT_ERROR')[0].code, ALREADY_INITIALISED)
  host.handle({ type: 'HMR_TICK_HANDLER' })
  assert.equal(posted.at(-1).code, TICK_HANDLER_RELOAD_UNSUPPORTED)
  assert.equal(host.handle({ type: 'NOPE' }).status, 'unknown-opcode')
})

gate('an INIT with a bad config or an app that cannot be imported answers INIT_ERROR and leaves no server behind', async () => {
  const bad = inProcess()
  await bad.host.handle({ type: 'INIT', config: { gravity: [1, 0, 0] }, apps: {} }).result
  assert.deepEqual(bad.posted.map((message) => [message.type, message.code]), [['INIT_ERROR', 'gravity-not-vertical']])
  assert.equal(bad.host.ready, false)
  const missing = inProcess()
  await missing.host.handle({ type: 'INIT', config, apps: { counter: fixture('nothing-here.mjs') } }).result
  assert.equal(missing.posted[0].type, 'INIT_ERROR')
  assert.equal(missing.host.ready, false)
})

gate('peers connect through the same port, each receives its own PEER_SEND frames, and a peer that leaves is removed from the game', async () => {
  const { host, posted, tick } = inProcess()
  await host.handle({ type: 'INIT', config, apps }).result
  for (const peerId of ['p1', 'p2']) {
    assert.equal(host.handle({ type: 'PEER_CONNECT', peerId }).result, true)
    const bytes = Uint8Array.from(pack({ type: MSG.HANDSHAKE, payload: { name: peerId } }))
    host.handle({ type: 'PEER_MESSAGE', peerId, data: bytes.buffer })
  }
  tick(2)
  const sends = posted.filter((message) => message.type === 'PEER_SEND')
  assert.deepEqual([...new Set(sends.map((message) => message.peerId))].sort(), ['p1', 'p2'])
  assert.equal(host.server.tickHost.playerManager.getConnectedPlayers().length, 2)
  host.handle({ type: 'PEER_LEFT', peerId: 'p1' })
  assert.equal(host.peerCount, 1)
  assert.equal(host.server.tickHost.playerManager.getConnectedPlayers().length, 1)
  assert.equal(host.handle({ type: 'PEER_CONNECT', peerId: 'p2' }).result, false)
})

gate('the debug collider opcodes answer from the server queries, and SAVE_NOW hands the app states to the injected save', async () => {
  const saved = []
  const posted = []
  const host = createBrowserServer({ post: (message) => posted.push(message), now: () => 0, importApp: (url) => import(url), save: (states) => saved.push(states) })
  await host.handle({ type: 'INIT', config, apps }).result
  host.server.tick()
  host.handle({ type: 'DEBUG_COLLIDER_RAYS', rays: [{ origin: [0, 10, 0], direction: [0, -1, 0], maxDistance: 20 }] })
  host.handle({ type: 'DEBUG_COLLIDER_QUERY', min: [-1, 0, -1], max: [1, 9, 1] })
  const results = posted.filter((message) => message.type === 'DEBUG_COLLIDER_RESULT')
  assert.deepEqual([results[0].ok, results[0].hits[0].kind, results[0].hits[0].id], [true, 'body', 0])
  assert.deepEqual([results[1].ok, results[1].bodies], [true, [0]])
  assert.equal(host.handle({ type: 'SAVE_NOW' }).result, true)
  assert.deepEqual(saved[0].map((entry) => [entry.name, entry.app, entry.state]), [['counter', 'counter', { count: 1 }], ['ball', null, {}]])
})

gate('the server runs in a real Worker thread: the page-side client boots it, joins over the port, receives live snapshots on the worker clock, hot reloads an app and disconnects', async () => {
  const thread = new Worker(new URL('./lib/browserServerWorker.mjs', import.meta.url))
  const worker = {
    postMessage: (message, transfer) => thread.postMessage(message, transfer),
    set onmessage(handler) { thread.on('message', (data) => handler({ data })) },
  }
  try {
    const client = createBrowserServerClient({ worker, config, apps, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle) })
    const inbox = []
    client.transport.onMessage = (bytes) => inbox.push(unpack(bytes))
    assert.equal(client.transport.send(pack({ type: MSG.HANDSHAKE, payload: {} })), false)
    const info = await client.ready
    assert.deepEqual([info.tickRate, info.entities], [64, 2])
    assert.equal(client.transport.send(pack({ type: MSG.HANDSHAKE, payload: { name: 'solo' } })), true)
    const until = async (test, label) => {
      for (let i = 0; i < 400; i++) {
        if (test()) return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('timed out waiting for ' + label)
    }
    const snaps = () => inbox.filter((m) => m.type === MSG.SNAPSHOT).map((m) => SnapshotEncoder.decode(m.payload))
    await until(() => inbox.some((m) => m.type === MSG.HANDSHAKE_ACK), 'the handshake ack')
    await until(() => snaps().length >= 10, 'ten snapshots')
    const ticks = snaps().map((snap) => snap.tick)
    assert.ok(ticks.every((tick, index) => index === 0 || tick > ticks[index - 1]), 'snapshot ticks do not rise')
    assert.equal(snaps().at(-1).entities[0].custom.version, 1)
    const result = await client.reloadApp('counter', fixture('counter-v2.mjs'))
    assert.deepEqual([result.ok, result.reloaded], [true, 1])
    const before = snaps().at(-1).entities[0].custom.count
    await until(() => snaps().at(-1).entities[0].custom.version === 2, 'a snapshot from the reloaded app')
    assert.ok(snaps().at(-1).entities[0].custom.count > before, 'the counter state did not carry through the reload')
    const rays = await client.debugRays([{ origin: [0, 10, 0], direction: [0, -1, 0], maxDistance: 20 }])
    assert.equal(rays.hits[0].kind, 'body')
    client.transport.close()
    assert.equal(client.transport.send(pack({ type: MSG.HEARTBEAT, payload: {} })), false)
    const seen = inbox.length
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.ok(inbox.length - seen <= 2, 'snapshots kept arriving after the disconnect')
  } finally {
    await thread.terminate()
  }
})

finish()
