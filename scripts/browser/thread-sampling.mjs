export const processType = (cmd) => {
  const match = /--type=([\w-]+)/.exec(cmd)
  return match ? match[1] : 'browser'
}

export const parseStat = (stat) => {
  const open = stat.indexOf('(')
  const close = stat.lastIndexOf(')')
  const comm = stat.slice(open + 1, close)
  const fields = stat.slice(close + 2).split(' ')
  return { comm, jiffies: Number(fields[11]) + Number(fields[12]), minflt: Number(fields[7]), majflt: Number(fields[9]) }
}

export const parseSchedStat = (text) => {
  const [runNs, waitNs, slices] = String(text).trim().split(/\s+/).map(Number)
  if (![runNs, waitNs, slices].every(Number.isFinite)) throw new TypeError('schedstat needs run, wait and slice counts: ' + text)
  return { runNs, waitNs, slices }
}

export const parsePressureTotal = (text) => {
  const match = /^some .*total=(\d+)/m.exec(String(text))
  if (!match) throw new TypeError('pressure file has no some total: ' + text)
  return Number(match[1])
}

export const WCHAN_CATEGORIES = [
  [/^futex/, 'futex'],
  [/epoll|ep_poll/, 'epoll'],
  [/^(io_schedule|folio_wait|wait_on_page|wait_on_buffer|filemap_|blk_|__wait_on_bit_lock)/, 'page-io'],
  [/^(shrink_|try_to_free|throttle_direct_reclaim|mem_cgroup|do_try_to_free)/, 'reclaim'],
  [/^(do_nanosleep|hrtimer_nanosleep|do_sys_poll|poll_schedule|do_select|do_poll)/, 'sleep-or-poll'],
  [/^(pipe_|unix_stream|unix_dgram|sock_|skb_|tcp_|unix_)/, 'socket'],
  [/^(do_wait|wait_consider|do_exit)/, 'child'],
]

export const categoryOfWchan = (name) => {
  if (name === '0' || name === '') return 'running'
  const hit = WCHAN_CATEGORIES.find(([pattern]) => pattern.test(name))
  return hit ? hit[1] : 'other'
}

export const parseSchedLog = (text) => String(text).split('\n').filter((line) => line !== '').map((line) => {
  const parts = line.split(' ')
  if (parts.length !== 8) throw new TypeError('sched line needs ts pid runNs waitNs slices minflt majflt wchan: ' + line)
  const [t, pid, runNs, waitNs, slices, minflt, majflt] = parts.slice(0, 7).map(Number)
  if (![t, pid, runNs, waitNs, slices, minflt, majflt].every(Number.isFinite)) throw new TypeError('sched line is not valid: ' + line)
  return { t, pid, runNs, waitNs, slices, minflt, majflt, wchan: parts[7] }
})

export const parseTicksLog = (text) => String(text).split('\n').filter((line) => line !== '').map((line) => {
  const parts = line.split(' ').map(Number)
  if (parts.length !== 6 || !parts.every(Number.isFinite)) throw new TypeError('tick line needs ts memSomeUs ioSomeUs selfRunNs selfWaitNs workMs: ' + line)
  const [t, memSomeUs, ioSomeUs, selfRunNs, selfWaitNs, workMs] = parts
  return { t, memSomeUs, ioSomeUs, selfRunNs, selfWaitNs, workMs }
})

export const samplingGaps = (stamps) => stamps.slice(1).map((t, i) => t - stamps[i])

export const gapsOverLimit = (stamps, intervalMs) => samplingGaps(stamps).filter((gap) => gap > 2 * intervalMs)

export const interpolateAt = (points, t) => {
  if (points.length === 0 || t < points[0].t) return null
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (points[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  if (lo === points.length - 1 || points[lo].t === t) return points[lo].v
  const next = points[lo + 1]
  return points[lo].v + ((t - points[lo].t) / (next.t - points[lo].t)) * (next.v - points[lo].v)
}

export const stepAt = (points, t) => {
  if (points.length === 0 || t < points[0].t) return null
  let value = points[0].v
  for (const point of points) {
    if (point.t > t) break
    value = point.v
  }
  return value
}

export const offCpuWindow = ({ schedRows, pid, startMs, endMs }) => {
  if (!(endMs > startMs)) throw new TypeError('offCpuWindow needs startMs before endMs')
  const mine = schedRows.filter((row) => row.pid === pid).sort((a, b) => a.t - b.t)
  const covered = mine.length > 0 && startMs >= mine[0].t && endMs <= mine[mine.length - 1].t
  const at = (key, t) => (covered ? interpolateAt(mine.map((row) => ({ t: row.t, v: row[key] })), t) : null)
  const runStart = at('runNs', startMs)
  const runEnd = at('runNs', endMs)
  const waitStart = at('waitNs', startMs)
  const waitEnd = at('waitNs', endMs)
  const inWindow = mine.filter((row) => row.t >= startMs && row.t <= endMs)
  const nearest = inWindow.length === 0 ? mine.filter((row) => row.t < startMs).slice(-1) : []
  const waits = {}
  for (const row of inWindow.concat(nearest)) {
    const label = categoryOfWchan(row.wchan)
    waits[label] = (waits[label] ?? 0) + 1
  }
  const faultDelta = (key) => {
    const a = stepAt(mine.map((row) => ({ t: row.t, v: row[key] })), startMs)
    const b = stepAt(mine.map((row) => ({ t: row.t, v: row[key] })), endMs)
    return a === null || b === null || a < 0 || b < 0 ? null : b - a
  }
  return {
    runMs: runStart === null || runEnd === null ? null : (runEnd - runStart) / 1e6,
    waitMs: waitStart === null || waitEnd === null ? null : (waitEnd - waitStart) / 1e6,
    samples: inWindow.length,
    waits,
    majflt: covered ? faultDelta('majflt') : null,
    minflt: covered ? faultDelta('minflt') : null,
  }
}

export const pressureMsBetweenTicks = (ticks, key, startMs, endMs) => {
  const points = ticks.filter((row) => row[key] >= 0).map((row) => ({ t: row.t, v: row[key] }))
  if (points.length === 0 || startMs < points[0].t || endMs > points[points.length - 1].t) return null
  const a = interpolateAt(points, startMs)
  const b = interpolateAt(points, endMs)
  return a === null || b === null ? null : (b - a) / 1000
}

export const gapCauses = (ticks, intervalMs, shareOfExcess = 0.8) => {
  if (!(intervalMs > 0)) throw new TypeError('gapCauses needs a positive interval')
  const causes = []
  for (let i = 1; i < ticks.length; i += 1) {
    const prev = ticks[i - 1]
    const row = ticks[i]
    const gapMs = row.t - prev.t
    if (gapMs <= 2 * intervalMs) continue
    const excessMs = gapMs - intervalMs
    const selfWaitMs = (row.selfWaitNs - prev.selfWaitNs) / 1e6
    const selfRunMs = (row.selfRunNs - prev.selfRunNs) / 1e6
    const cause = selfWaitMs >= shareOfExcess * excessMs
      ? 'run-queue-wait'
      : row.workMs >= shareOfExcess * excessMs
        ? 'sampler-work'
        : 'unattributed'
    causes.push({ t: row.t, gapMs, excessMs, selfWaitMs, selfRunMs, workMs: row.workMs, cause })
  }
  return causes
}
