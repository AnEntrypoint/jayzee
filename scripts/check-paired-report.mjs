import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { runRecord } from './browser/paired-run.mjs'
import { pairRounds, summarizeRun, verdict, report } from './browser/paired-report.mjs'
import { parseThrottleLog } from './browser/stall-attribution.mjs'

const sampler = { file: '/tmp/x.sampler.txt', startMs: 1000, endMs: 2000 }
const streamer = { startMs: 1000, endMs: 2000, samples: 10, p50Ms: 0.01, p99Ms: 0.02, maxMs: 0.03 }
const generator = { workers: 2, requestedDurationMs: 1000, startMs: 1000, endMs: 2000 }
const run = (label, condition, round, extra = {}) => ({ label, condition, round, sampler, streamer, generator: condition === 'G1' ? generator : null, ...extra })

gate('runRecord builds a G0 record with no generator and a G1 record with one', () => {
  const g0 = runRecord({ label: 'a', condition: 'G0', round: 1, sampler, streamer })
  assert.equal(g0.generator, null)
  assert.equal(g0.streamer.p99Ms, 0.02)
  const g1 = runRecord({ label: 'b', condition: 'G1', round: 1, sampler, generator, streamer })
  assert.equal(g1.generator.workers, 2)
})

gate('runRecord refuses a bad condition, round, label or window, and a generator that does not match its condition', () => {
  assert.throws(() => runRecord({ label: 'a', condition: 'G2', round: 1, sampler, streamer }), TypeError)
  assert.throws(() => runRecord({ label: 'a', condition: 'G0', round: 0, sampler, streamer }), TypeError)
  assert.throws(() => runRecord({ label: '', condition: 'G0', round: 1, sampler, streamer }), TypeError)
  assert.throws(() => runRecord({ label: 'a', condition: 'G0', round: 1, sampler: { ...sampler, endMs: 1000 }, streamer }), TypeError)
  assert.throws(() => runRecord({ label: 'a', condition: 'G0', round: 1, sampler, streamer, generator }), TypeError)
  assert.throws(() => runRecord({ label: 'b', condition: 'G1', round: 1, sampler, streamer }), TypeError)
  assert.throws(() => runRecord({ label: 'a', condition: 'G0', round: 1, sampler, streamer: { ...streamer, p99Ms: NaN } }), TypeError)
})

gate('pairRounds pairs each round by condition in round order and refuses a duplicate or a missing condition', () => {
  const pairs = pairRounds([run('g1r2', 'G1', 2), run('g0r2', 'G0', 2), run('g0r1', 'G0', 1), run('g1r1', 'G1', 1)])
  assert.deepEqual(pairs.map((p) => [p.round, p.g0.label, p.g1.label]), [[1, 'g0r1', 'g1r1'], [2, 'g0r2', 'g1r2']])
  assert.throws(() => pairRounds([run('a', 'G0', 1), run('b', 'G0', 1), run('c', 'G1', 1)]), RangeError)
  assert.throws(() => pairRounds([run('a', 'G0', 1)]), RangeError)
})

const samplerRows = []
for (let i = 0; i <= 10; i++) samplerRows.push(`${1000 + 100 * i} ${400000 * i} 0 0 ${50000 * i}`)
const samples = parseThrottleLog(samplerRows.join('\n') + '\n')
const result = {
  rowColumns: ['frame', 'startMs', 'tickMs', 'renderMs'],
  rows: [
    ...Array.from({ length: 10 }, (_, i) => [i, 1000 + 40 * i, 40, 0]),
    [10, 1500, 150, 0],
  ],
}

gate('summarizeRun takes the throttle and full-pressure deltas over its window and counts stalls inside it', () => {
  const summary = summarizeRun(run('g0r1', 'G0', 1), { samples, result })
  assert.equal(summary.throttleDeltaUs, 4000000)
  assert.equal(summary.fullDeltaMs, 500)
  assert.equal(summary.frames, 11)
  assert.equal(summary.medianFrameMs, 40)
  assert.equal(summary.stallCount, 1)
  assert.equal(summary.counts.starved, 1)
  assert.equal(summary.streamerP99Ms, 0.02)
})

gate('summarizeRun refuses a window with fewer than two sampler rows', () => {
  assert.throws(() => summarizeRun({ ...run('x', 'G0', 1), sampler: { ...sampler, startMs: 5000, endMs: 6000 } }, { samples, result }), RangeError)
})

const summary = (stallCount, fullDeltaMs = 10) => ({ stallCount, fullDeltaMs, counts: {}, throttleDeltaUs: 0 })
const pair = (round, g0Stalls, g1Stalls) => ({ round, g0: summary(g0Stalls, 10), g1: summary(g1Stalls, 40) })

gate('verdict is insufficient below two pairs, supported when G1 raises every pair, not-supported when it never does, and mixed otherwise', () => {
  assert.equal(verdict([pair(1, 0, 3)]), 'insufficient')
  assert.equal(verdict([pair(1, 0, 3), pair(2, 1, 4)]), 'supported')
  assert.equal(verdict([pair(1, 2, 2), pair(2, 0, 0)]), 'not-supported')
  assert.equal(verdict([pair(1, 0, 3), pair(2, 2, 1)]), 'mixed')
})

gate('report carries each pair, the verdict and the starvation ratio of G1 over G0', () => {
  const r = report([pair(1, 0, 3), pair(2, 1, 4)])
  assert.equal(r.verdict, 'supported')
  assert.equal(r.starvationRatio, 4)
  assert.equal(r.pairs.length, 2)
  assert.equal(report([{ round: 1, g0: summary(0, 0), g1: summary(1, 5) }]).starvationRatio, null)
})

finish()
