import { DesyncDetector } from '../anticheat/DesyncDetector.js'
import { isInChecksumHorizon } from './checksumHorizon.js'
import { CONSENSUS_CTRL_PREFIX, controlFrameHandlers, countOrder, countReject, createFrameClock, dispatchControlFrame, encodeControlFrame } from '../control-frame-pure/controlFrame.js'
import { clearUnejectedRuns, createPeerTracks, ejectionDue, ejectionEvidence, recordOffenders } from './desyncLedger.js'

export const DEFAULT_CONSECUTIVE_DESYNCS_REQUIRED = 3
const DESYNC_LOG_LIMIT = 16

const encodeChecksumMessage = (tick, pubkey, checksum) => encodeControlFrame(CONSENSUS_CTRL_PREFIX, { type: 'checksum', tick, pubkey, checksum })

export class ConsensusVoter {
  constructor({
    bridge,
    checksumOf,
    localPeerId,
    expectedPeerIds,
    hostPeerId = null,
    checksumIntervalTicks = 30,
    consecutiveDesyncsRequired = DEFAULT_CONSECUTIVE_DESYNCS_REQUIRED,
    onCheatingHost = null,
    onCheatingPeer = null,
    onEjectionReady = null,
  } = {}) {
    if (!bridge?.data) throw new Error('[ConsensusVoter] bridge (wireweave bridge or WorkerBridgeProxy) is required')
    if (typeof checksumOf !== 'function') throw new Error('[ConsensusVoter] checksumOf(tick) is required')
    if (!localPeerId) throw new Error('[ConsensusVoter] localPeerId is required')
    if (!Array.isArray(expectedPeerIds) || expectedPeerIds.length < 2) {
      throw new Error('[ConsensusVoter] expectedPeerIds must be an array of at least 2 peer pubkeys')
    }
    if (!Number.isSafeInteger(consecutiveDesyncsRequired) || consecutiveDesyncsRequired < 1) {
      throw new Error('[ConsensusVoter] consecutiveDesyncsRequired must be a whole number of at least 1, got ' + String(consecutiveDesyncsRequired))
    }

    this.bridge = bridge
    this.checksumOf = checksumOf
    this.localPeerId = localPeerId
    this.hostPeerId = hostPeerId
    this.consecutiveDesyncsRequired = consecutiveDesyncsRequired
    this.onCheatingHost = onCheatingHost
    this.onCheatingPeer = onCheatingPeer
    this.onEjectionReady = onEjectionReady
    this.desyncLog = []

    this._detector = new DesyncDetector({
      checksumIntervalTicks,
      expectedPeerIds,
      onDesync: (tick, result) => this._onDesync(tick, result),
      onVerified: (tick, checksum) => this._onVerified(tick, checksum),
    })

    this._peerDesync = createPeerTracks(expectedPeerIds)

    this._clock = createFrameClock()
    this._arms = controlFrameHandlers(CONSENSUS_CTRL_PREFIX, {
      checksum: (frame, from) => this._ingestRemoteChecksum(frame.tick, from, frame.checksum),
    })

    this._onData = ({ detail }) => {
      const dispatched = dispatchControlFrame(CONSENSUS_CTRL_PREFIX, this._arms, detail?.data, countReject(this.stats), {
        from: detail?.peerPubkey,
        selfId: this.localPeerId,
        clock: this._clock,
        tickOf: (frame) => frame.tick,
        senderOf: (frame) => frame.pubkey,
        onOrder: countOrder(this.stats),
      })
      if (!dispatched) return
      if (dispatched.order === 'stale-frame') this.stats.staleChecksums = (this.stats.staleChecksums ?? 0) + 1
      dispatched.apply(dispatched.frame, dispatched.from)
    }
    this.bridge.data.addEventListener('data', this._onData)

    this.stats = { checksumsSent: 0, checksumsReceived: 0, checksumsIgnored: 0, staleChecksums: 0, unknownKind: 0, verified: 0, desyncsDetected: 0, unattributedDesyncs: 0, firstDesyncTick: null, ejectionsFired: 0, rejects: {} }
  }

  tick(tick) {
    this._localTick = tick
    if (!this._detector.isChecksumTick(tick)) return
    const checksum = this.checksumOf(tick)
    this._detector.reportChecksum(tick, this.localPeerId, checksum)
    this.stats.checksumsSent++
    this.bridge.data.broadcast(encodeChecksumMessage(tick, this.localPeerId, checksum))
  }

  removePeer(peerId) {
    const track = this._peerDesync.get(peerId)
    if (track) track.ejected = true
    this._detector.removePeer(peerId)
  }

  _withinChecksumHorizon(tick) {
    return this._detector.isChecksumTick(tick) && isInChecksumHorizon(tick, this._localTick, this._detector.checksumIntervalTicks, this._detector._maxPendingRows)
  }

  _ingestRemoteChecksum(tick, pubkey, checksum) {
    if (!this._detector.expects(pubkey) || !this._withinChecksumHorizon(tick)) { this.stats.checksumsIgnored++; return }
    this._detector.reportChecksum(tick, pubkey, checksum)
    this.stats.checksumsReceived++
  }

  _onDesync(tick, result) {
    this.stats.desyncsDetected++
    if (this.stats.firstDesyncTick == null) this.stats.firstDesyncTick = tick
    if (this.desyncLog.length < DESYNC_LOG_LIMIT) this.desyncLog.push({ tick, reports: Object.fromEntries(result.reports), offenders: [...result.offenders] })
    if (!result.strictMajority) { this.stats.unattributedDesyncs++; return }

    recordOffenders(this._peerDesync, result.offenders, tick, this.consecutiveDesyncsRequired)

    for (const [pk, track] of this._peerDesync) {
      if (!ejectionDue(track, pk, this.localPeerId, this.consecutiveDesyncsRequired)) continue
      track.ejected = true
      this.stats.ejectionsFired++
      const evidence = ejectionEvidence(track, pk, tick)
      if (this.onEjectionReady) this.onEjectionReady(pk, { ...evidence, isHost: pk === this.hostPeerId })
      if (pk === this.hostPeerId && this.onCheatingHost) {
        this.onCheatingHost(pk, evidence)
      } else if (pk !== this.hostPeerId && this.onCheatingPeer) {
        this.onCheatingPeer(pk, evidence)
      }
    }
  }

  _onVerified() {
    this.stats.verified++
    clearUnejectedRuns(this._peerDesync)
  }

  getStats() {
    const peerState = {}
    for (const [pk, track] of this._peerDesync) {
      peerState[pk] = {
        consecutiveCount: track.consecutiveCount,
        evidenceTicks: [...track.evidenceTicks],
        ejected: track.ejected,
      }
    }
    return {
      ...this.stats,
      desyncLog: [...this.desyncLog],
      peers: peerState,
      pendingChecksumRows: this._detector.pendingCount,
    }
  }

  destroy() {
    this.bridge.data.removeEventListener('data', this._onData)
  }
}
