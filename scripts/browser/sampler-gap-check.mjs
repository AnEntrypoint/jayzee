import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gapCauses, gapsOverLimit, parseTicksLog, samplingGaps } from './thread-sampling.mjs'
import { percentile } from '../streamer-p99.mjs'

export const PERIOD_MS = 50

export const sampledRows = (ticksText, window) => parseTicksLog(ticksText).filter((row) => row.t >= window.startMs && row.t <= window.endMs)

export const sampledStamps = (ticksText, window) => sampledRows(ticksText, window).map((row) => row.t)

export const gapSummary = (stamps, periodMs = PERIOD_MS) => {
  const gaps = samplingGaps(stamps)
  return {
    ticks: stamps.length,
    medianGapMs: percentile(gaps, 0.5),
    p99GapMs: percentile(gaps, 0.99),
    maxGapMs: Math.max(...gaps),
    limitMs: 2 * periodMs,
    gapsOverLimit: gapsOverLimit(stamps, periodMs).length,
  }
}

export const parseCgroupSamples = (text) => String(text).split('\n').filter((line) => line !== '').map((line) => {
  const [t, throttledUs, usageUs, someUs, fullUs] = line.trim().split(/\s+/).map(Number)
  if (![t, throttledUs, usageUs, someUs, fullUs].every(Number.isFinite)) throw new TypeError('cgroup sampler line is not five numbers: ' + line)
  return { t, throttledUs, usageUs, someUs, fullUs }
})

const cgroupAt = (samples, t) => {
  let hit = null
  for (const sample of samples) {
    if (sample.t > t) break
    hit = sample
  }
  return hit
}

export const cgroupBetween = (samples, t0, t1) => {
  const from = cgroupAt(samples, t0)
  const to = cgroupAt(samples, t1)
  if (!from || !to) return null
  return {
    throttleMs: (to.throttledUs - from.throttledUs) / 1000,
    usageMs: (to.usageUs - from.usageUs) / 1000,
    someMs: (to.someUs - from.someUs) / 1000,
  }
}

export const attributeOverLimit = (rows, cgroupSamples, periodMs = PERIOD_MS) => gapCauses(rows, periodMs).map((gap) => {
  const host = cgroupBetween(cgroupSamples, gap.t - gap.gapMs, gap.t)
  return {
    t0: gap.t - gap.gapMs,
    t1: gap.t,
    gapMs: gap.gapMs,
    threadCause: gap.cause,
    selfWaitMs: gap.selfWaitMs,
    workMs: gap.workMs,
    cgroupThrottleMs: host === null ? null : host.throttleMs,
    cgroupUsageMs: host === null ? null : host.usageMs,
    cgroupSomeMs: host === null ? null : host.someMs,
    cause: host !== null && host.throttleMs > 0 ? 'host-cfs-quota' : gap.cause,
  }
})

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [runPath, ticksPath] = process.argv.slice(2)
  if (!runPath || !ticksPath) {
    console.error('usage: node scripts/browser/sampler-gap-check.mjs <run.json> <threads.txt.ticks>')
    process.exit(2)
  }
  const run = JSON.parse(readFileSync(runPath, 'utf8'))
  const samplerPath = existsSync(run.sampler.file) ? run.sampler.file : join(dirname(runPath), basename(run.sampler.file))
  const rows = sampledRows(readFileSync(ticksPath, 'utf8'), run.sampler)
  const cgroup = parseCgroupSamples(readFileSync(samplerPath, 'utf8'))
  const summary = { ...gapSummary(rows.map((row) => row.t)), cpuMax: run.host ? run.host.cpuMax : null, overLimit: attributeOverLimit(rows, cgroup) }
  const verdict = summary.gapsOverLimit === 0 ? 'PASS' : 'FAIL'
  console.log(verdict + ' ' + JSON.stringify(summary))
  process.exitCode = verdict === 'PASS' ? 0 : 1
}
