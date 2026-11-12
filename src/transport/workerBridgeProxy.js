export const BRIDGE_BROADCAST = 'PEER_BROADCAST'
export const BRIDGE_SEND = 'PEER_SEND_FRAME'
export const BRIDGE_REFUSAL = Object.freeze({
  PEER_ID: 'peer-id-not-string',
  SELF: 'peer-is-self',
  UNKNOWN_PEER: 'frame-from-unknown-peer',
  FRAME: 'frame-not-text-or-bytes',
  CLOSED: 'bridge-closed',
})

const isPeerId = (value) => typeof value === 'string' && value.length > 0
const isFrame = (value) => typeof value === 'string' || value instanceof Uint8Array || value instanceof ArrayBuffer

export class WorkerBridgeProxy {
  constructor({ post, pubkey }) {
    if (typeof post !== 'function') throw new TypeError('WorkerBridgeProxy reaches the bridge on the main thread only through post; got ' + typeof post)
    if (!isPeerId(pubkey)) throw new TypeError('WorkerBridgeProxy needs the local pubkey as a non-empty string')
    const proxy = this
    const peers = new Map()
    const openChannel = Object.freeze({ dc: Object.freeze({ readyState: 'open' }) })
    this.pubkey = pubkey
    this.closed = false
    this.stats = { broadcasts: 0, sends: 0, framesIn: 0, opened: 0, left: 0, refused: 0 }
    this.refusals = new Map()
    this.lastRefusal = null
    this._post = post
    this._openChannel = openChannel
    this.data = Object.assign(new EventTarget(), {
      peers,
      broadcast(frame) {
        if (proxy.closed) { proxy._refuse(BRIDGE_REFUSAL.CLOSED); return 0 }
        if (!isFrame(frame)) { proxy._refuse(BRIDGE_REFUSAL.FRAME); return 0 }
        proxy.stats.broadcasts++
        post({ type: BRIDGE_BROADCAST, data: frame })
        return peers.size
      },
      send(peerId, frame) {
        if (proxy.closed) return proxy._refuse(BRIDGE_REFUSAL.CLOSED)
        if (!peers.has(peerId)) return proxy._refuse(BRIDGE_REFUSAL.UNKNOWN_PEER)
        if (!isFrame(frame)) return proxy._refuse(BRIDGE_REFUSAL.FRAME)
        proxy.stats.sends++
        post({ type: BRIDGE_SEND, peerId, data: frame })
        return true
      },
    })
  }

  _refuse(reason) {
    this.stats.refused++
    this.refusals.set(reason, (this.refusals.get(reason) || 0) + 1)
    this.lastRefusal = reason
    return false
  }

  _emit(name, detail) {
    this.data.dispatchEvent(new CustomEvent(name, { detail }))
  }

  onPeerConnect(message) {
    const peerId = message?.peerId
    if (this.closed) return this._refuse(BRIDGE_REFUSAL.CLOSED)
    if (!isPeerId(peerId)) return this._refuse(BRIDGE_REFUSAL.PEER_ID)
    if (peerId === this.pubkey) return this._refuse(BRIDGE_REFUSAL.SELF)
    if (this.data.peers.has(peerId)) return true
    this.data.peers.set(peerId, this._openChannel)
    this.stats.opened++
    this._emit('peer-open', { peerPubkey: peerId })
    return true
  }

  onPeerFrame(message) {
    const peerId = message?.peerId
    if (this.closed) return this._refuse(BRIDGE_REFUSAL.CLOSED)
    if (!isPeerId(peerId)) return this._refuse(BRIDGE_REFUSAL.PEER_ID)
    if (!this.data.peers.has(peerId)) return this._refuse(BRIDGE_REFUSAL.UNKNOWN_PEER)
    if (!isFrame(message.data)) return this._refuse(BRIDGE_REFUSAL.FRAME)
    this.stats.framesIn++
    this._emit('data', { data: message.data, peerPubkey: peerId })
    return true
  }

  onPeerLeft(message) {
    const peerId = message?.peerId
    if (!isPeerId(peerId)) return this._refuse(BRIDGE_REFUSAL.PEER_ID)
    if (!this.data.peers.delete(peerId)) return false
    this.stats.left++
    this._emit('peer-close', { peerPubkey: peerId })
    return true
  }

  handlers() {
    return {
      PEER_CONNECT: (message) => this.onPeerConnect(message),
      PEER_FRAME: (message) => this.onPeerFrame(message),
      PEER_LEFT: (message) => this.onPeerLeft(message),
    }
  }

  close() {
    if (this.closed) return false
    for (const peerId of [...this.data.peers.keys()]) this.onPeerLeft({ peerId })
    this.closed = true
    return true
  }
}
