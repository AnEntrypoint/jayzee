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

export function rendererMainSeries(rows) {
  const busiest = new Map()
  for (const row of rows) {
    if (row.type !== 'renderer' || row.tid !== row.pid) continue
    busiest.set(row.pid, Math.max(busiest.get(row.pid) ?? 0, row.jiffies))
  }
  if (busiest.size === 0) throw new RangeError('no renderer main thread in the thread log')
  const pid = [...busiest.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return rows.filter((row) => row.type === 'renderer' && row.pid === pid && row.tid === pid).map((row) => ({ t: row.t, jiffies: row.jiffies }))
}

function jiffiesAt(series, t) {
  if (series.length === 0 || t < series[0].t) return null
  let lo = 0
  let hi = series.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (series[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return series[lo].jiffies
}

export function cpuMsBetween(series, startMs, endMs) {
  if (!(endMs > startMs)) return null
  const a = jiffiesAt(series, startMs)
  const b = jiffiesAt(series, endMs)
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
  const series = rendererMainSeries(threadRows)
  const columns = result.rowColumns
  const tickAt = columns.indexOf('tickMs')
  const frameAt = columns.indexOf('frame')
  const rowOf = new Map(result.rows.map((row) => [row[frameAt], row]))
  const stalls = attribution.stalls.map((stall) => {
    const endMs = stall.startMs + stall.totalMs
    const cpuMs = cpuMsBetween(series, stall.startMs, endMs)
    const someMs = pressureMsBetween(samples, 'someUs', stall.startMs, endMs)
    const tickMs = rowOf.get(stall.frame)[tickAt]
    const verdict = cpuMs === null || someMs === null ? 'uncovered' : classifyStall({ totalMs: stall.totalMs, cpuMs, someMs })
    return { frame: stall.frame, startMs: stall.startMs, totalMs: stall.totalMs, excessMs: stall.excessMs, tickMs, cpuMs, someMs, fullMs: stall.starvedMs, verdict }
  })
  const counts = {}
  for (const stall of stalls) counts[stall.verdict] = (counts[stall.verdict] ?? 0) + 1
  const stallIds = new Set(stalls.map((stall) => stall.frame))
  const normalTick = frames.filter((f) => !stallIds.has(f.frame)).map((f) => rowOf.get(f.frame)[tickAt])
  return {
    baseMs: attribution.medianMs,
    stallCount: stalls.length,
    counts,
    stallTickMedianMs: stalls.length ? median(stalls.map((s) => s.tickMs)) : null,
    normalTickMedianMs: normalTick.length ? median(normalTick) : null,
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
