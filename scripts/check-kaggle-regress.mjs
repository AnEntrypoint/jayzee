import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { classRecord, judge } from './kaggle/regress.mjs'
import { decide } from './kaggle/push-gate.mjs'
import { repeatedSpikes } from './kaggle/spikes.mjs'
import { BASELINE, PROFILE_COMPACT_REPEATS, PROFILE_REPEATS, PROFILE_UNRECLAIMED_REPEATS, PROFILE_VARIANT, RECLAIM_OFF, RELEASE_ORDER_REPEATS, TUNE_DEFAULT, TUNE_DEFAULT_BY_SLOT, buildPlan } from './kaggle/plan.mjs'
import { describeSlowTick } from './kaggle/tickProfile.mjs'
import { canaryStalls, densestPhase, nearPhase, overBudgetTimes, periodFit, phaseShare, slowTickTimes } from './kaggle/slowTickClock.mjs'
import { PIPE_BYTES, distinctDryRows, judgePreflight } from './kaggle/preflight.mjs'
import { spawnSync } from 'node:child_process'
import { referenceGlue } from './kaggle/reference.mjs'
import { COLD_START_S, coldStartOf, describeColdStart, describeFollows, followsOf, rowsOfResults, startLogStream, streamRows } from './kaggle/stream.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

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

gate('record rows in the gate run are not judged: a slow record row at the top tier leaves the verdict alone, and with no gate role every matching row is judged', () => {
  const results = run(12, 12)
  for (const c of results.configs.filter((c) => c.kind === 'tick')) c.role = 'gate'
  results.configs.push({ ...tick('base', 99, 400), role: 'record' })
  const verdict = judge(BASELINE, results)
  assert.equal(verdict.ok, true, verdict.failures.join('; '))
  assert.equal(verdict.topTier.candidateP99EachMs.length, top.repeats)
  const legacy = run(12, 12)
  legacy.configs.push(tick('base', 99, 400))
  assert.equal(judge(BASELINE, legacy).topTier.candidateP99EachMs.length, top.repeats + 1)
})

gate('a tick over budget with no host mark stays counted and is carried in the verdict with its counters', () => {
  const results = run(12, 12)
  const row = results.configs.find((c) => c.variant === 'base')
  row.overBudget = 1
  row.overTicks = [{ tick: 285, ms: 31.78, host: false, awake: 3969, released: 107, minorFaults: 300, majorFaults: 0, involuntarySwitches: 0, systemJiffies: 2, arenaGrowthBytes: 65536, memoryGrowthBytes: 0, engineRunMs: 120, waitMaxMs: 0.02 }, { tick: 90, ms: 18, host: true }]
  const verdict = judge(BASELINE, results)
  assert.equal(verdict.topTier.candidateUnmarkedOverTicks.length, 1)
  assert.equal(verdict.topTier.candidateUnmarkedOverTicks[0].tick, 285)
  assert.deepEqual(verdict.topTier.candidateOverEach.slice(0, 1), [1])
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
  assert.equal(plan.runs.filter((r) => r.dryOnly !== true).at(-1).script, 'scripts/kaggle/calibrate.mjs')
  assert.deepEqual(plan.runs.filter((r) => r.dryOnly === true).map((r) => r.script), ['scripts/kaggle/pipeProbe.mjs'])
  const ticks = plan.runs.filter((r) => r.role === 'gate')
  assert.equal(ticks.length, top.repeats * 2)
  const record = plan.runs.filter((r) => r.role === 'record')
  assert.ok(record.length >= 4 && record.every((r) => r.script === 'scripts/kaggle/bench.mjs'), 'the gate run carries no record rows')
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

gate('a slow tick is described by the scopes that took more than in a quiet tick, the time outside the engine, and each thread widest gap', () => {
  const scopes = 4
  const lanes = 2
  const names = ['engine tick batch', 'FindCollisions', 'Island', 'engine pose export']
  const table = Float64Array.from([18, 1, 18, 0, 3, 4, 2, 1, 14, 900, 11, 5, 1, 1, 1, 18.5, 40, 11, 5, 2, 1, 0, 0, 0, 0, 0])
  const described = describeSlowTick({ ms: 20, table, scopes, lanes, names, quietMeanMs: Float64Array.of(6, 2.5, 3, 1), quietMaxMs: Float64Array.of(9, 4, 5, 1.5), quietMeanCalls: Float64Array.of(1, 4, 880, 1) })
  assert.equal(described.outsideEngineMs, 1)
  assert.deepEqual(described.scopes.map((row) => row.scope), ['engine tick batch', 'Island', 'FindCollisions', 'engine pose export'])
  assert.equal(described.scopes[1].overQuietMs, 11)
  assert.equal(described.scopes[1].longestMs, 11)
  assert.equal(described.scopes[1].longestAtMs, 5)
  assert.deepEqual(described.threads, [{ lane: 0, events: 40, widestGapMs: 11, gapAtMs: 5, gapEndsAt: 'end of Island' }])
})

gate('slow ticks are placed on the clock of the kernel run, and gaps that are whole multiples of ten seconds are counted against what chance would give', () => {
  const quiet = (count) => Array.from({ length: count }, () => 5)
  const row = (slowAt) => {
    const traceMs = quiet(400)
    if (slowAt !== null) traceMs[slowAt] = 30
    return { kind: 'tick', runS: 10, warmMs: 1000, loadMs: 500, setupMs: 500, traceMs }
  }
  const results = { configs: [{ kind: 'calibrate', runS: 3 }, row(100), row(100), row(null), row(100), row(260)] }
  const events = slowTickTimes(results)
  assert.deepEqual(events.map((event) => [event.row, event.tick, event.atS]), [[1, 100, 5.5], [2, 100, 15.5], [4, 100, 35.5], [5, 260, 46.3]])
  const fit = periodFit(events)
  assert.deepEqual(fit.gaps.map((gap) => [gap.periods, gap.offS]), [[1, 0], [2, 0], [1, 0.8]])
  assert.equal(fit.near, 2)
  assert.equal(fit.chanceShare, 0.15)
  const boot = row(null)
  boot.traceMs[0] = 40
  assert.equal(slowTickTimes({ configs: [boot] }).length, 0)
})

gate('a result line of 300 KB, over the 64 KB of a pipe, arrives whole through the shared emit', () => {
  const whole = spawnSync(process.execPath, [join(root, 'scripts/kaggle/pipeProbe.mjs'), '300000'], { encoding: 'utf8' })
  const line = whole.stdout.split('\n').find((text) => text.startsWith('RESULT '))
  assert.ok(line.length > 300000)
  assert.equal(JSON.parse(line.slice(7)).filler.length, 300000)
  assert.ok(line.length > PIPE_BYTES)
  for (const script of ['bench.mjs', 'canary.mjs', 'pipeProbe.mjs']) {
    const source = readFileSync(join(root, 'scripts/kaggle', script), 'utf8')
    assert.ok(source.includes("import { emitResult } from './emit.mjs'"), script + ' does not use the shared emit')
    assert.ok(!/console\.log\('RESULT/.test(source), script + ' logs its result and may exit before the pipe is drained')
  }
})

gate('the dry run judges every distinct row: a failed row, a missing field, a short plan and a run with no line over the pipe size are each refused', () => {
  const plan = buildPlan('regress')
  const distinct = distinctDryRows(plan)
  assert.ok(distinct.length < plan.runs.length && distinct.length >= 15, distinct.length + ' distinct rows')
  const stamp = { startedAtEpochS: 1, endedAtEpochS: 2 }
  const good = distinct.map((run) => {
    if (run.script.endsWith('bench.mjs')) return { ...stamp, script: run.script, args: run.dryArgs, kind: 'tick', resultBytes: 50000, p99Ms: 1, maxMs: 1, overBudget: 1, activeMeanMs: 1, p99QuietMs: 1, loopStartedEpochMs: 5, arenaBytes: 9, overTicks: [{ epochMs: 7 }], profile: { slow: [{}] } }
    if (run.script.endsWith('marble.mjs')) return { ...stamp, script: run.script, args: run.dryArgs, kind: 'marble-bowl', resultBytes: 900, cpuP99Ms: 1, cpuMaxMs: 1, perRun: [] }
    if (run.script.endsWith('canary.mjs')) return { ...stamp, script: run.script, args: run.dryArgs, kind: 'canary', resultBytes: 300, gapCount: 0, over5Ms: 0, startedEpochMs: 4 }
    if (run.script.endsWith('pipeProbe.mjs')) return { ...stamp, script: run.script, args: run.dryArgs, kind: 'pipe-probe', resultBytes: 300040, bytes: 300000, filler: 'x' }
    return { ...stamp, script: run.script, args: run.dryArgs, kind: 'calibrate', resultBytes: 200, singleMs: 500 }
  })
  assert.deepEqual(judgePreflight({ dry: true, configs: good }, plan), { failures: [], rows: distinct.length, mostResultBytes: 300040 })
  const failuresOf = (configs, dry = true) => judgePreflight({ dry, configs }, plan).failures
  assert.match(failuresOf(good, false)[0], /did not run dry/)
  assert.match(failuresOf(good.slice(1))[0], /ran \d+ rows of \d+/)
  assert.match(failuresOf(good.map((row, i) => (i === 1 ? { ...row, error: 'unreadable result: Unterminated string' } : row)))[0], /unreadable result/)
  assert.match(failuresOf(good.map((row, i) => (i === 1 ? { ...row, p99QuietMs: null } : row)))[0], /has no p99QuietMs/)
  assert.match(failuresOf(good.map((row) => (row.kind === 'tick' ? { ...row, overTicks: [] } : row)))[0], /marked no tick as over/)
  assert.match(failuresOf(good.map((row) => (row.kind === 'pipe-probe' ? { ...row, resultBytes: 4000 } : row)))[0], /no result line was over/)
})

gate('canary stalls and stamped slow ticks are placed on one clock, and their share near one phase of the ten-second period is counted', () => {
  const results = { startedAtEpochS: 1000, configs: [
    { kind: 'canary', threads: 1, seconds: 45, gaps: [{ thread: 0, epochMs: 1003200, gapMs: 6.5, runQueueMs: 0 }, { thread: 0, epochMs: 1013300, gapMs: 6.8, runQueueMs: 0.2 }, { thread: 0, epochMs: 1017000, gapMs: 7, runQueueMs: 6.9 }, { thread: 0, epochMs: 1018000, gapMs: 2, runQueueMs: 0 }] },
    { kind: 'tick', runS: 9, loopStartedEpochMs: 1021000, traceMs: [5, 5, 5, ...Array.from({ length: 440 }, () => 5), 30, 5] },
  ] }
  const stalls = canaryStalls(results)
  assert.deepEqual(stalls.map((stall) => [stall.atS, stall.unseen]), [[3.2, true], [13.3, true], [17, false]])
  const ticks = slowTickTimes(results)
  assert.deepEqual(ticks.map((tick) => [tick.tick, tick.clock]), [[443, 'stamped']])
  assert.ok(Math.abs(ticks[0].atS - 23.215) < 0.011)
  const share = phaseShare([...stalls.filter((stall) => stall.unseen), ...ticks])
  assert.equal(share.events, 3)
  assert.equal(share.near, 3)
  assert.ok(Math.abs(share.phaseS - 3.24) < 0.05, 'phase ' + share.phaseS)
  assert.equal(phaseShare([{ atS: 1 }, { atS: 6 }, { atS: 3.4 }, { atS: 8.5 }]).near <= 2, true)
  assert.equal(phaseShare([]).events, 0)
  const lattice = [{ atS: 240.05 }, { atS: 250.09 }, { atS: 260.05 }, { atS: 233.0 }, { atS: 270.12 }]
  assert.equal(densestPhase(lattice), 0.25)
  assert.equal(densestPhase([]), null)
  assert.deepEqual(nearPhase(lattice, 0.25), { events: 5, near: 4, phaseS: 0.25, chanceShare: 0.15 })
  assert.equal(nearPhase([{ atS: 109.84 }], 0.25).near, 1)
  const stamped = { startedAtEpochS: 1000, configs: [{ kind: 'tick', workers: 4, role: 'gate', overTicks: [{ tick: 9, ms: 18, host: true, epochMs: 1090070 }, { tick: 12, ms: 19, host: false }] }, { kind: 'tick', workers: 1, role: 'record', overTicks: [{ tick: 1, ms: 30, host: false, epochMs: 1001000 }] }] }
  assert.deepEqual(overBudgetTimes(stamped), [{ row: 0, role: 'gate', tick: 9, ms: 18, host: true, atS: 90.07 }])
})

gate('the regress plan carries the profile build at the top tier as rows the gate does not judge', () => {
  const rows = buildPlan('regress').runs.filter((run) => run.role === 'profile')
  assert.equal(rows.length, PROFILE_REPEATS + PROFILE_UNRECLAIMED_REPEATS + PROFILE_COMPACT_REPEATS)
  assert.equal(rows.filter((row) => row.args[9] === RECLAIM_OFF).length, PROFILE_UNRECLAIMED_REPEATS)
  for (const row of rows) assert.ok(row.args[0].includes('/variants/' + PROFILE_VARIANT + '/'))
  assert.equal(rows.filter((row) => Number(row.args[1]) === top.bodies).length, PROFILE_REPEATS + PROFILE_UNRECLAIMED_REPEATS)
  assert.ok(PROFILE_REPEATS >= 5 && PROFILE_COMPACT_REPEATS >= 3)
})

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

gate('the log stream fills its file while its command runs, restarts a command that ended early, and stop leaves neither the command nor its guard behind', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaggle-stream-'))
  const path = join(dir, 'stream.log')
  const stream = startLogStream({ command: 'sh', args: ['-c', 'i=0; while [ $i -lt 4 ]; do echo "line $i"; i=$((i+1)); sleep 0.05; done'], path })
  const long = startLogStream({ command: 'sh', args: ['-c', 'while true; do echo tick; sleep 0.05; done'], path: join(dir, 'long.log') })
  try {
    const first = stream.pid()
    await new Promise((done) => setTimeout(done, 600))
    const whole = stream.bytes()
    assert.ok(whole > 0, 'the stream file is empty after the command ran')
    assert.equal(alive(first), false, 'the short command is still alive')
    stream.keepRunning()
    assert.equal(stream.starts(), 2)
    assert.notEqual(stream.pid(), first)
    await new Promise((done) => setTimeout(done, 600))
    assert.equal(stream.bytes(), whole, 'a restarted stream replays the log from its start, so the file holds it once and not twice')
    const longPid = long.pid()
    assert.equal(alive(longPid), true)
    const growing = long.bytes()
    await new Promise((done) => setTimeout(done, 300))
    assert.ok(long.bytes() > growing, 'the stream file did not grow while its command ran')
    const stoppedLong = await long.stop()
    assert.equal(stoppedLong.pid, longPid)
    assert.equal(alive(longPid), false, 'the stream command outlived stop')
    assert.equal(alive(stoppedLong.guardPid), false, 'the guard outlived stop')
    const stopped = await stream.stop()
    assert.equal(alive(stopped.guardPid), false)
  } finally {
    await long.stop()
    await stream.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

gate('live rows are read out of a streamed log whatever wraps them, and the cold-start comparison splits them at ' + COLD_START_S + ' s', () => {
  const live = (atS, variant, maxMs, overBudget, overBudgetHost) => ({ index: 0, atS, role: 'gate', kind: 'tick', variant, bodies: top.bodies, workers: top.workers, warm: true, activeMeanMs: 6, maxMs, overBudget, overBudgetHost })
  const text = ['noise', 'ROW ' + JSON.stringify(live(8, 'reference', 54.8, 1, 1)), '{"stream_name":"stdout","time":1.5,"data":"ROW ' + JSON.stringify(live(19, 'base', 25.9, 2, 1)).replaceAll('"', '\\"') + '\\n"}', 'ROW ' + JSON.stringify(live(180, 'base', 12.5, 0, 0)), 'ROW {broken'].join('\n')
  const rows = streamRows(text)
  assert.deepEqual(rows.map((row) => row.maxMs), [54.8, 25.9, 12.5])
  const cold = coldStartOf(rows, top)
  assert.deepEqual([cold.earlyRows, cold.lateRows, cold.earlyWorstMs, cold.lateWorstMs, cold.earlyCounted, cold.lateCounted], [2, 1, 54.8, 12.5, 1, 0])
  assert.match(describeColdStart(cold), /first 100 s of the session: 2, worst tick 54.8 ms/)
  const fromResults = rowsOfResults({ startedAtEpochS: 1000, configs: [{ kind: 'tick', startedAtEpochS: 1008, role: 'gate', variant: 'base', bodies: top.bodies, workers: top.workers, warm: true, maxMs: 30, overBudget: 1, overBudgetHost: 0 }, { kind: 'calibrate', startedAtEpochS: 1001 }] })
  assert.deepEqual(fromResults.map((row) => [row.atS, row.maxMs]), [[8, 30]])
})

gate('rows are split by whether the row before them ran the other build, which is where runs 42 to 51 had their counted ticks', () => {
  const row = (variant, maxMs, overBudget, overBudgetHost, extra = {}) => ({ variant, bodies: top.bodies, workers: top.workers, warm: true, maxMs, overBudget, overBudgetHost, ...extra })
  const groups = followsOf([row('reference', 12, 0, 0), row('base', 40, 2, 1), row('reference', 30, 1, 1), row('base', 20, 1, 0), row('base', 12, 0, 0), { kind: 'calibrate' }, row('base', 55, 3, 0), row('base', 9, 0, 0, { workers: 1 }), row('base', 14, 0, 0)], top)
  assert.deepEqual(groups.afterOtherBuild, { rows: 3, counted: 2, worstMs: 40, rowsWithCounted: 2 })
  assert.deepEqual(groups.afterSameBuild, { rows: 2, counted: 0, worstMs: 14, rowsWithCounted: 0 })
  assert.match(describeFollows(groups), /after a row of the other build: 3, 2 with a counted tick/)
})

gate('release by view is judged against release in slot order on eight alternated pairs at the top tier, not on rows run in one block', () => {
  const rows = buildPlan('regress').runs.filter((run) => run.role === 'release order')
  const knobs = rows.map((row) => row.args[9])
  assert.equal(knobs.length, 2 * RELEASE_ORDER_REPEATS)
  assert.ok(RELEASE_ORDER_REPEATS >= 8)
  knobs.forEach((knob, i) => assert.equal(knob, 'tune=' + (i % 2 === 0 ? TUNE_DEFAULT : TUNE_DEFAULT_BY_SLOT)))
  assert.equal(TUNE_DEFAULT_BY_SLOT - TUNE_DEFAULT, 16)
  assert.ok(rows.every((row) => row.args[1] === String(BASELINE.topTier.bodies)))
})

gate('the baseline names a full commit, margins above one and the hook runs the push gate', () => {
  assert.match(BASELINE.referenceCommit, /^[0-9a-f]{40}$/)
  assert.ok(BASELINE.margin.p99Factor > 1 && BASELINE.margin.p99Factor < 1.5)
  assert.ok(BASELINE.margin.overBudgetFactor >= 1)
  assert.equal(BASELINE.marble.p99Ms, BUDGET_MS)
  assert.match(readFileSync(join(root, '.githooks/pre-push'), 'utf8'), /scripts\/kaggle\/push-gate\.mjs/)
})

finish()
