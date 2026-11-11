import { closeSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'

const NEWLINE = 10
const SPACE = 32
const TAB = 9
const CLOSE_PAREN = 41
const NS_PER_MS = 1e6
const ENGINE_POOL_THREADS = 3
const STEAL_FIELD = 7
const STAT_MINOR_FAULTS = 7
const STAT_MAJOR_FAULTS = 9
const STAT_SYSTEM_TICKS = 12
const RUNQUEUE_WAIT_MS = 5
const QUIET_WAIT_MS = 1
const HELPER_IDLE_MS = 1
const FUTEX_KINDS = Object.freeze(['mainSpin', 'spinTimeout', 'workerWait', 'timedSlice', 'yield'])
const THROTTLED_LABEL = Buffer.from('nr_throttled ')
const THROTTLED_USEC_LABEL = Buffer.from('throttled_usec ')
const CPU_LABEL = Buffer.from('cpu ')
const VOLUNTARY_LABEL = Buffer.from('\nvoluntary_ctxt_switches:')
const INVOLUNTARY_LABEL = Buffer.from('\nnonvoluntary_ctxt_switches:')

export const HOST_RULE = 'a tick over budget is the host when the cgroup throttle counter moved in it, or steal time moved in it, or an engine thread waited ' + RUNQUEUE_WAIT_MS + ' ms or more on the run queue in it while the helper threads of the process ran under ' + HELPER_IDLE_MS + ' ms'
export const QUIET_RULE = 'a tick is quiet when the throttle counter and steal time did not move in it and no engine thread waited ' + QUIET_WAIT_MS + ' ms or more on the run queue with the helper threads idle'

const openCounter = (path) => {
  try {
    return openSync(path, 'r')
  } catch {
    return -1
  }
}

const digitsAt = (bytes, from, length) => {
  let i = from
  let value = 0
  while (i < length && bytes[i] >= 48 && bytes[i] <= 57) {
    value = value * 10 + bytes[i] - 48
    i += 1
  }
  return value
}

const numberAfter = (bytes, length, label, skipFields) => {
  const at = bytes.indexOf(label)
  if (at < 0 || at >= length) return -1
  let i = at + label.length
  for (let skipped = 0; skipped <= skipFields; skipped++) {
    while (i < length && (bytes[i] === SPACE || bytes[i] === TAB)) i += 1
    if (skipped === skipFields) break
    while (i < length && bytes[i] !== SPACE && bytes[i] !== NEWLINE) i += 1
  }
  return digitsAt(bytes, i, length)
}

const fieldFrom = (bytes, from, length, index) => {
  let i = from
  for (let skipped = 0; skipped < index; skipped++) {
    while (i < length && bytes[i] !== SPACE) i += 1
    i += 1
  }
  return digitsAt(bytes, i, length)
}

const listThreads = () => {
  try {
    return readdirSync('/proc/self/task').map((tid) => ({
      tid: Number(tid),
      sched: openCounter('/proc/self/task/' + tid + '/schedstat'),
      stat: openCounter('/proc/self/task/' + tid + '/stat'),
      status: openCounter('/proc/self/task/' + tid + '/status'),
      name: readFileSync('/proc/self/task/' + tid + '/comm', 'utf8').trim(),
    })).filter((thread) => thread.sched >= 0)
  } catch {
    return []
  }
}

export const createTickProbe = ({ module, ticks, budgetMs, layoutUsedWord }) => {
  const bytes = Buffer.alloc(4096)
  const cgroupFd = openCounter('/sys/fs/cgroup/cpu.stat')
  const statFd = openCounter('/proc/stat')
  const threads = listThreads()
  const isEngineThread = (index) => index === 0 || index >= threads.length - ENGINE_POOL_THREADS
  const throttledAt = new Float64Array(ticks + 1).fill(-1)
  const throttledUsecAt = new Float64Array(ticks + 1).fill(-1)
  const stealAt = new Float64Array(ticks + 1).fill(-1)
  const threadWaitNs = new Float64Array(threads.length)
  const threadRunNs = new Float64Array(threads.length)
  const waitMaxMs = new Float64Array(ticks)
  const waitSumMs = new Float64Array(ticks)
  const waitThread = new Int32Array(ticks).fill(-1)
  const helperRunMs = new Float64Array(ticks)
  const engineRunMs = new Float64Array(ticks)
  const futexCount = typeof module._engine_wait_count === 'function' ? module._engine_wait_count : null
  const futexAt = new Float64Array(FUTEX_KINDS.length)
  const futexIn = FUTEX_KINDS.map(() => new Int32Array(ticks))
  const totals = { minor: 0, major: 0, system: 0, voluntary: 0, involuntary: 0 }
  const minorFaults = new Int32Array(ticks)
  const majorFaults = new Int32Array(ticks)
  const systemTicks = new Int32Array(ticks)
  const voluntary = new Int32Array(ticks)
  const involuntary = new Int32Array(ticks)
  const arenaGrowth = new Float64Array(ticks)
  const memoryGrowth = new Float64Array(ticks)
  const state = { arenaUsed: 0, memoryBytes: 0 }
  const layoutAt = () => module._engine_layout() >> 2

  const readHost = (at) => {
    if (cgroupFd >= 0) {
      const length = readSync(cgroupFd, bytes, 0, bytes.length, 0)
      throttledAt[at] = numberAfter(bytes, length, THROTTLED_LABEL, 0)
      throttledUsecAt[at] = numberAfter(bytes, length, THROTTLED_USEC_LABEL, 0)
    }
    if (statFd >= 0) {
      const length = readSync(statFd, bytes, 0, 512, 0)
      stealAt[at] = numberAfter(bytes, length, CPU_LABEL, STEAL_FIELD)
    }
  }

  const readThreads = (tick) => {
    let worst = 0
    let sum = 0
    let who = -1
    let helpers = 0
    let engines = 0
    let minor = 0
    let major = 0
    let system = 0
    let willing = 0
    let unwilling = 0
    for (let t = 0; t < threads.length; t++) {
      const length = readSync(threads[t].sched, bytes, 0, 128, 0)
      const ran = fieldFrom(bytes, 0, length, 0)
      const waited = fieldFrom(bytes, 0, length, 1)
      const delta = waited - threadWaitNs[t]
      if (isEngineThread(t)) engines += ran - threadRunNs[t]
      else helpers += ran - threadRunNs[t]
      threadWaitNs[t] = waited
      threadRunNs[t] = ran
      sum += delta
      if (delta > worst) {
        worst = delta
        who = t
      }
      if (!isEngineThread(t)) continue
      if (threads[t].stat >= 0) {
        const statLength = readSync(threads[t].stat, bytes, 0, 1024, 0)
        const after = bytes.lastIndexOf(CLOSE_PAREN, statLength) + 2
        minor += fieldFrom(bytes, after, statLength, STAT_MINOR_FAULTS)
        major += fieldFrom(bytes, after, statLength, STAT_MAJOR_FAULTS)
        system += fieldFrom(bytes, after, statLength, STAT_SYSTEM_TICKS)
      }
      if (threads[t].status >= 0) {
        const statusLength = readSync(threads[t].status, bytes, 0, bytes.length, 0)
        willing += Math.max(0, numberAfter(bytes, statusLength, VOLUNTARY_LABEL, 0))
        unwilling += Math.max(0, numberAfter(bytes, statusLength, INVOLUNTARY_LABEL, 0))
      }
    }
    if (tick >= 0) {
      waitMaxMs[tick] = worst / NS_PER_MS
      waitSumMs[tick] = sum / NS_PER_MS
      waitThread[tick] = who
      helperRunMs[tick] = helpers / NS_PER_MS
      engineRunMs[tick] = engines / NS_PER_MS
      minorFaults[tick] = minor - totals.minor
      majorFaults[tick] = major - totals.major
      systemTicks[tick] = system - totals.system
      voluntary[tick] = willing - totals.voluntary
      involuntary[tick] = unwilling - totals.involuntary
    }
    totals.minor = minor
    totals.major = major
    totals.system = system
    totals.voluntary = willing
    totals.involuntary = unwilling
  }

  const readEngine = (tick) => {
    if (futexCount) {
      for (let kind = 0; kind < FUTEX_KINDS.length; kind++) {
        const now = futexCount(kind)
        if (tick >= 0) futexIn[kind][tick] = now - futexAt[kind]
        futexAt[kind] = now
      }
    }
    const used = module.HEAPU32[layoutAt() + layoutUsedWord]
    const memory = module.HEAPU8.buffer.byteLength
    if (tick >= 0) {
      arenaGrowth[tick] = used - state.arenaUsed
      memoryGrowth[tick] = memory - state.memoryBytes
    }
    state.arenaUsed = used
    state.memoryBytes = memory
  }

  const hostCounters = () => throttledAt[0] >= 0 && stealAt[0] >= 0
  const throttledIn = (tick) => throttledAt[tick + 1] - throttledAt[tick]
  const stealIn = (tick) => stealAt[tick + 1] - stealAt[tick]
  const throttledAround = (tick) => hostCounters() && throttledIn(tick) > 0
  const stolenAround = (tick) => hostCounters() && stealIn(tick) > 0
  const waitedOver = (tick, least) => waitThread[tick] >= 0 && isEngineThread(waitThread[tick]) && waitMaxMs[tick] >= least && helperRunMs[tick] < HELPER_IDLE_MS
  const hostIn = (tick) => throttledAround(tick) || stolenAround(tick) || waitedOver(tick, RUNQUEUE_WAIT_MS)
  const quietIn = (tick) => !throttledAround(tick) && !stolenAround(tick) && !waitedOver(tick, QUIET_WAIT_MS)
  const round = (value, digits) => Number(value.toFixed(digits))

  return {
    threads: threads.map((thread, index) => (isEngineThread(index) ? 'engine ' : 'helper ') + thread.name),
    start() {
      readHost(0)
      readThreads(-1)
      readEngine(-1)
    },
    record(tick) {
      readHost(tick + 1)
      readThreads(tick)
      readEngine(tick)
    },
    close() {
      if (cgroupFd >= 0) closeSync(cgroupFd)
      if (statFd >= 0) closeSync(statFd)
      for (const thread of threads) {
        closeSync(thread.sched)
        if (thread.stat >= 0) closeSync(thread.stat)
        if (thread.status >= 0) closeSync(thread.status)
      }
    },
    hostIn,
    quietIn,
    describe(tick, ms) {
      return {
        tick,
        ms: round(ms, 2),
        host: hostIn(tick),
        throttledPeriods: hostCounters() ? throttledIn(tick) : null,
        throttledMs: hostCounters() ? round((throttledUsecAt[tick + 1] - throttledUsecAt[tick]) / 1000, 2) : null,
        stealJiffies: hostCounters() ? stealIn(tick) : null,
        waitMaxMs: round(waitMaxMs[tick], 2),
        waitThread: waitThread[tick] >= 0 ? (isEngineThread(waitThread[tick]) ? 'engine thread ' : 'helper thread ') + waitThread[tick] : null,
        waitSumMs: round(waitSumMs[tick], 2),
        helperRunMs: round(helperRunMs[tick], 2),
        engineRunMs: round(engineRunMs[tick], 2),
        futex: futexCount ? FUTEX_KINDS.map((_, kind) => futexIn[kind][tick]) : null,
        minorFaults: minorFaults[tick],
        majorFaults: majorFaults[tick],
        systemJiffies: systemTicks[tick],
        voluntarySwitches: voluntary[tick],
        involuntarySwitches: involuntary[tick],
        arenaGrowthBytes: arenaGrowth[tick],
        memoryGrowthBytes: memoryGrowth[tick],
      }
    },
    summarise(times, quantile) {
      const sum = (values) => values.reduce((total, value) => total + value, 0)
      const sortedCopy = (values) => Float64Array.from(values).sort()
      const share = sortedCopy(Float64Array.from(times, (ms, tick) => (ms > 0 ? engineRunMs[tick] / ms : 0)))
      const quiet = times.filter((ms, tick) => quietIn(tick)).sort()
      const over = { any: 0, throttled: 0, stolen: 0, preempted: 0 }
      times.forEach((ms, tick) => {
        if (ms <= budgetMs) return
        if (throttledAround(tick)) over.throttled += 1
        if (stolenAround(tick)) over.stolen += 1
        if (waitedOver(tick, RUNQUEUE_WAIT_MS)) over.preempted += 1
        if (hostIn(tick)) over.any += 1
      })
      return {
        hostCounters: hostCounters(),
        hostRule: HOST_RULE,
        quietRule: QUIET_RULE,
        quietTicks: quiet.length,
        p99QuietMs: quiet.length ? round(quantile(quiet, 0.99), 3) : null,
        overBudgetHost: over.any,
        overBudgetHostThrottled: over.throttled,
        overBudgetHostStolen: over.stolen,
        overBudgetHostPreempted: over.preempted,
        threadsWatched: threads.length,
        waitMaxMedianMs: round(quantile(sortedCopy(waitMaxMs), 0.5), 3),
        waitMaxP99Ms: round(quantile(sortedCopy(waitMaxMs), 0.99), 3),
        helperRunP99Ms: round(quantile(sortedCopy(helperRunMs), 0.99), 3),
        helperRunTotalMs: round(sum(helperRunMs), 1),
        engineRunShareMedian: round(quantile(share, 0.5), 2),
        futexKinds: FUTEX_KINDS,
        futexP99PerTick: futexCount ? futexIn.map((counts) => quantile(Int32Array.from(counts).sort(), 0.99)) : null,
        throttledPeriods: hostCounters() ? throttledAt[ticks] - throttledAt[0] : null,
        throttledMs: hostCounters() ? round((throttledUsecAt[ticks] - throttledUsecAt[0]) / 1000, 1) : null,
        stealJiffies: hostCounters() ? stealAt[ticks] - stealAt[0] : null,
        minorFaultsTotal: sum(minorFaults),
        minorFaultsP99: quantile(Int32Array.from(minorFaults).sort(), 0.99),
        minorFaultsMax: Math.max(...minorFaults),
        majorFaultsTotal: sum(majorFaults),
        involuntarySwitchesTotal: sum(involuntary),
        voluntarySwitchesP99: quantile(Int32Array.from(voluntary).sort(), 0.99),
        systemJiffiesTotal: sum(systemTicks),
        arenaGrowthTicks: arenaGrowth.reduce((count, bytes) => count + (bytes !== 0 ? 1 : 0), 0),
        arenaGrowthBytes: sum(arenaGrowth),
        memoryGrowthTicks: memoryGrowth.reduce((count, bytes) => count + (bytes !== 0 ? 1 : 0), 0),
      }
    },
  }
}
