import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MODES = Object.freeze({ regress: 'build/kaggle/verdict.json', control: 'build/kaggle/control-verdict.json' })

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
  const top = { bodies, workers, referenceP99Ms: null, candidateP99Ms: null, p99LimitMs: null, referenceOverBudget: null, candidateOverBudget: null, overLimit: null, referenceOverEach: reference.map((c) => c.overBudget), candidateOverEach: candidate.map((c) => c.overBudget), referenceP99EachMs: reference.map((c) => c.p99Ms), candidateP99EachMs: candidate.map((c) => c.p99Ms) }
  if (reference.length > 0 && candidate.length > 0) {
    top.referenceP99Ms = median(reference.map((c) => c.p99Ms))
    top.candidateP99Ms = median(candidate.map((c) => c.p99Ms))
    top.p99LimitMs = Number((top.referenceP99Ms * baseline.margin.p99Factor).toFixed(3))
    top.referenceOverBudget = median(top.referenceOverEach)
    top.candidateOverBudget = median(top.candidateOverEach)
    top.overLimit = Math.floor(top.referenceOverBudget * baseline.margin.overBudgetFactor) + baseline.margin.overBudgetTicks
    if (top.candidateP99Ms > top.p99LimitMs) failures.push('top tier median p99 ' + top.candidateP99Ms + ' ms is over ' + top.p99LimitMs + ' ms (the reference build ran ' + top.referenceP99Ms + ' ms in the same run, times ' + baseline.margin.p99Factor + ')')
    if (top.candidateOverBudget > top.overLimit) failures.push('top tier ticks over ' + results.budgetMs + ' ms in the median run: ' + top.candidateOverBudget + ', limit ' + top.overLimit + ' (the reference build had ' + top.referenceOverBudget + ' in the same kernel run)')
  }
  const marbles = results.configs.filter((c) => c.kind === 'marble-bowl')
  if (marbles.length < baseline.marble.tiers) failures.push('marble tiers: ' + marbles.length + ' of ' + baseline.marble.tiers)
  const marble = marbles.map((c) => {
    const onCpu = c.clockSource !== 'performance.now'
    const p99Ms = onCpu ? c.cpuP99Ms : c.wallP99Ms
    const over25 = onCpu ? c.cpuOver25 : c.wallOver25
    if (p99Ms > baseline.marble.p99Ms) failures.push('marble bowl ' + c.tier + ' p99 ' + p99Ms + ' ms is over ' + baseline.marble.p99Ms + ' ms')
    if (over25 > baseline.marble.over25) failures.push('marble bowl ' + c.tier + ' has ' + over25 + ' ticks over ' + c.spikeMs + ' ms after its warm run')
    return { tier: c.tier, clockSource: c.clockSource, p99Ms, maxMs: onCpu ? c.cpuMaxMs : c.wallMaxMs, over25, overBudget: onCpu ? c.cpuOverBudget : c.wallOverBudget }
  })
  const broken = results.configs.filter((c) => c.error)
  if (broken.length) failures.push(broken.length + ' runs gave no result')
  return { ok: failures.length === 0, failures, topTier: top, marble }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { BASELINE, KERNEL_REF } = await import('./plan.mjs')
  const { ensureReference } = await import('./reference.mjs')
  const { runOnKaggle } = await import('./run.mjs')
  const mode = process.argv[2] ?? 'regress'
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
  console.log('RESULT: PASS top tier median p99 ' + verdict.topTier.candidateP99Ms + ' ms against the reference ' + verdict.topTier.referenceP99Ms + ' ms (limit ' + verdict.topTier.p99LimitMs + '), ' + verdict.topTier.candidateOverBudget + ' ticks over budget in the median run against ' + verdict.topTier.referenceOverBudget + ' (limit ' + verdict.topTier.overLimit + ')')
}
