export const THROTTLE_SAMPLE_MS = 20
export const THROTTLE_SLACK_MS = 40

export const throttledBetween = (samples, fromEpochMs, toEpochMs) => {
  let before = null
  let after = null
  for (const sample of samples) {
    if (sample.epochMs <= fromEpochMs) before = sample
    if (after === null && sample.epochMs >= toEpochMs) after = sample
  }
  if (before === null || after === null) return null
  return { periods: after.nrThrottled - before.nrThrottled, throttledMs: (after.throttledUsec - before.throttledUsec) / 1000, sampleWallMs: after.epochMs - before.epochMs }
}

export const isHostThrottledGap = ({ throttled, pageIdle, workWithinBudget }) =>
  throttled !== null && typeof throttled === 'object' && Number.isInteger(throttled.periods) && throttled.periods > 0 && pageIdle === true && workWithinBudget === true

export const HOST_WAITS_MOST = 3
export const HOST_WAIT_MOST_MS = 50

export const excuseHostThrottled = (verdict, cases) => {
  const throttled = cases.filter((c) => c.hostThrottledGap === true)
  const driverLocked = cases.filter((c) => c.hostThrottledGap !== true && c.gpuDriverLockGap === true)
  const hostWaits = throttled.length + driverLocked.length
  const longestMs = [...throttled, ...driverLocked].reduce((most, c) => Math.max(most, c.intervalMs ?? 0), 0)
  const counts = { hostThrottledIntervals: throttled.length, gpuDriverLockIntervals: driverLocked.length, hostWaitLongestMs: longestMs }
  const onlyMissedFrames = verdict.failures.length === 1 && verdict.failures[0].startsWith('missed frames')
  if (verdict.ok || !onlyMissedFrames || cases.length === 0 || hostWaits !== cases.length) return { ...verdict, ...counts }
  if (hostWaits > HOST_WAITS_MOST || longestMs > HOST_WAIT_MOST_MS) {
    const over = 'host waits over the allowance: ' + hostWaits + ' intervals outside the page (allowance ' + HOST_WAITS_MOST + '), longest ' + longestMs + ' ms (allowance ' + HOST_WAIT_MOST_MS + ' ms). A wait this frequent or this long is a stall a viewer sees, and the host was not quiet enough to judge the page'
    return { ...verdict, ...counts, failures: [...verdict.failures, over] }
  }
  return { ...verdict, ok: true, failures: [], ...counts, notCountedAgainstThePage: verdict.failures }
}
