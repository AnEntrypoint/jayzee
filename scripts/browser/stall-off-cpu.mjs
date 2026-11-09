import { readFileSync } from 'node:fs'
import { framesFromResult, parseThrottleLog } from './stall-attribution.mjs'
import { parseThreadLog, probeStalls, rendererMainPid } from './stall-probe.mjs'
import { offCpuWindow, parseSchedLog, parseTicksLog, pressureMsBetweenTicks } from './thread-sampling.mjs'

const median = (values) => {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function offCpuForStalls(stalls, schedRows, ticksRows, pid) {
  return stalls.map((stall) => {
    const endMs = stall.startMs + stall.totalMs
    const window = offCpuWindow({ schedRows, pid, startMs: stall.startMs, endMs })
    const sleepMs = window.runMs === null || window.waitMs === null ? null : Math.max(0, stall.totalMs - window.runMs - window.waitMs)
    return {
      frame: stall.frame,
      verdict: stall.verdict,
      totalMs: stall.totalMs,
      runMs: window.runMs,
      waitMs: window.waitMs,
      sleepMs,
      samples: window.samples,
      waits: window.waits,
      majflt: window.majflt,
      minflt: window.minflt,
      memSomeMs: pressureMsBetweenTicks(ticksRows, 'memSomeUs', stall.startMs, endMs),
      ioSomeMs: pressureMsBetweenTicks(ticksRows, 'ioSomeUs', stall.startMs, endMs),
    }
  })
}

export function summariseOffCpu(stalls) {
  const byVerdict = {}
  for (const stall of stalls) {
    const entry = (byVerdict[stall.verdict] ??= { count: 0, sleepMs: [], majflt: 0, memSomeMs: 0, waits: {} })
    entry.count += 1
    if (stall.sleepMs !== null) entry.sleepMs.push(stall.sleepMs)
    entry.majflt += stall.majflt ?? 0
    entry.memSomeMs += stall.memSomeMs ?? 0
    for (const [label, count] of Object.entries(stall.waits)) entry.waits[label] = (entry.waits[label] ?? 0) + count
  }
  for (const entry of Object.values(byVerdict)) {
    entry.sleepMsMedian = median(entry.sleepMs)
    entry.sleepMsSum = entry.sleepMs.reduce((sum, value) => sum + value, 0)
    delete entry.sleepMs
  }
  return byVerdict
}

if (process.argv[1] && process.argv[1].endsWith('/browser/stall-off-cpu.mjs')) {
  const [pagePath, cgroupPath, threadPath, schedPath, ticksPath] = process.argv.slice(2)
  const result = JSON.parse(readFileSync(pagePath, 'utf8'))
  const samples = parseThrottleLog(readFileSync(cgroupPath, 'utf8'))
  const threadRows = parseThreadLog(readFileSync(threadPath, 'utf8'))
  const schedRows = parseSchedLog(readFileSync(schedPath, 'utf8'))
  const ticksRows = parseTicksLog(readFileSync(ticksPath, 'utf8'))
  const report = probeStalls(result, samples, threadRows)
  const frames = framesFromResult(result)
  const windowStart = Math.min(...frames.map((f) => f.startMs))
  const windowEnd = Math.max(...frames.map((f) => f.startMs + f.totalMs))
  const pid = rendererMainPid(threadRows, windowStart, windowEnd)
  const stalls = offCpuForStalls(report.stalls, schedRows, ticksRows, pid)
  console.log(JSON.stringify({ pid, counts: report.counts, summary: summariseOffCpu(stalls), stalls }, null, 2))
}
