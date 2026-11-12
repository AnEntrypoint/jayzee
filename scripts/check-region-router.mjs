import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  createRegionRouter, createRegionWorker, forkedWorkerChannel, webSocketClient,
  MSG_INIT, MSG_CLIENT_CONNECT, MSG_CLIENT_MESSAGE, MSG_CLIENT_DISCONNECT, MSG_HANDOFF_RELEASE,
  CLOSE_REGION_UNHOSTED, CLOSE_REGION_LOST, CLOSE_ROUTER_FULL, CLOSE_ROUTER_NOT_READY,
  HANDOFF_REGION_UNHOSTED, HANDOFF_ALREADY_IN_FLIGHT, HANDOFF_FROM_FOREIGN_REGION, HANDOFF_TARGET_LOST,
} from '../src/sharding/regionRouterRuntime.js'
import { HANDOFF_REFUSED, RegionWorkerRefusedError, RegionSiblingRefusedError, PLAYER_IDENTITY_UNMINTED, SESSION_TOKEN_MALFORMED } from '../src/sharding/index.js'

const TOKEN = 'c'.repeat(32)

const rig = (regions, opts = {}) => {
  const queue = []
  const log = []
  const ends = new Map()
  const spawnWorker = (regionId) => {
    const end = { regionId, toWorker: null, toRouter: null, exit: null, killed: false, hooks: {}, seen: [], nextLocal: 0 }
    ends.set(regionId, end)
    const port = { send: (msg) => queue.push(() => end.toRouter && !end.killed && end.toRouter(msg)), onMessage: (fn) => { end.toWorker = fn } }
    end.worker = createRegionWorker({
      port,
      hooks: {
        init: (msg) => {
          end.init = msg
          if (opts.refuse === regionId) {
            const error = new Error('no world')
            error.code = 'world-missing'
            throw error
          }
        },
        join: (id, handoff, token) => {
          if (end.hooks.join) return end.hooks.join(id, handoff, token)
          end.seen.push(['join', id, handoff ? handoff.fromRegion : null])
          return { localPlayerId: end.nextLocal++, sessionToken: null }
        },
        message: (id, data) => end.seen.push(['message', id, data]),
        leave: (id, to) => end.seen.push(['leave', id, to]),
        handoffRefused: (id, code) => end.seen.push(['handoff-refused', id, code]),
      },
    })
    return {
      send: (msg) => {
        log.push([regionId, msg.type])
        queue.push(() => !end.killed && end.toWorker(msg))
      },
      onMessage: (fn) => { end.toRouter = fn },
      onExit: (fn) => { end.exit = fn },
      kill: () => { end.killed = true },
    }
  }
  const pump = () => {
    while (queue.length) queue.shift()()
  }
  const router = createRegionRouter({ regions, spawnWorker, cellSize: 100, spawnPoint: [10, 0, 10], ...opts.router })
  const socket = () => {
    const s = { sent: [], closed: null, send: (d) => s.sent.push(d), close: (r) => { s.closed = r } }
    return s
  }
  return { router, pump, ends, log, socket }
}

const booted = async (regions, opts) => {
  const r = rig(regions, opts)
  const started = r.router.start()
  r.pump()
  await started
  return r
}

gate('start forks one worker per region, sends each its init and resolves when all are ready', async () => {
  const r = rig(['0,0', '1,0'])
  assert.equal(r.router.status().ready, false)
  const refused = r.router.connectClient(r.socket())
  assert.deepEqual(refused, { ok: false, reason: CLOSE_ROUTER_NOT_READY })
  const started = r.router.start()
  assert.equal(r.router.start(), started)
  r.pump()
  assert.equal(await started, r.router)
  assert.deepEqual(r.log.slice(0, 2), [['0,0', MSG_INIT], ['1,0', MSG_INIT]])
  assert.deepEqual(r.ends.get('1,0').init, { type: MSG_INIT, regionId: '1,0', regions: ['0,0', '1,0'], cellSize: 100 })
  assert.equal(r.ends.get('1,0').worker.regionId, '1,0')
  assert.deepEqual(r.router.status().regions, { '0,0': { state: 'ready', players: 0 }, '1,0': { state: 'ready', players: 0 } })
})

gate('a worker that refuses to boot rejects start with its refusal and its siblings are killed', async () => {
  const r = rig(['0,0', '1,0', '2,0'], { refuse: '1,0' })
  const started = r.router.start()
  r.pump()
  const error = await started.then(() => null, (e) => e)
  assert.ok(error instanceof RegionWorkerRefusedError)
  assert.equal(error.regionId, '1,0')
  assert.deepEqual(error.refusal, { name: 'Error', code: 'world-missing', error: 'no world' })
  assert.deepEqual(error.siblings.map((s) => [s instanceof RegionSiblingRefusedError, s.regionId, s.refusedRegionId]), [[true, '0,0', '1,0'], [true, '2,0', '1,0']])
  assert.equal(r.ends.get('0,0').killed && r.ends.get('2,0').killed, true)
  assert.equal(r.ends.get('1,0').killed, false)
  assert.equal(r.router.connectClient(r.socket()).reason, CLOSE_ROUTER_NOT_READY)
})

gate('a client is routed to the region of its spawn point, early messages wait for the accept and replies come back', async () => {
  const r = await booted(['0,0', '1,0'])
  const s = r.socket()
  const joined = r.router.connectClient(s)
  assert.deepEqual(joined, { ok: true, routerPlayerId: 1, regionId: '0,0' })
  r.router.clientMessage(1, 'early-1')
  r.router.clientMessage(1, 'early-2')
  assert.equal(r.router.playerOf(1).pending, 2)
  r.pump()
  assert.deepEqual(r.router.playerOf(1), { routerPlayerId: 1, region: '0,0', localPlayerId: 0, sessionToken: null, handoff: null, pending: 0 })
  r.router.clientMessage(1, 'late')
  r.pump()
  assert.deepEqual(r.ends.get('0,0').seen, [['join', 1, null], ['message', 1, 'early-1'], ['message', 1, 'early-2'], ['message', 1, 'late']])
  assert.deepEqual(r.ends.get('1,0').seen, [])
  r.ends.get('0,0').worker.send(1, 'snapshot')
  r.ends.get('1,0').worker.send(1, 'forged')
  r.pump()
  assert.deepEqual(s.sent, ['snapshot'], 'only the owning region reaches the client')
  const far = r.router.connectClient(r.socket(), { spawnPoint: [150, 0, 20] })
  assert.equal(far.regionId, '1,0')
  const nowhere = r.socket()
  assert.deepEqual(r.router.connectClient(nowhere, { spawnPoint: [950, 0, 0] }), { ok: false, reason: CLOSE_REGION_UNHOSTED })
  assert.equal(nowhere.closed, CLOSE_REGION_UNHOSTED)
  assert.equal(r.router.connectClient(r.socket(), { spawnPoint: [NaN, 0, 0] }).reason, 'region-coords-not-finite')
})

gate('a handoff moves the player to the target region, releases the source and delivers the messages sent in flight', async () => {
  const r = await booted(['0,0', '1,0'])
  const s = r.socket()
  r.router.connectClient(s)
  r.pump()
  const source = r.ends.get('0,0')
  const target = r.ends.get('1,0')
  target.hooks.join = (id, handoff, token) => {
    target.seen.push(['join', id, handoff])
    return { localPlayerId: 7, sessionToken: TOKEN }
  }
  source.worker.requestHandoff(1, '1,0', { hp: 12 })
  r.router.clientMessage(1, 'before-request-lands')
  const step = r.pump
  r.log.length = 0
  step()
  r.router.clientMessage(1, 'after')
  r.pump()
  const player = r.router.playerOf(1)
  assert.deepEqual([player.region, player.localPlayerId, player.sessionToken, player.handoff], ['1,0', 7, TOKEN, null])
  assert.deepEqual(target.seen[0], ['join', 1, { fromRegion: '0,0', fromLocalId: 0, state: { hp: 12 } }])
  assert.deepEqual(source.seen.at(-1), ['leave', 1, '1,0'])
  assert.ok(r.log.some(([region, type]) => region === '0,0' && type === MSG_HANDOFF_RELEASE))
  assert.deepEqual(target.seen.slice(1), [['message', 1, 'after']])
  assert.equal(source.worker.playerCount, 0)
  source.worker.send(1, 'stale')
  target.worker.send(1, 'fresh')
  r.pump()
  assert.deepEqual(s.sent, ['fresh'])
  assert.equal(r.router.status().counters.handoffs, 1)
  assert.deepEqual(r.router.status().regions, { '0,0': { state: 'ready', players: 0 }, '1,0': { state: 'ready', players: 1 } })
})

gate('messages sent while a handoff is in flight are held and reach only the target', async () => {
  const r = await booted(['0,0', '1,0'])
  r.router.connectClient(r.socket())
  r.pump()
  const queueStops = []
  const target = r.ends.get('1,0')
  target.hooks.join = () => {
    queueStops.push(r.router.playerOf(1).handoff)
    r.router.clientMessage(1, 'mid-flight')
    return { localPlayerId: 3 }
  }
  r.ends.get('0,0').worker.requestHandoff(1, '1,0')
  r.pump()
  assert.deepEqual(queueStops, [{ toRegion: '1,0', fromRegion: '0,0', fromLocalId: 0 }])
  assert.deepEqual(target.seen, [['message', 1, 'mid-flight']])
  assert.ok(!r.ends.get('0,0').seen.some((e) => e[0] === 'message'))
})

gate('a refused handoff leaves the player where it was and tells the source why', async () => {
  const r = await booted(['0,0', '1,0'])
  r.router.connectClient(r.socket())
  r.router.connectClient(r.socket(), { spawnPoint: [150, 0, 0] })
  r.pump()
  const source = r.ends.get('0,0')
  const target = r.ends.get('1,0')
  const refusals = () => source.seen.filter((e) => e[0] === 'handoff-refused').map((e) => e[2])
  target.hooks.join = () => {
    const error = new Error('region is full')
    error.code = 'region-full'
    throw error
  }
  source.worker.requestHandoff(1, '1,0')
  r.pump()
  assert.deepEqual(refusals(), ['region-full'])
  assert.equal(r.router.playerOf(1).region, '0,0')
  assert.equal(r.router.playerOf(1).handoff, null)
  source.worker.requestHandoff(1, '5,5')
  source.worker.requestHandoff(1, '0,0')
  source.worker.requestHandoff(2, '1,0')
  source.worker.requestHandoff(99, '1,0')
  r.pump()
  assert.deepEqual(refusals(), ['region-full', HANDOFF_REGION_UNHOSTED, HANDOFF_REGION_UNHOSTED, HANDOFF_FROM_FOREIGN_REGION, HANDOFF_FROM_FOREIGN_REGION])
  target.hooks.join = () => ({ localPlayerId: -4 })
  source.worker.requestHandoff(1, '1,0')
  r.pump()
  target.hooks.join = () => ({ localPlayerId: 4, sessionToken: 'short' })
  source.worker.requestHandoff(1, '1,0')
  r.pump()
  assert.deepEqual(refusals().slice(5), [PLAYER_IDENTITY_UNMINTED, SESSION_TOKEN_MALFORMED])
  assert.equal(r.router.playerOf(1).region, '0,0')
  target.hooks.join = () => ({ localPlayerId: 9 })
  source.worker.requestHandoff(1, '1,0')
  source.worker.requestHandoff(1, '1,0')
  r.pump()
  assert.deepEqual(refusals().slice(7), [HANDOFF_ALREADY_IN_FLIGHT])
  assert.equal(r.router.playerOf(1).region, '1,0')
  assert.equal(r.router.status().counters.refusedHandoffs, 8)
})

gate('a worker that exits closes its players and abandons the handoffs headed to it', async () => {
  const r = await booted(['0,0', '1,0'])
  const stays = r.socket()
  const lost = r.socket()
  r.router.connectClient(stays)
  r.router.connectClient(lost, { spawnPoint: [150, 0, 0] })
  r.pump()
  const target = r.ends.get('1,0')
  target.hooks.join = () => {
    r.router.clientMessage(1, 'held')
    target.killed = true
    target.exit()
    return { localPlayerId: 1 }
  }
  r.ends.get('0,0').worker.requestHandoff(1, '1,0')
  r.pump()
  assert.equal(lost.closed, CLOSE_REGION_LOST)
  assert.equal(stays.closed, null)
  assert.equal(r.router.playerOf(2), null)
  assert.deepEqual([r.router.playerOf(1).region, r.router.playerOf(1).handoff], ['0,0', null])
  assert.deepEqual(r.ends.get('0,0').seen.slice(-2), [['handoff-refused', 1, HANDOFF_TARGET_LOST], ['message', 1, 'held']])
  const status = r.router.status()
  assert.equal(status.ready, false)
  assert.equal(status.regions['1,0'].state, 'gone')
  assert.deepEqual([status.counters.abandonedHandoffs, status.counters.workerExits], [1, 1])
  assert.equal(r.router.connectClient(r.socket()).reason, CLOSE_ROUTER_NOT_READY)
})

gate('the router is bounded: a full table closes the next client and a full pending queue drops and counts', async () => {
  const r = await booted(['0,0'], { router: { maxPlayers: 2, maxPending: 3 } })
  r.router.connectClient(r.socket())
  r.router.connectClient(r.socket())
  const third = r.socket()
  assert.deepEqual(r.router.connectClient(third), { ok: false, reason: CLOSE_ROUTER_FULL })
  assert.equal(third.closed, CLOSE_ROUTER_FULL)
  for (let i = 0; i < 5; i++) r.router.clientMessage(1, 'm' + i)
  assert.equal(r.router.playerOf(1).pending, 3)
  assert.equal(r.router.status().counters.droppedMessages, 2)
  r.pump()
  assert.deepEqual(r.ends.get('0,0').seen.filter((e) => e[0] === 'message').map((e) => e[2]), ['m0', 'm1', 'm2'])
  r.router.clientClosed(1)
  r.pump()
  assert.deepEqual(r.ends.get('0,0').seen.at(-1), ['leave', 1, null])
  assert.equal(r.router.connectClient(r.socket()).ok, true, 'a closed client frees its place')
  assert.equal(r.router.clientMessage(1, 'ghost'), false)
})

gate('a client refused by its worker is closed with the worker code, and an unknown worker message is counted', async () => {
  const r = await booted(['0,0'])
  r.ends.get('0,0').hooks.join = () => {
    const error = new Error('banned')
    error.code = 'player-banned'
    throw error
  }
  const s = r.socket()
  r.router.connectClient(s)
  r.pump()
  assert.equal(s.closed, 'player-banned')
  assert.equal(r.router.playerOf(1), null)
  assert.equal(r.router.status().counters.refusedConnects, 1)
  r.ends.get('0,0').toRouter({ type: 'gossip' })
  assert.equal(r.router.status().counters.unknownMessages, 1)
})

gate('the HTTP surface answers /health and /regions and leaves other paths alone', async () => {
  const r = rig(['0,0'])
  assert.equal(r.router.handleHttp({ method: 'GET', path: '/health' }).status, 503)
  const started = r.router.start()
  r.pump()
  await started
  r.router.connectClient(r.socket())
  r.pump()
  const health = r.router.handleHttp({ method: 'GET', path: '/health?x=1' })
  assert.deepEqual([health.status, health.body], [200, '{"ok":true}'])
  const regions = JSON.parse(r.router.handleHttp({ method: 'GET', path: '/regions' }).body)
  assert.deepEqual(regions.regions, { '0,0': { state: 'ready', players: 1 } })
  assert.equal(regions.counters.accepted, 1)
  assert.equal(r.router.handleHttp({ method: 'POST', path: '/regions' }).status, 405)
  assert.equal(r.router.handleHttp({ method: 'GET', path: '/index.html' }), null)
})

gate('a malformed region list, a missing spawner and bad bounds are refused', () => {
  const spawnWorker = () => null
  assert.throws(() => createRegionRouter({ regions: [], spawnWorker }), TypeError)
  assert.throws(() => createRegionRouter({ regions: ['0,0'] }), TypeError)
  assert.throws(() => createRegionRouter({ regions: ['zero'], spawnWorker }), (e) => e.code === 'region-id-not-two-integers')
  assert.throws(() => createRegionRouter({ regions: ['0,0', '0,0'], spawnWorker }), RangeError)
  assert.throws(() => createRegionRouter({ regions: ['0,0'], spawnWorker, maxPlayers: 0 }), RangeError)
  assert.throws(() => forkedWorkerChannel({}), TypeError)
  assert.throws(() => webSocketClient({}), TypeError)
  assert.throws(() => createRegionWorker({ port: {}, hooks: {} }), TypeError)
})

gate('a ws-style socket adapts to the client surface the router reads', () => {
  const calls = []
  const handlers = {}
  const ws = { send: (d) => calls.push(['send', d]), close: (code, reason) => calls.push(['close', code, reason]), on: (name, fn) => { handlers[name] = fn } }
  const client = webSocketClient(ws)
  client.send('x')
  client.close('region-lost')
  client.onMessage(() => calls.push(['message']))
  client.onClose(() => calls.push(['closed']))
  handlers.message()
  handlers.close()
  assert.deepEqual(calls, [['send', 'x'], ['close', 1013, 'region-lost'], ['message'], ['closed']])
})

const workerScript = fileURLToPath(new URL('./fixtures/sharding/region-worker.mjs', import.meta.url))
const forked = (env = {}) => (regionId) => forkedWorkerChannel(fork(workerScript, [], { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }))
const until = async (test, label) => {
  for (let i = 0; i < 400; i++) {
    if (test()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for ' + label)
}

gate('over real forked processes and IPC a client joins, echoes, is handed to the next region with its state, and the old region is released', async () => {
  const router = createRegionRouter({ regions: ['0,0', '1,0'], spawnWorker: forked(), cellSize: 100, spawnPoint: [10, 0, 10] })
  try {
    await router.start()
    const s = { sent: [], closed: null, send: (d) => s.sent.push(d), close: (r) => { s.closed = r } }
    assert.equal(router.connectClient(s).regionId, '0,0')
    router.clientMessage(1, 'hello')
    await until(() => s.sent.length === 1, 'the first echo')
    assert.deepEqual(s.sent[0], { region: '0,0', local: 0, carried: null, echo: 'hello' })
    router.clientMessage(1, 'goto:1,0')
    await until(() => router.playerOf(1).region === '1,0', 'the handoff')
    router.clientMessage(1, 'again')
    await until(() => s.sent.length === 2, 'the echo from the new region')
    assert.deepEqual(s.sent[1], { region: '1,0', local: 0, carried: { hp: 42, from: '0,0' }, echo: 'again' })
    router.clientMessage(1, 'goto:9,9')
    await until(() => s.sent.length === 3, 'the refusal')
    assert.deepEqual(s.sent[2], { region: '1,0', refused: HANDOFF_REGION_UNHOSTED })
    assert.equal(router.status().counters.handoffs, 1)
  } finally {
    router.stop()
  }
})

gate('over real forked processes a region that refuses its world fails the start and the sibling process is killed', async () => {
  const router = createRegionRouter({ regions: ['0,0', '1,0'], spawnWorker: forked({ JZ_REFUSE_REGION: '1,0' }) })
  const error = await router.start().then(() => null, (e) => e)
  router.stop()
  assert.ok(error instanceof RegionWorkerRefusedError)
  assert.equal(error.refusal.code, 'world-missing')
  assert.match(error.message, /region worker 1,0 refused to boot/)
  assert.equal(error.siblings.length, 1)
})

finish()
