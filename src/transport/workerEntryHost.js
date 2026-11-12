import { createNetcodeDispatch } from '../worker-dispatch-pure/workerDispatch.js'
import { allocateRingBuffer } from './transformRing.js'
import { createPeerSender } from './workerMessages.js'
import { createWorkerTransport } from './workerTransport.js'

export const TRANSFORM_RING_CAPACITY = 64
export const PENDING_CAPACITY = 256
export const REASON_ALREADY_INITIALISED = 'worker-already-initialised'
export const REASON_PENDING_FULL = 'worker-pending-queue-full'

const messageOf = (error) => (error && error.message ? error.message : String(error))

export function createWorkerEntryHost({ post, boot, allocateRing = () => allocateRingBuffer(TRANSFORM_RING_CAPACITY), log = { error() {} } }) {
  if (typeof post !== 'function') throw new TypeError('createWorkerEntryHost needs a post function')
  if (typeof boot !== 'function') throw new TypeError('createWorkerEntryHost needs a boot function')
  const pending = new Array(PENDING_CAPACITY).fill(null)
  let pendingCount = 0
  let state = 'idle'
  let ctx = null
  let transport = null
  const stats = { received: 0, dispatched: 0, queued: 0, dropped: 0, unknown: 0, handlerErrors: 0 }

  const peers = new Map()

  const openPeer = (peerId) => {
    if (peerId === undefined || peerId === null || peers.has(peerId)) return null
    const send = createPeerSender(peerId, post)
    const closeListeners = []
    let ready = true
    const peer = {
      type: 'peer',
      peerId,
      get ready() {
        return ready
      },
      send: (data, mt) => (ready ? send(data, mt) : false),
      onClose(listener) {
        closeListeners.push(listener)
      },
      close() {
        if (!ready) return
        ready = false
        for (const listener of closeListeners) listener()
      },
    }
    peers.set(peerId, peer)
    return peer
  }

  const call = (name, message) => {
    const fn = ctx[name]
    if (typeof fn !== 'function') return undefined
    return fn.call(ctx, message)
  }

  const answer = async (type, message, name) => {
    try {
      const result = await call(name, message)
      post({ type, id: message.id, ok: true, result: result === undefined ? null : result })
    } catch (error) {
      stats.handlerErrors += 1
      post({ type, id: message.id, ok: false, error: messageOf(error) })
    }
  }

  const init = async (message) => {
    if (state !== 'idle') {
      post({ type: 'INIT_ERROR', error: 'worker is already initialised', reasonCode: REASON_ALREADY_INITIALISED })
      return
    }
    state = 'booting'
    try {
      transport = createWorkerTransport(post)
      ctx = await boot(message.config ?? {}, { transport, post })
      if (ctx === null || typeof ctx !== 'object') throw new TypeError('boot must return the worker context object')
      if (typeof ctx.onClientConnect === 'function') ctx.onClientConnect(transport)
      if (ctx.peerSession && typeof ctx.peerSession.start === 'function') ctx.peerSession.start()
      const ring = allocateRing()
      if (ring) {
        if (typeof ctx.setTransformRing === 'function') ctx.setTransformRing(ring)
        post({ type: 'TRANSFORM_RING', sab: ring.sab, capacity: ring.capacity })
      }
      state = 'ready'
      const count = pendingCount
      pendingCount = 0
      for (let i = 0; i < count; i++) {
        const queued = pending[i]
        pending[i] = null
        route(queued)
      }
    } catch (error) {
      state = 'failed'
      ctx = null
      for (let i = 0; i < pendingCount; i++) pending[i] = null
      pendingCount = 0
      log.error('[WorkerEntry] init failed: ' + messageOf(error))
      post({ type: 'INIT_ERROR', error: messageOf(error) })
    }
  }

  const guarded = (name) => (message) => {
    try {
      return call(name, message)
    } catch (error) {
      stats.handlerErrors += 1
      log.error('[WorkerEntry] ' + name + ' failed: ' + messageOf(error))
      return undefined
    }
  }

  const dispatch = createNetcodeDispatch({
    INIT: init,
    PEER_CONNECT: (message) => {
      const peer = openPeer(message.peerId)
      const result = guarded('onPeerConnect')(message)
      if (peer !== null && typeof ctx.onClientConnect === 'function') ctx.onClientConnect(peer)
      return result
    },
    PEER_FRAME: guarded('onPeerFrame'),
    PEER_LEFT: guarded('onPeerLeft'),
    HMR_APP: (message) => answer('HMR_RESULT', message, 'hmrApp'),
    HMR_TICK_HANDLER: (message) => answer('HMR_RESULT', message, 'hmrTickHandler'),
    SAVE_NOW: guarded('saveNow'),
    DEBUG_COLLIDER_QUERY: (message) => answer('DEBUG_COLLIDER_RESULT', message, 'debugColliderQuery'),
    DEBUG_COLLIDER_RAYS: (message) => answer('DEBUG_COLLIDER_RESULT', message, 'debugColliderRays'),
    CLIENT_MESSAGE: guarded('onClientMessage'),
    CLIENT_DISCONNECT: (message) => {
      const result = guarded('onClientDisconnect')(message)
      transport.close()
      return result
    },
    PEER_MESSAGE: guarded('onPeerMessage'),
    PEER_DISCONNECT: (message) => {
      const result = guarded('onPeerDisconnect')(message)
      const peer = peers.get(message.peerId)
      if (peer) {
        peers.delete(message.peerId)
        peer.close()
      }
      return result
    },
  })

  function route(message) {
    const outcome = dispatch(message)
    if (outcome.status === 'dispatched') stats.dispatched += 1
    else stats.unknown += 1
    return outcome
  }

  const handle = (message) => {
    stats.received += 1
    const type = message?.type
    if (type === 'INIT') return route(message)
    if (state === 'ready') return route(message)
    if (state === 'failed') {
      stats.dropped += 1
      return { status: 'dropped', opcode: type ?? null }
    }
    if (pendingCount === PENDING_CAPACITY) {
      stats.dropped += 1
      return { status: 'dropped', opcode: type ?? null, reasonCode: REASON_PENDING_FULL }
    }
    pending[pendingCount++] = message
    stats.queued += 1
    return { status: 'queued', opcode: type ?? null }
  }

  const attach = (port) => {
    if (typeof port?.on !== 'function') throw new TypeError('attach needs a port with on(message)')
    port.on('message', handle)
    post({ type: 'WORKER_READY' })
  }

  return {
    handle,
    attach,
    get state() {
      return state
    },
    get peerCount() {
      return peers.size
    },
    get pendingCount() {
      return pendingCount
    },
    getStats: () => ({ ...stats }),
  }
}
