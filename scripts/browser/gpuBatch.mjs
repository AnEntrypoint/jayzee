export const BATCH_EVENT = 'WebGPUDecoderImpl::HandleDawnCommands'
export const SLOW_BATCH_MS = 5
const SHOWN = 8
const LEAST_GAP_US = 200
const round = (value) => Number(value.toFixed(3))

const directChildren = (parent, sameThread) => {
  const end = parent.ts + parent.dur
  const children = []
  let covered = parent.ts
  for (const event of sameThread) {
    if (event === parent || event.ts < parent.ts) continue
    if (event.ts > end) break
    if (event.ts + event.dur > end + 1 || event.ts < covered - 1) continue
    children.push(event)
    covered = event.ts + event.dur
  }
  return children
}

const piecesOf = (parent, sameThread) => {
  const pieces = []
  let at = parent.ts
  let after = 'the batch start'
  for (const child of directChildren(parent, sameThread)) {
    if (child.ts - at > LEAST_GAP_US) pieces.push({ name: 'untraced after ' + after, ts: at, dur: child.ts - at })
    pieces.push({ name: child.name, ts: child.ts, dur: child.dur })
    at = child.ts + child.dur
    after = child.name
  }
  const end = parent.ts + parent.dur
  if (end - at > LEAST_GAP_US) pieces.push({ name: 'untraced after ' + after, ts: at, dur: end - at })
  return pieces
}

export const DRIVER_LOCK = /^os_acquire_/
export const DRIVER_LOCK_LEAST_MS = 5
export const DRIVER_LOCK_SHARE = 0.5
export const FRAME_PERIOD_MS = 16.7

export const driverLockMs = (samples, fromUs, toUs) => {
  if (!samples || samples.samples < 2) return null
  const { atUs } = samples
  if (atUs[0] > fromUs || atUs[atUs.length - 1] < toUs) return null
  let lockedUs = 0
  for (let i = 0; i < atUs.length - 1; i++) {
    if (atUs[i + 1] <= fromUs) continue
    if (atUs[i] >= toUs) break
    if (samples.state[i] !== 'D' || !DRIVER_LOCK.test(samples.waitNames[samples.waitsOn[i]])) continue
    lockedUs += Math.min(atUs[i + 1], toUs) - Math.max(atUs[i], fromUs)
  }
  return round(lockedUs / 1000)
}

export const isDriverLockGap = ({ lockMs, intervalMs, pageIdle, workWithinBudget }) =>
  typeof lockMs === 'number' && lockMs >= DRIVER_LOCK_LEAST_MS && lockMs >= DRIVER_LOCK_SHARE * (intervalMs - FRAME_PERIOD_MS) && pageIdle === true && workWithinBudget === true

export const RUN_QUEUE_LEAST_MS = 5

export const runQueueWaitMs = (samples, fromUs, toUs) => {
  if (!samples || samples.samples < 2 || !samples.waitNs) return null
  const { atUs, waitNs } = samples
  if (atUs[0] > fromUs || atUs[atUs.length - 1] < toUs) return null
  let first = 0
  while (first < atUs.length - 1 && atUs[first + 1] <= fromUs) first += 1
  let last = first
  while (last < atUs.length - 1 && atUs[last] < toUs) last += 1
  return round((Number(waitNs[last]) - Number(waitNs[first])) / 1e6)
}

export const isRunQueueGap = ({ waitMs, intervalMs, pageIdle, workWithinBudget }) =>
  typeof waitMs === 'number' && waitMs >= RUN_QUEUE_LEAST_MS && waitMs >= DRIVER_LOCK_SHARE * (intervalMs - FRAME_PERIOD_MS) && pageIdle === true && workWithinBudget === true

export const tsAfterFrames = (events, frames) => {
  const starts = events.filter((event) => event.ph === 'X' && event.name === 'FireAnimationFrame').map((event) => event.ts).sort((a, b) => a - b)
  return starts.length > frames ? starts[frames] : 0
}

export const threadTime = (samples, fromUs, toUs) => {
  if (!samples || samples.samples === 0) return null
  const { atUs, runNs, waitNs } = samples
  let low = 0
  let high = atUs.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (atUs[mid] <= fromUs) low = mid
    else high = mid - 1
  }
  const first = low
  let last = first
  while (last < atUs.length - 1 && atUs[last] < toUs) last += 1
  if (atUs[first] > fromUs || atUs[last] < toUs) return null
  const states = {}
  const waits = {}
  for (let i = first; i <= last; i++) {
    const letter = samples.state[i]
    states[letter] = (states[letter] ?? 0) + 1
    const name = samples.waitNames[samples.waitsOn[i]]
    if (name) waits[name] = (waits[name] ?? 0) + 1
  }
  const spanMs = (atUs[last] - atUs[first]) / 1000
  const onCpuMs = (runNs[last] - runNs[first]) / 1e6
  const runQueueMs = (waitNs[last] - waitNs[first]) / 1e6
  const time = { spanMs: round(spanMs), onCpuMs: round(onCpuMs), runQueueMs: round(runQueueMs), asleepMs: round(Math.max(0, spanMs - onCpuMs - runQueueMs)), samples: last - first + 1, states, waits }
  if (samples.minorFaults) {
    time.minorFaults = samples.minorFaults[last] - samples.minorFaults[first]
    time.majorFaults = samples.majorFaults[last] - samples.majorFaults[first]
    time.systemTicks = samples.systemTicks[last] - samples.systemTicks[first]
    time.userTicks = samples.userTicks[last] - samples.userTicks[first]
  }
  if (!samples.otherSample || samples.otherSample.length === 0) return time
  const ran = {}
  let low2 = 0
  let high2 = samples.otherSample.length
  while (low2 < high2) {
    const mid = (low2 + high2) >> 1
    if (samples.otherSample[mid] <= first) low2 = mid + 1
    else high2 = mid
  }
  for (let i = low2; i < samples.otherSample.length && samples.otherSample[i] <= last; i++) {
    const label = samples.others[samples.otherIndex[i]].label
    ran[label] = (ran[label] ?? 0) + samples.otherRunNs[i] / 1e6
  }
  return { ...time, othersRanMs: Object.fromEntries(Object.entries(ran).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, ms]) => [label, round(ms)])) }
}

export const describeBatches = (events, { afterTs = 0, slowMs = SLOW_BATCH_MS, samples = null } = {}) => {
  const complete = events.filter((event) => event.ph === 'X' && typeof event.dur === 'number')
  const batches = complete.filter((event) => event.name === BATCH_EVENT && event.ts >= afterTs)
  if (batches.length === 0) return { batches: 0, slow: 0, error: 'the trace holds no ' + BATCH_EVENT + ' event' }
  const { pid, tid } = batches[0]
  const sameThread = complete.filter((event) => event.pid === pid && event.tid === tid).sort((a, b) => a.ts - b.ts || b.dur - a.dur)
  const durations = batches.map((event) => event.dur).sort((a, b) => a - b)
  const slow = batches.filter((event) => event.dur > slowMs * 1000).sort((a, b) => b.dur - a.dur)
  const steps = new Map()
  let slowMsSum = 0
  let untracedMs = 0
  const totals = { spanMs: 0, onCpuMs: 0, runQueueMs: 0, asleepMs: 0, measured: 0, states: {}, waits: {}, othersRanMs: {} }
  const worst = []
  for (const batch of slow) {
    const children = piecesOf(batch, sameThread)
    for (const child of children) {
      const step = steps.get(child.name) ?? { step: child.name, ms: 0, calls: 0, longestMs: 0 }
      step.ms += child.dur / 1000
      step.calls += 1
      step.longestMs = Math.max(step.longestMs, child.dur / 1000)
      steps.set(child.name, step)
      if (child.name.startsWith('untraced')) untracedMs += child.dur / 1000
    }
    slowMsSum += batch.dur / 1000
    const longest = children.slice().sort((a, b) => b.dur - a.dur)[0] ?? null
    const thread = longest ? threadTime(samples, longest.ts, longest.ts + longest.dur) : threadTime(samples, batch.ts, batch.ts + batch.dur)
    if (thread) {
      totals.measured += 1
      for (const key of ['spanMs', 'onCpuMs', 'runQueueMs', 'asleepMs']) totals[key] += thread[key]
      for (const key of ['minorFaults', 'majorFaults', 'systemTicks', 'userTicks']) totals[key] = (totals[key] ?? 0) + (thread[key] ?? 0)
      for (const [letter, count] of Object.entries(thread.states)) totals.states[letter] = (totals.states[letter] ?? 0) + count
      for (const [name, count] of Object.entries(thread.waits)) totals.waits[name] = (totals.waits[name] ?? 0) + count
      for (const [label, ms] of Object.entries(thread.othersRanMs ?? {})) totals.othersRanMs[label] = round((totals.othersRanMs[label] ?? 0) + ms)
    }
    if (worst.length < SHOWN) worst.push({ ms: round(batch.dur / 1000), bytes: batch.args?.bytes ?? null, longestStep: longest ? longest.name : null, longestStepMs: longest ? round(longest.dur / 1000) : null, thread })
  }
  for (const key of ['spanMs', 'onCpuMs', 'runQueueMs', 'asleepMs']) totals[key] = round(totals[key])
  totals.othersRanMs = Object.fromEntries(Object.entries(totals.othersRanMs).sort((a, b) => b[1] - a[1]).slice(0, SHOWN))
  return {
    pid,
    tid,
    batches: batches.length,
    medianMs: round(durations[durations.length >> 1] / 1000),
    p99Ms: round(durations[Math.floor(durations.length * 0.99)] / 1000),
    longestMs: round(durations[durations.length - 1] / 1000),
    slowMs,
    slow: slow.length,
    slowSumMs: round(slowMsSum),
    untracedMs: round(untracedMs),
    steps: [...steps.values()].sort((a, b) => b.ms - a.ms).slice(0, SHOWN).map((step) => ({ ...step, ms: round(step.ms), longestMs: round(step.longestMs) })),
    longestStepThread: samples ? totals : null,
    worst,
  }
}
