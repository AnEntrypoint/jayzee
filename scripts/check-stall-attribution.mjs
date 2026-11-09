import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { attributeStalls, parseThrottleLog, starvedMs } from './browser/stall-attribution.mjs'
import { burn } from './browser/cpu-load.mjs'
import { readCpuPressure, readCpuStat } from './browser/cgroup-sampler.mjs'

const linear = (fromMs, toMs, fullUsPerMs) => {
  const rows = []
  for (let t = fromMs; t <= toMs; t += 10) rows.push({ t, throttledUs: 0, usageUs: 0, someUs: 0, fullUs: t * fullUsPerMs })
  return rows
}

gate('parseThrottleLog reads five numbers per line and refuses any other line', () => {
  assert.deepEqual(parseThrottleLog('0 0 5 1 2\n10 4000 9000 7 8\n'), [
    { t: 0, throttledUs: 0, usageUs: 5, someUs: 1, fullUs: 2 },
    { t: 10, throttledUs: 4000, usageUs: 9000, someUs: 7, fullUs: 8 },
  ])
  assert.throws(() => parseThrottleLog('0 0 5 1\n'), TypeError)
  assert.throws(() => parseThrottleLog('0 x 5 1 2\n'), TypeError)
})

gate('readCpuStat reads throttled_usec and usage_usec and refuses a file without them', () => {
  const text = 'usage_usec 588252916886\nnr_throttled 207802\nthrottled_usec 49801725422\n'
  assert.deepEqual(readCpuStat(text), { throttledUs: 49801725422, usageUs: 588252916886 })
  assert.throws(() => readCpuStat('usage_usec 1\n'), TypeError)
})

gate('readCpuPressure reads the some and full totals and refuses a file without a full line', () => {
  const text = 'some avg10=1.94 avg60=18.00 avg300=11.66 total=9600048697\nfull avg10=1.21 avg60=11.45 avg300=7.03 total=4028050772\n'
  assert.deepEqual(readCpuPressure(text), { someUs: 9600048697, fullUs: 4028050772 })
  assert.throws(() => readCpuPressure('some avg10=0 avg60=0 avg300=0 total=5\n'), TypeError)
})

gate('starvedMs is the interpolated full-pressure time inside the window and null outside the samples', () => {
  const samples = linear(0, 100, 1000)
  assert.equal(starvedMs(samples, 0, 10), 10)
  assert.equal(starvedMs(samples, 5, 15), 10)
  assert.equal(starvedMs(samples, 95, 100), 5)
  assert.equal(starvedMs(samples, -5, 10), null)
  assert.equal(starvedMs(samples, 90, 110), null)
})

gate('a stall inside a starvation window is labelled starved, and a stall with none is labelled unexplained', () => {
  const samples = [
    { t: 0, throttledUs: 0, usageUs: 0, someUs: 0, fullUs: 0 },
    { t: 1000, throttledUs: 0, usageUs: 0, someUs: 0, fullUs: 1000000 },
    { t: 2000, throttledUs: 0, usageUs: 0, someUs: 0, fullUs: 1000000 },
  ]
  const frames = []
  for (let i = 0; i < 10; i++) frames.push({ frame: i, startMs: 100 + i * 40, totalMs: 40 })
  frames.push({ frame: 10, startMs: 100, totalMs: 100 })
  frames.push({ frame: 11, startMs: 1500, totalMs: 100 })
  const report = attributeStalls(frames, samples)
  assert.equal(report.medianMs, 40)
  assert.equal(report.stallCount, 2)
  const byFrame = Object.fromEntries(report.stalls.map((s) => [s.frame, s]))
  assert.equal(byFrame[10].verdict, 'starved')
  assert.equal(byFrame[11].verdict, 'unexplained')
  assert.equal(report.counts.starved, 1)
  assert.equal(report.counts.unexplained, 1)
})

gate('a stall outside the sampler window is labelled uncovered, not starved', () => {
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

gate('a common baseline sets the threshold, so the same frames can count as stalls against a lower median', () => {
  const samples = [{ t: 0, throttledUs: 0, usageUs: 0, someUs: 0, fullUs: 0 }, { t: 2000, throttledUs: 0, usageUs: 0, someUs: 0, fullUs: 0 }]
  const frames = []
  for (let i = 0; i < 10; i++) frames.push({ frame: i, startMs: 100 + i * 40, totalMs: 40 })
  frames.push({ frame: 10, startMs: 100, totalMs: 100 })
  assert.equal(attributeStalls(frames, samples).stallCount, 1)
  const common = attributeStalls(frames, samples, { baseMs: 20 })
  assert.equal(common.medianMs, 20)
  assert.equal(common.stallCount, 11)
})

finish()
