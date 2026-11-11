import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { judge } from './kaggle/regress.mjs'
import { decide } from './kaggle/push-gate.mjs'
import { BASELINE, buildPlan } from './kaggle/plan.mjs'
import { referenceGlue } from './kaggle/reference.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUDGET_MS = 16.7
const top = BASELINE.topTier

const tick = (variant, p99Ms, overBudget) => ({ kind: 'tick', variant, bodies: top.bodies, workers: top.workers, warm: true, p99Ms, overBudget })
const marble = (tier, cpuP99Ms, cpuOver25) => ({ kind: 'marble-bowl', tier, clockSource: 'schedstat', spikeMs: 25, cpuP99Ms, cpuMaxMs: cpuP99Ms + 2, cpuOver25, cpuOverBudget: 0, wallP99Ms: 40, wallMaxMs: 60, wallOver25: 9, wallOverBudget: 30 })
const marbles = () => Array.from({ length: BASELINE.marble.tiers }, (_, i) => marble('tier ' + i, 12, 0))
const run = (referenceP99, candidateP99, referenceOver = 0, candidateOver = 0, extra = marbles()) => ({
  budgetMs: BUDGET_MS,
  configs: [...Array.from({ length: top.repeats }, () => tick('reference', referenceP99, referenceOver)), ...Array.from({ length: top.repeats }, () => tick('base', candidateP99, candidateOver)), ...extra],
})

gate('a candidate that matches the reference build passes, on a fast machine and on a slow one', () => {
  assert.equal(judge(BASELINE, run(12, 12)).ok, true)
  assert.equal(judge(BASELINE, run(21, 21, 9, 9)).ok, true)
})

gate('a candidate whose median p99 is past the reference times the margin fails, and one just inside it passes', () => {
  const inside = Number((12 * BASELINE.margin.p99Factor - 0.01).toFixed(3))
  const outside = Number((12 * BASELINE.margin.p99Factor + 0.01).toFixed(3))
  assert.equal(judge(BASELINE, run(12, inside)).ok, true)
  const verdict = judge(BASELINE, run(12, outside))
  assert.equal(verdict.ok, false)
  assert.match(verdict.failures.join(' '), /median p99/)
})

gate('the p99 is the median of the repeats, so one slow repeat does not fail the run', () => {
  const results = run(12, 12)
  results.configs.find((c) => c.variant === 'base').p99Ms = 40
  assert.equal(judge(BASELINE, results).ok, true)
})

gate('more ticks over budget than the reference allows fails', () => {
  const allowedEach = Math.floor((Math.floor(9 * top.repeats * BASELINE.margin.overBudgetFactor) + BASELINE.margin.overBudgetTicks) / top.repeats)
  assert.equal(judge(BASELINE, run(20, 20, 9, allowedEach)).ok, true)
  const verdict = judge(BASELINE, run(20, 20, 9, allowedEach + 2))
  assert.equal(verdict.ok, false)
  assert.match(verdict.failures.join(' '), /ticks over/)
  assert.equal(judge(BASELINE, run(12, 12, 0, Math.ceil((BASELINE.margin.overBudgetTicks + 1) / top.repeats) + 1)).ok, false)
})

gate('missing reference rows, missing candidate rows, a missing marble tier and a run with no result each fail', () => {
  const noReference = run(12, 12)
  noReference.configs = noReference.configs.filter((c) => c.variant !== 'reference')
  assert.match(judge(BASELINE, noReference).failures.join(' '), /reference rows: 0/)
  const noCandidate = run(12, 12)
  noCandidate.configs = noCandidate.configs.filter((c) => c.variant !== 'base')
  assert.match(judge(BASELINE, noCandidate).failures.join(' '), /candidate rows: 0/)
  assert.match(judge(BASELINE, run(12, 12, 0, 0, marbles().slice(1))).failures.join(' '), /marble tiers/)
  const broken = run(12, 12)
  broken.configs.push({ error: 'timeout' })
  assert.match(judge(BASELINE, broken).failures.join(' '), /no result/)
})

gate('the marble bowl fails on a p99 over its budget or a tick over 25 ms of CPU time, and wall time is not judged when the CPU clock is there', () => {
  assert.equal(judge(BASELINE, run(12, 12)).ok, true)
  assert.match(judge(BASELINE, run(12, 12, 0, 0, [...marbles().slice(1), marble('slow', BASELINE.marble.p99Ms + 0.1, 0)])).failures.join(' '), /p99/)
  assert.match(judge(BASELINE, run(12, 12, 0, 0, [...marbles().slice(1), marble('spike', 12, 1)])).failures.join(' '), /ticks over 25 ms/)
})

gate('without the CPU clock the marble bowl is judged on wall time', () => {
  const wallOnly = marbles().map((c) => ({ ...c, clockSource: 'performance.now', wallP99Ms: 12, wallOver25: 0 }))
  assert.equal(judge(BASELINE, run(12, 12, 0, 0, wallOnly)).ok, true)
  assert.equal(judge(BASELINE, run(12, 12, 0, 0, wallOnly.map((c) => ({ ...c, wallOver25: 1 })))).ok, false)
})

gate('the push gate refuses a missing verdict, a verdict for another payload and a failed verdict, and passes a matching one', () => {
  assert.equal(decide(null, 'a'.repeat(64)).ok, false)
  assert.match(decide({ ok: true, payloadSha256: 'b'.repeat(64), version: 3 }, 'a'.repeat(64)).reason, /this tree packs/)
  assert.match(decide({ ok: false, payloadSha256: 'a'.repeat(64), failures: ['top tier median p99'] }, 'a'.repeat(64)).reason, /failed: top tier median p99/)
  assert.equal(decide({ ok: true, payloadSha256: 'a'.repeat(64), version: 3 }, 'a'.repeat(64)).ok, true)
})

gate('the regress plan runs the reference and the candidate alternately at the top tier, warmed, then the marble tiers after a warm run', () => {
  const plan = buildPlan('regress')
  const ticks = plan.runs.filter((r) => r.glueArg >= 0)
  assert.equal(ticks.length, top.repeats * 2)
  ticks.forEach((r, i) => {
    assert.equal(r.args[0].startsWith('build/reference/'), i % 2 === 0, 'row ' + i + ' glue ' + r.args[0])
    assert.deepEqual(r.args.slice(1, 3), [String(top.bodies), String(top.workers)])
    assert.equal(r.args[7], 'warm')
  })
  assert.equal(ticks[0].args[0], referenceGlue(BASELINE.referenceCommit))
  const marbleRuns = plan.runs.filter((r) => r.glueArg < 0)
  assert.equal(marbleRuns.length, BASELINE.marble.tiers)
  marbleRuns.forEach((r) => assert.deepEqual(r.args.slice(1), [String(BASELINE.marble.runs), String(BASELINE.marble.warmRuns)]))
  assert.ok(BASELINE.marble.warmRuns >= 1)
})

gate('the baseline names a full commit, margins above one and the hook runs the push gate', () => {
  assert.match(BASELINE.referenceCommit, /^[0-9a-f]{40}$/)
  assert.ok(BASELINE.margin.p99Factor > 1 && BASELINE.margin.p99Factor < 1.5)
  assert.ok(BASELINE.margin.overBudgetFactor >= 1)
  assert.equal(BASELINE.marble.p99Ms, BUDGET_MS)
  assert.match(readFileSync(join(root, '.githooks/pre-push'), 'utf8'), /scripts\/kaggle\/push-gate\.mjs/)
})

finish()
