import { gate, finish } from './lib/gate.mjs'
import { LagCompensator, REWIND_BUCKET_CAPACITY } from '../src/netcode/lagCompensation.js'
import { findHitLinear, findHitSpatial, normalizeShotDirection, rayVsCapsule, resolveTargetPoint } from '../src/netcode/hitscan.js'
import { RewindSpatialIndex, buildLiveIndex, RewindDuplicatePlayerIdError } from '../src/netcode/rewindIndex.js'
import * as netcode from '../src/netcode/index.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const fakeClock = (start = 0) => {
  let now = start
  return { now: () => now, set: (value) => { now = value } }
}

const random = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

const EYE = [0, 0.9, 0]

const recordLine = (lc, id, fromTick, toTick) => {
  for (let tick = fromTick; tick <= toTick; tick++) {
    lc.recordPlayerPosition(id, [tick * 0.5, 1, -tick * 0.25], [0, 0, 0, 1], [tick, 0, 0], tick)
  }
}

const bruteForceIds = (players, shot) => players
  .filter(p => p.id !== shot.shooterId)
  .filter(p => rayVsCapsule(shot.origin, shot.direction, shot.range, p.state.position) !== null)
  .map(p => p.id)

const candidateIds = (source, shot) => {
  const found = new Set()
  source.queryRay(shot.origin, normalizeShotDirection(shot.direction), shot.range, entry => found.add(entry.id))
  return found
}

const coversBruteForce = (players, shot, source) => {
  const found = candidateIds(source, shot)
  return bruteForceIds(players, shot).every(id => found.has(id))
}

gate('a rewind to a tick inside the window returns that tick state', () => {
  const lc = new LagCompensator(1000, 60, fakeClock().now)
  recordLine(lc, 'p1', 0, 100)
  const exact = lc.rewindAtTick('p1', 50)
  assert(exact.tick === 50, 'exact rewind reported tick ' + exact.tick)
  assert(same(exact.position, [25, 1, -12.5]), 'exact rewind position ' + JSON.stringify(exact.position))
  assert(same(exact.velocity, [50, 0, 0]), 'exact rewind velocity ' + JSON.stringify(exact.velocity))
  const between = lc.rewindAtTick('p1', 50.5)
  assert(same(between.position, [25.25, 1, -12.625]), 'interpolated position ' + JSON.stringify(between.position))
  assert(lc.resolveViewTick(140, 200) === 140, 'boundary tick 140 of a 200 tick view was not kept')
})

gate('a request one tick older than the window is refused as a view and clamped to the oldest retained tick', () => {
  const lc = new LagCompensator(1000, 60, fakeClock().now)
  assert(lc.windowTicks === 60, 'window ticks ' + lc.windowTicks)
  recordLine(lc, 'p1', 0, 200)
  const clampedTo = lc.resolveViewTick(139, 200)
  assert(clampedTo === 140, 'older request resolved to ' + clampedTo + ', expected 140')
  assert(clampedTo !== 139, 'older request was served at its own tick')
  assert(lc.stats.clamped === 1, 'clamped counter ' + lc.stats.clamped)
  assert(lc.rewindAtTick('p1', clampedTo).tick === 140, 'clamped rewind did not return tick 140')
})

gate('a view tick beyond the one tick future tolerance is refused', () => {
  const lc = new LagCompensator(1000, 60, fakeClock().now)
  assert(lc.resolveViewTick(202, 200) === null, 'tick 202 was not refused')
  assert(lc.stats.rejected === 1, 'rejected counter ' + lc.stats.rejected)
  assert(lc.resolveViewTick(201, 200) === 200, 'tick 201 is inside the tolerance and should clamp to 200')
})

gate('the rate limit allows the burst capacity and refills at 20 per second', () => {
  const clock = fakeClock(1000)
  const lc = new LagCompensator(1000, 60, clock.now)
  const burst = Array.from({ length: REWIND_BUCKET_CAPACITY + 1 }, () => lc.acceptRewind('s1'))
  assert(burst.slice(0, REWIND_BUCKET_CAPACITY).every(Boolean), 'burst inside capacity was refused')
  assert(burst[REWIND_BUCKET_CAPACITY] === false, 'request past capacity was accepted')
  assert(lc.stats.rateLimited === 1, 'rateLimited counter ' + lc.stats.rateLimited)
  clock.set(1100)
  const refilled = [lc.acceptRewind('s1'), lc.acceptRewind('s1'), lc.acceptRewind('s1')]
  assert(same(refilled, [true, true, false]), '100 ms refill granted ' + JSON.stringify(refilled))
  clock.set(60000)
  const idle = Array.from({ length: REWIND_BUCKET_CAPACITY + 1 }, () => lc.acceptRewind('s1'))
  assert(idle.filter(Boolean).length === REWIND_BUCKET_CAPACITY, 'idle refill exceeded capacity')
  assert(lc.acceptRewind('s2') === true, 'a second shooter did not start with a full bucket')
})

gate('a 5000 ms rewind window is capped to the 255 ticks the 256 sample ring retains', () => {
  const lc = new LagCompensator(5000, 60, fakeClock().now)
  assert(lc.windowTicks === 300, 'window ticks ' + lc.windowTicks)
  assert(lc.retainedTicks === 255, 'retained ticks ' + lc.retainedTicks)
  recordLine(lc, 'p1', 0, 400)
  assert(lc.playerHistory.get('p1').len === 256, 'ring length ' + lc.playerHistory.get('p1').len)
  const served = lc.getPlayerStateAtTime('p1', 5000)
  assert(served.tick !== 100, 'a 5000 ms request was served at its own tick')
  assert(served.tick === 145, 'oldest retained tick ' + served.tick)
  assert(new LagCompensator(1000, 60, fakeClock().now).retainedTicks === 60, 'a 1000 ms window is not 60 ticks')
})

gate('a hitscan ray hits the nearer of two targets in either list order', () => {
  const near = { id: 'near', state: { position: [0, 0, 10] } }
  const far = { id: 'far', state: { position: [0, 0, 20] } }
  const shot = { shooterId: 'me', origin: EYE, direction: [0, 0, 3], range: 50 }
  const forward = findHitLinear([near, far], shot)
  const reverse = findHitLinear([far, near], shot)
  assert(forward && forward.target.id === 'near', 'forward order hit ' + (forward && forward.target.id))
  assert(reverse && reverse.target.id === 'near', 'reverse order hit ' + (reverse && reverse.target.id))
  assert(forward.dot === 10, 'hit distance ' + forward.dot)
  const spatial = findHitSpatial([far, near], shot)
  assert(spatial && spatial.target.id === 'near', 'spatial hit ' + (spatial && spatial.target.id))
})

gate('a target past range, a target off the ray and the shooter are not hit', () => {
  const near = { id: 'near', state: { position: [0, 0, 10] } }
  const sideways = { id: 'side', state: { position: [1, 0, 5] } }
  assert(findHitLinear([near], { shooterId: 'me', origin: EYE, direction: [0, 0, 1], range: 5 }) === null, 'a target past range was hit')
  assert(findHitLinear([sideways], { shooterId: 'me', origin: EYE, direction: [0, 0, 1], range: 50 }) === null, 'a target 1 m off the ray was hit')
  assert(findHitLinear([near], { shooterId: 'near', origin: EYE, direction: [0, 0, 1], range: 50 }) === null, 'the shooter was hit by its own shot')
})

gate('a hitscan against a rewound target hits where the target was at the view tick', () => {
  const lc = new LagCompensator(1000, 60, fakeClock().now)
  lc.recordPlayerPosition('tg', [0, 0, 10], [0, 0, 0, 1], [0, 0, 0], 10)
  lc.recordPlayerPosition('tg', [8, 0, 10], [0, 0, 0, 1], [0, 0, 0], 20)
  const target = { id: 'tg', state: { position: [8, 0, 10] } }
  const shot = { shooterId: 'me', origin: EYE, direction: [0, 0, 1], range: 20 }
  assert(findHitLinear([target], shot) === null, 'the current position was hit without rewind')
  const rewound = findHitLinear([target], { ...shot, lagComp: lc, viewTick: 10 })
  assert(rewound && rewound.target.id === 'tg', 'rewound target was not hit')
  assert(same(rewound.tp, [0, 0, 10]), 'rewound target point ' + JSON.stringify(rewound.tp))
  assert(same(resolveTargetPoint(target, lc, 10).tp, [0, 0, 10]), 'resolveTargetPoint did not rewind')
})

gate('a rewind index query finds every target a brute-force scan hits, with the same nearest target', () => {
  const next = random(20260615)
  const players = Array.from({ length: 150 }, (_, i) => ({
    id: 'p' + i,
    state: { position: [next() * 120 - 60, next() * 10, next() * 120 - 60] },
  }))
  const index = buildLiveIndex(players)
  let hitShots = 0
  for (let i = 0; i < 300; i++) {
    const shot = {
      shooterId: null,
      origin: [next() * 120 - 60, next() * 10 + 0.9, next() * 120 - 60],
      direction: [next() * 2 - 1, next() * 2 - 1, next() * 2 - 1],
      range: 5 + next() * 115,
    }
    assert(coversBruteForce(players, shot, index), 'index missed a brute-force hit on shot ' + i)
    const linear = findHitLinear(players, shot)
    const spatial = findHitSpatial(players, shot, index)
    assert((linear && linear.target.id) === (spatial && spatial.target.id), 'nearest target differs on shot ' + i)
    if (linear) hitShots++
  }
  assert(hitShots > 0, 'no shot in the seeded set hit a target')
})

gate('the brute-force comparison rejects an empty index that drops a target', () => {
  const players = [{ id: 'a', state: { position: [0, 0, 10] } }]
  const shot = { shooterId: null, origin: EYE, direction: [0, 0, 1], range: 50 }
  assert(bruteForceIds(players, shot).length === 1, 'brute force missed the seeded target')
  assert(!coversBruteForce(players, shot, new RewindSpatialIndex(16)), 'an empty index passed the comparison')
})

gate('a zero shot direction and a duplicate player id are refused', () => {
  let zeroRefused = false
  try {
    findHitSpatial([{ id: 'a', state: { position: [0, 0, 5] } }], { shooterId: null, origin: EYE, direction: [0, 0, 0], range: 10 })
  } catch (error) {
    zeroRefused = error instanceof TypeError
  }
  assert(zeroRefused, 'zero direction was not refused')
  let duplicate = null
  try {
    buildLiveIndex([{ id: 'a', state: { position: [0, 0, 0] } }, { id: 'a', state: { position: [1, 0, 0] } }])
  } catch (error) {
    duplicate = error
  }
  assert(duplicate instanceof RewindDuplicatePlayerIdError, 'duplicate id was not refused')
  assert(duplicate.code === 'duplicate_player_id', 'duplicate code ' + duplicate.code)
})

gate('the netcode barrel exports the lag, hitscan and index entry points', () => {
  assert(typeof netcode.LagCompensator === 'function', 'LagCompensator missing from barrel')
  assert(typeof netcode.findHitLinear === 'function', 'findHitLinear missing from barrel')
  assert(typeof netcode.RewindSpatialIndex === 'function', 'RewindSpatialIndex missing from barrel')
  assert(netcode.ChartTransfer === undefined, 'a chart transfer export appeared in the barrel')
})

finish()
