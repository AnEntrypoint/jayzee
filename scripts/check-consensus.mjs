import { gate, finish } from './lib/gate.mjs'
import { ConsensusVoter, DEFAULT_CONSECUTIVE_DESYNCS_REQUIRED } from '../src/consensus-pure/ConsensusVoter.js'
import { CONSENSUS_CTRL_PREFIX, advanceFrameClock, controlFrameHandlers, countOrder, countReject, createFrameClock, dispatchControlFrame, encodeControlFrame, parseControlFrame } from '../src/control-frame-pure/controlFrame.js'
import { REMOTE_CHECKSUM_PAST_HORIZON_ROWS, isInChecksumHorizon } from '../src/consensus-pure/checksumHorizon.js'
import { clearUnejectedRuns, createPeerTracks, ejectionDue, ejectionEvidence, recordOffenders } from '../src/consensus-pure/desyncLedger.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const assertSame = (actual, expected, label) => {
  const got = JSON.stringify(actual)
  const want = JSON.stringify(expected)
  assert(got === want, `${label}: got ${got}, expected ${want}`)
}

const assertThrows = (fn, message) => {
  let threw = false
  try {
    fn()
  } catch {
    threw = true
  }
  assert(threw, message)
}

const wireFrame = (pubkey, tick, checksum) => 'wwconsensus:' + JSON.stringify({ type: 'checksum', tick, pubkey, checksum })

const fakeBridge = () => {
  const listeners = []
  const broadcasts = []
  return {
    broadcasts,
    data: {
      addEventListener: (type, listener) => {
        if (type === 'data') listeners.push(listener)
      },
      removeEventListener: (type, listener) => {
        const index = listeners.indexOf(listener)
        if (type === 'data' && index >= 0) listeners.splice(index, 1)
      },
      broadcast: (message) => broadcasts.push(message),
    },
    deliver: (peerPubkey, data) => {
      for (const listener of [...listeners]) listener({ detail: { data, peerPubkey } })
    },
  }
}

const voterEnv = ({ roster = ['me', 'b', 'c'], checksumOf = (tick) => 1000 + tick, host = null, required, interval = 30 } = {}) => {
  const bridge = fakeBridge()
  const calls = { peer: [], host: [], ready: [] }
  const voter = new ConsensusVoter({
    bridge,
    checksumOf,
    localPeerId: 'me',
    expectedPeerIds: roster,
    hostPeerId: host,
    checksumIntervalTicks: interval,
    consecutiveDesyncsRequired: required,
    onCheatingPeer: (pk, evidence) => calls.peer.push([pk, evidence]),
    onCheatingHost: (pk, evidence) => calls.host.push([pk, evidence]),
    onEjectionReady: (pk, evidence) => calls.ready.push([pk, evidence]),
  })
  return { voter, bridge, calls }
}

const round = (env, tick, reports) => {
  env.voter.tick(tick)
  for (const [pubkey, checksum] of Object.entries(reports)) env.bridge.deliver(pubkey, wireFrame(pubkey, tick, checksum))
}

const desyncB = (tick) => ({ b: 9999, c: 1000 + tick })
const agree = (tick) => ({ b: 1000 + tick, c: 1000 + tick })

gate('encodes a consensus checksum frame under the wwconsensus prefix', () => {
  const encoded = encodeControlFrame(CONSENSUS_CTRL_PREFIX, { type: 'checksum', tick: 30, pubkey: 'a', checksum: 7 })
  assert(encoded === 'wwconsensus:{"type":"checksum","tick":30,"pubkey":"a","checksum":7}', `encoded ${encoded}`)
  assertThrows(() => encodeControlFrame(CONSENSUS_CTRL_PREFIX, { type: 'input', tick: 30 }), 'an input frame was encoded under the consensus prefix')
  assertThrows(() => encodeControlFrame('wwlockstep:', { type: 'checksum' }), 'an unregistered prefix was accepted')
})

gate('parses a well-formed checksum frame back to its fields', () => {
  const parsed = parseControlFrame(CONSENSUS_CTRL_PREFIX, wireFrame('a', 30, 7))
  assertSame(parsed, { status: 'accepted', frame: { type: 'checksum', tick: 30, pubkey: 'a', checksum: 7 } }, 'parsed frame')
  assertSame(parseControlFrame(CONSENSUS_CTRL_PREFIX, 'wwlockstep:' + JSON.stringify({ type: 'checksum', tick: 30, pubkey: 'a', checksum: 7 })).status, 'foreign-prefix', 'a lockstep-prefixed frame')
})

gate('classifies each malformed consensus frame with its own status', () => {
  const statusOf = (data) => parseControlFrame(CONSENSUS_CTRL_PREFIX, data)
  assertSame(statusOf('other:{}').status, 'foreign-prefix', 'foreign prefix')
  assertSame(statusOf('wwconsensus:{"type":').status, 'malformed-payload', 'truncated JSON')
  assertSame(statusOf('wwconsensus:null').status, 'malformed-payload', 'null payload')
  assertSame(statusOf('wwconsensus:{"type":"drop"}'), { status: 'unknown-kind', kind: 'drop' }, 'unknown kind')
  assertSame(statusOf('wwconsensus:{"type":"checksum","tick":"30","pubkey":"a","checksum":7}'), { status: 'invalid-field', kind: 'checksum', field: 'tick' }, 'string tick')
  assertSame(statusOf('wwconsensus:{"type":"checksum","tick":null,"pubkey":"a","checksum":7}'), { status: 'invalid-field', kind: 'checksum', field: 'tick' }, 'null tick')
  assertSame(statusOf('wwconsensus:{"type":"checksum","tick":30,"checksum":7}'), { status: 'invalid-field', kind: 'checksum', field: 'pubkey' }, 'missing pubkey')
  assertSame(statusOf('wwconsensus:{"type":"checksum","tick":30,"pubkey":"a","checksum":1}').status, 'accepted', 'checksum 1 control')
})

gate('refuses a checksum of 0 because the contract tests truthiness, as spoint does', () => {
  assertSame(parseControlFrame(CONSENSUS_CTRL_PREFIX, wireFrame('a', 30, 0)), { status: 'invalid-field', kind: 'checksum', field: 'checksum' }, 'zero checksum')
  assertSame(parseControlFrame(CONSENSUS_CTRL_PREFIX, wireFrame('a', 30, 1)).status, 'accepted', 'nonzero checksum control')
})

gate('controlFrameHandlers requires one arm per kind and rejects arms for unknown kinds', () => {
  const arm = () => {}
  assert(controlFrameHandlers(CONSENSUS_CTRL_PREFIX, { checksum: arm }).get('checksum') === arm, 'the checksum arm was not kept')
  assertThrows(() => controlFrameHandlers(CONSENSUS_CTRL_PREFIX, {}), 'a missing checksum arm was accepted')
  assertThrows(() => controlFrameHandlers(CONSENSUS_CTRL_PREFIX, { checksum: arm, drop: arm }), 'an arm for an unknown kind was accepted')
  assertThrows(() => controlFrameHandlers('wwlockstep:', { input: arm }), 'an unregistered prefix was accepted')
})

gate('dispatchControlFrame refuses self-echo, unattributed and misattributed frames and counts each reject', () => {
  const stats = {}
  const onReject = countReject(stats)
  const arms = controlFrameHandlers(CONSENSUS_CTRL_PREFIX, { checksum: () => {} })
  const origin = (from) => ({ from, selfId: 'me', clock: createFrameClock(), tickOf: (frame) => frame.tick, senderOf: (frame) => frame.pubkey, onOrder: countOrder(stats) })
  const data = wireFrame('b', 30, 7)
  assert(dispatchControlFrame(CONSENSUS_CTRL_PREFIX, arms, wireFrame('me', 30, 7), onReject, origin('me')) === null, 'a self-echo was dispatched')
  assert(dispatchControlFrame(CONSENSUS_CTRL_PREFIX, arms, data, onReject, origin(undefined)) === null, 'an unattributed frame was dispatched')
  assert(dispatchControlFrame(CONSENSUS_CTRL_PREFIX, arms, data, onReject, origin('c')) === null, 'a frame claiming another sender was dispatched')
  assertSame(stats.rejects, { 'self-echo': 1, 'unattributed-sender': 1, 'misattributed-sender': 1 }, 'reject counts')
  const dispatched = dispatchControlFrame(CONSENSUS_CTRL_PREFIX, arms, data, onReject, origin('b'))
  assert(dispatched !== null && dispatched.from === 'b' && dispatched.order === 'in-order', 'the attributed frame was not dispatched in order')
  assertSame(stats.order, { 'in-order': 1 }, 'order counts')
})

gate('advanceFrameClock orders frames per sender and flags duplicates and stale ticks', () => {
  const clock = createFrameClock()
  const verdicts = [
    advanceFrameClock(clock, 'b', 30),
    advanceFrameClock(clock, 'b', 30),
    advanceFrameClock(clock, 'b', 60),
    advanceFrameClock(clock, 'b', 30),
    advanceFrameClock(clock, 'c', 30),
  ]
  assertSame(verdicts, ['in-order', 'duplicate-frame', 'in-order', 'stale-frame', 'in-order'], 'per-sender verdicts')
})

gate('isInChecksumHorizon accepts ticks 16 intervals behind through 47 intervals ahead of local', () => {
  assert(REMOTE_CHECKSUM_PAST_HORIZON_ROWS === 16, 'the past horizon is not 16 rows')
  assert(isInChecksumHorizon(1710, 300, 30, 64), 'the furthest accepted future tick was refused')
  assert(!isInChecksumHorizon(1740, 300, 30, 64), 'a tick one interval past the future limit was accepted')
  assert(isInChecksumHorizon(-150, 300, 30, 64), 'the oldest accepted past tick was refused')
  assert(!isInChecksumHorizon(-180, 300, 30, 64), 'a tick exactly 16 intervals behind was accepted')
})

gate('isInChecksumHorizon follows the pending-row bound and reads a missing local tick as zero', () => {
  assert(!isInChecksumHorizon(1710, 300, 30, 32), 'a 32-row pending bound still accepted the 64-row future limit')
  assert(isInChecksumHorizon(1410, undefined, 30, 64), 'a missing local tick did not read as zero')
  assert(!isInChecksumHorizon(1440, undefined, 30, 64), 'a missing local tick accepted a tick past the future limit')
})

gate('recordOffenders extends the run of each offender and clears the run of each peer that agreed', () => {
  const tracks = createPeerTracks(['a', 'b'])
  recordOffenders(tracks, ['b'], 30, 3)
  recordOffenders(tracks, ['b'], 60, 3)
  assertSame(Object.fromEntries(tracks).b, { consecutiveCount: 2, evidenceTicks: [30, 60], ejected: false }, 'offender run')
  assertSame(Object.fromEntries(tracks).a, { consecutiveCount: 0, evidenceTicks: [], ejected: false }, 'agreeing peer was counted')
  recordOffenders(tracks, [], 90, 3)
  assertSame(tracks.get('b').consecutiveCount, 0, 'an agreeing tick did not clear the run')
})

gate('recordOffenders trims evidence to the last required ticks only once it passes twice the requirement', () => {
  const tracks = createPeerTracks(['b'])
  for (const tick of [30, 60, 90, 120, 150, 180]) recordOffenders(tracks, ['b'], tick, 3)
  assertSame(tracks.get('b').evidenceTicks, [30, 60, 90, 120, 150, 180], 'trimmed at six ticks')
  recordOffenders(tracks, ['b'], 210, 3)
  assertSame(tracks.get('b').evidenceTicks, [150, 180, 210], 'not trimmed to the last three')
  assertSame(tracks.get('b').consecutiveCount, 7, 'the run stopped counting')
})

gate('ejectionDue fires for a remote peer at the requirement and never for the local or an ejected peer', () => {
  const track = (consecutiveCount, ejected = false) => ({ consecutiveCount, evidenceTicks: [], ejected })
  assert(ejectionDue(track(3), 'b', 'me', 3), 'a remote peer at the requirement was not due')
  assert(!ejectionDue(track(2), 'b', 'me', 3), 'a run one short of the requirement was due')
  assert(!ejectionDue(track(9), 'me', 'me', 3), 'the local peer was due')
  assert(!ejectionDue(track(9, true), 'b', 'me', 3), 'an already ejected peer was due again')
})

gate('ejectionEvidence copies the evidence ticks instead of sharing them', () => {
  const track = { consecutiveCount: 3, evidenceTicks: [30, 60, 90], ejected: false }
  const evidence = ejectionEvidence(track, 'b', 90)
  track.evidenceTicks.push(120)
  assertSame(evidence, { tick: 90, offenderPubkey: 'b', consecutiveCount: 3, evidenceTicks: [30, 60, 90] }, 'evidence')
})

gate('clearUnejectedRuns resets runs of peers that are not ejected and keeps ejected runs', () => {
  const tracks = new Map([
    ['a', { consecutiveCount: 2, evidenceTicks: [30, 60], ejected: false }],
    ['b', { consecutiveCount: 2, evidenceTicks: [30, 60], ejected: true }],
  ])
  clearUnejectedRuns(tracks)
  assertSame(Object.fromEntries(tracks), {
    a: { consecutiveCount: 0, evidenceTicks: [], ejected: false },
    b: { consecutiveCount: 2, evidenceTicks: [30, 60], ejected: true },
  }, 'runs after a verified tick')
})

gate('the ConsensusVoter constructor refuses a missing bridge, checksum source, local id or a roster under two peers', () => {
  const base = { bridge: fakeBridge(), checksumOf: () => 1, localPeerId: 'me', expectedPeerIds: ['me', 'b'] }
  assert(new ConsensusVoter(base) instanceof ConsensusVoter, 'a valid configuration was refused')
  assertThrows(() => new ConsensusVoter({ ...base, bridge: {} }), 'a bridge without data was accepted')
  assertThrows(() => new ConsensusVoter({ ...base, checksumOf: undefined }), 'a missing checksumOf was accepted')
  assertThrows(() => new ConsensusVoter({ ...base, localPeerId: '' }), 'an empty localPeerId was accepted')
  assertThrows(() => new ConsensusVoter({ ...base, expectedPeerIds: ['me'] }), 'a roster of one was accepted')
})

gate('tick broadcasts a checksum frame only on checksum ticks and counts each send', () => {
  const env = voterEnv()
  env.voter.tick(29)
  assertSame(env.bridge.broadcasts, [], 'a non-checksum tick broadcast')
  env.voter.tick(30)
  assertSame(env.bridge.broadcasts, ['wwconsensus:{"type":"checksum","tick":30,"pubkey":"me","checksum":1030}'], 'broadcast frame')
  assertSame(env.voter.getStats().checksumsSent, 1, 'sent count')
})

gate('remote checksums from expected peers are counted and from unknown peers are ignored', () => {
  const env = voterEnv()
  env.voter.tick(30)
  env.bridge.deliver('b', wireFrame('b', 30, 1030))
  env.bridge.deliver('x', wireFrame('x', 30, 1030))
  const stats = env.voter.getStats()
  assertSame([stats.checksumsReceived, stats.checksumsIgnored], [1, 1], 'received and ignored')
})

gate('self-echoed, malformed, misattributed and unknown-kind frames are rejected and counted, not applied', () => {
  const env = voterEnv()
  env.voter.tick(30)
  env.bridge.deliver('me', wireFrame('me', 30, 1030))
  env.bridge.deliver('b', 'wwconsensus:{"type":')
  env.bridge.deliver('b', wireFrame('c', 30, 1030))
  env.bridge.deliver('b', 'wwconsensus:{"type":"drop"}')
  const stats = env.voter.getStats()
  assertSame(stats.rejects, { 'self-echo': 1, 'malformed-payload': 1, 'misattributed-sender': 1, 'unknown-kind': 1 }, 'reject counts')
  assertSame(stats.unknownKind, 1, 'unknown kind count')
  assertSame(stats.checksumsReceived, 0, 'a rejected frame was applied')
  env.bridge.deliver('b', wireFrame('b', 30, 1030))
  assertSame(env.voter.getStats().checksumsReceived, 1, 'the valid frame control was not applied')
})

gate('a frame older than the sender last tick is counted as stale and still applied, a repeat as duplicate', () => {
  const env = voterEnv()
  env.voter.tick(60)
  env.bridge.deliver('b', wireFrame('b', 60, 1060))
  env.bridge.deliver('b', wireFrame('b', 30, 1030))
  let stats = env.voter.getStats()
  assertSame([stats.staleChecksums, stats.checksumsReceived], [1, 2], 'stale count and applied frames')
  env.bridge.deliver('b', wireFrame('b', 60, 1060))
  stats = env.voter.getStats()
  assertSame([stats.staleChecksums, stats.order['duplicate-frame']], [1, 1], 'a repeat was counted as stale or not as duplicate')
})

gate('three consecutive strict-majority desyncs eject the offender and no earlier', () => {
  assert(DEFAULT_CONSECUTIVE_DESYNCS_REQUIRED === 3, 'the default requirement is not 3')
  const env = voterEnv()
  round(env, 30, desyncB(30))
  round(env, 60, desyncB(60))
  assertSame(env.calls.peer, [], 'ejected after two desyncs')
  round(env, 90, desyncB(90))
  assertSame(env.calls.peer, [['b', { tick: 90, offenderPubkey: 'b', consecutiveCount: 3, evidenceTicks: [30, 60, 90] }]], 'ejection evidence')
  const stats = env.voter.getStats()
  assertSame([stats.desyncsDetected, stats.ejectionsFired, stats.firstDesyncTick, stats.unattributedDesyncs], [3, 1, 30, 0], 'desync stats')
  assertSame(env.calls.host, [], 'the host hook fired for a peer')
  const lowered = voterEnv({ required: 2 })
  round(lowered, 30, desyncB(30))
  round(lowered, 60, desyncB(60))
  assertSame(lowered.calls.peer.map(([pk]) => pk), ['b'], 'a requirement of two did not eject')
})

gate('a desync without a strict majority is counted as unattributed and ejects nobody', () => {
  const split = voterEnv({ roster: ['me', 'b'] })
  round(split, 30, { b: 9999 })
  round(split, 60, { b: 9999 })
  round(split, 90, { b: 9999 })
  const stats = split.voter.getStats()
  assertSame([stats.desyncsDetected, stats.unattributedDesyncs, stats.ejectionsFired], [3, 3, 0], 'split stats')
  assertSame(split.calls.peer, [], 'an unattributed split ejected a peer')
  const majority = voterEnv()
  round(majority, 30, desyncB(30))
  round(majority, 60, desyncB(60))
  round(majority, 90, desyncB(90))
  assertSame(majority.voter.getStats().ejectionsFired, 1, 'the same three rounds with a majority did not eject')
})

gate('the local peer is never ejected, though its own run is counted', () => {
  const env = voterEnv({ checksumOf: () => 9999 })
  for (const tick of [30, 60, 90]) round(env, tick, agree(tick))
  const stats = env.voter.getStats()
  assertSame([stats.ejectionsFired, env.calls.peer.length], [0, 0], 'the local peer was ejected')
  assertSame(stats.peers.me.consecutiveCount, 3, 'the local run was not counted')
  assertSame(stats.peers.b.consecutiveCount, 0, 'an agreeing remote peer was counted')
})

gate('a verified tick clears the run of a peer that is not ejected', () => {
  const env = voterEnv()
  round(env, 30, desyncB(30))
  round(env, 60, desyncB(60))
  round(env, 90, agree(90))
  round(env, 120, desyncB(120))
  assertSame(env.calls.peer, [], 'a run interrupted by a verified tick still ejected')
  assertSame(env.voter.getStats().peers.b.consecutiveCount, 1, 'the run after the verified tick')
  const control = voterEnv()
  round(control, 30, desyncB(30))
  round(control, 60, desyncB(60))
  round(control, 90, desyncB(90))
  assertSame(control.calls.peer.length, 1, 'three desyncs without a verified tick did not eject')
})

gate('an offending host goes to onCheatingHost and an offending peer to onCheatingPeer, with isHost set to match', () => {
  const host = voterEnv({ host: 'b' })
  for (const tick of [30, 60, 90]) round(host, tick, desyncB(tick))
  assertSame(host.calls.host.map(([pk]) => pk), ['b'], 'host hook')
  assertSame(host.calls.peer, [], 'the peer hook fired for the host')
  assertSame(host.calls.ready[0][1].isHost, true, 'isHost for the host')
  const peer = voterEnv({ host: 'c' })
  for (const tick of [30, 60, 90]) round(peer, tick, desyncB(tick))
  assertSame(peer.calls.peer.map(([pk]) => pk), ['b'], 'peer hook')
  assertSame(peer.calls.host, [], 'the host hook fired for a peer')
  assertSame(peer.calls.ready[0][1].isHost, false, 'isHost for the peer')
})

gate('desyncLog keeps 16 entries and getStats hands out copies', () => {
  const env = voterEnv()
  for (let k = 1; k <= 20; k++) round(env, 30 * k, { b: 1000 + 30 * k, c: 9999 })
  const stats = env.voter.getStats()
  assertSame([stats.desyncsDetected, stats.desyncLog.length], [20, 16], 'log bounds')
  stats.desyncLog.push({})
  stats.peers.c.ejected = false
  const again = env.voter.getStats()
  assertSame([again.desyncLog.length, again.peers.c.ejected], [16, true], 'the returned copies leaked into the voter')
})

gate('destroy detaches the data listener so later frames are ignored', () => {
  const env = voterEnv()
  env.voter.tick(30)
  env.bridge.deliver('b', wireFrame('b', 30, 1030))
  assertSame(env.voter.getStats().checksumsReceived, 1, 'a live voter did not count the frame')
  env.voter.destroy()
  env.bridge.deliver('c', wireFrame('c', 30, 1030))
  assertSame(env.voter.getStats().checksumsReceived, 1, 'a destroyed voter counted a frame')
})

gate('removePeer marks the peer ejected so later rounds never eject it', () => {
  const env = voterEnv()
  round(env, 30, desyncB(30))
  round(env, 60, desyncB(60))
  env.voter.removePeer('b')
  assertSame(env.voter.getStats().peers.b.ejected, true, 'the removed peer was not marked ejected')
  round(env, 90, desyncB(90))
  assertSame(env.calls.peer, [], 'a removed peer was ejected by a later round')
  assertSame(env.voter.getStats().ejectionsFired, 0, 'ejections fired after removal')
  const control = voterEnv()
  for (const tick of [30, 60, 90]) round(control, tick, desyncB(tick))
  assertSame(control.calls.peer.length, 1, 'without removePeer the same rounds did not eject')
})

gate('consecutiveDesyncsRequired defaults to 3 and accepts a whole number of at least 1', () => {
  assertSame(voterEnv().voter.consecutiveDesyncsRequired, DEFAULT_CONSECUTIVE_DESYNCS_REQUIRED, 'default value')
  assertSame(DEFAULT_CONSECUTIVE_DESYNCS_REQUIRED, 3, 'default constant')
  assertSame(voterEnv({ required: 1 }).voter.consecutiveDesyncsRequired, 1, 'one offence')
  assertSame(voterEnv({ required: 7 }).voter.consecutiveDesyncsRequired, 7, 'seven offences')
})

gate('consecutiveDesyncsRequired refuses 0, negatives, fractions, NaN, infinities, strings and null, where it used to eject or never eject silently', () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
    assertThrows(() => voterEnv({ required: bad }), 'consecutiveDesyncsRequired must be a whole number of at least 1, got ' + String(bad))
  }
})

finish()
