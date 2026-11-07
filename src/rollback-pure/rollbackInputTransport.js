import { ROLLBACK_CTRL_PREFIX, controlFrameHandlers, countOrder, countReject, createFrameClock, dispatchControlFrame, encodeControlFrame } from '../control-frame-pure/controlFrame.js'

export const DEFAULT_STALL_TICKS = 180

const encodeCtrl = (frame) => encodeControlFrame(ROLLBACK_CTRL_PREFIX, frame)

export function createRollbackInputTransport({ link, openPeers = [], stallTicks = DEFAULT_STALL_TICKS, onRemoteInput = null, onRemoteChecksum = null } = {}) {
  if (typeof link?.broadcast !== 'function') throw new Error('RollbackInputTransport: link.broadcast required')
  const roster = new Set(openPeers)
  const dropped = new Set()
  const clock = createFrameClock()
  const stats = { sent: 0, received: 0, staleIgnored: 0, unknownKind: 0, checksumsSent: 0, checksumsReceived: 0, rejects: {} }

  function applyRemoteChecksum(frame, from) {
    stats.checksumsReceived++
    if (transport.onRemoteChecksum) transport.onRemoteChecksum(from, frame.tick, frame.checksum)
  }

  function applyRemoteInput(frame, from) {
    roster.add(from)
    dropped.delete(from)
    stats.received++
    if (transport.onRemoteInput) transport.onRemoteInput(from, frame.tick, frame.input, Number.isFinite(frame.adv) ? frame.adv : 0)
  }

  const arms = controlFrameHandlers(ROLLBACK_CTRL_PREFIX, {
    input: (frame, from) => applyRemoteInput(frame, from),
    checksum: (frame, from) => applyRemoteChecksum(frame, from),
  })

  const transport = {
    onRemoteInput,
    onRemoteChecksum,
    stats,
    get myPubkey() { return link.pubkey },

    submitLocalInput(tick, input, advantage = 0) {
      if (!transport.myPubkey) throw new Error('RollbackInputTransport: link not connected (no pubkey yet)')
      const n = link.broadcast(encodeCtrl({ type: 'input', tick, input, adv: advantage }))
      stats.sent++
      return n
    },

    submitChecksum(tick, checksum) {
      link.broadcast(encodeCtrl({ type: 'checksum', tick, checksum }))
      stats.checksumsSent++
    },

    handleFrame(detail) {
      const dispatched = dispatchControlFrame(ROLLBACK_CTRL_PREFIX, arms, detail?.data, countReject(stats), {
        from: detail?.peerPubkey,
        selfId: transport.myPubkey,
        clock,
        tickOf: (frame) => (frame.type === 'input' ? frame.tick : undefined),
        onOrder: countOrder(stats),
      })
      if (!dispatched) return
      dispatched.apply(dispatched.frame, dispatched.from)
    },

    peerOpened(pubkey) {
      if (pubkey) roster.add(pubkey)
    },

    peerClosed(pubkey) {
      transport.dropPeer(pubkey)
    },

    dropPeer(pubkey) {
      if (!pubkey) return
      dropped.add(pubkey)
    },

    getStalledPeers(nowTick) {
      const out = []
      for (const pk of roster) {
        if (dropped.has(pk)) continue
        const last = clock.get(pk)
        if (last === undefined || nowTick - last > stallTicks) out.push({ pubkey: pk, lastTick: last ?? -1 })
      }
      return out
    },

    getRoster() { return [...roster].filter(pk => !dropped.has(pk)) },

    getStats() {
      return { ...stats, staleIgnored: stats.order?.['stale-frame'] ?? 0, duplicateIgnored: stats.order?.['duplicate-frame'] ?? 0, roster: [...roster], dropped: [...dropped], lastTickByPeer: Object.fromEntries(clock) }
    },
  }

  return transport
}
