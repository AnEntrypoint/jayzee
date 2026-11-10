import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { frameCauses, pageFrames, parseCgroupSamples } from './frame-stall-cause.mjs'
import { parseSchedLog } from './thread-sampling.mjs'

export const BUDGET_MS = 16.7

export const percentile = (values, q) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]
}

const mean = (values) => (values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length)

export const attributeTails = (causes, budgetMs = BUDGET_MS) => {
  const tails = causes.filter((c) => c.wallMs > budgetMs)
  const share = (key) => mean(tails.map((c) => c[key]).filter((v) => v !== null && v !== undefined))
  const runShare = share('runShare')
  const waitShare = share('waitShare')
  const offShare = share('offShare')
  const throttled = mean(tails.map((c) => c.throttledMs ?? 0))
  let verdict = 'no tail frames over budget'
  if (tails.length > 0) {
    if (runShare === null) verdict = 'no scheduler log: attribution unavailable'
    else if (waitShare >= 0.5) verdict = 'run-queue wait dominates the tail frames (host CPU contention)'
    else if (throttled !== null && throttled > 0 && (offShare ?? 0) > 0.2) verdict = 'cgroup throttling dominates the off-CPU share of the tail frames'
    else verdict = 'the tail frames run on CPU: the cost is in the frame itself'
  }
  return { count: tails.length, runShare, waitShare, offShare, throttledMs: throttled, verdict }
}

export const reportFromFiles = ({ page, cgroupText, schedText, budgetMs = BUDGET_MS }) => {
  const measured = new Map(frameCauses({
    page,
    cgroupSamples: parseCgroupSamples(cgroupText),
    schedRows: schedText === null ? null : parseSchedLog(schedText),
    longMs: budgetMs,
  }).measured.map((c) => [c.frame, c]))
  const causes = pageFrames(page).map((frame) => measured.get(frame.frame) ?? { frame: frame.frame, wallMs: frame.endMs - frame.startMs, runShare: null, waitShare: null, offShare: null, throttledMs: 0 })
  const wall = causes.map((c) => c.wallMs)
  const timed = page.rows.map((row) => row[page.rowColumns.indexOf('tickMs')] + row[page.rowColumns.indexOf('renderMs')])
  return {
    frames: wall.length,
    budgetMs,
    medianMs: percentile(timed, 0.5),
    p99Ms: percentile(timed, 0.99),
    maxMs: timed.length === 0 ? null : Math.max(...timed),
    attribution: attributeTails(causes, budgetMs),
    allocationsSinceWarmup: page.allocationsSinceWarmup ?? null,
  }
}

const readOptional = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null)

const run = () => {
  const [prefix] = process.argv.slice(2)
  if (!prefix) {
    console.error('usage: node scripts/browser/tail-report.mjs <run prefix, e.g. build/diag/controlled/live-thr-wgpu.json/live-thr-wgpu>')
    process.exitCode = 2
    return
  }
  const page = JSON.parse(readFileSync(prefix + '.page.json', 'utf8'))
  const result = reportFromFiles({
    page: page.result ?? page,
    cgroupText: readOptional(prefix + '.cgroup.txt') ?? '',
    schedText: readOptional(prefix + '.threads.txt.sched'),
  })
  console.log(JSON.stringify(result))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
}
