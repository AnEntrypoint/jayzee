import { TransformRingWriter } from '../../../src/transport/transformRing.js'

export async function boot(config, { transport, post }) {
  if (config.fail) throw new Error('boot refused: ' + config.fail)
  let writer = null
  const seen = []
  const peerLinks = new Map()
  return {
    peerSession: { start() { seen.push('peer-session-started') } },
    onClientConnect(link) {
      if (link.type === 'peer') peerLinks.set(link.peerId, link)
      seen.push(link.type === 'peer' ? 'peer-linked:' + link.peerId : 'client-connected')
    },
    setTransformRing(ring) { writer = new TransformRingWriter(ring.sab, ring.capacity) },
    onClientMessage(message) {
      const bytes = new Uint8Array(message.data)
      const reply = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i++) reply[i] = bytes[bytes.length - 1 - i]
      const buffer = reply.buffer
      const sent = transport.send(reply, message.mt)
      post({ type: 'TEST_NOTE', sent, detachedAfterSend: buffer.byteLength === 0, seen: [...seen] })
    },
    onClientDisconnect() { seen.push('client-disconnected') },
    onPeerConnect(message) { seen.push('peer-connect:' + message.peerId) },
    onPeerFrame(message) {
      writer.tryAssign(message.playerId)
      writer.write(message.playerId, message.position, [0, 0, 0, 1], [0, 0, 0])
      post({ type: 'TEST_NOTE', wrote: message.playerId })
    },
    onPeerLeft(message) { seen.push('peer-left:' + message.peerId) },
    onPeerMessage(message) {
      if (message.fail) throw new Error('peer message handler fails on purpose')
      const link = peerLinks.get(message.peerId)
      const sent = link.send(Uint8Array.from([9, 8, 7]), 3)
      post({ type: 'TEST_NOTE', peerSent: sent, peerReady: link.ready })
    },
    onPeerDisconnect(message) { post({ type: 'TEST_NOTE', seen: [...seen], after: 'PEER_DISCONNECT:' + message.peerId }) },
    hmrApp(message) {
      if (message.name === 'bad') throw new Error('app bad does not compile')
      return { reloaded: message.name }
    },
    hmrTickHandler() { return { reloaded: 'tick-handler' } },
    saveNow() { post({ type: 'TEST_NOTE', saved: true }) },
    debugColliderQuery(message) { return { hits: message.points.length } },
    debugColliderRays(message) { return { rays: message.rays.length } },
  }
}
