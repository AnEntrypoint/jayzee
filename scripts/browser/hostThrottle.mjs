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

export const excuseHostThrottled = (verdict, cases) => {
  const throttled = cases.filter((c) => c.hostThrottledGap === true)
  const onlyMissedFrames = verdict.failures.length === 1 && verdict.failures[0].startsWith('missed frames')
  if (verdict.ok || !onlyMissedFrames || cases.length === 0 || throttled.length !== cases.length) return { ...verdict, hostThrottledIntervals: throttled.length }
  return { ...verdict, ok: true, failures: [], hostThrottledIntervals: throttled.length, notCountedAgainstThePage: verdict.failures }
}
