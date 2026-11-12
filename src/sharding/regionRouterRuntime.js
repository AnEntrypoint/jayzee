import { parseRegionId, DEFAULT_CELL_SIZE } from './RegionGrid.js'
import {
  WORKER_REFUSED, CLIENT_CONNECT_REFUSED, HANDOFF_REFUSED, MESSAGE_TYPE_UNKNOWN,
  messageTable, dispatchMessage, errorRefusal,
  ClientConnectRefusedError, RegionWorkerRefusedError, RegionSiblingRefusedError,
} from './ShardingRefusal.js'
import { playerIdentity, handoffTo, regionForSpawnPoint, parseSessionToken, HANDOFF_IDLE } from './RegionRouter.js'
import { beginHandoff, acceptHandoff, refuseHandoff, abandonHandoffsTo, handoffAcceptanceRefusal } from './HandoffState.js'

export const MSG_INIT = 'init'
export const MSG_READY = 'ready'
export const MSG_CLIENT_CONNECT = 'client-connect'
export const MSG_CLIENT_ACCEPTED = 'client-accepted'
export const MSG_CLIENT_MESSAGE = 'client-message'
export const MSG_CLIENT_SEND = 'client-send'
export const MSG_CLIENT_DISCONNECT = 'client-disconnect'
export const MSG_HANDOFF_REQUEST = 'handoff-request'
export const MSG_HANDOFF_RELEASE = 'handoff-release'

export const CLOSE_REGION_UNHOSTED = 'region-unhosted'
export const CLOSE_REGION_LOST = 'region-lost'
export const CLOSE_ROUTER_FULL = 'router-full'
export const CLOSE_ROUTER_NOT_READY = 'router-not-ready'
export const HANDOFF_REGION_UNHOSTED = 'handoff-region-unhosted'
export const HANDOFF_ALREADY_IN_FLIGHT = 'handoff-already-in-flight'
export const HANDOFF_FROM_FOREIGN_REGION = 'handoff-from-foreign-region'
export const HANDOFF_TARGET_LOST = 'handoff-target-lost'

const DEFAULT_MAX_PLAYERS = 256
const DEFAULT_MAX_PENDING = 32
const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })

const STATE_BOOTING = 'booting'
const STATE_READY = 'ready'
const STATE_REFUSED = 'refused'
const STATE_GONE = 'gone'

export function createRegionRouter(opts) {
  const { regions, spawnWorker } = opts ?? {}
  if (!Array.isArray(regions) || regions.length === 0) throw new TypeError('createRegionRouter needs a non-empty list of region ids')
  if (typeof spawnWorker !== 'function') throw new TypeError('createRegionRouter needs a spawnWorker(regionId) function')
  for (const id of regions) {
    const parsed = parseRegionId(id)
    if (!parsed.ok) {
      const error = new Error(`[region-router] ${parsed.reason}: region id ${JSON.stringify(id)} is not "<int>,<int>"`)
      error.code = parsed.reason
      throw error
    }
  }
  if (new Set(regions).size !== regions.length) throw new RangeError('createRegionRouter: region ids must be distinct')
  const cellSize = opts.cellSize ?? DEFAULT_CELL_SIZE
  const maxPlayers = opts.maxPlayers ?? DEFAULT_MAX_PLAYERS
  const maxPending = opts.maxPending ?? DEFAULT_MAX_PENDING
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1) throw new RangeError('createRegionRouter: maxPlayers must be a positive integer')
  if (!Number.isInteger(maxPending) || maxPending < 1) throw new RangeError('createRegionRouter: maxPending must be a positive integer')
  const spawnPoint = opts.spawnPoint ?? [0, 0, 0]

  const workers = new Map()
  const players = new Map()
  const counters = { connects: 0, accepted: 0, refusedConnects: 0, handoffs: 0, refusedHandoffs: 0, abandonedHandoffs: 0, droppedMessages: 0, unknownMessages: 0, workerExits: 0 }
  let nextRouterPlayerId = 1
  let started = null
  let settleStart = null

  function sendTo(regionId, msg) {
    const worker = workers.get(regionId)
    if (!worker || worker.state === STATE_GONE || worker.state === STATE_REFUSED) return false
    worker.channel.send(msg)
    return true
  }

  function closePlayer(player, reason) {
    players.delete(player.routerPlayerId)
    if (!player.closed) {
      player.closed = true
      player.socket.close(reason)
    }
  }

  function queueOrDrop(player, data) {
    if (player.pending.length === maxPending) {
      counters.droppedMessages++
      return
    }
    player.pending.push(data)
  }

  function flushPending(player) {
    const queued = player.pending
    player.pending = []
    for (const data of queued) sendTo(player.region, { type: MSG_CLIENT_MESSAGE, routerPlayerId: player.routerPlayerId, data })
  }

  function refuseHandoffToSource(player, code) {
    counters.refusedHandoffs++
    const source = player.region
    refuseHandoff(player)
    sendTo(source, { type: HANDOFF_REFUSED, routerPlayerId: player.routerPlayerId, code })
    flushPending(player)
  }

  function onClientAccepted(msg, regionId) {
    const player = players.get(msg.routerPlayerId)
    const identity = playerIdentity(regionId, msg.localPlayerId)
    const token = parseSessionToken(msg.sessionToken)
    const refusal = handoffAcceptanceRefusal(player, identity, token)
    if (refusal !== null) {
      counters.refusedConnects++
      if (player) {
        if (player.handoff !== HANDOFF_IDLE && player.handoff.toRegion === regionId) refuseHandoffToSource(player, refusal)
        else if (player.region === null) closePlayer(player, refusal)
      }
      sendTo(regionId, { type: MSG_CLIENT_DISCONNECT, routerPlayerId: msg.routerPlayerId })
      return
    }
    const inFlight = player.handoff
    if (inFlight !== HANDOFF_IDLE) {
      if (inFlight.toRegion !== regionId) return
      const source = player.region
      acceptHandoff(player, identity, token.sessionToken)
      counters.handoffs++
      sendTo(source, { type: MSG_HANDOFF_RELEASE, routerPlayerId: player.routerPlayerId, toRegion: regionId })
    } else {
      if (player.region !== null || player.wanted !== regionId) return
      acceptHandoff(player, identity, token.sessionToken)
      counters.accepted++
    }
    flushPending(player)
  }

  function onConnectRefused(msg, regionId) {
    const player = players.get(msg.routerPlayerId)
    if (!player) return
    if (player.handoff !== HANDOFF_IDLE && player.handoff.toRegion === regionId) {
      refuseHandoffToSource(player, msg.code ?? CLIENT_CONNECT_REFUSED)
      return
    }
    if (player.region === null) {
      counters.refusedConnects++
      player.refusal = new ClientConnectRefusedError(msg.code ?? CLIENT_CONNECT_REFUSED, msg.error ?? null)
      closePlayer(player, msg.code ?? CLIENT_CONNECT_REFUSED)
    }
  }

  function onClientSend(msg, regionId) {
    const player = players.get(msg.routerPlayerId)
    if (!player || player.region !== regionId || player.closed) {
      counters.droppedMessages++
      return
    }
    player.socket.send(msg.data)
  }

  function onHandoffRequest(msg, regionId) {
    const player = players.get(msg.routerPlayerId)
    const refuse = (code) => {
      counters.refusedHandoffs++
      sendTo(regionId, { type: HANDOFF_REFUSED, routerPlayerId: msg.routerPlayerId, code })
    }
    if (!player || player.region !== regionId) return refuse(HANDOFF_FROM_FOREIGN_REGION)
    const target = workers.get(msg.toRegion)
    if (!target || target.state !== STATE_READY || msg.toRegion === regionId) return refuse(HANDOFF_REGION_UNHOSTED)
    const handoff = handoffTo(msg.toRegion, regionId, player.localPlayerId)
    if (handoff === null) return refuse(HANDOFF_REGION_UNHOSTED)
    if (!beginHandoff(player, handoff)) return refuse(HANDOFF_ALREADY_IN_FLIGHT)
    sendTo(msg.toRegion, { type: MSG_CLIENT_CONNECT, routerPlayerId: player.routerPlayerId, sessionToken: player.sessionToken, handoff: { fromRegion: regionId, fromLocalId: player.localPlayerId, state: msg.state ?? null } })
    return null
  }

  function onReady(msg, regionId) {
    const worker = workers.get(regionId)
    if (worker.state !== STATE_BOOTING) return
    worker.state = STATE_READY
    if (settleStart) settleStart()
  }

  function onWorkerRefused(msg, regionId) {
    const worker = workers.get(regionId)
    worker.state = STATE_REFUSED
    worker.refusal = msg.refusal ?? errorRefusal(null)
    if (settleStart) settleStart()
  }

  const table = messageTable([
    [MSG_READY, onReady],
    [WORKER_REFUSED, onWorkerRefused],
    [MSG_CLIENT_ACCEPTED, onClientAccepted],
    [CLIENT_CONNECT_REFUSED, onConnectRefused],
    [MSG_CLIENT_SEND, onClientSend],
    [MSG_HANDOFF_REQUEST, onHandoffRequest],
  ])

  function onWorkerMessage(regionId, msg) {
    const result = dispatchMessage(table, msg, regionId)
    if (!result.ok && result.code === MESSAGE_TYPE_UNKNOWN) counters.unknownMessages++
    return result
  }

  function onWorkerExit(regionId) {
    const worker = workers.get(regionId)
    if (!worker || worker.state === STATE_GONE) return
    const wasRefused = worker.state === STATE_REFUSED
    if (!wasRefused) worker.state = STATE_GONE
    counters.workerExits++
    for (const player of abandonHandoffsTo(players.values(), regionId)) {
      counters.abandonedHandoffs++
      sendTo(player.region, { type: HANDOFF_REFUSED, routerPlayerId: player.routerPlayerId, code: HANDOFF_TARGET_LOST })
      flushPending(player)
    }
    for (const player of [...players.values()]) {
      if (player.region === regionId || (player.region === null && player.wanted === regionId)) closePlayer(player, CLOSE_REGION_LOST)
    }
    if (settleStart) settleStart()
  }

  function start() {
    if (started) return started
    started = new Promise((resolve, reject) => {
      settleStart = () => {
        const states = [...workers.values()].map((w) => w.state)
        const refused = [...workers.values()].find((w) => w.state === STATE_REFUSED)
        if (refused) {
          settleStart = null
          const siblings = []
          for (const worker of workers.values()) {
            if (worker === refused || worker.state === STATE_GONE) continue
            worker.state = STATE_GONE
            worker.channel.kill()
            siblings.push(new RegionSiblingRefusedError(worker.regionId, refused.regionId))
          }
          const error = new RegionWorkerRefusedError(refused.regionId, refused.refusal)
          error.siblings = siblings
          reject(error)
          return
        }
        const gone = [...workers.values()].find((w) => w.state === STATE_GONE)
        if (gone) {
          settleStart = null
          reject(new RegionWorkerRefusedError(gone.regionId, errorRefusal({ name: 'Error', code: 'region-worker-exited', message: 'the worker exited before it was ready' })))
          return
        }
        if (states.every((s) => s === STATE_READY)) {
          settleStart = null
          resolve(api)
        }
      }
      for (const regionId of regions) {
        const channel = spawnWorker(regionId)
        workers.set(regionId, { regionId, channel, state: STATE_BOOTING, refusal: null })
        channel.onMessage((msg) => onWorkerMessage(regionId, msg))
        if (typeof channel.onExit === 'function') channel.onExit(() => onWorkerExit(regionId))
      }
      for (const regionId of regions) sendTo(regionId, { type: MSG_INIT, regionId, regions: [...regions], cellSize })
    })
    return started
  }

  function isReady() {
    return workers.size === regions.length && [...workers.values()].every((w) => w.state === STATE_READY)
  }

  function connectClient(socket, hint = {}) {
    if (!socket || typeof socket.send !== 'function' || typeof socket.close !== 'function') throw new TypeError('connectClient needs a socket with send and close')
    counters.connects++
    const refuseNow = (reason) => {
      counters.refusedConnects++
      socket.close(reason)
      return { ok: false, reason }
    }
    if (!isReady()) return refuseNow(CLOSE_ROUTER_NOT_READY)
    if (players.size >= maxPlayers) return refuseNow(CLOSE_ROUTER_FULL)
    const wanted = regionForSpawnPoint(hint.spawnPoint ?? spawnPoint, cellSize)
    if (!wanted.ok) return refuseNow(wanted.reason)
    if (!workers.has(wanted.regionId)) return refuseNow(CLOSE_REGION_UNHOSTED)
    const routerPlayerId = nextRouterPlayerId++
    const player = { routerPlayerId, socket, region: null, wanted: wanted.regionId, localPlayerId: null, sessionToken: null, handoff: HANDOFF_IDLE, pending: [], closed: false, refusal: null }
    players.set(routerPlayerId, player)
    if (typeof socket.onMessage === 'function') socket.onMessage((data) => clientMessage(routerPlayerId, data))
    if (typeof socket.onClose === 'function') socket.onClose(() => clientClosed(routerPlayerId))
    sendTo(wanted.regionId, { type: MSG_CLIENT_CONNECT, routerPlayerId, sessionToken: hint.sessionToken ?? null, handoff: null })
    return { ok: true, routerPlayerId, regionId: wanted.regionId }
  }

  function clientMessage(routerPlayerId, data) {
    const player = players.get(routerPlayerId)
    if (!player) {
      counters.droppedMessages++
      return false
    }
    if (player.region === null || player.handoff !== HANDOFF_IDLE) {
      queueOrDrop(player, data)
      return true
    }
    return sendTo(player.region, { type: MSG_CLIENT_MESSAGE, routerPlayerId, data })
  }

  function clientClosed(routerPlayerId) {
    const player = players.get(routerPlayerId)
    if (!player) return
    player.closed = true
    players.delete(routerPlayerId)
    if (player.region !== null) sendTo(player.region, { type: MSG_CLIENT_DISCONNECT, routerPlayerId })
    else sendTo(player.wanted, { type: MSG_CLIENT_DISCONNECT, routerPlayerId })
    if (player.handoff !== HANDOFF_IDLE) sendTo(player.handoff.toRegion, { type: MSG_CLIENT_DISCONNECT, routerPlayerId })
  }

  function status() {
    const byRegion = {}
    for (const worker of workers.values()) byRegion[worker.regionId] = { state: worker.state, players: 0 }
    let inFlight = 0
    for (const player of players.values()) {
      if (player.region !== null && byRegion[player.region]) byRegion[player.region].players++
      if (player.handoff !== HANDOFF_IDLE) inFlight++
    }
    return { ready: isReady(), players: players.size, handoffsInFlight: inFlight, regions: byRegion, counters: { ...counters } }
  }

  function handleHttp(request) {
    const method = request && typeof request.method === 'string' ? request.method.toUpperCase() : ''
    const target = request && typeof request.path === 'string' ? request.path : ''
    const mark = target.indexOf('?')
    const path = mark < 0 ? target : target.slice(0, mark)
    if (path !== '/health' && path !== '/regions') return null
    if (method !== 'GET') return { status: 405, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, code: 'method-not-allowed' }) }
    if (path === '/health') {
      const ready = isReady()
      return { status: ready ? 200 : 503, headers: JSON_HEADERS, body: JSON.stringify({ ok: ready }) }
    }
    return { status: 200, headers: JSON_HEADERS, body: JSON.stringify(status()) }
  }

  function stop() {
    for (const player of [...players.values()]) closePlayer(player, CLOSE_REGION_LOST)
    for (const worker of workers.values()) {
      if (worker.state === STATE_GONE) continue
      worker.state = STATE_GONE
      worker.channel.kill()
    }
  }

  const api = {
    start,
    stop,
    connectClient,
    clientMessage,
    clientClosed,
    status,
    handleHttp,
    playerOf: (routerPlayerId) => {
      const p = players.get(routerPlayerId)
      return p ? { routerPlayerId, region: p.region, localPlayerId: p.localPlayerId, sessionToken: p.sessionToken, handoff: p.handoff, pending: p.pending.length } : null
    },
  }
  return api
}

export function forkedWorkerChannel(child) {
  if (!child || typeof child.send !== 'function' || typeof child.on !== 'function') throw new TypeError('forkedWorkerChannel needs a forked child process')
  return {
    send: (msg) => {
      if (child.connected) child.send(msg)
    },
    onMessage: (fn) => child.on('message', fn),
    onExit: (fn) => child.on('exit', fn),
    kill: () => child.kill(),
  }
}

export function webSocketClient(ws) {
  if (!ws || typeof ws.send !== 'function' || typeof ws.on !== 'function') throw new TypeError('webSocketClient needs a ws-style socket')
  return {
    send: (data) => ws.send(data),
    close: (reason) => ws.close(1013, String(reason ?? '')),
    onMessage: (fn) => ws.on('message', fn),
    onClose: (fn) => ws.on('close', fn),
  }
}

export function createRegionWorker({ port, hooks }) {
  if (!port || typeof port.send !== 'function' || typeof port.onMessage !== 'function') throw new TypeError('createRegionWorker needs a port with send and onMessage')
  if (!hooks || typeof hooks.join !== 'function') throw new TypeError('createRegionWorker needs hooks with join')
  let regionId = null
  const locals = new Map()

  const table = messageTable([
    [MSG_INIT, (msg) => {
      try {
        if (typeof hooks.init === 'function') hooks.init(msg)
        regionId = msg.regionId
        port.send({ type: MSG_READY, regionId })
      } catch (error) {
        port.send({ type: WORKER_REFUSED, refusal: errorRefusal(error) })
      }
    }],
    [MSG_CLIENT_CONNECT, (msg) => {
      try {
        const joined = hooks.join(msg.routerPlayerId, msg.handoff, msg.sessionToken)
        locals.set(msg.routerPlayerId, joined.localPlayerId)
        port.send({ type: MSG_CLIENT_ACCEPTED, routerPlayerId: msg.routerPlayerId, localPlayerId: joined.localPlayerId, sessionToken: joined.sessionToken ?? null })
      } catch (error) {
        port.send({ type: CLIENT_CONNECT_REFUSED, routerPlayerId: msg.routerPlayerId, code: typeof error?.code === 'string' ? error.code : CLIENT_CONNECT_REFUSED, error: String(error?.message ?? error) })
      }
    }],
    [MSG_CLIENT_MESSAGE, (msg) => {
      if (locals.has(msg.routerPlayerId) && typeof hooks.message === 'function') hooks.message(msg.routerPlayerId, msg.data)
    }],
    [MSG_CLIENT_DISCONNECT, (msg) => {
      if (locals.delete(msg.routerPlayerId) && typeof hooks.leave === 'function') hooks.leave(msg.routerPlayerId, null)
    }],
    [MSG_HANDOFF_RELEASE, (msg) => {
      if (locals.delete(msg.routerPlayerId) && typeof hooks.leave === 'function') hooks.leave(msg.routerPlayerId, msg.toRegion)
    }],
    [HANDOFF_REFUSED, (msg) => {
      if (typeof hooks.handoffRefused === 'function') hooks.handoffRefused(msg.routerPlayerId, msg.code)
    }],
  ])

  port.onMessage((msg) => dispatchMessage(table, msg))

  return {
    get regionId() { return regionId },
    send: (routerPlayerId, data) => port.send({ type: MSG_CLIENT_SEND, routerPlayerId, data }),
    requestHandoff: (routerPlayerId, toRegion, state = null) => port.send({ type: MSG_HANDOFF_REQUEST, routerPlayerId, toRegion, state }),
    localIdOf: (routerPlayerId) => locals.get(routerPlayerId) ?? null,
    get playerCount() { return locals.size },
  }
}
