import { createWorkerTransport } from './workerTransport.js'
import { createPeerSender } from './workerMessages.js'
import { createNetcodeDispatch } from '../worker-dispatch-pure/workerDispatch.js'
import { createServer } from '../sdk/server.js'
import { bootServer } from '../sdk/staticModelColliders.js'

export const SINGLEPLAYER_PARAM = 'singleplayer'
export const NOT_INITIALISED = 'browser-server-not-initialised'
export const ALREADY_INITIALISED = 'browser-server-already-initialised'
export const TICK_HANDLER_RELOAD_UNSUPPORTED = 'tick-handler-reload-unsupported'
export const INIT_TIMEOUT = 'browser-server-init-timeout'
const OFF_VALUES = Object.freeze(['0', 'false', 'off', 'no'])

export function isSingleplayer(search = '', hash = '') {
  const params = new URLSearchParams(search)
  const hashAt = hash.indexOf('?')
  if (!params.has(SINGLEPLAYER_PARAM) && hashAt >= 0) {
    const fromHash = new URLSearchParams(hash.slice(hashAt + 1))
    if (fromHash.has(SINGLEPLAYER_PARAM)) params.set(SINGLEPLAYER_PARAM, fromHash.get(SINGLEPLAYER_PARAM))
  }
  if (!params.has(SINGLEPLAYER_PARAM)) return false
  return !OFF_VALUES.includes(params.get(SINGLEPLAYER_PARAM).toLowerCase())
}

const moduleOf = (loaded) => (loaded && loaded.default !== undefined ? loaded.default : loaded)

const describe = (error) => ({ message: error && error.message ? error.message : String(error), code: error && (error.code || error.reasonCode) ? error.code || error.reasonCode : null })

export function createBrowserServer({ post, now, timers = null, importApp, readModel = null, save = null, prepare = null, log = () => {} } = {}) {
  if (typeof post !== 'function') throw new TypeError('createBrowserServer needs a post function')
  if (typeof now !== 'function') throw new TypeError('createBrowserServer needs a clock function in milliseconds')
  if (typeof importApp !== 'function') throw new TypeError('createBrowserServer needs an importApp function')
  let server = null
  let starting = false
  let localSocket = null
  const peers = new Map()
  const stats = { inits: 0, clientMessages: 0, peerMessages: 0, dropped: 0, reloads: 0 }

  const makeSocket = (send, release) => {
    let open = true
    const socket = {
      get isOpen() { return open },
      send(bytes) {
        if (!open) return false
        const copy = bytes.slice()
        return send(copy)
      },
      close() {
        if (!open) return
        open = false
        release()
      },
      onMessage: null,
      onClose: null,
    }
    return socket
  }

  const deliver = (socket, data, counter) => {
    if (server === null || socket === null || !socket.isOpen || typeof socket.onMessage !== 'function') {
      stats.dropped += 1
      return false
    }
    stats[counter] += 1
    socket.onMessage(data instanceof Uint8Array ? data : new Uint8Array(data))
    return true
  }

  const hangUp = (socket) => {
    if (socket === null) return false
    if (typeof socket.onClose === 'function') socket.onClose()
    socket.close()
    return true
  }

  const init = async (message) => {
    if (server !== null || starting) {
      post({ type: 'INIT_ERROR', message: 'the browser server was already initialised', code: ALREADY_INITIALISED })
      return false
    }
    starting = true
    stats.inits += 1
    try {
      if (typeof prepare === 'function') await prepare()
      const apps = {}
      const urls = message.apps || {}
      for (const name of Object.keys(urls)) apps[name] = moduleOf(await importApp(urls[name]))
      const options = { config: message.config || {}, apps, now, log, timers }
      const built = readModel === null ? createServer(options) : await bootServer({ ...options, readModel })
      const transport = createWorkerTransport(post)
      localSocket = makeSocket((bytes) => transport.send(bytes, message.mt), () => {})
      built.attach(localSocket)
      server = built
      if (timers !== null) built.start()
      post({ type: 'WORKER_READY', tickRate: built.config.tickRate, entities: built.loadedEntities.length, apps: Object.keys(apps) })
      return true
    } catch (error) {
      post({ type: 'INIT_ERROR', ...describe(error) })
      return false
    } finally {
      starting = false
    }
  }

  const reloadApp = async (message) => {
    if (server === null) {
      post({ type: 'HMR_RESULT', name: message.name ?? null, ok: false, message: 'the browser server is not initialised', code: NOT_INITIALISED })
      return false
    }
    try {
      const def = moduleOf(await importApp(message.url))
      const reloaded = server.appRuntime.hasApp(message.name) ? server.reloadApp(message.name, def) : (server.registerApp(message.name, def), 0)
      stats.reloads += 1
      post({ type: 'HMR_RESULT', name: message.name, ok: true, reloaded })
      return true
    } catch (error) {
      post({ type: 'HMR_RESULT', name: message.name ?? null, ok: false, ...describe(error) })
      return false
    }
  }

  const peerConnect = (message) => {
    if (server === null || peers.has(message.peerId)) return false
    const sender = createPeerSender(message.peerId, post)
    const socket = makeSocket((bytes) => sender(bytes, message.mt), () => peers.delete(message.peerId))
    peers.set(message.peerId, socket)
    server.attach(socket)
    return true
  }

  const peerGone = (message) => hangUp(peers.get(message.peerId) ?? null)

  const debugQuery = (message) => {
    if (server === null) return post({ type: 'DEBUG_COLLIDER_RESULT', ok: false, code: NOT_INITIALISED })
    try {
      post({ type: 'DEBUG_COLLIDER_RESULT', ok: true, query: 'overlap', statics: server.queries.overlapStatics(message.min, message.max), bodies: server.queries.overlapBox(message.min, message.max) })
    } catch (error) {
      post({ type: 'DEBUG_COLLIDER_RESULT', ok: false, ...describe(error) })
    }
  }

  const debugRays = (message) => {
    if (server === null) return post({ type: 'DEBUG_COLLIDER_RESULT', ok: false, code: NOT_INITIALISED })
    try {
      const hits = (message.rays || []).map((ray) => server.queries.raycast(ray.origin, ray.direction, ray.maxDistance))
      post({ type: 'DEBUG_COLLIDER_RESULT', ok: true, query: 'rays', hits })
    } catch (error) {
      post({ type: 'DEBUG_COLLIDER_RESULT', ok: false, ...describe(error) })
    }
  }

  const dispatch = createNetcodeDispatch({
    INIT: init,
    CLIENT_MESSAGE: (message) => deliver(localSocket, message.data, 'clientMessages'),
    CLIENT_DISCONNECT: () => {
      const closed = hangUp(localSocket)
      if (server !== null && server.scheduler !== null) server.stop()
      return closed
    },
    PEER_CONNECT: peerConnect,
    PEER_MESSAGE: (message) => deliver(peers.get(message.peerId) ?? null, message.data, 'peerMessages'),
    PEER_FRAME: (message) => deliver(peers.get(message.peerId) ?? null, message.data, 'peerMessages'),
    PEER_DISCONNECT: peerGone,
    PEER_LEFT: peerGone,
    HMR_APP: reloadApp,
    HMR_TICK_HANDLER: () => post({ type: 'HMR_RESULT', name: null, ok: false, message: 'the tick handler is not reloadable in place; restart the worker', code: TICK_HANDLER_RELOAD_UNSUPPORTED }),
    SAVE_NOW: () => {
      if (server === null || typeof save !== 'function') return false
      save(server.appRuntime.exportStates())
      return true
    },
    DEBUG_COLLIDER_QUERY: debugQuery,
    DEBUG_COLLIDER_RAYS: debugRays,
  })

  return {
    handle: dispatch,
    stats,
    get server() { return server },
    get ready() { return server !== null },
    get peerCount() { return peers.size },
  }
}

export function bindBrowserServer(scope, deps) {
  if (!scope || typeof scope.postMessage !== 'function') throw new TypeError('bindBrowserServer needs a worker scope with postMessage')
  const host = createBrowserServer({ ...deps, post: (message, transfer) => scope.postMessage(message, transfer) })
  scope.onmessage = (event) => host.handle(event.data)
  return host
}

export function createBrowserServerClient({ worker, config = {}, apps = {}, setTimer = null, clearTimer = null, initTimeoutMs = 10000 } = {}) {
  if (!worker || typeof worker.postMessage !== 'function') throw new TypeError('createBrowserServerClient needs a worker with postMessage')
  let open = false
  let closed = false
  let readyInfo = null
  let settleReady = null
  let timeout = null
  const reloads = []
  const debug = []
  const transport = {
    type: 'worker',
    onMessage: null,
    onClose: null,
    get isOpen() { return open },
    send(bytes) {
      if (!open) return false
      const copy = bytes.slice()
      worker.postMessage({ type: 'CLIENT_MESSAGE', data: copy.buffer }, [copy.buffer])
      return true
    },
    close() {
      if (closed) return
      closed = true
      open = false
      worker.postMessage({ type: 'CLIENT_DISCONNECT' })
      if (typeof transport.onClose === 'function') transport.onClose()
    },
  }
  const ready = new Promise((resolve, reject) => { settleReady = { resolve, reject } })
  const finishInit = () => {
    if (timeout !== null && clearTimer !== null) clearTimer(timeout)
    timeout = null
  }
  worker.onmessage = (event) => {
    const message = event.data
    if (!message || typeof message.type !== 'string') return
    if (message.type === 'SEND_CLIENT') {
      if (typeof transport.onMessage === 'function') transport.onMessage(new Uint8Array(message.data))
    } else if (message.type === 'WORKER_READY') {
      open = true
      readyInfo = message
      finishInit()
      settleReady.resolve(message)
    } else if (message.type === 'INIT_ERROR') {
      finishInit()
      const error = new Error(message.message)
      error.code = message.code
      settleReady.reject(error)
    } else if (message.type === 'HMR_RESULT') {
      const waiter = reloads.shift()
      if (waiter) waiter(message)
    } else if (message.type === 'DEBUG_COLLIDER_RESULT') {
      const waiter = debug.shift()
      if (waiter) waiter(message)
    }
  }
  if (setTimer !== null) {
    timeout = setTimer(() => {
      const error = new Error('the browser server did not report ready in ' + initTimeoutMs + ' ms')
      error.code = INIT_TIMEOUT
      settleReady.reject(error)
    }, initTimeoutMs)
  }
  worker.postMessage({ type: 'INIT', config, apps })
  return {
    transport,
    ready,
    get info() { return readyInfo },
    reloadApp: (name, url) => new Promise((resolve) => {
      reloads.push(resolve)
      worker.postMessage({ type: 'HMR_APP', name, url })
    }),
    debugRays: (rays) => new Promise((resolve) => {
      debug.push(resolve)
      worker.postMessage({ type: 'DEBUG_COLLIDER_RAYS', rays })
    }),
    saveNow: () => worker.postMessage({ type: 'SAVE_NOW' }),
  }
}
