import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { framesFromResult, parseThrottleLog } from './stall-attribution.mjs'
import { parseThreadLog, probeStalls, rendererMainPid } from './stall-probe.mjs'
import { offCpuForStalls } from './stall-off-cpu.mjs'
import { parseSchedLog, parseTicksLog } from './thread-sampling.mjs'

export const WAIT_SHARE_CPU = 0.25
export const MIN_RUNS = 3

export const median = (values) => {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export const percentile = (values, q) => {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

export const cellOf = (row) => row.condition + ' ' + (row.pin ?? 'unpinned')

export function analyseRunData({ run, page, samples, threadRows, schedRows, ticksRows }) {
  const base = { label: run.label, round: run.round, condition: run.condition, pin: run.pin ?? null, externalBusy: run.externalBusy?.share ?? null }
  if (typeof page.error === 'string' || !Array.isArray(page.rows)) return { ...base, valid: false, reason: page.error ?? 'page has no rows' }
  const frames = framesFromResult(page)
  const totals = frames.map((frame) => frame.totalMs)
  const report = probeStalls(page, samples, threadRows)
  const windowStart = Math.min(...frames.map((frame) => frame.startMs))
  const windowEnd = Math.max(...frames.map((frame) => frame.startMs + frame.totalMs))
  const rendererPid = rendererMainPid(threadRows, windowStart, windowEnd)
  const stalls = offCpuForStalls(report.stalls, schedRows, ticksRows, rendererPid)
  const measured = stalls.filter((stall) => stall.waitMs !== null && stall.runMs !== null)
  const waitMs = measured.reduce((sum, stall) => sum + stall.waitMs, 0)
  const measuredStallMs = measured.reduce((sum, stall) => sum + stall.totalMs, 0)
  return {
    ...base,
    valid: true,
    reason: null,
    rendererPid,
    frames: frames.length,
    medianMs: report.baseMs,
    p99Ms: percentile(totals, 0.99),
    maxMs: Math.max(...totals),
    stallCount: stalls.length,
    verdicts: report.counts,
    stallMs: stalls.reduce((sum, stall) => sum + stall.totalMs, 0),
    measuredStallMs,
    waitMs,
    runMs: measured.reduce((sum, stall) => sum + stall.runMs, 0),
    unmeasuredStalls: stalls.length - measured.length,
    waitShare: measuredStallMs > 0 ? waitMs / measuredStallMs : null,
  }
}

export const summariseCell = (rows) => {
  const valid = rows.filter((row) => row.valid)
  const stallCounts = valid.map((row) => row.stallCount)
  const measuredStallMs = valid.reduce((sum, row) => sum + row.measuredStallMs, 0)
  const waitMs = valid.reduce((sum, row) => sum + row.waitMs, 0)
  return {
    runs: rows.length,
    valid: valid.length,
    labels: valid.map((row) => row.label),
    stallCounts,
    totalStalls: stallCounts.reduce((sum, count) => sum + count, 0),
    medianStallsPerRun: median(stallCounts),
    stallMs: valid.reduce((sum, row) => sum + row.stallMs, 0),
    waitShare: measuredStallMs > 0 ? waitMs / measuredStallMs : null,
    medianFrameMs: median(valid.map((row) => row.medianMs)),
    p99Ms: median(valid.map((row) => row.p99Ms)),
    maxFrameMs: valid.length ? Math.max(...valid.map((row) => row.maxMs)) : null,
    medianExternalBusy: median(valid.map((row) => row.externalBusy).filter(Number.isFinite)),
  }
}

export const pinningVerdict = (unpinned, pinned) => {
  if (unpinned.valid < MIN_RUNS || pinned.valid < MIN_RUNS) return 'insufficient: each cell needs ' + MIN_RUNS + ' valid runs'
  if (pinned.totalStalls < unpinned.totalStalls) return 'pinning reduces stall frames'
  if (pinned.totalStalls > unpinned.totalStalls) return 'pinning adds stall frames'
  return 'no difference in stall frames'
}

export const cpuSharingVerdict = (paused, live) => {
  if (paused.valid < MIN_RUNS || live.valid < MIN_RUNS) return 'insufficient: each cell needs ' + MIN_RUNS + ' valid runs'
  if (live.totalStalls <= paused.totalStalls) return 'not supported: stalls do not rise with co-tenant load'
  if (live.waitShare !== null && live.waitShare >= WAIT_SHARE_CPU) return 'supported: stalls rise with co-tenant load and their time is run-queue wait'
  return 'partly: stalls rise with co-tenant load, but their time is not mostly run-queue wait'
}

export const analyseDir = (dir) => readdirSync(dir).filter((name) => name.endsWith('.run.json')).sort().map((name) => {
  const run = JSON.parse(readFileSync(join(dir, name), 'utf8'))
  const read = (path) => readFileSync(join(dir, path), 'utf8')
  try {
    return analyseRunData({
      run,
      page: JSON.parse(read(run.files.page)),
      samples: parseThrottleLog(read(run.files.cgroup)),
      threadRows: parseThreadLog(read(run.files.threads)),
      schedRows: parseSchedLog(read(run.files.threads + '.sched')),
      ticksRows: parseTicksLog(read(run.files.threads + '.ticks')),
    })
  } catch (error) {
    return { label: run.label, round: run.round, condition: run.condition, pin: run.pin ?? null, valid: false, reason: error.message }
  }
})

export const reportDir = (dir, pinnedKey) => {
  const rows = analyseDir(dir)
  const keys = [...new Set(rows.map(cellOf))].sort()
  const cells = Object.fromEntries(keys.map((key) => [key, summariseCell(rows.filter((row) => cellOf(row) === key))]))
  const paused = cells['PAUSED unpinned']
  const pinnedCell = cells[pinnedKey]
  const live = cells['LIVE unpinned']
  return {
    cells,
    verdicts: {
      pinning: paused && pinnedCell ? pinningVerdict(paused, pinnedCell) : 'insufficient: a cell is missing',
      cpuSharing: paused && live ? cpuSharingVerdict(paused, live) : 'insufficient: a cell is missing',
    },
    runs: rows,
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [dir, pinnedKey = 'PAUSED 0-7', outPath = ''] = process.argv.slice(2)
  if (!dir) throw new TypeError('usage: node scripts/browser/controlled-report.mjs <dir> [pinned cell] [out.json]')
  const report = reportDir(dir, pinnedKey)
  const text = JSON.stringify(report, null, 1) + '\n'
  if (outPath !== '') writeFileSync(outPath, text)
  console.log(text)
}
