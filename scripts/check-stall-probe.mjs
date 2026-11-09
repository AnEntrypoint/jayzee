import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { parseThrottleLog } from './browser/stall-attribution.mjs'
import { classifyStall, cpuMsBetween, parseThreadLog, probeStalls, rendererMainSeries } from './browser/stall-probe.mjs'

gate('parseThreadLog reads six fields per line and refuses a short or non-numeric line', () => {
  const rows = parseThreadLog('100 100 renderer 100 7 Chrome_Render thread\n100 100 renderer 101 3 Compositor\n')
  assert.deepEqual(rows[0], { t: 100, pid: 100, type: 'renderer', tid: 100, jiffies: 7, comm: 'Chrome_Render thread' })
  assert.equal(rows[1].tid, 101)
  assert.throws(() => parseThreadLog('100 100 renderer 100\n'), TypeError)
  assert.throws(() => parseThreadLog('x 100 renderer 100 7 comm\n'), TypeError)
})

gate('rendererMainSeries keeps the main thread of the busiest renderer and refuses a log with no renderer', () => {
  const rows = parseThreadLog([
    '0 100 renderer 100 0 Chrome', '0 100 renderer 101 9 Compositor', '50 100 renderer 100 4 Chrome',
    '0 200 renderer 200 1 Chrome', '50 200 renderer 200 2 Chrome',
    '60 100 renderer 100 6 Chrome', '60 300 gpu 300 99 GPU',
  ].join('\n') + '\n')
  assert.deepEqual(rendererMainSeries(rows), [{ t: 0, jiffies: 0 }, { t: 50, jiffies: 4 }, { t: 60, jiffies: 6 }])
  assert.throws(() => rendererMainSeries(parseThreadLog('0 300 gpu 300 1 GPU\n')), RangeError)
})

gate('cpuMsBetween is the main-thread time in ms, holds the last record, and is null before the first record', () => {
  const series = [{ t: 0, jiffies: 0 }, { t: 100, jiffies: 5 }]
  assert.equal(cpuMsBetween(series, 0, 100), 50)
  assert.equal(cpuMsBetween(series, 50, 150), 50)
  assert.equal(cpuMsBetween(series, -10, 100), null)
  assert.equal(cpuMsBetween(series, 100, 100), null)
})

gate('classifyStall calls a frame cpu-bound when the main thread ran most of it, starved when cgroup some pressure covered it, and blocked otherwise', () => {
  assert.equal(classifyStall({ totalMs: 100, cpuMs: 90, someMs: 0 }), 'cpu-bound')
  assert.equal(classifyStall({ totalMs: 100, cpuMs: 10, someMs: 80 }), 'starved')
  assert.equal(classifyStall({ totalMs: 100, cpuMs: 10, someMs: 10 }), 'blocked')
})

gate('probeStalls labels three synthetic stalls cpu-bound, starved and blocked, and reports the physics share of each stall', () => {
  const samples = []
  for (let t = 0; t <= 2000; t += 10) {
    const someUs = t < 1500 ? 0 : t <= 1600 ? (t - 1500) * 800 : 80000
    samples.push(t + ' 0 0 ' + someUs + ' 0')
  }
  const threads = ['100 100 renderer 100 0 Chrome', '200 100 renderer 100 10 Chrome', '1500 100 renderer 100 10 Chrome', '1600 100 renderer 100 10 Chrome', '1800 100 renderer 100 10 Chrome', '1900 100 renderer 100 10 Chrome']
  const result = { rowColumns: ['frame', 'startMs', 'tickMs', 'renderMs'], rows: [] }
  for (let i = 0; i < 10; i++) result.rows.push([i, 100 + 40 * i, 30, 10])
  result.rows.push([10, 100, 90, 10])
  result.rows.push([11, 1500, 95, 5])
  result.rows.push([12, 1800, 5, 95])
  const report = probeStalls(result, parseThrottleLog(samples.join('\n') + '\n'), parseThreadLog(threads.join('\n') + '\n'))
  assert.equal(report.baseMs, 40)
  assert.equal(report.stallCount, 3)
  const byFrame = Object.fromEntries(report.stalls.map((s) => [s.frame, s.verdict]))
  assert.deepEqual(byFrame, { 10: 'cpu-bound', 11: 'starved', 12: 'blocked' })
  assert.equal(report.counts['cpu-bound'], 1)
  assert.equal(report.stallTickMedianMs, 90)
  assert.equal(report.normalTickMedianMs, 30)
})

gate('probeStalls gives the active-body range over the frames and the active count of each stall, and null without an active column', () => {
  const samples = []
  for (let t = 0; t <= 2000; t += 10) samples.push(t + ' 0 0 0 0')
  const threads = ['100 100 renderer 100 0 Chrome', '200 100 renderer 100 10 Chrome', '1500 100 renderer 100 10 Chrome', '1600 100 renderer 100 10 Chrome']
  const throttle = parseThrottleLog(samples.join('\n') + '\n')
  const rows = parseThreadLog(threads.join('\n') + '\n')
  const withActive = { rowColumns: ['frame', 'startMs', 'tickMs', 'renderMs', 'active'], rows: [[0, 100, 30, 10, 10240], [1, 140, 30, 10, 10240], [2, 1500, 90, 10, 0], [3, 1600, 30, 10, 0]] }
  const report = probeStalls(withActive, throttle, rows)
  assert.equal(report.activeMin, 0)
  assert.equal(report.activeMax, 10240)
  assert.deepEqual(report.stalls.map((s) => [s.frame, s.active]), [[2, 0]])
  const without = { rowColumns: ['frame', 'startMs', 'tickMs', 'renderMs'], rows: [[0, 100, 30, 10], [1, 140, 30, 10]] }
  const plain = probeStalls(without, throttle, rows)
  assert.equal(plain.activeMin, null)
  assert.equal(plain.activeMax, null)
})

finish()
