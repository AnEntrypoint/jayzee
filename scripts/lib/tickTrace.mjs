import { closeSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const FRAME_BUDGET_MS = 16.7
export const SPIKE_MS = 25
export const HOST_THROTTLED_SHARE_LIMIT = 0.02

const TRACE_DIR = new URL('../../build/diag/scenarios/', import.meta.url)
const CGROUP_STAT = '/sys/fs/cgroup/cpu.stat'
const THROTTLED_KEY = Buffer.from('nr_throttled ')
const STAT_BYTES = 1024
const DIGIT_ZERO = 48
const DIGIT_NINE = 57

export const createThrottleReader = (path = CGROUP_STAT) => {
  let fd = -1
  try {
    fd = openSync(path, 'r')
  } catch {
    return { available: false, read: () => -1, close: () => {} }
  }
  const bytes = Buffer.alloc(STAT_BYTES)
  const read = () => {
    const length = readSync(fd, bytes, 0, STAT_BYTES, 0)
    const at = bytes.indexOf(THROTTLED_KEY)
    if (at === -1 || at >= length) return -1
    let value = 0
    for (let i = at + THROTTLED_KEY.length; i < length && bytes[i] >= DIGIT_ZERO && bytes[i] <= DIGIT_NINE; i++) value = value * 10 + (bytes[i] - DIGIT_ZERO)
    return value
  }
  return { available: true, read, close: () => closeSync(fd) }
}

const sharedReader = createThrottleReader()

const SCHEDSTAT = '/proc/thread-self/schedstat'
const SCHEDSTAT_BYTES = 96
const SPACE = 32
const NS_PER_MS = 1e6

const createSchedstatClock = () => {
  let fd = -1
  try {
    fd = openSync(SCHEDSTAT, 'r')
  } catch {
    return null
  }
  const bytes = Buffer.alloc(SCHEDSTAT_BYTES)
  const sample = { runMs: 0, waitMs: 0 }
  const read = () => {
    const length = readSync(fd, bytes, 0, SCHEDSTAT_BYTES, 0)
    let run = 0
    let wait = 0
    let i = 0
    for (; i < length && bytes[i] !== SPACE; i++) run = run * 10 + (bytes[i] - DIGIT_ZERO)
    for (i += 1; i < length && bytes[i] !== SPACE; i++) wait = wait * 10 + (bytes[i] - DIGIT_ZERO)
    sample.runMs = run / NS_PER_MS
    sample.waitMs = wait / NS_PER_MS
    return sample
  }
  if (!(read().runMs > 0)) return null
  return { source: 'schedstat', read }
}

const createUsageClock = () => {
  if (typeof process.threadCpuUsage !== 'function') return null
  const sample = { runMs: 0, waitMs: 0 }
  return {
    source: 'thread-cpu-usage',
    read: () => {
      const used = process.threadCpuUsage()
      sample.runMs = (used.user + used.system) / 1000
      return sample
    },
  }
}

const cpuClock = createSchedstatClock() ?? createUsageClock()

export const TICK_CLOCK = cpuClock ? 'thread-cpu' : 'wall'
export const TICK_CLOCK_SOURCE = cpuClock ? cpuClock.source : 'performance.now'

export const createTickTimer = (reader = sharedReader) => {
  const tickMs = []
  const throttledPeriods = []
  tickMs.throttledPeriods = throttledPeriods
  const cpuMs = cpuClock ? [] : null
  const waitMs = cpuClock ? [] : null
  tickMs.cpuMs = cpuMs
  tickMs.waitMs = waitMs
  let started = 0
  let cpuStarted = 0
  let waitStarted = 0
  let periodsBefore = reader.read()
  return {
    tickMs,
    start() {
      if (cpuClock) {
        const at = cpuClock.read()
        cpuStarted = at.runMs
        waitStarted = at.waitMs
      }
      started = performance.now()
    },
    stop() {
      tickMs.push(performance.now() - started)
      if (cpuClock) {
        const at = cpuClock.read()
        cpuMs.push(at.runMs - cpuStarted)
        waitMs.push(at.waitMs - waitStarted)
      }
      const periodsNow = reader.read()
      throttledPeriods.push(periodsNow >= 0 && periodsBefore >= 0 ? periodsNow - periodsBefore : 0)
      periodsBefore = periodsNow
    },
  }
}

export const summariseTicks = (wallMs) => {
  const cpuMs = wallMs.cpuMs ?? null
  const tickMs = cpuMs ?? wallMs
  const sorted = Float64Array.from(tickMs).sort()
  const wallSorted = Float64Array.from(wallMs).sort()
  const throttled = cpuMs === null ? (wallMs.throttledPeriods ?? null) : null
  const hostThrottled = (tick) => throttled !== null && throttled[tick] > 0
  const overBudgetTicks = []
  let overBudget = 0
  let over25 = 0
  let hostThrottledOverBudget = 0
  for (let tick = 0; tick < tickMs.length; tick++) {
    if (!(tickMs[tick] > FRAME_BUDGET_MS)) continue
    overBudgetTicks.push({ tick, ms: Math.round(tickMs[tick] * 1000) / 1000, cgroupThrottledPeriods: throttled === null ? null : throttled[tick] })
    if (hostThrottled(tick)) {
      hostThrottledOverBudget += 1
      continue
    }
    overBudget += 1
    if (tickMs[tick] > SPIKE_MS) over25 += 1
  }
  const noValidWindow = hostThrottledOverBudget > tickMs.length * HOST_THROTTLED_SHARE_LIMIT
  return {
    clock: cpuMs === null ? 'wall' : 'thread-cpu',
    clockSource: TICK_CLOCK_SOURCE,
    waitTotalMs: wallMs.waitMs ? wallMs.waitMs.reduce((sum, ms) => sum + ms, 0) : null,
    ticks: tickMs.length,
    wallMaxMs: wallSorted[wallSorted.length - 1],
    wallP99Ms: wallSorted[Math.min(wallSorted.length - 1, Math.floor(wallSorted.length * 0.99))],
    wallOverBudget: wallMs.reduce((n, ms) => n + (ms > FRAME_BUDGET_MS ? 1 : 0), 0),
    maxMs: sorted[sorted.length - 1],
    p99Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))],
    overBudget: noValidWindow ? overBudget + hostThrottledOverBudget : overBudget,
    over25,
    hostThrottledOverBudget,
    noValidWindow,
    cgroupThrottledPeriods: throttled === null ? null : throttled.reduce((sum, n) => sum + n, 0),
    overBudgetTicks,
  }
}

export const writeTickTrace = (scenario, label, runs) => {
  mkdirSync(TRACE_DIR, { recursive: true })
  const summaries = runs.map((tickMs) => summariseTicks(tickMs))
  const file = fileURLToPath(new URL(`${scenario}-${label.replace(/[^a-z0-9]+/gi, '-')}.json`, TRACE_DIR))
  writeFileSync(file, JSON.stringify({ scenario, label, budgetMs: FRAME_BUDGET_MS, spikeMs: SPIKE_MS, runs: runs.map((tickMs, i) => ({ ...summaries[i], tickMs: Array.from(tickMs, (ms) => Math.round(ms * 1000) / 1000), cpuMs: tickMs.cpuMs ? tickMs.cpuMs.map((ms) => Math.round(ms * 1000) / 1000) : null })) }) + '\n')
  const hostThrottledOverBudget = summaries.reduce((n, s) => n + s.hostThrottledOverBudget, 0)
  if (hostThrottledOverBudget > 0) {
    const detail = summaries.flatMap((s, run) => s.overBudgetTicks.filter((t) => t.cgroupThrottledPeriods > 0).map((t) => 'run ' + (run + 1) + ' tick ' + t.tick + ' ' + t.ms + ' ms'))
    console.log('INFO ' + scenario + ', ' + label + ': ' + hostThrottledOverBudget + ' tick' + (hostThrottledOverBudget === 1 ? '' : 's') + ' over ' + FRAME_BUDGET_MS + ' ms while the cgroup CPU quota throttled this process, not counted against the engine: ' + detail.slice(0, 8).join(', '))
  }
  return {
    overBudget: summaries.reduce((n, s) => n + s.overBudget, 0),
    over25: summaries.reduce((n, s) => n + s.over25, 0),
    hostThrottledOverBudget,
    clock: summaries[0]?.clock ?? TICK_CLOCK,
    wallOverBudget: summaries.reduce((n, s) => n + s.wallOverBudget, 0),
    maxMs: Math.max(...summaries.map((s) => s.maxMs)),
    file,
  }
}
