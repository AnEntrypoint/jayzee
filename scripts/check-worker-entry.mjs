import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { gate, finish } from './lib/gate.mjs'
import { TransformRingReader } from '../src/transport/transformRing.js'
import { PENDING_CAPACITY, TRANSFORM_RING_CAPACITY, createWorkerEntryHost } from '../src/transport/workerEntryHost.js'
import { NETCODE_OPCODES } from '../src/worker-dispatch-pure/workerDispatch.js'

const ENTRY = new URL('../src/transport/nodeWorkerEntry.js', import.meta.url)
const BOOT = new URL('./fixtures/worker-entry/boot.mjs', import.meta.url).href

const startWorker = (data = {}) => {
  const worker = new Worker(ENTRY, { workerData: { boot: BOOT, ...data }, stderr: true })
  const inbox = []
  const waiters = []
  worker.on('message', (message) => {
    inbox.push(message)
    for (let i = waiters.length - 1; i >= 0; i--) {
      const found = inbox.find(waiters[i].match)
      if (!found) continue
      waiters[i].resolve(found)
      waiters.splice(i, 1)
    }
  })
  const until = (match, label) => new Promise((resolve, reject) => {
    const found = inbox.find(match)
    if (found) return resolve(found)
    const timer = setTimeout(() => reject(new Error('no ' + label + ' within 5 s; inbox holds ' + inbox.map((m) => m.type).join(','))), 5000)
    waiters.push({ match, resolve: (value) => { clearTimeout(timer); resolve(value) } })
  })
  const ofType = (type) => until((m) => m.type === type, type)
  return { worker, inbox, until, ofType }
}

const withWorker = async (data, body) => {
  const env = startWorker(data)
  try {
    await body(env)
  } finally {
    await env.worker.terminate()
  }
}

const memoryHost = (boot, allocateRing = () => null) => {
  const posts = []
  const host = createWorkerEntryHost({ post: (message, transfer) => posts.push({ message, transfer: transfer ?? [] }), boot, allocateRing })
  return { host, posts }
}

gate('a real worker thread posts WORKER_READY once its listener is attached, before any INIT', () => withWorker({}, async ({ ofType, inbox }) => {
  await ofType('WORKER_READY')
  assert.deepEqual(inbox.map((m) => m.type), ['WORKER_READY'])
}))

gate('INIT on the worker thread boots the context, connects the client transport, starts the peer session and posts the transform ring', () => withWorker({}, async ({ worker, ofType, until }) => {
  await ofType('WORKER_READY')
  worker.postMessage({ type: 'INIT', config: {} })
  const ring = await ofType('TRANSFORM_RING')
  assert.equal(ring.capacity, TRANSFORM_RING_CAPACITY)
  assert.equal(ring.sab instanceof SharedArrayBuffer, true)
  const data = Uint8Array.from([1, 2, 3, 4]).buffer
  worker.postMessage({ type: 'CLIENT_MESSAGE', data, mt: 9 }, [data])
  const note = await until((m) => m.type === 'TEST_NOTE' && 'sent' in m, 'note')
  assert.deepEqual(note.seen, ['client-connected', 'peer-session-started'])
}))

gate('a client message is answered over SEND_CLIENT with the bytes in a transferred buffer, which the worker no longer holds', () => withWorker({}, async ({ worker, ofType, until }) => {
  await ofType('WORKER_READY')
  worker.postMessage({ type: 'INIT', config: {} })
  const data = Uint8Array.from([1, 2, 3, 4, 5]).buffer
  worker.postMessage({ type: 'CLIENT_MESSAGE', data, mt: 9 }, [data])
  assert.equal(data.byteLength, 0)
  const sent = await ofType('SEND_CLIENT')
  assert.equal(sent.data instanceof ArrayBuffer, true)
  assert.deepEqual([...new Uint8Array(sent.data)], [5, 4, 3, 2, 1])
  assert.equal(sent.mt, 9)
  const note = await until((m) => m.type === 'TEST_NOTE' && 'sent' in m, 'note')
  assert.equal(note.sent, true)
  assert.equal(note.detachedAfterSend, true)
}))

gate('messages that arrive before INIT are held and handled in order once the worker is initialised', () => withWorker({}, async ({ worker, ofType, until }) => {
  await ofType('WORKER_READY')
  worker.postMessage({ type: 'PEER_CONNECT', peerId: 'p1' })
  worker.postMessage({ type: 'PEER_LEFT', peerId: 'p1' })
  worker.postMessage({ type: 'PEER_DISCONNECT', peerId: 'p2' })
  worker.postMessage({ type: 'INIT', config: {} })
  const note = await until((m) => m.type === 'TEST_NOTE' && m.after === 'PEER_DISCONNECT:p2', 'note after the held messages')
  assert.deepEqual(note.seen, ['client-connected', 'peer-session-started', 'peer-connect:p1', 'peer-linked:p1', 'peer-left:p1'])
}))

gate('a pose the worker writes into the transform ring is read on the main thread through the shared buffer', () => withWorker({}, async ({ worker, ofType, until }) => {
  await ofType('WORKER_READY')
  worker.postMessage({ type: 'INIT', config: {} })
  const ring = await ofType('TRANSFORM_RING')
  const reader = new TransformRingReader(ring.sab, ring.capacity)
  assert.equal(reader.readAll().size, 0)
  worker.postMessage({ type: 'PEER_FRAME', playerId: 7, position: [1.5, 2.5, -3.5] })
  await until((m) => m.type === 'TEST_NOTE' && m.wrote === 7, 'write note')
  const players = reader.readAll()
  assert.deepEqual([...players.keys()], [7])
  assert.deepEqual(players.get(7).position, [1.5, 2.5, -3.5])
}))

gate('a boot that throws answers INIT_ERROR with its message, posts no ring, and a later message is dropped', () => withWorker({}, async ({ worker, ofType, inbox }) => {
  await ofType('WORKER_READY')
  worker.postMessage({ type: 'INIT', config: { fail: 'no world' } })
  const failed = await ofType('INIT_ERROR')
  assert.equal(failed.error, 'boot refused: no world')
  worker.postMessage({ type: 'SAVE_NOW' })
  worker.postMessage({ type: 'HMR_APP', id: 1, name: 'door' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual(inbox.map((m) => m.type), ['WORKER_READY', 'INIT_ERROR'])
}))

gate('a worker started with the ring off posts no TRANSFORM_RING and still answers', () => withWorker({ ring: false }, async ({ worker, ofType, until, inbox }) => {
  await ofType('WORKER_READY')
  worker.postMessage({ type: 'INIT', config: {} })
  worker.postMessage({ type: 'SAVE_NOW' })
  await until((m) => m.type === 'TEST_NOTE' && m.saved === true, 'save note')
  assert.equal(inbox.some((m) => m.type === 'TRANSFORM_RING'), false)
}))

gate('a connected peer gets its own transport, which posts PEER_SEND with the peer id and a transferred buffer until the peer disconnects', () => withWorker({}, async ({ worker, ofType, until, inbox }) => {
  await ofType('WORKER_READY')
  worker.postMessage({ type: 'INIT', config: {} })
  worker.postMessage({ type: 'PEER_CONNECT', peerId: 'p7' })
  worker.postMessage({ type: 'PEER_MESSAGE', peerId: 'p7' })
  const sent = await ofType('PEER_SEND')
  assert.equal(sent.peerId, 'p7')
  assert.equal(sent.mt, 3)
  assert.deepEqual([...new Uint8Array(sent.data)], [9, 8, 7])
  const first = await until((m) => m.type === 'TEST_NOTE' && 'peerSent' in m, 'peer note')
  assert.deepEqual([first.peerSent, first.peerReady], [true, true])
  worker.postMessage({ type: 'PEER_DISCONNECT', peerId: 'p7' })
  worker.postMessage({ type: 'PEER_MESSAGE', peerId: 'p7' })
  const second = await until((m) => m.type === 'TEST_NOTE' && m.peerSent === false, 'note after the disconnect')
  assert.equal(second.peerReady, false)
  assert.equal(inbox.filter((m) => m.type === 'PEER_SEND').length, 1)
}))

gate('hot reload and collider debug requests are answered with their id, and a failing reload answers ok false with the reason', () => withWorker({}, async ({ worker, ofType, until }) => {
  await ofType('WORKER_READY')
  worker.postMessage({ type: 'INIT', config: {} })
  worker.postMessage({ type: 'HMR_APP', id: 11, name: 'door' })
  worker.postMessage({ type: 'HMR_APP', id: 12, name: 'bad' })
  worker.postMessage({ type: 'HMR_TICK_HANDLER', id: 13 })
  worker.postMessage({ type: 'DEBUG_COLLIDER_QUERY', id: 14, points: [[0, 0, 0], [1, 1, 1]] })
  worker.postMessage({ type: 'DEBUG_COLLIDER_RAYS', id: 15, rays: [1, 2, 3] })
  const byId = (id) => until((m) => m.id === id, 'answer ' + id)
  assert.deepEqual(await byId(11), { type: 'HMR_RESULT', id: 11, ok: true, result: { reloaded: 'door' } })
  assert.deepEqual(await byId(12), { type: 'HMR_RESULT', id: 12, ok: false, error: 'app bad does not compile' })
  assert.deepEqual(await byId(13), { type: 'HMR_RESULT', id: 13, ok: true, result: { reloaded: 'tick-handler' } })
  assert.deepEqual(await byId(14), { type: 'DEBUG_COLLIDER_RESULT', id: 14, ok: true, result: { hits: 2 } })
  assert.deepEqual(await byId(15), { type: 'DEBUG_COLLIDER_RESULT', id: 15, ok: true, result: { rays: 3 } })
}))

gate('a handler that throws on the worker thread does not stop the worker, and a client disconnect closes the transport', () => withWorker({}, async ({ worker, ofType, until, inbox }) => {
  await ofType('WORKER_READY')
  worker.postMessage({ type: 'INIT', config: {} })
  worker.postMessage({ type: 'PEER_MESSAGE', peerId: 'p1', fail: true })
  worker.postMessage({ type: 'CLIENT_DISCONNECT' })
  const data = Uint8Array.from([1, 2]).buffer
  worker.postMessage({ type: 'CLIENT_MESSAGE', data, mt: 1 }, [data])
  const note = await until((m) => m.type === 'TEST_NOTE' && 'sent' in m, 'note')
  assert.equal(note.sent, false)
  assert.equal(note.seen.includes('client-disconnected'), true)
  assert.equal(inbox.some((m) => m.type === 'SEND_CLIENT'), false)
}))

gate('every one of the 13 inbound opcodes reaches the context once in the in-process host, and an unknown or outbound name reaches nothing', async () => {
  const calls = []
  const names = ['onPeerConnect', 'onPeerFrame', 'onPeerLeft', 'hmrApp', 'hmrTickHandler', 'saveNow', 'debugColliderQuery', 'debugColliderRays', 'onClientMessage', 'onClientDisconnect', 'onPeerMessage', 'onPeerDisconnect']
  const ctx = Object.fromEntries(names.map((name) => [name, () => { calls.push(name) }]))
  const { host } = memoryHost(async () => ctx)
  await host.handle({ type: 'INIT' }).result
  for (const type of NETCODE_OPCODES.filter((name) => name !== 'INIT')) host.handle({ type })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls.sort(), [...names].sort())
  for (const type of ['SEND_CLIENT', 'WORKER_READY', 'init', 'NOPE', undefined]) assert.equal(host.handle({ type }).status, 'unknown-opcode')
  assert.equal(calls.length, names.length)
  assert.equal(host.getStats().unknown, 5)
})

gate('a second INIT is refused with INIT_ERROR and does not boot again', async () => {
  let boots = 0
  const { host, posts } = memoryHost(async () => { boots += 1; return {} })
  await host.handle({ type: 'INIT' }).result
  await host.handle({ type: 'INIT' }).result
  assert.equal(boots, 1)
  assert.deepEqual(posts.map((p) => p.message), [{ type: 'INIT_ERROR', error: 'worker is already initialised', reasonCode: 'worker-already-initialised' }])
})

gate('the queue before INIT holds 256 messages and counts the ones past that as dropped', async () => {
  const seen = []
  const { host } = memoryHost(async () => ({ saveNow: (message) => { seen.push(message.n) } }))
  for (let n = 0; n < PENDING_CAPACITY + 3; n++) host.handle({ type: 'SAVE_NOW', n })
  assert.equal(host.pendingCount, PENDING_CAPACITY)
  assert.equal(host.getStats().dropped, 3)
  await host.handle({ type: 'INIT' }).result
  assert.equal(seen.length, PENDING_CAPACITY)
  assert.deepEqual(seen.slice(0, 3), [0, 1, 2])
  assert.equal(seen.at(-1), PENDING_CAPACITY - 1)
  assert.equal(host.pendingCount, 0)
})

gate('control: with no queue before INIT the early messages would be lost, which the dropped count of a failed worker shows', async () => {
  const { host } = memoryHost(async () => { throw new Error('nope') })
  host.handle({ type: 'SAVE_NOW' })
  await host.handle({ type: 'INIT' }).result
  assert.equal(host.state, 'failed')
  assert.equal(host.pendingCount, 0)
  assert.equal(host.handle({ type: 'SAVE_NOW' }).status, 'dropped')
})

gate('the host refuses a missing post or boot function and a port without on', () => {
  assert.throws(() => createWorkerEntryHost({ post: null, boot: async () => ({}) }), TypeError)
  assert.throws(() => createWorkerEntryHost({ post() {}, boot: null }), TypeError)
  assert.throws(() => createWorkerEntryHost({ post() {}, boot: async () => ({}) }).attach({}), TypeError)
})

finish()
