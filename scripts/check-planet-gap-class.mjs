import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { HOST_WAITS_MOST, HOST_WAIT_MOST_MS, THROTTLE_SAMPLE_MS, THROTTLE_SLACK_MS, excuseHostThrottled, isHostThrottledGap, throttledBetween } from './browser/hostThrottle.mjs'
import { RUN_QUEUE_LEAST_MS, driverLockMs, isDriverLockGap, isRunQueueGap, runQueueWaitMs } from './browser/gpuBatch.mjs'

const missed = { ok: false, failures: ['missed frames: 2 rAF intervals over 25 ms, first at frame 64 (31.35 ms)'] }
const samples = [0, 20, 40, 60, 80, 100, 120].map((epochMs, i) => ({ epochMs, nrThrottled: i < 4 ? 7 : 8, throttledUsec: i < 4 ? 1000 : 91000 }))

gate('the throttle count over a window is read from the samples that bracket it, and is unknown without both', () => {
  assert.deepEqual(throttledBetween(samples, 45, 85), { periods: 1, throttledMs: 90, sampleWallMs: 60 })
  assert.deepEqual(throttledBetween(samples, 0, 40), { periods: 0, throttledMs: 0, sampleWallMs: 40 })
  assert.equal(throttledBetween(samples, -5, 40), null)
  assert.equal(throttledBetween(samples, 45, 130), null)
  assert.equal(throttledBetween([], 0, 10), null)
  assert.ok(THROTTLE_SAMPLE_MS <= 25 && THROTTLE_SLACK_MS >= THROTTLE_SAMPLE_MS)
})

gate('a gap is host throttling only when the quota counter advanced around it, the page was idle and its frame work was within budget', () => {
  const throttled = { periods: 1, throttledMs: 90, sampleWallMs: 60 }
  assert.equal(isHostThrottledGap({ throttled, pageIdle: true, workWithinBudget: true }), true)
  assert.equal(isHostThrottledGap({ throttled: { ...throttled, periods: 0 }, pageIdle: true, workWithinBudget: true }), false)
  assert.equal(isHostThrottledGap({ throttled: null, pageIdle: true, workWithinBudget: true }), false)
  assert.equal(isHostThrottledGap({ throttled, pageIdle: false, workWithinBudget: true }), false)
  assert.equal(isHostThrottledGap({ throttled, pageIdle: true, workWithinBudget: false }), false)
})

gate('missed frames are not counted against the page only when every one of them is a host-throttled gap', () => {
  const excused = excuseHostThrottled(missed, [{ hostThrottledGap: true }, { hostThrottledGap: true }])
  assert.equal(excused.ok, true)
  assert.equal(excused.hostThrottledIntervals, 2)
  assert.deepEqual(excused.notCountedAgainstThePage, missed.failures)
  assert.equal(excuseHostThrottled(missed, [{ hostThrottledGap: true }, { hostThrottledGap: false }]).ok, false)
  assert.equal(excuseHostThrottled(missed, []).ok, false)
})

gate('an interval in which the GPU thread slept in the graphics driver lock is named so when the page was idle, and is not counted against the page', () => {
  const samples = { samples: 6, atUs: [0, 10000, 20000, 30000, 40000, 50000], state: 'SDDRDS', waitsOn: [0, 1, 1, 0, 2, 0], waitNames: ['', 'os_acquire_rwlock_write', 'futex_do_wait'] }
  assert.equal(driverLockMs(samples, 5000, 45000), 20)
  assert.equal(driverLockMs(samples, 12000, 26000), 14)
  assert.equal(driverLockMs(samples, 5000, 60000), null)
  assert.equal(driverLockMs(null, 0, 10), null)
  assert.equal(isDriverLockGap({ lockMs: 20, intervalMs: 40, pageIdle: true, workWithinBudget: true }), true)
  assert.equal(isDriverLockGap({ lockMs: 4, intervalMs: 26, pageIdle: true, workWithinBudget: true }), false)
  assert.equal(isDriverLockGap({ lockMs: 6, intervalMs: 60, pageIdle: true, workWithinBudget: true }), false)
  assert.equal(isDriverLockGap({ lockMs: 20, intervalMs: 40, pageIdle: false, workWithinBudget: true }), false)
  assert.equal(isDriverLockGap({ lockMs: 20, intervalMs: 40, pageIdle: true, workWithinBudget: false }), false)
  assert.equal(isDriverLockGap({ lockMs: null, intervalMs: 40, pageIdle: true, workWithinBudget: true }), false)
  const excused = excuseHostThrottled(missed, [{ hostThrottledGap: true }, { gpuDriverLockGap: true }])
  assert.equal(excused.ok, true)
  assert.equal(excused.hostThrottledIntervals, 1)
  assert.equal(excused.gpuDriverLockIntervals, 1)
  assert.equal(excuseHostThrottled(missed, [{ gpuDriverLockGap: true }, { gpuDriverLockGap: false }]).ok, false)
})

gate('host waits are left out only up to ' + HOST_WAITS_MOST + ' intervals a run and ' + HOST_WAIT_MOST_MS + ' ms each; more or longer fails the run and says the host was not quiet', () => {
  const lock = (intervalMs) => ({ gpuDriverLockGap: true, intervalMs })
  const atAllowance = excuseHostThrottled(missed, Array.from({ length: HOST_WAITS_MOST }, () => lock(28)))
  assert.equal(atAllowance.ok, true)
  assert.equal(atAllowance.hostWaitLongestMs, 28)
  const tooMany = excuseHostThrottled(missed, Array.from({ length: HOST_WAITS_MOST + 1 }, () => lock(28)))
  assert.equal(tooMany.ok, false)
  assert.equal(tooMany.failures.length, 2)
  assert.match(tooMany.failures[1], /host waits over the allowance: 4 intervals/)
  const tooLong = excuseHostThrottled(missed, [lock(HOST_WAIT_MOST_MS + 1)])
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.failures[1], /longest 51 ms/)
  assert.equal(excuseHostThrottled(missed, [lock(HOST_WAIT_MOST_MS)]).ok, true)
  const throttledToo = excuseHostThrottled(missed, [{ hostThrottledGap: true, intervalMs: 30 }, { hostThrottledGap: true, intervalMs: 31 }, lock(29), lock(27)])
  assert.equal(throttledToo.ok, false)
})

gate('an interval in which the GPU thread waited for a CPU is named a run-queue gap and stays counted against the run', () => {
  const samples = { samples: 5, atUs: [0, 10000, 20000, 30000, 40000], waitNs: [0, 1e6, 9e6, 15e6, 15e6] }
  assert.equal(runQueueWaitMs(samples, 5000, 35000), 15)
  assert.equal(runQueueWaitMs(samples, 12000, 28000), 14)
  assert.equal(runQueueWaitMs(samples, 5000, 60000), null)
  assert.equal(runQueueWaitMs(null, 0, 10), null)
  assert.equal(isRunQueueGap({ waitMs: 15, intervalMs: 34, pageIdle: true, workWithinBudget: true }), true)
  assert.equal(isRunQueueGap({ waitMs: RUN_QUEUE_LEAST_MS - 1, intervalMs: 26, pageIdle: true, workWithinBudget: true }), false)
  assert.equal(isRunQueueGap({ waitMs: 6, intervalMs: 60, pageIdle: true, workWithinBudget: true }), false)
  assert.equal(isRunQueueGap({ waitMs: 15, intervalMs: 34, pageIdle: false, workWithinBudget: true }), false)
  assert.equal(excuseHostThrottled(missed, [{ gpuRunQueueGap: true, intervalMs: 34 }]).ok, false)
})

gate('any other failure keeps the run failed, and a passing run stays passing', () => {
  const two = { ok: false, failures: [missed.failures[0], 'allocations after warm-up: 12'] }
  assert.equal(excuseHostThrottled(two, [{ hostThrottledGap: true }]).ok, false)
  assert.equal(excuseHostThrottled({ ok: false, failures: ['run failed: no result'] }, [{ hostThrottledGap: true }]).ok, false)
  assert.equal(excuseHostThrottled({ ok: true, failures: [] }, []).ok, true)
})

finish()
