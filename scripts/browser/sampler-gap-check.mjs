import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gapsOverLimit, parseTicksLog, samplingGaps } from './thread-sampling.mjs'
import { percentile } from '../streamer-p99.mjs'

export const PERIOD_MS = 50

export const sampledStamps = (ticksText, window) => parseTicksLog(ticksText).map((row) => row.t).filter((t) => t >= window.startMs && t <= window.endMs)

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [runPath, ticksPath] = process.argv.slice(2)
  if (!runPath || !ticksPath) {
    console.error('usage: node scripts/browser/sampler-gap-check.mjs <run.json> <threads.txt.ticks>')
    process.exit(2)
  }
  const run = JSON.parse(readFileSync(runPath, 'utf8'))
  const summary = gapSummary(sampledStamps(readFileSync(ticksPath, 'utf8'), run.sampler))
  const verdict = summary.gapsOverLimit === 0 ? 'PASS' : 'FAIL'
  console.log(verdict + ' ' + JSON.stringify(summary))
  process.exitCode = verdict === 'PASS' ? 0 : 1
}
