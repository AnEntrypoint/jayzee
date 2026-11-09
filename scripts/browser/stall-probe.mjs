import { readFileSync } from 'node:fs'
import { attributeStalls, framesFromResult, parseThrottleLog, pressureMsBetween } from './stall-attribution.mjs'

export const JIFFY_MS = 10
export const CPU_SHARE = 0.8
export const PRESSURE_SHARE = 0.5

export function parseThreadLog(text) {
  return String(text).split('\n').filter((line) => line !== '').map((line) => {
    const parts = line.split(' ')
    if (parts.length < 6) throw new TypeError('thread line needs ts pid type tid jiffies and comm: ' + line)
    const t = Number(parts[0])
    const pid = Number(parts[1])
    const tid = Number(parts[3])
    const jiffies = Number(parts[4])
    if (![t, pid, tid, jiffies].every(Number.isFinite) || parts[2] === '') throw new TypeError('thread line is not valid: ' + line)
    return { t, pid, type: parts[2], tid, jiffies, comm: parts.slice(5).join(' ') }
  })
}

function mainThreadSeries(rows) {
  const byPid = new Map()
  for (const row of rows) {
    if (row.type !== 'renderer' || row.tid !== row.pid) continue
    if (!byPid.has(row.pid)) byPid.set(row.pid, [])
    byPid.get(row.pid).push({ t: row.t, jiffies: row.jiffies })
  }
  return byPid
}

function cumulativeAt(series, t) {
  if (series.length === 0 || t < series[0].t) return null
  let lo = 0
  let hi = series.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (series[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  if (lo === series.length - 1 || series[lo].t === t) return series[lo].jiffies
  const next = series[lo + 1]
  return series[lo].jiffies + ((t - series[lo].t) / (next.t - series[lo].t)) * (next.jiffies - series[lo].jiffies)
}

function gainInWindow(series, startMs, endMs) {
  const first = series[0].jiffies
  return (cumulativeAt(series, endMs) ?? first) - (cumulativeAt(series, startMs) ?? first)
}

export function rendererMainSeries(rows, startMs, endMs) {
  if (!(endMs > startMs)) throw new TypeError('rendererMainSeries needs a window with startMs before endMs')
  const byPid = mainThreadSeries(rows)
  if (byPid.size === 0) throw new RangeError('no renderer main thread in the thread log')
  const ranked = [...byPid.entries()].map(([pid, series]) => ({ pid, gain: gainInWindow(series, startMs, endMs), last: series[series.length - 1].jiffies }))
  ranked.sort((a, b) => b.gain - a.gain || b.last - a.last)
  return byPid.get(ranked[0].pid)
}

export function cpuMsBetween(series, startMs, endMs) {
  if (!(endMs > startMs)) return null
  const a = cumulativeAt(series, startMs)
  const b = cumulativeAt(series, endMs)
  if (a === null || b === null) return null
  return (b - a) * JIFFY_MS
}

export function classifyStall({ totalMs, cpuMs, someMs }) {
  if (cpuMs / totalMs >= CPU_SHARE) return 'cpu-bound'
  if (someMs / totalMs >= PRESSURE_SHARE) return 'starved'
  return 'blocked'
}

const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function probeStalls(result, samples, threadRows) {
  const frames = framesFromResult(result)
  const attribution = attributeStalls(frames, samples)
  const windowStart = Math.min(...frames.map((f) => f.startMs))
  const windowEnd = Math.max(...frames.map((f) => f.startMs + f.totalMs))
  const series = rendererMainSeries(threadRows, windowStart, windowEnd)
  const columns = result.rowColumns
  const tickAt = columns.indexOf('tickMs')
  const frameAt = columns.indexOf('frame')
  const activeAt = columns.indexOf('active')
  const rowOf = new Map(result.rows.map((row) => [row[frameAt], row]))
  const activeOf = (frame) => (activeAt < 0 ? null : rowOf.get(frame)[activeAt])
  const stalls = attribution.stalls.map((stall) => {
    const endMs = stall.startMs + stall.totalMs
    const cpuMs = cpuMsBetween(series, stall.startMs, endMs)
    const someMs = pressureMsBetween(samples, 'someUs', stall.startMs, endMs)
    const tickMs = rowOf.get(stall.frame)[tickAt]
    const verdict = cpuMs === null || someMs === null ? 'uncovered' : classifyStall({ totalMs: stall.totalMs, cpuMs, someMs })
    return { frame: stall.frame, startMs: stall.startMs, totalMs: stall.totalMs, excessMs: stall.excessMs, tickMs, cpuMs, someMs, fullMs: stall.starvedMs, active: activeOf(stall.frame), verdict }
  })
  const counts = {}
  for (const stall of stalls) counts[stall.verdict] = (counts[stall.verdict] ?? 0) + 1
  const stallIds = new Set(stalls.map((stall) => stall.frame))
  const normalTick = frames.filter((f) => !stallIds.has(f.frame)).map((f) => rowOf.get(f.frame)[tickAt])
  const activeCounts = activeAt < 0 ? [] : frames.map((f) => activeOf(f.frame))
  return {
    baseMs: attribution.medianMs,
    stallCount: stalls.length,
    counts,
    stallTickMedianMs: stalls.length ? median(stalls.map((s) => s.tickMs)) : null,
    normalTickMedianMs: normalTick.length ? median(normalTick) : null,
    activeMin: activeCounts.length ? Math.min(...activeCounts) : null,
    activeMax: activeCounts.length ? Math.max(...activeCounts) : null,
    stalls,
  }
}

if (process.argv[1] && process.argv[1].endsWith('/browser/stall-probe.mjs')) {
  const [pagePath, throttlePath, threadPath] = process.argv.slice(2)
  const result = JSON.parse(readFileSync(pagePath, 'utf8'))
  const samples = parseThrottleLog(readFileSync(throttlePath, 'utf8'))
  const rows = parseThreadLog(readFileSync(threadPath, 'utf8'))
  console.log(JSON.stringify(probeStalls(result, samples, rows), null, 2))
}
