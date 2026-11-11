import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { classRecord, judge } from './kaggle/regress.mjs'
import { decide } from './kaggle/push-gate.mjs'
import { repeatedSpikes } from './kaggle/spikes.mjs'
import { BASELINE, buildPlan } from './kaggle/plan.mjs'
import { referenceGlue } from './kaggle/reference.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUDGET_MS = 16.7
const top = BASELINE.topTier

const tick = (variant, p99Ms, overBudget) => ({ kind: 'tick', variant, bodies: top.bodies, workers: top.workers, warm: true, p99Ms, overBudget })
const marble = (tier, cpuP99Ms, cpuOver25Repeated, cpuOver25 = cpuOver25Repeated) => ({ kind: 'marble-bowl', tier, clockSource: 'schedstat', spikeMs: 25, cpuP99Ms, cpuMaxMs: cpuP99Ms + 2, cpuOver25, cpuOver25Repeated, cpuOverBudget: 0, wallP99Ms: 40, wallMaxMs: 60, wallOver25: 9, wallOver25Repeated: 9, wallOverBudget: 30 })
const marbles = () => Array.from({ length: BASELINE.marble.tiers }, (_, i) => marble('tier ' + i, 12, 0))
const CLASS = 'TestVendor-1-2-3'
const SINGLE_MS = 500
const calibration = (singleMs = SINGLE_MS) => ({ kind: 'calibrate', singleMs, memoryMs: 170, laneSlowdown: 1.02 })
const run = (referenceP99, candidateP99, referenceOver = 0, candidateOver = 0, extra = marbles(), singleMs = SINGLE_MS) => ({
  budgetMs: BUDGET_MS,
  machine: { class: CLASS, modelName: 'Test CPU', cores: '2', siblings: '4', cache: '512 KB' },
  configs: [calibration(singleMs + 3), calibration(singleMs), ...Array.from({ length: top.repeats }, () => tick('reference', referenceP99, referenceOver)), ...Array.from({ length: top.repeats }, () => tick('base', candidateP99, candidateOver)), ...extra],
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

gate('the p99 limit is the larger of the reference times the factor and the reference plus the floor: the floor governs a 2 ms tier and the factor a 6 ms one', () => {
  const { p99Factor, p99FloorMs } = BASELINE.margin
  assert.ok(p99FloorMs > 0 && p99FloorMs <= 2)
  assert.ok(2 + p99FloorMs > 2 * p99Factor && 5.829 * p99Factor > 5.829 + p99FloorMs)
  assert.equal(judge(BASELINE, run(2, 2 + p99FloorMs - 0.01)).ok, true)
  assert.equal(judge(BASELINE, run(2, 2 + p99FloorMs + 0.01)).ok, false)
  assert.equal(judge(BASELINE, run(5.829, 6.156)).ok, true)
  assert.equal(judge(BASELINE, run(5.829, 5.829 * p99Factor - 0.01)).ok, true)
  const verdict = judge(BASELINE, run(5.829, 5.829 * p99Factor + 0.01))
  assert.equal(verdict.ok, false)
  assert.match(verdict.failures.join(' '), /median p99/)
})

gate('the p99 is the median of the repeats, so one slow repeat does not fail the run', () => {
  const results = run(12, 12)
  results.configs.find((c) => c.variant === 'base').p99Ms = 40
  assert.equal(judge(BASELINE, results).ok, true)
})

gate('more ticks over budget in the median run than the reference allows fails', () => {
  const limit = Math.floor(9 * BASELINE.margin.overBudgetFactor) + BASELINE.margin.overBudgetTicks
  assert.equal(judge(BASELINE, run(20, 20, 9, limit)).ok, true)
  const verdict = judge(BASELINE, run(20, 20, 9, limit + 1))
  assert.equal(verdict.ok, false)
  assert.match(verdict.failures.join(' '), /ticks over/)
  assert.equal(judge(BASELINE, run(12, 12, 0, BASELINE.margin.overBudgetTicks)).ok, true)
  assert.equal(judge(BASELINE, run(12, 12, 0, BASELINE.margin.overBudgetTicks + 1)).ok, false)
})

gate('one noisy repeat with many ticks over budget does not fail the run, as Kaggle run 12 had with identical builds', () => {
  const results = run(13.9, 14.25)
  const noisy = results.configs.find((c) => c.variant === 'base')
  noisy.p99Ms = 19.469
  noisy.overBudget = 17
  const verdict = judge(BASELINE, results)
  assert.equal(verdict.ok, true, verdict.failures.join('; '))
  assert.equal(verdict.topTier.candidateOverBudget, 0)
})

gate('a tick over budget is left out only when the run marks it as the host, and the verdict carries the count and the rule', () => {
  const limit = BASELINE.margin.overBudgetTicks
  const results = run(12, 12, 0, limit + 3)
  assert.equal(judge(BASELINE, results).ok, false, 'control: the same ticks with no host mark fail')
  for (const c of results.configs.filter((c) => c.variant === 'base')) {
    c.overBudgetHost = 3
    c.hostRule = 'a tick over budget is the host when a counter moved in it'
  }
  const verdict = judge(BASELINE, results)
  assert.equal(verdict.ok, true, verdict.failures.join('; '))
  assert.deepEqual(verdict.topTier.candidateHostExcludedEach, Array(top.repeats).fill(3))
  assert.deepEqual(verdict.topTier.candidateOverEach, Array(top.repeats).fill(limit))
  assert.match(verdict.topTier.hostRule, /counter moved/)
  for (const c of results.configs.filter((c) => c.variant === 'base')) c.overBudgetHost = 2
  assert.equal(judge(BASELINE, results).ok, false, 'one tick more than the host marks cover still fails')
})

gate('the p99 is judged over quiet ticks when every row has them: the identical builds of Kaggle run 27 are judged on their quiet ticks, and a build slower in quiet ticks fails', () => {
  const everyTick = { reference: [9.589, 6.68, 7.961, 9.148, 6.808], base: [8.645, 11.371, 6.539, 9.301, 9.672] }
  const noisy = (quietReference, quietCandidate) => {
    const results = run(0, 0)
    for (const variant of ['reference', 'base']) {
      results.configs.filter((c) => c.variant === variant).forEach((c, i) => {
        c.p99Ms = everyTick[variant][i]
        c.ticks = 900
        c.quietTicks = 800
        c.p99QuietMs = variant === 'reference' ? quietReference : quietCandidate
      })
    }
    return results
  }
  const control = noisy(6.4, 6.5)
  for (const c of control.configs) delete c.p99QuietMs
  const raw = judge(BASELINE, control)
  assert.equal(raw.topTier.p99Basis, 'every tick')
  assert.equal(raw.topTier.candidateP99Ms, 9.301)
  assert.ok(raw.topTier.candidateP99Ms > raw.topTier.referenceP99Ms * 1.1, 'control: over every tick the identical builds of run 27 are 17 percent apart')
  const quiet = judge(BASELINE, noisy(6.4, 6.5))
  assert.equal(quiet.ok, true, quiet.failures.join('; '))
  assert.equal(quiet.topTier.p99Basis, 'quiet ticks')
  assert.equal(quiet.topTier.candidateP99Ms, 6.5)
  assert.match(judge(BASELINE, noisy(6.4, 6.4 * BASELINE.margin.p99Factor + 0.1)).failures.join(' '), /median p99 over quiet ticks/)
  const fewQuiet = noisy(6.4, 6.5)
  fewQuiet.configs.find((c) => c.variant === 'base').quietTicks = 100
  assert.equal(judge(BASELINE, fewQuiet).topTier.p99Basis, 'every tick', 'a row with under half its ticks quiet puts the run back on every tick')
})

gate('the build is compared on the mean tick while bodies are awake: 8 percent over the reference passes, 12 percent fails, though the p99 is the same', () => {
  const withMeans = (referenceMean, candidateMean) => {
    const results = run(9, 9)
    for (const c of results.configs.filter((c) => c.kind === 'tick')) c.activeMeanMs = c.variant === 'reference' ? referenceMean : candidateMean
    return results
  }
  assert.ok(BASELINE.margin.meanFactor > 1 && BASELINE.margin.meanFactor <= 1.15)
  const inside = judge(BASELINE, withMeans(5.5, 5.5 * 1.08))
  assert.equal(inside.ok, true, inside.failures.join('; '))
  assert.equal(inside.topTier.referenceActiveMeanMs, 5.5)
  const outside = judge(BASELINE, withMeans(5.5, 5.5 * 1.12))
  assert.equal(outside.ok, false)
  assert.match(outside.failures.join(' '), /mean tick while bodies are awake/)
  assert.equal(judge(BASELINE, withMeans(5.39, 5.57)).ok, true, 'run 27, identical builds')
  assert.equal(judge(BASELINE, run(9, 9)).topTier.activeMeanLimitMs, null, 'rows with no mean are judged on the p99 and the count alone')
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

gate('a tick over 25 ms in one marble run of four is recorded and not judged, as Kaggle run 21 had at tick 202 of one run; the same tick in half the runs fails', () => {
  const once = judge(BASELINE, run(12, 12, 0, 0, [...marbles().slice(1), marble('once', 12, 0, 1)]))
  assert.equal(once.ok, true, once.failures.join('; '))
  assert.equal(once.marble.at(-1).over25InAnyRun, 1)
  assert.deepEqual(repeatedSpikes([[], [202], [], []]), [])
  assert.deepEqual(repeatedSpikes([[202], [202], [], []]), [202])
  assert.deepEqual(repeatedSpikes([[77], [202], [], []]), [], 'two runs with different ticks are two single stalls')
  assert.deepEqual(repeatedSpikes([[75, 76], [76], [76, 90], [76]]), [76])
  assert.deepEqual(repeatedSpikes([[5]]), [5], 'with one run every tick over the limit counts')
  assert.throws(() => repeatedSpikes([]), /at least one run/)
  const unlabelled = marbles()
  delete unlabelled[0].cpuOver25Repeated
  assert.match(judge(BASELINE, run(12, 12, 0, 0, unlabelled)).failures.join(' '), /no count of repeated ticks/)
})

gate('without the CPU clock the marble bowl is judged on wall time', () => {
  const wallOnly = marbles().map((c) => ({ ...c, clockSource: 'performance.now', wallP99Ms: 12, wallOver25: 0, wallOver25Repeated: 0 }))
  assert.equal(judge(BASELINE, run(12, 12, 0, 0, wallOnly)).ok, true)
  assert.equal(judge(BASELINE, run(12, 12, 0, 0, wallOnly.map((c) => ({ ...c, wallOver25: 1, wallOver25Repeated: 1 })))).ok, false)
})

gate('the push gate refuses a missing verdict, a verdict for another payload and a failed verdict, and passes a matching one', () => {
  assert.equal(decide(null, 'a'.repeat(64)).ok, false)
  assert.match(decide({ ok: true, payloadSha256: 'b'.repeat(64), version: 3 }, 'a'.repeat(64)).reason, /this tree packs/)
  assert.match(decide({ ok: false, payloadSha256: 'a'.repeat(64), failures: ['top tier median p99'] }, 'a'.repeat(64)).reason, /failed: top tier median p99/)
  assert.equal(decide({ ok: true, payloadSha256: 'a'.repeat(64), version: 3 }, 'a'.repeat(64)).ok, true)
})

const withClass = (entry) => ({ ...BASELINE, classes: { [CLASS]: { referenceCommit: BASELINE.referenceCommit, singleMs: SINGLE_MS, referenceP99Ms: 12, holds: true, ...entry } } })

gate('a class with no record passes and is reported as unrecorded, and results with no class or no calibration fail', () => {
  const verdict = judge(BASELINE, run(12, 12))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.machineClass.recorded, false)
  assert.equal(verdict.machineClass.class, CLASS)
  assert.equal(verdict.machineClass.singleMs, SINGLE_MS)
  const noClass = run(12, 12)
  delete noClass.machine
  assert.match(judge(BASELINE, noClass).failures.join(' '), /no machine class/)
  const noCalibration = run(12, 12)
  noCalibration.configs = noCalibration.configs.filter((c) => c.kind !== 'calibrate')
  assert.match(judge(BASELINE, noCalibration).failures.join(' '), /no calibration/)
})

gate('on a recorded class the reference build fails when it runs past its recorded p99 times the drift factor, though the candidate matches it', () => {
  const limit = 12 * BASELINE.drift.p99Factor
  assert.equal(judge(withClass({ holds: false }), run(limit - 0.01, limit - 0.01)).ok, true)
  const verdict = judge(withClass({ holds: false }), run(limit + 0.01, limit + 0.01))
  assert.equal(verdict.ok, false)
  assert.match(verdict.failures.join(' '), /the reference build itself ran/)
  assert.equal(judge(BASELINE, run(limit + 0.01, limit + 0.01)).ok, true, 'the same figures on an unrecorded class are the control')
})

gate('a machine that calibrates slower than its class record raises the reference limit by that ratio, and a faster one does not lower it', () => {
  const limit = 12 * BASELINE.drift.p99Factor
  const slow = judge(withClass({ holds: false }), run(limit * 1.15, limit * 1.15, 0, 0, marbles(), SINGLE_MS * 1.2))
  assert.equal(slow.ok, true, slow.failures.join('; '))
  assert.equal(slow.machineClass.calibrationScale, 1.2)
  assert.equal(judge(withClass({ holds: false }), run(limit * 1.25, limit * 1.25, 0, 0, marbles(), SINGLE_MS * 1.2)).ok, false)
  const fast = judge(withClass({ holds: false }), run(limit - 0.01, limit - 0.01, 0, 0, marbles(), SINGLE_MS * 0.8))
  assert.equal(fast.ok, true)
  assert.equal(fast.machineClass.calibrationScale, 1)
})

gate('a class recorded as holding fails when the candidate has a tick over budget in the median run or a p99 over it', () => {
  assert.equal(judge(withClass({}), run(12, 12)).ok, true)
  assert.match(judge(withClass({}), run(12, 12, 0, 1)).failures.join(' '), /recorded as holding/)
  assert.match(judge(withClass({ referenceP99Ms: 16 }), run(16, 16.8)).failures.join(' '), /recorded as holding/)
  assert.equal(judge(withClass({ holds: false }), run(12, 12, 0, 1)).ok, true)
})

gate('a class record with a mean awake tick is judged on that mean: the reference of Kaggle run 28 passes the record of run 32 though its p99 is 1.8 times the recorded one, and a mean past the limit fails', () => {
  const record = withClass({ holds: false, referenceP99Ms: 5.048, referenceActiveMeanMs: 4.165, singleMs: 523.5 })
  const results = (referenceMean) => {
    const r = run(9.079, 8.046, 0, 0, marbles(), 574.1)
    for (const c of r.configs.filter((c) => c.kind === 'tick')) c.activeMeanMs = c.variant === 'reference' ? referenceMean : referenceMean * 0.98
    return r
  }
  const run28 = judge(record, results(5.97))
  assert.equal(run28.ok, true, run28.failures.join('; '))
  assert.equal(run28.machineClass.driftBasis, 'mean tick while bodies are awake')
  const slow = judge(record, results(4.165 * BASELINE.drift.p99Factor * 1.2))
  assert.equal(slow.ok, false)
  assert.match(slow.failures.join(' '), /the reference build itself ran a median mean tick/)
})

gate('a class record made for another reference commit is not judged and is reported as stale', () => {
  const stale = withClass({ referenceCommit: 'f'.repeat(40), referenceP99Ms: 1 })
  const verdict = judge(stale, run(12, 12))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.machineClass.recorded, false)
  assert.equal(verdict.machineClass.staleRecord, true)
})

gate('a passing verdict becomes a class record with its reference figure and calibration, and a failed one is refused', () => {
  const verdict = { ...judge(BASELINE, run(12, 11.5)), version: 16, referenceCommit: BASELINE.referenceCommit }
  const { name, entry } = classRecord(verdict)
  assert.equal(name, CLASS)
  assert.deepEqual({ referenceP99Ms: entry.referenceP99Ms, candidateP99Ms: entry.candidateP99Ms, singleMs: entry.singleMs, holds: entry.holds, kaggleRun: entry.kaggleRun, referenceCommit: entry.referenceCommit }, { referenceP99Ms: 12, candidateP99Ms: 11.5, singleMs: SINGLE_MS, holds: true, kaggleRun: 16, referenceCommit: BASELINE.referenceCommit })
  const missed = { ...judge(BASELINE, run(18, 18, 3, 3)), version: 16, referenceCommit: BASELINE.referenceCommit }
  assert.equal(classRecord(missed).entry.holds, false)
  assert.throws(() => classRecord({ ...verdict, ok: false }), /failed verdict/)
})

gate('every class in the baseline is recorded for a full commit with a positive calibration and reference figure', () => {
  for (const [name, entry] of Object.entries(BASELINE.classes)) {
    assert.match(name, /^[A-Za-z]+-\d+-\d+-\d+$/, name)
    assert.match(entry.referenceCommit, /^[0-9a-f]{40}$/)
    assert.ok(entry.singleMs > 0 && entry.referenceP99Ms > 0, name)
    assert.equal(typeof entry.holds, 'boolean')
  }
  assert.ok(BASELINE.drift.p99Factor > 1 && BASELINE.drift.p99Factor < 2)
})

gate('the regress plan runs the reference and the candidate alternately at the top tier, warmed, then the marble tiers after a warm run, between two calibrations', () => {
  const plan = buildPlan('regress')
  assert.equal(plan.runs[0].script, 'scripts/kaggle/calibrate.mjs')
  assert.equal(plan.runs.at(-1).script, 'scripts/kaggle/calibrate.mjs')
  const ticks = plan.runs.filter((r) => r.glueArg >= 0)
  assert.equal(ticks.length, top.repeats * 2)
  ticks.forEach((r, i) => {
    assert.equal(r.args[0].startsWith('build/reference/'), i % 2 === 0, 'row ' + i + ' glue ' + r.args[0])
    assert.deepEqual(r.args.slice(1, 3), [String(top.bodies), String(top.workers)])
    assert.equal(r.args[7], 'warm')
  })
  assert.equal(ticks[0].args[0], referenceGlue(BASELINE.referenceCommit))
  const marbleRuns = plan.runs.filter((r) => r.script === 'scripts/kaggle/marble.mjs')
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
