import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { attributeTails, BUDGET_MS, percentile, reportFromFiles } from './browser/tail-report.mjs'

gate('percentile reads the nearest rank of the sorted values, and null for none', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3)
  assert.equal(percentile([1, 2, 3, 4, 5], 0.99), 5)
  assert.equal(percentile([], 0.5), null)
})

gate('a frame over the budget is a tail, and no tail reports no verdict', () => {
  assert.equal(attributeTails([{ wallMs: 10, runShare: 1, waitShare: 0, offShare: 0 }]).verdict, 'no tail frames over budget')
  assert.equal(attributeTails([{ wallMs: BUDGET_MS + 1, runShare: 1, waitShare: 0, offShare: 0 }]).count, 1)
})

gate('run-queue wait over half of a tail names host CPU contention', () => {
  const verdict = attributeTails([{ wallMs: 25, runShare: 0.3, waitShare: 0.6, offShare: 0.1, throttledMs: 0 }]).verdict
  assert.match(verdict, /run-queue wait/)
})

gate('cgroup throttling with a large off-CPU share names the throttle', () => {
  const verdict = attributeTails([{ wallMs: 25, runShare: 0.5, waitShare: 0.1, offShare: 0.4, throttledMs: 8 }]).verdict
  assert.match(verdict, /cgroup throttling/)
})

gate('a tail that runs on CPU is attributed to the frame itself', () => {
  const verdict = attributeTails([{ wallMs: 25, runShare: 0.95, waitShare: 0.02, offShare: 0.03, throttledMs: 0 }]).verdict
  assert.match(verdict, /run on CPU/)
})

gate('a missing scheduler log says so instead of guessing', () => {
  const verdict = attributeTails([{ wallMs: 25, runShare: null, waitShare: null, offShare: null, throttledMs: 0 }]).verdict
  assert.match(verdict, /attribution unavailable/)
})

gate('reportFromFiles reads the page rows, the cgroup samples and the scheduler log together', () => {
  const page = {
    rowColumns: ['frame', 'startMs', 'tickMs', 'renderMs', 'gapMs', 'active', 'physics'],
    rows: [
      [0, 0, 5, 1, 0, 1, 4],
      [1, 6, 30, 1, 0, 1, 29],
    ],
    allocationsSinceWarmup: '0',
  }
  const report = reportFromFiles({ page, cgroupText: '', schedText: null })
  assert.equal(report.frames, 2)
  assert.equal(report.maxMs, 31)
  assert.equal(report.attribution.count, 1)
  assert.match(report.attribution.verdict, /attribution unavailable/)
  assert.equal(report.allocationsSinceWarmup, '0')
})

finish()
