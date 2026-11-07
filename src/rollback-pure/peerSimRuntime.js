import { createRollbackGameLoop } from './rollbackGameLoop.js'
import { createRollbackInputTransport } from './rollbackInputTransport.js'
import { createRollbackLoop } from './rollbackLoop.js'

export const STATE_RING_TICKS = 32
export const STATS_POST_INTERVAL_MS = 1000

export function startStatsPost({ getStats, post, schedule, cancel, every = STATS_POST_INTERVAL_MS }) {
  const handle = schedule(() => post({ type: 'PEER_STATS', stats: getStats() }), every)
  return () => cancel(handle)
}

export function buildRollbackPeerLoop({ link, tickSystem, roster, localPeerId, simulate, getLocalInput, checksumOf, observeRollback, capture, apply, stateRingTicks = STATE_RING_TICKS, options = {} }) {
  const openPeers = roster.filter((pubkey) => pubkey !== localPeerId)
  const transport = createRollbackInputTransport({ link, openPeers })
  const rollback = createRollbackLoop({ capture, apply, windowSize: stateRingTicks })
  const loop = createRollbackGameLoop({ tickSystem, transport, rollback, roster, localPeerId, simulate, getLocalInput, checksumOf, observeRollback, options })
  return { loop, transport, voter: null }
}
