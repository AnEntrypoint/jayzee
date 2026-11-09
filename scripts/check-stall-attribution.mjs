import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { attributeStalls, parseThrottleLog, throttledMs } from './browser/stall-attribution.mjs'
import { burn } from './browser/cpu-load.mjs'
import { readCpuStat } from './browser/cgroup-sampler.mjs'

const linear = (fromMs, toMs, throttledUsPerMs) => {
  const rows = []
  for (let t = fromMs; t <= toMs; t += 10) rows.push({ t, throttledUs: t * throttledUsPerMs, usageUs: 0 })
  return rows
}

gate('parseThrottleLog reads three numbers per line and refuses any other line', () => {
  assert.deepEqual(parseThrottleLog('0 0 5\n10 4000 9000\n'), [{ t: 0, throttledUs: 0, usageUs: 5 }, { t: 10, throttledUs: 4000, usageUs: 9000 }])
  assert.throws(() => parseThrottleLog('0 0\n'), TypeError)
  assert.throws(() => parseThrottleLog('0 x 5\n'), TypeError)
})

gate('readCpuStat reads throttled_usec and usage_usec and refuses a file without them', () => {
  const text = 'usage_usec 588252916886\nnr_throttled 207802\nthrottled_usec 49801725422\n'
  assert.deepEqual(readCpuStat(text), { throttledUs: 49801725422, usageUs: 588252916886 })
  assert.throws(() => readCpuStat('usage_usec 1\n'), TypeError)
})

gate('throttledMs is the interpolated throttled time inside the window and null outside the samples', () => {
  const samples = linear(0, 100, 1000)
  assert.equal(throttledMs(samples, 0, 10), 10)
  assert.equal(throttledMs(samples, 5, 15), 10)
  assert.equal(throttledMs(samples, 95, 100), 5)
  assert.equal(throttledMs(samples, -5, 10), null)
  assert.equal(throttledMs(samples, 90, 110), null)
})

gate('a stall inside a throttle window is labelled throttled, and a stall with no throttle is labelled unexplained', () => {
  const samples = [
    { t: 0, throttledUs: 0, usageUs: 0 },
    { t: 1000, throttledUs: 1000000, usageUs: 0 },
    { t: 2000, throttledUs: 1000000, usageUs: 0 },
  ]
  const frames = []
  for (let i = 0; i < 10; i++) frames.push({ frame: i, startMs: 100 + i * 40, totalMs: 40 })
  frames.push({ frame: 10, startMs: 100, totalMs: 100 })
  frames.push({ frame: 11, startMs: 1500, totalMs: 100 })
  const report = attributeStalls(frames, samples)
  assert.equal(report.medianMs, 40)
  assert.equal(report.stallCount, 2)
  const byFrame = Object.fromEntries(report.stalls.map((s) => [s.frame, s]))
  assert.equal(byFrame[10].verdict, 'throttled')
  assert.equal(byFrame[11].verdict, 'unexplained')
  assert.equal(report.counts.throttled, 1)
  assert.equal(report.counts.unexplained, 1)
})

gate('a stall outside the sampler window is labelled uncovered, not throttled', () => {
  const samples = linear(0, 1000, 0)
  const frames = [{ frame: 0, startMs: 0, totalMs: 40 }, { frame: 1, startMs: 40, totalMs: 40 }, { frame: 2, startMs: 5000, totalMs: 200 }]
  const report = attributeStalls(frames, samples)
  assert.equal(report.stalls[0].verdict, 'uncovered')
})

gate('burn runs the requested number of busy workers for the requested time and records a window that contains it', async () => {
  const record = await burn({ workers: 2, durationMs: 300 })
  assert.equal(record.workers, 2)
  assert.ok(record.endMs - record.startMs >= 300, 'window ' + (record.endMs - record.startMs))
  assert.ok(record.endMs - record.startMs < 3000, 'window ' + (record.endMs - record.startMs))
})

finish()
