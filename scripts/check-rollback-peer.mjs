import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { createCorrectionObserver } from '../src/rollback-pure/correctionObserver.js'
import { STATE_RING_TICKS, STATS_POST_INTERVAL_MS, buildRollbackPeerLoop, startStatsPost } from '../src/rollback-pure/peerSimRuntime.js'


const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustThrow = (check) => {
  let thrown = false
  try {
    check()
  } catch (_) {
    thrown = true
  }
  assert(thrown, 'negative control was accepted')
}

gate('the spoint constants are 32 state ring ticks and a 1000 ms stats post interval', () => {
  same(STATE_RING_TICKS, 32, 'STATE_RING_TICKS')
  same(STATS_POST_INTERVAL_MS, 1000, 'STATS_POST_INTERVAL_MS')
})

gate('a correction observer with no moved player reports zeros', () => {
  const players = [{ id: 1, position: [0, 0, 0] }]
  const observer = createCorrectionObserver({ connected: () => players, localPlayerId: 1 })
  observer.after(observer.before())
  sameJson(observer.snapshot(), { count: 1, sumM: 0, maxM: 0, remoteSumM: 0, remoteMaxM: 0 }, 'still player')
})

gate('moved players are measured in metres, the local player counts in the total only, and remote players in both', () => {
  const players = [{ id: 1, position: [0, 0, 0] }, { id: 2, position: [10, 0, 0] }]
  const observer = createCorrectionObserver({ connected: () => players, localPlayerId: 1 })
  const before = observer.before()
  players[0].position = [3, 0, 4]
  players[1].position = [10, 0, 12]
  observer.after(before)
  const stats = observer.snapshot()
  same(stats.count, 2, 'count')
  same(stats.sumM, 5 + 12, 'sumM')
  same(stats.maxM, 12, 'maxM')
  same(stats.remoteSumM, 12, 'remoteSumM')
  same(stats.remoteMaxM, 12, 'remoteMaxM')
})

gate('a player that joined after the before snapshot is skipped, and the observer refuses a missing connected reader', () => {
  const players = [{ id: 1, position: [0, 0, 0] }]
  const observer = createCorrectionObserver({ connected: () => players, localPlayerId: 1 })
  const before = observer.before()
  players.push({ id: 2, position: [100, 0, 0] })
  observer.after(before)
  same(observer.snapshot().count, 1, 'count with a late joiner')
  mustThrow(() => createCorrectionObserver({ localPlayerId: 1 }))
})

gate('the stats post runs the scheduled callback once per interval and posts PEER_STATS until stopped', () => {
  const posted = []
  let scheduled = null
  let cancelled = null
  const stop = startStatsPost({
    getStats: () => ({ n: posted.length }),
    post: (message) => posted.push(message),
    schedule: (fn, every) => {
      scheduled = { fn, every }
      return 'handle-1'
    },
    cancel: (handle) => {
      cancelled = handle
    },
  })
  same(scheduled.every, 1000, 'interval')
  scheduled.fn()
  scheduled.fn()
  sameJson(posted, [{ type: 'PEER_STATS', stats: { n: 0 } }, { type: 'PEER_STATS', stats: { n: 1 } }], 'posts')
  stop()
  same(cancelled, 'handle-1', 'cancelled handle')
})

gate('the rollback peer loop builds its transport and loop from the injected pieces, with no consensus voter', () => {
  const sent = []
  const link = { pubkey: 'me', broadcast: (payload) => { sent.push(payload); return 1 } }
  const built = buildRollbackPeerLoop({
    link,
    tickSystem: { onTick: () => {}, start: () => {}, stop: () => {} },
    roster: ['me', 'them'],
    localPeerId: 'me',
    simulate: () => {},
    getLocalInput: () => null,
    checksumOf: () => 0,
    observeRollback: null,
    capture: () => ({}),
    apply: () => {},
  })
  assert(built.loop && built.transport, 'loop and transport are built')
  same(built.voter, null, 'rollback has no consensus voter')
  same(typeof built.loop.start, 'function', 'loop start')
})

gate('the rollback peer loop refuses a link without broadcast, so no transport is built silently', () => {
  mustThrow(() => buildRollbackPeerLoop({
    link: { pubkey: 'me' },
    tickSystem: {},
    roster: ['me', 'them'],
    localPeerId: 'me',
    simulate: () => {},
    getLocalInput: () => null,
    checksumOf: () => 0,
    observeRollback: null,
    capture: () => ({}),
    apply: () => {},
  }))
})

finish()
