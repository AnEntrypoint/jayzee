import { gate, finish } from './lib/gate.mjs'
import * as client from '../src/client/index.js'
import { ClockSync, SnapshotTimeline, ReconciliationEngine, ReconnectManager, reconnectDelayMs, TransportMigrationTrigger, createChartEpochSync, createChartTransfer, createReexpressPass, encodeChart, decodeChart, reexpressMotionState } from '../src/client/index.js'
import { MSG } from '../src/protocol/messages.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const near = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon
const sameArray = (a, b) => a.length === b.length && a.every((value, index) => near(value, b[index]))
const flush = () => new Promise((resolve) => setImmediate(resolve))

const clock = new ClockSync()
clock.addSample(1000, 1521, 1041, 1520)
const clockAfterOne = { offset: clock.getOffset(), delay: clock.getOneWayDelay(), estimate: clock.getEstimatedServerTime(1041), count: clock.getSampleCount() }
clock.addSample(2000, 2601, 2111, 2600)
const clockAfterTwo = { offset: clock.getOffset(), count: clock.getSampleCount() }
const refusedNegativeRtt = clock.addSample(0, 100, 10, 0)
const refusedNonFinite = clock.addSample(NaN, 1521, 1041, 1520)
const refusedNaNReceive = clock.addSample(1000, 1521, 1041, NaN)
const clockAfterRefusals = clock.getSampleCount()

const basis = { east: [1, 0, 0], up: [0, 1, 0], north: [0, 0, 1] }
const chartAt = (chartEpoch, radius) => ({ ...basis, radius, offsetY: 0, anchorHeight: 0, chartEpoch })
const chart5 = chartAt(5, 10)
const chart6 = chartAt(6, 12)
const chart7 = chartAt(7, 14)
const chart8 = chartAt(8, 16)

const timeline = new SnapshotTimeline({ tickRate: 10 })
const playerAt = (tick) => ({ id: 1, position: [tick, 0, 0], velocity: [0, 0, 0], rotation: [0, 0, 0, 1], onGround: false, health: 100, crouch: 0, expr: 0, weapon: 0 })
const snapshotOf = (tick) => ({ tick, players: [playerAt(tick)] })
timeline.addSnapshot(snapshotOf(10), 1005)
timeline.addSnapshot(snapshotOf(11), 1105)
timeline.addSnapshot(snapshotOf(12), 1205)
const acceptedOutOfOrder = timeline.addSnapshot(snapshotOf(11), 1300)
const acceptedDuplicate = timeline.addSnapshot(snapshotOf(12), 1300)
const timelineAfterRefusals = timeline.getStats().buffered
const sampled = timeline.sample(1270)
const sampledPlayer = sampled.players[0]
const displayed = timeline.displayedTick(1270)

const engine = new ReconciliationEngine()
engine.absorb(0.5, 0, 0, true)
const smallError = [...engine.getErrorOffset()]
engine.absorb(4.5, 0, 0, true)
const groundedTeleported = [...engine.getErrorOffset()]

const airborne = new ReconciliationEngine()
airborne.absorb(6, 0, 0, false)
const airborneKept = [...airborne.getErrorOffset()]
const grounded = new ReconciliationEngine()
grounded.absorb(6, 0, 0, true)
const groundedSix = [...grounded.getErrorOffset()]

const decaying = new ReconciliationEngine()
decaying.absorb(0.5, 0, 0, true)
decaying.decay(1000)
const decayedOneStep = decaying.decay(1080)[0]
const longGap = new ReconciliationEngine()
longGap.absorb(0.5, 0, 0, true)
longGap.decay(1000)
const longGapResult = longGap.decay(11000)[0]

const transfer56 = createChartTransfer(chart5, chart6)
const transfer57 = createChartTransfer(chart5, chart7)
const motion = { position: [1, 2, 3], velocity: [0, 0, 0], onGround: false }
const motionPass = createReexpressPass(transfer56)
reexpressMotionState(motionPass, motion)
const motionOnce = [...motion.position]
reexpressMotionState(motionPass, motion)
const motionTwice = [...motion.position]

const roundTrip = decodeChart(encodeChart(chart5))
let rejectedShortWire = false
try {
  decodeChart({ e: 5, d: new Uint8Array(8) })
} catch {
  rejectedShortWire = true
}
let rejectedNonFiniteWire = false
try {
  decodeChart(encodeChart({ ...chart5, radius: NaN }))
} catch {
  rejectedNonFiniteWire = true
}

const holderCalls = { resync: 0, reset: 0, clear: 0 }
const reanchored = []
const resynced = []
const requests = []
const replayed = []
const reports = []
const epochClock = { value: 0 }
const holders = () => ({
  mirror: null,
  pred: { applyChartTransfer() {}, resyncToServer() { holderCalls.resync++ } },
  timeline: { applyChartTransfer() {}, reset() { holderCalls.reset++ } },
  snapProc: { applyChartTransfer() {}, clear() { holderCalls.clear++ } },
})
const epochSync = createChartEpochSync({
  callbacks: { onChartReanchor: (event) => reanchored.push(event.epoch), onChartResync: (event) => resynced.push(event.epoch) },
  holders,
  requestResync: (epoch) => requests.push(epoch),
  replayAck: (ack) => replayed.push(ack),
  now: () => epochClock.value,
  report: (message) => reports.push(message),
})
epochSync.adopt({ chartEpoch: 5, chart: encodeChart(chart5) })
const adoptedEpoch = epochSync.epoch
epochSync.onBroadcast({ from: encodeChart(chart5), to: encodeChart(chart6), ackSeq: 9 })
const transferredEpoch = epochSync.epoch
const transferredApplied = epochSync.stats.applied
const reanchoredAfterTransfer = [...reanchored]
epochSync.onBroadcast({ from: encodeChart(chart5), to: encodeChart(chart6), ackSeq: 9 })
const ignoredRepeat = epochSync.stats.ignoredBroadcasts
const appliedAfterRepeat = epochSync.stats.applied
const staleAdmitted = epochSync.admitSnapshot({ chartEpoch: 4 })
const currentAdmitted = epochSync.admitSnapshot({ chartEpoch: 6 })
const heldAdmitted = epochSync.admitSnapshot({ chartEpoch: 7 })
epochClock.value = 100
epochSync.admitSnapshot({ chartEpoch: 7 })
epochClock.value = 600
epochSync.admitSnapshot({ chartEpoch: 7 })
const requestsAfterHold = [...requests]
const futureAck = { chartEpoch: 7, position: [1, 2, 3] }
const deferredResult = epochSync.admitAck(futureAck)
const deferredCount = epochSync.stats.deferredAcks
epochSync.onBroadcast({ from: encodeChart(chart6), to: encodeChart(chart7), ackSeq: 10 })
const replayedCount = replayed.length
const replayedIsSame = replayed[0] === futureAck
const olderAck = { chartEpoch: 5, position: [1, 2, 3] }
const olderResult = epochSync.admitAck(olderAck)
const unknownAck = { chartEpoch: 2, position: [1, 2, 3] }
const unknownResult = epochSync.admitAck(unknownAck)
const reexpressedAcks = epochSync.stats.reexpressedAcks
const appliedBeforeHard = epochSync.stats.applied
epochSync.onBroadcast({ to: encodeChart(chart8), ackSeq: 11 })

const reconnectTimers = (() => {
  const pending = new Map()
  const delays = []
  let nextHandle = 1
  return {
    delays,
    pending,
    setTimer(callback, delayMs) {
      const handle = nextHandle++
      pending.set(handle, callback)
      delays.push(delayMs)
      return handle
    },
    clearTimer(handle) {
      pending.delete(handle)
    },
    fireAll() {
      for (const [handle, callback] of [...pending]) {
        pending.delete(handle)
        callback()
      }
    },
  }
})()
const reconnect = new ReconnectManager({ setTimer: reconnectTimers.setTimer, clearTimer: reconnectTimers.clearTimer })
reconnect.onConnected()
reconnect.setSessionToken('session-A')
const reconnectCalls = []
for (let attempt = 0; attempt < 5; attempt++) {
  reconnect.onDisconnected(() => reconnectCalls.push(reconnect.attempts))
  reconnectTimers.fireAll()
}
const stateAfterFailures = reconnect.state
reconnect.onConnected()
const attemptsAfterReconnect = reconnect.attempts
const stateAfterReconnect = reconnect.state
reconnect.onDisconnected(() => {})
const delayAfterReset = reconnectTimers.delays[reconnectTimers.delays.length - 1]
const delaysBeforeClear = reconnectTimers.delays.length
reconnect.clear()
reconnect.onDisconnected(() => {})
const destroyedStateAfterClear = reconnect.state
const delaysAfterClear = reconnectTimers.delays.length
const pendingAfterClear = reconnectTimers.pending.size

const sendTimers = (() => {
  const pending = new Map()
  let nextHandle = 1
  return { pending, setTimer(callback) { const handle = nextHandle++; pending.set(handle, callback); return handle }, clearTimer(handle) { pending.delete(handle) } }
})()
const sender = new ReconnectManager({ setTimer: sendTimers.setTimer, clearTimer: sendTimers.clearTimer })
sender.setSessionToken('session-B')
sender.onConnected()
const sentWhileConnected = []
const acceptedWhileConnected = sender.sendReconnectMessage({ isOpen: () => true, send: (message) => sentWhileConnected.push(message) })
sender.onDisconnected(() => {})
const sentWhileWaiting = []
const acceptedWhileWaiting = sender.sendReconnectMessage({ isOpen: () => true, send: (message) => sentWhileWaiting.push(message) })
const refusedWhileClosed = sender.sendReconnectMessage({ isOpen: () => false, send: (message) => sentWhileWaiting.push(message) })

const scriptedClient = ({ rtt = 0, open = true, outcomes = [] } = {}) => {
  const state = { rtt, open, migrateCalls: 0 }
  const client = {
    getRTT: () => state.rtt,
    isOpen: () => state.open,
    migrateTransport: async () => {
      state.migrateCalls++
      return outcomes.shift() ?? 'failed'
    },
  }
  return { client, state }
}
const scheduler = () => {
  const intervals = []
  const stopped = []
  return {
    intervals,
    stopped,
    startInterval(callback, periodMs) {
      const handle = { callback, periodMs }
      intervals.push(handle)
      return handle
    },
    stopInterval(handle) {
      stopped.push(handle)
    },
  }
}

const spikeClock = { value: 0 }
const spikeClient = scriptedClient({ rtt: 350, outcomes: ['failed', 'migrated'] })
const spikeSchedule = scheduler()
const spikeTrigger = new TransportMigrationTrigger(spikeClient.client, { now: () => spikeClock.value, startInterval: spikeSchedule.startInterval, stopInterval: spikeSchedule.stopInterval })
spikeTrigger.start()
const pollSpike = async (count) => {
  for (let i = 0; i < count; i++) {
    spikeSchedule.intervals[0].callback()
    await flush()
  }
}
await pollSpike(3)
const spikeFirstCalls = spikeClient.state.migrateCalls
const spikeFirstStats = spikeTrigger.getStats()
spikeClock.value = 500
await pollSpike(3)
const spikeCooldownCalls = spikeClient.state.migrateCalls
spikeClock.value = 1000
await pollSpike(3)
const spikeRetryCalls = spikeClient.state.migrateCalls
const spikeFinalStats = spikeTrigger.getStats()
spikeTrigger.stop()
const spikeStoppedHandles = spikeSchedule.stopped.length

const edgeClient = scriptedClient({ rtt: 300 })
const edgeSchedule = scheduler()
const edgeTrigger = new TransportMigrationTrigger(edgeClient.client, { now: () => 0, startInterval: edgeSchedule.startInterval, stopInterval: edgeSchedule.stopInterval })
edgeTrigger.start()
for (let i = 0; i < 3; i++) {
  edgeSchedule.intervals[0].callback()
  await flush()
}
const edgeCalls = edgeClient.state.migrateCalls

const ownedClient = scriptedClient({ rtt: 900, open: false })
const ownedSchedule = scheduler()
const ownedTrigger = new TransportMigrationTrigger(ownedClient.client, { now: () => 0, startInterval: ownedSchedule.startInterval, stopInterval: ownedSchedule.stopInterval })
ownedTrigger.start()
for (let i = 0; i < 3; i++) {
  ownedSchedule.intervals[0].callback()
  await flush()
}
const ownedCalls = ownedClient.state.migrateCalls

const connectionClient = scriptedClient({ outcomes: ['migrated'] })
const connectionListeners = []
const connection = {
  effectiveType: '4g',
  type: 'wifi',
  addEventListener(event, listener) { if (event === 'change') connectionListeners.push(listener) },
  removeEventListener(event, listener) { const index = connectionListeners.indexOf(listener); if (event === 'change' && index >= 0) connectionListeners.splice(index, 1) },
}
const connectionSchedule = scheduler()
const connectionTrigger = new TransportMigrationTrigger(connectionClient.client, { connection, now: () => 0, startInterval: connectionSchedule.startInterval, stopInterval: connectionSchedule.stopInterval })
connectionTrigger.start()
const listenersAfterStart = connectionListeners.length
connectionListeners[0]()
await flush()
const connectionCalls = connectionClient.state.migrateCalls
const connectionReason = connectionTrigger.getStats().lastResult?.reason
const connectionEffective = connectionTrigger.getStats().lastResult?.detail.effectiveType
connectionTrigger.stop()
const listenersAfterStop = connectionListeners.length
const pollIntervalMs = connectionSchedule.intervals[0].periodMs

gate('ClockSync estimates the server offset and one-way delay from a known exchange', () => {
  assert(clockAfterOne.offset === 500, 'offset ' + clockAfterOne.offset)
  assert(clockAfterOne.delay === 20, 'one-way delay ' + clockAfterOne.delay)
  assert(clockAfterOne.estimate === 1541, 'server time estimate ' + clockAfterOne.estimate)
})

gate('ClockSync keeps the minimum round-trip sample as its estimate', () => {
  assert(clockAfterTwo.count === 2, 'sample count ' + clockAfterTwo.count)
  assert(clockAfterTwo.offset === 500, 'offset moved to ' + clockAfterTwo.offset)
})

gate('ClockSync refuses a negative round trip and non-finite times', () => {
  assert(refusedNegativeRtt === false, 'negative round trip accepted')
  assert(refusedNonFinite === false, 'non-finite send time accepted')
  assert(refusedNaNReceive === false, 'NaN receive time accepted')
  assert(clockAfterRefusals === 2, 'refused samples were stored, count ' + clockAfterRefusals)
})

gate('SnapshotTimeline interpolates the pair of snapshots around the render time', () => {
  assert(sampled.tick === 12, 'pair end tick ' + sampled.tick)
  assert(near(sampled.renderMs, 1115), 'render time ' + sampled.renderMs)
  assert(near(sampledPlayer.position[0], 11.15), 'interpolated x ' + sampledPlayer.position[0])
  assert(near(displayed, 11.15), 'displayed tick ' + displayed)
})

gate('SnapshotTimeline ignores an out-of-order or duplicate snapshot', () => {
  assert(acceptedOutOfOrder === false, 'out-of-order snapshot accepted')
  assert(acceptedDuplicate === false, 'duplicate snapshot accepted')
  assert(timelineAfterRefusals === 3, 'buffer grew to ' + timelineAfterRefusals)
})

gate('ReconciliationEngine keeps a small error and teleports past the grounded threshold', () => {
  assert(sameArray(smallError, [0.5, 0, 0]), 'small error ' + JSON.stringify(smallError))
  assert(sameArray(groundedTeleported, [0, 0, 0]), 'grounded error at 5 m was kept ' + JSON.stringify(groundedTeleported))
})

gate('ReconciliationEngine uses the airborne threshold in the air', () => {
  assert(sameArray(airborneKept, [6, 0, 0]), '6 m airborne error was reset ' + JSON.stringify(airborneKept))
  assert(sameArray(groundedSix, [0, 0, 0]), '6 m grounded error was kept ' + JSON.stringify(groundedSix))
})

gate('ReconciliationEngine decays the error by exp(-dt / timeConstant)', () => {
  assert(near(decayedOneStep, 0.5 * Math.exp(-1), 1e-9), 'decayed to ' + decayedOneStep)
})

gate('ReconciliationEngine caps a decay step at 100 ms', () => {
  assert(near(longGapResult, 0.5 * Math.exp(-1.25), 1e-9), 'long gap decayed to ' + longGapResult)
})

gate('the chart transfer maps a point between two charts with the same basis', () => {
  assert(sameArray(transfer56.point([1, 2, 3]), [1, 0, 3]), 'transfer point ' + JSON.stringify(transfer56.point([1, 2, 3])))
  assert(sameArray(transfer57.point([1, 2, 3]), [1, -2, 3]), 'transfer 5 to 7 point ' + JSON.stringify(transfer57.point([1, 2, 3])))
  assert(!sameArray(transfer56.point([1, 2, 3]), transfer57.point([1, 2, 3])), 'a different target chart mapped to the same point')
})

gate('PredictionChart re-expresses a motion state once per pass', () => {
  assert(sameArray(motionOnce, [1, 0, 3]), 'motion re-expressed to ' + JSON.stringify(motionOnce))
})

gate('a second pass over the same motion state leaves it unchanged', () => {
  assert(sameArray(motionTwice, motionOnce), 'second pass moved the state to ' + JSON.stringify(motionTwice))
})

gate('chart wire form round-trips and refuses a short or non-finite payload', () => {
  assert(roundTrip.radius === 10 && roundTrip.chartEpoch === 5 && sameArray(roundTrip.east, [1, 0, 0]), 'round trip ' + JSON.stringify(roundTrip))
  assert(rejectedShortWire, 'short wire payload was accepted')
  assert(rejectedNonFiniteWire, 'non-finite chart float was accepted')
})

gate('ChartEpochSync adopts a chart and applies a continuing broadcast as a transfer', () => {
  assert(adoptedEpoch === 5, 'adopted epoch ' + adoptedEpoch)
  assert(transferredEpoch === 6 && transferredApplied === 1, 'transfer epoch ' + transferredEpoch + ' applied ' + transferredApplied)
  assert(JSON.stringify(reanchoredAfterTransfer) === '[6]', 'reanchor callbacks ' + JSON.stringify(reanchoredAfterTransfer))
})

gate('ChartEpochSync ignores a broadcast for an epoch it already holds', () => {
  assert(ignoredRepeat === 1, 'ignored broadcasts ' + ignoredRepeat)
  assert(appliedAfterRepeat === 1, 'repeat was applied again, applied ' + appliedAfterRepeat)
})

gate('ChartEpochSync refuses a snapshot from an older chart epoch and admits the current one', () => {
  assert(staleAdmitted === false, 'older snapshot admitted')
  assert(epochSync.stats.staleSnapshots === 1, 'stale count ' + epochSync.stats.staleSnapshots)
  assert(currentAdmitted === true, 'current snapshot refused')
  assert(heldAdmitted === false, 'snapshot ahead of the chart was admitted')
})

gate('ChartEpochSync asks the server for the chart history after the held snapshots persist', () => {
  assert(JSON.stringify(requestsAfterHold) === '[6]', 'resync requests ' + JSON.stringify(requestsAfterHold))
})

gate('ChartEpochSync defers a future-epoch ack and replays it when the broadcast arrives', () => {
  assert(deferredResult === null && deferredCount === 1, 'future ack was not deferred')
  assert(replayedCount === 1 && replayedIsSame, 'deferred ack was not replayed, count ' + replayedCount)
})

gate('ChartEpochSync re-expresses an ack from a held older epoch into the current chart', () => {
  assert(olderResult === olderAck, 'older ack was replaced')
  assert(sameArray(olderAck.position, [1, -2, 3]), 'older ack position ' + JSON.stringify(olderAck.position))
  assert(reexpressedAcks === 1, 'reexpressed count ' + reexpressedAcks)
})

gate('ChartEpochSync drops an ack from an epoch it no longer holds', () => {
  assert(unknownResult === null, 'unknown-epoch ack was admitted')
  assert(reports.some((message) => message.includes('dropped')), 'no report for the dropped ack')
  assert(epochSync.stats.reexpressedAcks === reexpressedAcks, 'unknown ack was counted as re-expressed')
})

gate('ChartEpochSync hard-resyncs a broadcast with no retained base instead of transferring', () => {
  assert(appliedBeforeHard === 2, 'applied before hard resync ' + appliedBeforeHard)
  assert(epochSync.stats.applied === appliedBeforeHard, 'hard resync counted as a transfer')
  assert(epochSync.stats.hardResyncs === 1 && epochSync.epoch === 8, 'hard resync stats ' + JSON.stringify(epochSync.stats))
  assert(JSON.stringify(resynced) === '[8]', 'resync callbacks ' + JSON.stringify(resynced))
  assert(holderCalls.reset === 1 && holderCalls.clear === 1, 'holders not reset ' + JSON.stringify(holderCalls))
})

gate('ReconnectManager backs off on the spoint schedule, capped at the maximum delay', () => {
  const schedule = [1, 2, 3, 4, 5, 6].map((attempts) => reconnectDelayMs(attempts, 5000))
  assert(JSON.stringify(schedule) === '[1000,1500,2250,3375,5000,5000]', 'schedule ' + JSON.stringify(schedule))
  assert(JSON.stringify(reconnectTimers.delays.slice(0, 5)) === '[1000,1500,2250,3375,5000]', 'scheduled delays ' + JSON.stringify(reconnectTimers.delays))
  assert(reconnectCalls.length === 5, 'retry callbacks ' + reconnectCalls.length)
  assert(stateAfterFailures === 'reconnecting', 'state after failures ' + stateAfterFailures)
})

gate('ReconnectManager resets the backoff once a connection is back', () => {
  assert(stateAfterReconnect === 'connected' && attemptsAfterReconnect === 0, 'after reconnect ' + stateAfterReconnect + ' attempts ' + attemptsAfterReconnect)
  assert(delayAfterReset === 1000, 'delay after reset ' + delayAfterReset)
})

gate('ReconnectManager schedules nothing once cleared', () => {
  assert(destroyedStateAfterClear === 'destroyed', 'state after clear ' + destroyedStateAfterClear)
  assert(reconnectTimers.delays.length === delaysAfterClear && delaysAfterClear === delaysBeforeClear, 'a retry was scheduled after clear')
  assert(pendingAfterClear === 0, 'timers pending after clear ' + pendingAfterClear)
})

gate('ReconnectManager sends the reconnect message only while waiting on an open socket', () => {
  assert(acceptedWhileConnected === false && sentWhileConnected.length === 0, 'message sent while connected')
  assert(acceptedWhileWaiting === true && sentWhileWaiting.length === 1, 'message not sent while waiting')
  assert(sentWhileWaiting[0].type === MSG.RECONNECT && sentWhileWaiting[0].payload.sessionToken === 'session-B', 'message ' + JSON.stringify(sentWhileWaiting[0]))
  assert(refusedWhileClosed === false && sentWhileWaiting.length === 1, 'message sent on a closed socket')
})

gate('TransportMigrationTrigger migrates after three RTT spikes and waits out the backoff', () => {
  assert(spikeFirstCalls === 1, 'migrations after first spike streak ' + spikeFirstCalls)
  assert(spikeFirstStats.attempts === 1 && spikeFirstStats.cooldownUntil === 1000, 'backoff after failure ' + JSON.stringify(spikeFirstStats))
  assert(spikeCooldownCalls === 1, 'migration inside cooldown ' + spikeCooldownCalls)
  assert(spikeRetryCalls === 2 && spikeFinalStats.attempts === 0, 'retry after cooldown ' + spikeRetryCalls + ' attempts ' + spikeFinalStats.attempts)
  assert(spikeFinalStats.lastResult.reason === 'rtt-spike' && spikeFinalStats.lastResult.result === 'migrated', 'last result ' + JSON.stringify(spikeFinalStats.lastResult))
})

gate('TransportMigrationTrigger polls on a 1000 ms interval and stops its timer', () => {
  assert(spikeSchedule.intervals[0].periodMs === 1000, 'poll period ' + spikeSchedule.intervals[0].periodMs)
  assert(spikeStoppedHandles === 1, 'stop did not clear the poll timer')
})

gate('TransportMigrationTrigger does not count a round trip equal to the threshold', () => {
  assert(edgeCalls === 0, 'a 300 ms round trip counted as a spike, migrations ' + edgeCalls)
})

gate('TransportMigrationTrigger leaves recovery to ReconnectManager while the socket is closed', () => {
  assert(ownedCalls === 0, 'migration attempted on a closed socket, calls ' + ownedCalls)
})

gate('TransportMigrationTrigger migrates on a connection change and unregisters on stop', () => {
  assert(listenersAfterStart === 1, 'listeners after start ' + listenersAfterStart)
  assert(connectionCalls === 1 && connectionReason === 'connection-change' && connectionEffective === '4g', 'connection change ' + connectionCalls + ' ' + connectionReason)
  assert(listenersAfterStop === 0 && pollIntervalMs === 1000, 'listener not removed on stop')
})

gate('the client barrel exports every ported module', () => {
  const names = ['ClockSync', 'ReconciliationEngine', 'SnapshotTimeline', 'reexpressMotionState', 'saveStepNormal', 'copyAckedEntry', 'createChartEpochSync', 'ReconnectManager', 'reconnectDelayMs', 'TransportMigrationTrigger', 'slerpQuat', 'createChartTransfer', 'createReexpressPass', 'encodeChart', 'decodeChart']
  for (const name of names) assert(client[name] !== undefined, 'missing export ' + name)
})

gate('the barrel leaves the open modules out', () => {
  assert(!('PredictionEngine' in client) && !('SnapshotProcessor' in client), 'an open module is exported')
})

finish()
