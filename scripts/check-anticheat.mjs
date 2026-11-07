import { gate, finish } from './lib/gate.mjs'
import { wireCheatEjection, DesyncDetector, clearInputBucket, enforceMovementEnvelope, envelopeSpeedCap, isInputRateLimited, sanitizeInputPayload, clearOutlierWindow, recordHit, checksumBodies } from '../src/anticheat/index.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const collectingLog = () => {
  const records = []
  return {
    records,
    record(type, data, meta) {
      records.push({ type, data, meta })
    },
  }
}

const drainBurst = (clientId, nowMs, attempts) => Array.from({ length: attempts }, () => isInputRateLimited(clientId, nowMs))

gate('rate limit admits exactly the 120 burst tokens and refuses the next input', () => {
  const client = 'burst-client'
  clearInputBucket(client)
  const verdicts = drainBurst(client, 1_000_000, 121)
  const admitted = verdicts.filter(refused => !refused).length
  assert(admitted === 120, `admitted ${admitted} inputs in one instant, expected 120`)
  assert(verdicts[120] === true, 'the 121st input in the same instant was not refused')
  clearInputBucket(client)
})

gate('rate limit refills 90 tokens per second and never past the capacity', () => {
  const client = 'refill-client'
  clearInputBucket(client)
  drainBurst(client, 2_000_000, 120)
  const oneSecondLater = drainBurst(client, 2_001_000, 91)
  assert(oneSecondLater.filter(refused => !refused).length === 90, 'one second of refill did not admit exactly 90 inputs')
  assert(oneSecondLater[90] === true, 'the 91st input after one second of refill was not refused')
  clearInputBucket(client)
  drainBurst(client, 3_000_000, 120)
  const tenSecondsLater = drainBurst(client, 3_010_000, 121)
  assert(tenSecondsLater.filter(refused => !refused).length === 120, 'refill exceeded the 120 capacity after ten seconds')
  assert(tenSecondsLater[120] === true, 'the input past capacity after a long idle was not refused')
  clearInputBucket(client)
})

gate('rate limit refuses a call without an injected time', () => {
  let threw = false
  try {
    isInputRateLimited('no-clock-client')
  } catch {
    threw = true
  }
  assert(threw, 'a call without nowMs was accepted')
})

gate('envelope clamp limits a fast velocity to its speed cap', () => {
  const movement = { maxSpeed: 10 }
  assert(envelopeSpeedCap(movement) === 30, `cap ${envelopeSpeedCap(movement)} for maxSpeed 10, expected 30`)
  assert(envelopeSpeedCap({}) === 60, 'an empty movement did not fall back to the 20 minimum base times the 3 headroom')
  const state = { velocity: [300, 0, 0] }
  assert(enforceMovementEnvelope(state, movement) === true, 'a 300 m/s velocity was not clamped')
  const speed = Math.hypot(...state.velocity)
  assert(Math.abs(speed - 30) < 1e-9, `clamped speed ${speed}, expected 30`)
})

gate('envelope clamp leaves a velocity under the cap unchanged', () => {
  const state = { velocity: [10, 0, 0] }
  assert(enforceMovementEnvelope(state, { maxSpeed: 10 }) === false, 'a 10 m/s velocity under a 30 m/s cap was clamped')
  assert(state.velocity[0] === 10, 'a velocity under the cap was modified')
})

gate('input sanitizer zeroes non-finite and out-of-range angles and keeps valid ones', () => {
  const bad = sanitizeInputPayload({ yaw: NaN, pitch: 2e6, analogForward: 1, analogRight: 0.5 })
  assert(bad.yaw === 0 && bad.pitch === 0, 'a NaN yaw or an out-of-range pitch was not zeroed')
  assert(bad.analogForward === 1 && bad.analogRight === 0.5, 'valid analog values were modified')
})

gate('outlier flags a headshot ratio of 0.8 and does not flag 0.7', () => {
  clearOutlierWindow('ratio-high')
  clearOutlierWindow('ratio-low')
  const high = collectingLog()
  for (let i = 0; i < 10; i++) recordHit(high, 'ratio-high', { headshot: i < 8, timestampMs: 10_000 + i * 1000 })
  assert(high.records.length === 1, `ratio 0.8 raised ${high.records.length} flags, expected 1`)
  assert(high.records[0].data.kind === 'high_headshot_ratio', `kind ${high.records[0].data.kind}`)

  const low = collectingLog()
  for (let i = 0; i < 10; i++) recordHit(low, 'ratio-low', { headshot: i < 7, timestampMs: 10_000 + i * 1000 })
  assert(low.records.length === 0, `ratio 0.7 raised ${low.records.length} flags, expected 0`)
  clearOutlierWindow('ratio-high')
  clearOutlierWindow('ratio-low')
})

gate('outlier flags four headshots inside 100 ms and does not flag three', () => {
  clearOutlierWindow('streak-fast')
  clearOutlierWindow('streak-slow')
  const fast = collectingLog()
  for (let i = 0; i < 4; i++) recordHit(fast, 'streak-fast', { headshot: true, timestampMs: 10_000 + i * 50 })
  assert(fast.records.length === 1, `four fast headshots raised ${fast.records.length} flags, expected 1`)
  assert(fast.records[0].data.kind === 'suspiciously_fast_headshot_streak', `kind ${fast.records[0].data.kind}`)

  const slow = collectingLog()
  for (let i = 0; i < 3; i++) recordHit(slow, 'streak-slow', { headshot: true, timestampMs: 10_000 + i * 50 })
  assert(slow.records.length === 0, `three fast headshots raised ${slow.records.length} flags, expected 0`)
  clearOutlierWindow('streak-fast')
  clearOutlierWindow('streak-slow')
})

gate('outlier detector refuses a hit without an injected timestamp', () => {
  let threw = false
  try {
    recordHit(collectingLog(), 'no-clock-shooter', { headshot: true })
  } catch {
    threw = true
  }
  assert(threw, 'a hit without timestampMs was accepted')
})

const threePeers = ['alice', 'bob', 'carol']

gate('desync detector verifies matching checksums and flags none', () => {
  const detector = new DesyncDetector({ expectedPeerIds: threePeers })
  assert(detector.reportChecksum(30, 'alice', 7) === null, 'the first report of a row resolved early')
  assert(detector.reportChecksum(30, 'bob', 7) === null, 'the second report of a row resolved early')
  const result = detector.reportChecksum(30, 'carol', 7)
  assert(result && result.status === 'verified' && result.checksum === 7, `matching checksums gave ${JSON.stringify(result)}`)
})

gate('desync detector flags differing checksums and names the offender', () => {
  const detector = new DesyncDetector({ expectedPeerIds: threePeers })
  detector.reportChecksum(30, 'alice', 7)
  detector.reportChecksum(30, 'bob', 7)
  const result = detector.reportChecksum(30, 'carol', 8)
  assert(result && result.status === 'desync', 'differing checksums were not flagged as a desync')
  assert(result.offenders.length === 1 && result.offenders[0] === 'carol', `offenders ${JSON.stringify(result.offenders)}`)
})

gate('consensus majority picks the checksum most peers report', () => {
  const detector = new DesyncDetector({ expectedPeerIds: threePeers })
  detector.reportChecksum(60, 'alice', 5)
  detector.reportChecksum(60, 'bob', 9)
  const result = detector.reportChecksum(60, 'carol', 9)
  assert(result.majorityChecksum === 9 && result.strictMajority === true, `majority ${result.majorityChecksum}`)
  assert(JSON.stringify(result.offenders) === JSON.stringify(['alice']), `offenders ${JSON.stringify(result.offenders)}`)
})

gate('a two-peer tie has no majority and blames nobody', () => {
  const detector = new DesyncDetector({ expectedPeerIds: ['alice', 'bob'] })
  detector.reportChecksum(30, 'alice', 1)
  const result = detector.reportChecksum(30, 'bob', 2)
  assert(result.status === 'desync' && result.strictMajority === false, 'a 1 to 1 split claimed a strict majority')
  assert(result.majorityChecksum === null && result.offenders.length === 0, 'a 1 to 1 split named an offender')
})

const bodiesWithVelocityY = (vy) => new Map([
  [1, { position: [1, 2, 3], rotation: [0, 0, 0, 1], velocity: [0, vy, 0], angularVelocity: [0, 0, 0] }],
  [2, { position: [4, 5, 6], rotation: [0, 0, 0, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] }],
])

gate('lockstep checksum is identical for identical snapshots', () => {
  assert(checksumBodies(30, bodiesWithVelocityY(1)) === checksumBodies(30, bodiesWithVelocityY(1)), 'identical snapshots gave different checksums')
})

gate('lockstep checksum changes when one velocity value changes', () => {
  const before = checksumBodies(30, bodiesWithVelocityY(1))
  const after = checksumBodies(30, bodiesWithVelocityY(1.0000001))
  assert(before !== after, 'one changed velocity value left the checksum unchanged')
})

gate('desync detector fires when one lockstep checksum input changes', () => {
  const detector = new DesyncDetector({ expectedPeerIds: threePeers })
  detector.reportChecksum(30, 'alice', checksumBodies(30, bodiesWithVelocityY(1)))
  detector.reportChecksum(30, 'bob', checksumBodies(30, bodiesWithVelocityY(1)))
  const clean = detector.reportChecksum(30, 'carol', checksumBodies(30, bodiesWithVelocityY(1)))
  assert(clean.status === 'verified', 'the unchanged control row was not verified')
  detector.reportChecksum(60, 'alice', checksumBodies(60, bodiesWithVelocityY(1)))
  detector.reportChecksum(60, 'bob', checksumBodies(60, bodiesWithVelocityY(1.5)))
  const changed = detector.reportChecksum(60, 'carol', checksumBodies(60, bodiesWithVelocityY(1)))
  assert(changed.status === 'desync', 'a changed velocity did not make the detector fire')
  assert(changed.offenders.length === 1 && changed.offenders[0] === 'bob', `offenders ${JSON.stringify(changed.offenders)}`)
})

const fakeVoter = () => ({ getStats: () => ({}), onCheatingPeer: null, onCheatingHost: null })

gate('cheat ejection drops a cheating peer and reports it as not host', () => {
  const voter = fakeVoter()
  const dropped = []
  const ejected = []
  wireCheatEjection({ voter, transport: { dropPeer: (pubkey, reason) => dropped.push([pubkey, reason]) }, onEjected: (pubkey, evidence) => ejected.push([pubkey, evidence]) })
  voter.onCheatingPeer('peer-1', { tick: 30 })
  assert(dropped.length === 1 && dropped[0][0] === 'peer-1' && dropped[0][1] === 'desync', `drops ${JSON.stringify(dropped)}`)
  assert(ejected.length === 1 && ejected[0][1].isHost === false, 'the ejected peer was not reported as a non-host')
})

gate('cheat ejection drops a cheating host and forces an election', () => {
  const voter = fakeVoter()
  const dropped = []
  let elections = 0
  const ejected = []
  wireCheatEjection({
    voter,
    transport: { dropPeer: (pubkey, reason) => dropped.push([pubkey, reason]) },
    hostMigration: { forceElection: () => { elections++ } },
    onEjected: (pubkey, evidence) => ejected.push([pubkey, evidence]),
  })
  voter.onCheatingHost('host-1', { tick: 60 })
  assert(dropped.length === 1 && dropped[0][0] === 'host-1', 'the cheating host was not dropped')
  assert(elections === 1, `forced ${elections} elections, expected 1`)
  assert(ejected.length === 1 && ejected[0][1].isHost === true, 'the ejected host was not reported as a host')
})

gate('cheat ejection refuses a voter without getStats and a transport without dropPeer', () => {
  let noVoter = false
  let noTransport = false
  try {
    wireCheatEjection({ voter: {}, transport: { dropPeer() {} } })
  } catch {
    noVoter = true
  }
  try {
    wireCheatEjection({ voter: fakeVoter(), transport: {} })
  } catch {
    noTransport = true
  }
  assert(noVoter && noTransport, 'a missing voter or transport was accepted')
})

gate('cheat ejection destroy detaches both hooks', () => {
  const voter = fakeVoter()
  const handle = wireCheatEjection({ voter, transport: { dropPeer() {} } })
  handle.destroy()
  assert(voter.onCheatingPeer === null && voter.onCheatingHost === null, 'destroy left a hook attached')
})

finish()
