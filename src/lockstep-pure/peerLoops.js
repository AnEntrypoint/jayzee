import { wireCheatEjection } from '../anticheat/CheatEjection.js'
import { ConsensusVoter } from '../consensus-pure/ConsensusVoter.js'
import { buildRollbackPeerLoop } from '../rollback-pure/peerSimRuntime.js'
import { createLockstepGameLoop } from './lockstepGameLoop.js'
import { LockstepInputTransport } from './lockstepInputTransport.js'

export function buildLockstepPeerLoop({ bridge, tickSystem, roster, localPeerId, simulate, getLocalInput, liveChecksum, options, now }) {
  const transport = new LockstepInputTransport({ bridge })
  const voter = new ConsensusVoter({ bridge, checksumOf: liveChecksum, localPeerId, expectedPeerIds: roster, checksumIntervalTicks: options.checksumIntervalTicks })
  const loop = createLockstepGameLoop({ tickSystem, transport, roster, localPeerId, simulate: (t, dt, byPeer) => simulate(t, dt, byPeer, false), getLocalInput, voter, options, now })
  wireCheatEjection({ voter, transport: loop })
  return { loop, transport, voter }
}

export const PEER_LOOP_FACTORIES = Object.freeze({ lockstep: buildLockstepPeerLoop, rollback: buildRollbackPeerLoop })

export const PEER_SIMULATED_PROFILES = new Set(Object.keys(PEER_LOOP_FACTORIES))
