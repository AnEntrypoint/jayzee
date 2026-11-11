import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MODES = Object.freeze({ regress: 'build/kaggle/verdict.json', control: 'build/kaggle/control-verdict.json' })
const BASELINE_PATH = join(root, 'scripts/kaggle/baseline.json')

const calibratedSingleMs = (results) => {
  const rows = results.configs.filter((c) => c.kind === 'calibrate' && !c.error && Number.isFinite(c.singleMs))
  return rows.length ? Math.min(...rows.map((c) => c.singleMs)) : null
}

export const judgeClass = (baseline, results, top) => {
  const failures = []
  const machine = results.machine ?? null
  const name = machine?.class ?? null
  const singleMs = calibratedSingleMs(results)
  const entry = name !== null && Object.hasOwn(baseline.classes ?? {}, name) ? baseline.classes[name] : null
  const current = entry !== null && entry.referenceCommit === baseline.referenceCommit
  const summary = { class: name, modelName: machine?.modelName ?? null, cores: machine?.cores ?? null, siblings: machine?.siblings ?? null, cache: machine?.cache ?? null, singleMs, recorded: current, staleRecord: entry !== null && !current, recordedReferenceP99Ms: null, calibrationScale: null, referenceLimitMs: null, holds: null }
  if (name === null) failures.push('the results carry no machine class')
  if (singleMs === null) failures.push('the results carry no calibration row')
  if (!current || top.referenceP99Ms === null || singleMs === null) return { failures, summary }
  const onMean = Number.isFinite(entry.referenceActiveMeanMs) && Number.isFinite(top.referenceActiveMeanMs)
  const recorded = onMean ? entry.referenceActiveMeanMs : entry.referenceP99Ms
  const ran = onMean ? top.referenceActiveMeanMs : top.referenceP99Ms
  summary.driftBasis = onMean ? 'mean tick while bodies are awake' : 'p99'
  summary.recordedReferenceP99Ms = entry.referenceP99Ms
  summary.recordedReferenceMs = recorded
  summary.calibrationScale = Number(Math.max(1, singleMs / entry.singleMs).toFixed(3))
  summary.referenceLimitMs = Number((recorded * baseline.drift.p99Factor * summary.calibrationScale).toFixed(3))
  summary.holds = entry.holds === true
  if (ran > summary.referenceLimitMs) failures.push('the reference build itself ran a median ' + summary.driftBasis + ' of ' + ran + ' ms on machine class ' + name + ', over ' + summary.referenceLimitMs + ' ms (recorded ' + recorded + ' ms times ' + baseline.drift.p99Factor + ', calibration scale ' + summary.calibrationScale + ')')
  if (summary.holds && (top.candidateP99Ms > results.budgetMs || top.candidateOverBudget > 0)) failures.push('machine class ' + name + ' is recorded as holding ' + top.bodies + ' bodies, and the candidate ran a median p99 of ' + top.candidateP99Ms + ' ms with ' + top.candidateOverBudget + ' ticks over ' + results.budgetMs + ' ms in the median run')
  return { failures, summary }
}

export const classRecord = (verdict) => {
  if (!verdict.ok) throw new Error('a failed verdict is not recorded')
  const c = verdict.machineClass
  if (!c || c.class === null || c.singleMs === null) throw new Error('the verdict has no machine class or calibration')
  const t = verdict.topTier
  return { name: c.class, entry: { modelName: c.modelName, cores: c.cores, siblings: c.siblings, cache: c.cache, kaggleRun: verdict.version, referenceCommit: verdict.referenceCommit, bodies: t.bodies, workers: t.workers, singleMs: c.singleMs, referenceActiveMeanMs: t.referenceActiveMeanMs ?? null, referenceP99Ms: t.referenceP99Ms, candidateP99Ms: t.candidateP99Ms, candidateOverBudget: t.candidateOverBudget, holds: t.candidateP99Ms <= verdict.budgetMs && t.candidateOverBudget === 0 && t.candidateOverEach.every((n) => n === 0) } }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export const judge = (baseline, results) => {
  const failures = []
  const { bodies, workers, repeats } = baseline.topTier
  const rows = (variant) => results.configs.filter((c) => c.kind === 'tick' && !c.refused && !c.error && c.variant === variant && c.bodies === bodies && c.workers === workers && c.warm === true)
  const reference = rows('reference')
  const candidate = rows('base')
  if (reference.length < repeats) failures.push('reference rows: ' + reference.length + ' of ' + repeats)
  if (candidate.length < repeats) failures.push('candidate rows: ' + candidate.length + ' of ' + repeats)
  const QUIET_SHARE = 0.5
  const quietBasis = (rows) => rows.length > 0 && rows.every((c) => Number.isFinite(c.p99QuietMs) && c.quietTicks >= QUIET_SHARE * c.ticks)
  const onQuiet = quietBasis(reference) && quietBasis(candidate)
  const p99Of = (c) => (onQuiet ? c.p99QuietMs : c.p99Ms)
  const hostOf = (c) => (Number.isInteger(c.overBudgetHost) ? c.overBudgetHost : 0)
  const judgedOver = (c) => c.overBudget - hostOf(c)
  const meanBasis = (rows) => rows.length > 0 && rows.every((c) => Number.isFinite(c.activeMeanMs))
  const onMean = meanBasis(reference) && meanBasis(candidate)
  const top = { bodies, workers, referenceActiveMeanMs: null, candidateActiveMeanMs: null, activeMeanLimitMs: null, referenceActiveMeanEachMs: reference.map((c) => c.activeMeanMs ?? null), candidateActiveMeanEachMs: candidate.map((c) => c.activeMeanMs ?? null), referenceP99Ms: null, candidateP99Ms: null, p99LimitMs: null, referenceOverBudget: null, candidateOverBudget: null, overLimit: null, referenceOverEach: reference.map(judgedOver), candidateOverEach: candidate.map(judgedOver), referenceHostExcludedEach: reference.map(hostOf), candidateHostExcludedEach: candidate.map(hostOf), hostRule: [...reference, ...candidate].map((c) => c.hostRule).find((rule) => typeof rule === 'string') ?? null, p99Basis: onQuiet ? 'quiet ticks' : 'every tick', referenceP99EachMs: reference.map(p99Of), candidateP99EachMs: candidate.map(p99Of), referenceP99EveryTickEachMs: reference.map((c) => c.p99Ms), candidateP99EveryTickEachMs: candidate.map((c) => c.p99Ms), referenceQuietTicksEach: reference.map((c) => c.quietTicks ?? null), candidateQuietTicksEach: candidate.map((c) => c.quietTicks ?? null) }
  if (reference.length > 0 && candidate.length > 0) {
    top.referenceP99Ms = median(reference.map(p99Of))
    top.candidateP99Ms = median(candidate.map(p99Of))
    top.p99LimitMs = Number(Math.max(top.referenceP99Ms * baseline.margin.p99Factor, top.referenceP99Ms + baseline.margin.p99FloorMs).toFixed(3))
    if (onMean) {
      top.referenceActiveMeanMs = median(top.referenceActiveMeanEachMs)
      top.candidateActiveMeanMs = median(top.candidateActiveMeanEachMs)
      top.activeMeanLimitMs = Number((top.referenceActiveMeanMs * baseline.margin.meanFactor).toFixed(3))
      if (top.candidateActiveMeanMs > top.activeMeanLimitMs) failures.push('top tier median of the mean tick while bodies are awake ' + top.candidateActiveMeanMs + ' ms is over ' + top.activeMeanLimitMs + ' ms (the reference build ran ' + top.referenceActiveMeanMs + ' ms in the same run, times ' + baseline.margin.meanFactor + ')')
    }
    top.referenceOverBudget = median(top.referenceOverEach)
    top.candidateOverBudget = median(top.candidateOverEach)
    top.overLimit = Math.floor(top.referenceOverBudget * baseline.margin.overBudgetFactor) + baseline.margin.overBudgetTicks
    if (top.candidateP99Ms > top.p99LimitMs) failures.push('top tier median p99 over ' + top.p99Basis + ' ' + top.candidateP99Ms + ' ms is over ' + top.p99LimitMs + ' ms (the reference build ran ' + top.referenceP99Ms + ' ms in the same run; the limit is the larger of that times ' + baseline.margin.p99Factor + ' and that plus ' + baseline.margin.p99FloorMs + ' ms)')
    if (top.candidateOverBudget > top.overLimit) failures.push('top tier ticks over ' + results.budgetMs + ' ms in the median run: ' + top.candidateOverBudget + ', limit ' + top.overLimit + ' (the reference build had ' + top.referenceOverBudget + ' in the same kernel run)')
  }
  const marbles = results.configs.filter((c) => c.kind === 'marble-bowl')
  if (marbles.length < baseline.marble.tiers) failures.push('marble tiers: ' + marbles.length + ' of ' + baseline.marble.tiers)
  const marble = marbles.map((c) => {
    const onCpu = c.clockSource !== 'performance.now'
    const p99Ms = onCpu ? c.cpuP99Ms : c.wallP99Ms
    const over25 = onCpu ? c.cpuOver25Repeated : c.wallOver25Repeated
    const over25InAnyRun = onCpu ? c.cpuOver25 : c.wallOver25
    if (p99Ms > baseline.marble.p99Ms) failures.push('marble bowl ' + c.tier + ' p99 ' + p99Ms + ' ms is over ' + baseline.marble.p99Ms + ' ms')
    if (!Number.isInteger(over25)) failures.push('marble bowl ' + c.tier + ' carries no count of repeated ticks over ' + c.spikeMs + ' ms')
    if (over25 > baseline.marble.over25) failures.push('marble bowl ' + c.tier + ' has ' + over25 + ' ticks over ' + c.spikeMs + ' ms at the same tick in at least half of its runs after its warm run')
    return { tier: c.tier, clockSource: c.clockSource, p99Ms, maxMs: onCpu ? c.cpuMaxMs : c.wallMaxMs, over25, over25InAnyRun, overBudget: onCpu ? c.cpuOverBudget : c.wallOverBudget }
  })
  const broken = results.configs.filter((c) => c.error)
  if (broken.length) failures.push(broken.length + ' runs gave no result')
  const machineClass = judgeClass(baseline, results, top)
  failures.push(...machineClass.failures)
  return { ok: failures.length === 0, failures, budgetMs: results.budgetMs, topTier: top, marble, machineClass: machineClass.summary }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { BASELINE, KERNEL_REF } = await import('./plan.mjs')
  const { ensureReference } = await import('./reference.mjs')
  const { runOnKaggle } = await import('./run.mjs')
  const mode = process.argv[2] ?? 'regress'
  if (mode === 'record') {
    const verdict = JSON.parse(readFileSync(join(root, MODES.regress), 'utf8'))
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    const { name, entry } = classRecord(verdict)
    const existing = baseline.classes[name]
    if (existing && existing.referenceCommit === baseline.referenceCommit && process.argv[3] !== '--replace') {
      console.log('RESULT: KEPT ' + name + ' is already recorded for this reference (run ' + existing.kaggleRun + ', reference p99 ' + existing.referenceP99Ms + ' ms); pass --replace to overwrite')
      process.exit(0)
    }
    if (entry.referenceCommit !== baseline.referenceCommit) throw new Error('the verdict is for reference ' + entry.referenceCommit + ', not ' + baseline.referenceCommit)
    baseline.classes[name] = entry
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n')
    console.log('RESULT: RECORDED ' + name + ' ' + JSON.stringify(entry))
    process.exit(0)
  }
  if (!Object.hasOwn(MODES, mode)) throw new RangeError('unknown mode ' + mode)
  const verdictPath = join(root, MODES[mode])
  const reference = ensureReference(BASELINE.referenceCommit)
  const { meta, results } = await runOnKaggle(mode, mode === 'control' ? 'negative control: scalar build as the candidate' : 'regression gate')
  const verdict = { kernel: KERNEL_REF, referenceCommit: BASELINE.referenceCommit, referenceBuilt: reference.built, ...meta, machine: results.cpuModel + ', ' + results.nproc + ' CPUs, Node ' + results.node, ...judge(BASELINE, results) }
  mkdirSync(dirname(verdictPath), { recursive: true })
  writeFileSync(verdictPath, JSON.stringify(verdict, null, 1) + '\n')
  console.log(JSON.stringify(verdict))
  if (!verdict.ok) {
    console.error('RESULT: FAIL ' + verdict.failures.join('; '))
    process.exit(1)
  }
  const seen = verdict.machineClass
  console.log(seen.recorded ? 'machine class ' + seen.class + ': reference ' + seen.driftBasis + ' ' + (seen.driftBasis === 'p99' ? verdict.topTier.referenceP99Ms : verdict.topTier.referenceActiveMeanMs) + ' ms against its recorded ' + seen.recordedReferenceMs + ' ms (limit ' + seen.referenceLimitMs + ')' : 'machine class ' + seen.class + ' (' + seen.modelName + ') has no record for this reference; node scripts/kaggle/regress.mjs record adds it')
  const excluded = [...verdict.topTier.referenceHostExcludedEach, ...verdict.topTier.candidateHostExcludedEach].reduce((sum, n) => sum + n, 0)
  console.log(excluded > 0 ? excluded + ' ticks over budget were not counted (reference ' + verdict.topTier.referenceHostExcludedEach.join(', ') + '; candidate ' + verdict.topTier.candidateHostExcludedEach.join(', ') + '): ' + verdict.topTier.hostRule : 'no tick over budget was excluded as the host')
  console.log('p99 judged over ' + verdict.topTier.p99Basis + '; over every tick the medians are ' + median(verdict.topTier.candidateP99EveryTickEachMs) + ' ms against ' + median(verdict.topTier.referenceP99EveryTickEachMs) + ' ms')
  if (verdict.topTier.activeMeanLimitMs !== null) console.log('mean tick while bodies are awake: ' + verdict.topTier.candidateActiveMeanMs + ' ms against the reference ' + verdict.topTier.referenceActiveMeanMs + ' ms (limit ' + verdict.topTier.activeMeanLimitMs + ')')
  console.log('RESULT: PASS top tier median p99 ' + verdict.topTier.candidateP99Ms + ' ms against the reference ' + verdict.topTier.referenceP99Ms + ' ms (limit ' + verdict.topTier.p99LimitMs + '), ' + verdict.topTier.candidateOverBudget + ' ticks over budget in the median run against ' + verdict.topTier.referenceOverBudget + ' (limit ' + verdict.topTier.overLimit + ')')
}
