import { readFileSync } from 'node:fs'
import { offCpuWindow, parseSchedLog } from './thread-sampling.mjs'

export const LONG_FRAME_MS = 50

export const parseCgroupSamples = (text) => String(text).split('\n').filter((line) => line !== '').map((line) => {
  const parts = line.split(' ').map(Number)
  if (parts.length !== 5 || !parts.every(Number.isFinite)) throw new TypeError('cgroup sampler line needs ts throttledUs usageUs someUs fullUs: ' + line)
  const [t, throttledUs, usageUs, someUs, fullUs] = parts
  return { t, throttledUs, usageUs, someUs, fullUs }
})

export const pageFrames = (page) => {
  const columns = page.rowColumns
  if (!Array.isArray(columns) || !Array.isArray(page.rows)) throw new TypeError('page needs rowColumns and rows')
  return page.rows.map((row) => {
    const frame = Object.fromEntries(columns.map((name, i) => [name, row[i]]))
    const startMs = frame.startMs
    const endMs = startMs + frame.tickMs + frame.renderMs
    return { frame: frame.frame, startMs, endMs, tickMs: frame.tickMs, renderMs: frame.renderMs, physicsMs: frame.physics }
  })
}

export const mainThreadPid = (schedRows) => {
  const first = new Map()
  const last = new Map()
  for (const row of schedRows) {
    if (!first.has(row.pid)) first.set(row.pid, row)
    last.set(row.pid, row)
  }
  if (first.size === 0) throw new TypeError('no sched rows to choose a thread from')
  let best = null
  let bestGain = -Infinity
  for (const [pid, row] of first) {
    const gain = last.get(pid).runNs - row.runNs
    if (gain > bestGain) {
      best = pid
      bestGain = gain
    }
  }
  return best
}

const interpolate = (samples, key, t) => {
  let lo = 0
  let hi = samples.length - 1
  if (samples.length === 0 || t < samples[0].t || t > samples[hi].t) return null
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (samples[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  if (lo === samples.length - 1 || samples[lo].t === t) return samples[lo][key]
  const a = samples[lo]
  const b = samples[lo + 1]
  return a[key] + ((t - a.t) / (b.t - a.t)) * (b[key] - a[key])
}

export const cgroupOver = (samples, startMs, endMs) => {
  const thr = interpolate(samples, 'throttledUs', startMs)
  const thrEnd = interpolate(samples, 'throttledUs', endMs)
  const usage = interpolate(samples, 'usageUs', startMs)
  const usageEnd = interpolate(samples, 'usageUs', endMs)
  const some = interpolate(samples, 'someUs', startMs)
  const someEnd = interpolate(samples, 'someUs', endMs)
  if ([thr, thrEnd, usage, usageEnd, some, someEnd].includes(null)) return null
  const wallMs = endMs - startMs
  return {
    throttledMs: (thrEnd - thr) / 1000,
    cpuCores: (usageEnd - usage) / 1000 / wallMs,
    someMs: (someEnd - some) / 1000,
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)]
}

const summarise = (frames) => ({
  n: frames.length,
  tickMsMedian: median(frames.map((f) => f.tickMs)),
  wallMsMedian: median(frames.map((f) => f.wallMs)),
  runShareMedian: median(frames.map((f) => f.runShare)),
  waitShareMedian: median(frames.map((f) => f.waitShare)),
  offShareMedian: median(frames.map((f) => f.offShare)),
  throttledMsMedian: median(frames.map((f) => f.throttledMs)),
  cpuCoresMedian: median(frames.map((f) => f.cpuCores)),
  someMsMedian: median(frames.map((f) => f.someMs)),
})

export const classifyLongFrames = (long, quotaCores) => {
  if (long.n === 0) return 'no-long-frames'
  if (long.offShareMedian !== null && long.offShareMedian >= 0.5) return 'off-cpu'
  const run = long.runShareMedian
  const wait = long.waitShareMedian
  if (run !== null && wait !== null && run >= 0.3 && wait >= 0.3) return 'cpu-and-runnable-wait'
  if (run !== null && run >= 0.5) return 'cpu-work'
  if (wait !== null && wait >= 0.3) return 'runnable-wait'
  if (long.cpuCoresMedian !== null && long.cpuCoresMedian >= 0.9 * quotaCores && long.throttledMsMedian > 0) return 'quota-saturated'
  return 'unattributed'
}

export const frameCauses = ({ page, cgroupSamples, schedRows = null, quotaCores = 12, longMs = LONG_FRAME_MS }) => {
  const frames = pageFrames(page)
  const pid = schedRows && schedRows.length > 0 ? mainThreadPid(schedRows) : null
  const measured = []
  for (const frame of frames) {
    const cg = cgroupOver(cgroupSamples, frame.startMs, frame.endMs)
    if (cg === null) continue
    const wallMs = frame.endMs - frame.startMs
    const sched = pid === null ? null : offCpuWindow({ schedRows, pid, startMs: frame.startMs, endMs: frame.endMs })
    const runMs = sched && sched.runMs !== null ? sched.runMs : null
    const waitMs = sched && sched.waitMs !== null ? sched.waitMs : null
    measured.push({
      frame: frame.frame,
      tickMs: frame.tickMs,
      wallMs,
      runShare: runMs === null ? null : runMs / wallMs,
      waitShare: waitMs === null ? null : waitMs / wallMs,
      offShare: runMs === null ? null : (wallMs - runMs - waitMs) / wallMs,
      throttledMs: cg.throttledMs,
      cpuCores: cg.cpuCores,
      someMs: cg.someMs,
    })
  }
  const long = summarise(measured.filter((f) => f.tickMs > longMs))
  const normal = summarise(measured.filter((f) => f.tickMs <= longMs))
  return { frames: frames.length, covered: measured.length, mainPid: pid, long, normal, cause: classifyLongFrames(long, quotaCores) }
}

if (process.argv[1] && process.argv[1].endsWith('/browser/frame-stall-cause.mjs')) {
  const [pagePath, cgroupPath, schedPath = null, quotaArg = '12'] = process.argv.slice(2)
  const page = JSON.parse(readFileSync(pagePath, 'utf8'))
  const cgroupSamples = parseCgroupSamples(readFileSync(cgroupPath, 'utf8'))
  const schedRows = schedPath === null ? null : parseSchedLog(readFileSync(schedPath, 'utf8'))
  console.log(JSON.stringify(frameCauses({ page, cgroupSamples, schedRows, quotaCores: Number(quotaArg) })))
}
