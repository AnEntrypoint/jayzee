export const CACHE_REVALIDATE_STALE_MS = 30 * 60 * 1000
export const CACHE_REVALIDATE_SWEEP_INTERVAL_MS = 5 * 60 * 1000
export const CACHE_REVALIDATE_MAX_PER_SWEEP = 8
export const CACHE_REVALIDATE_LOW_PRIORITY_DISTANCE = 100000
export const CACHE_REVALIDATE_FIRST_SWEEP_MS = 15000
export const CACHE_REVALIDATE_MAX_SWEEPS = 288
export const CACHE_REVALIDATE_DEADLINE_MS = 24 * 60 * 60 * 1000

const noLog = () => {}
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const nonNegative = (v) => isFiniteNumber(v) && v >= 0
const positive = (v) => isFiniteNumber(v) && v > 0

function optionOr(value, fallback, valid, name) {
  if (value === undefined) return fallback
  if (!valid(value)) throw new RangeError(`createCacheRevalidationSweep: ${name} must be a finite number in range, got ${String(value)}`)
  return value
}

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`createCacheRevalidationSweep: ${name} must be a function`)
  return value
}

export function createCacheRevalidationSweep(opts = {}) {
  const scheduler = opts.scheduler
  if (!scheduler || typeof scheduler.enqueue !== 'function' || typeof scheduler.size !== 'function') {
    throw new TypeError('createCacheRevalidationSweep: scheduler must expose enqueue and size')
  }
  const listEntries = requireFunction(opts.listEntries, 'listEntries')
  const revalidate = requireFunction(opts.revalidate, 'revalidate')
  const now = requireFunction(opts.now, 'now')
  const timers = opts.timers
  if (!timers) throw new TypeError('createCacheRevalidationSweep: timers must be given')
  const setIntervalFn = requireFunction(timers.every, 'timers.every')
  const clearIntervalFn = requireFunction(timers.stopEvery, 'timers.stopEvery')
  const setTimeoutFn = requireFunction(timers.after, 'timers.after')
  const clearTimeoutFn = requireFunction(timers.cancelAfter, 'timers.cancelAfter')
  const log = typeof opts.log === 'function' ? opts.log : noLog
  const staleMs = optionOr(opts.staleMs, CACHE_REVALIDATE_STALE_MS, nonNegative, 'staleMs')
  const maxPerSweep = optionOr(opts.maxPerSweep, CACHE_REVALIDATE_MAX_PER_SWEEP, positive, 'maxPerSweep')
  const maxSweeps = optionOr(opts.maxSweeps, CACHE_REVALIDATE_MAX_SWEEPS, positive, 'maxSweeps')
  const sweepDeadlineMs = optionOr(opts.sweepDeadlineMs, CACHE_REVALIDATE_DEADLINE_MS, positive, 'sweepDeadlineMs')

  const stats = { sweeps: 0, candidatesSeen: 0, enqueued: 0, revalidated: 0, changed: 0, errors: 0, lastSweepAt: 0 }
  const inFlight = new Set()
  let active = false
  let intervalHandle = null
  let firstHandle = null
  let startedAt = 0
  let verdict = null

  function counters() {
    return `sweeps=${stats.sweeps} enqueued=${stats.enqueued} revalidated=${stats.revalidated} changed=${stats.changed} errors=${stats.errors}`
  }

  function getStats() {
    return { ...stats, queued: scheduler.size(), inFlight: inFlight.size }
  }

  function revalidateOne(url) {
    stats.enqueued++
    new Promise((resolve) => resolve(revalidate(url)))
      .then((res) => {
        stats.revalidated++
        if (res && res.changed) stats.changed++
      })
      .catch(() => { stats.errors++ })
      .finally(() => { inFlight.delete(url) })
  }

  async function sweepOnce() {
    stats.sweeps++
    stats.lastSweepAt = now()
    let entries
    try {
      entries = await listEntries()
    } catch {
      log(`[cache-revalidate] sweep list-unavailable: ${counters()}`)
      return 0
    }
    const cutoff = now() - staleMs
    let enqueuedThisSweep = 0
    for (const entry of entries) {
      if (enqueuedThisSweep >= maxPerSweep) break
      stats.candidatesSeen++
      if (entry.lastRevalidated > cutoff) continue
      if (inFlight.has(entry.url)) continue
      inFlight.add(entry.url)
      enqueuedThisSweep++
      scheduler.enqueue({
        id: `cacheRevalidate:${entry.url}`,
        kind: 'cacheRevalidate',
        features: { distance: CACHE_REVALIDATE_LOW_PRIORITY_DISTANCE, screenSize: 1, inFrustum: false, gameplayBoost: 0 },
        run: () => revalidateOne(entry.url),
      })
    }
    log(`[cache-revalidate] sweep ${counters()}`)
    return enqueuedThisSweep
  }

  function finish(reason) {
    if (!active) return verdict
    active = false
    if (intervalHandle !== null) {
      clearIntervalFn(intervalHandle)
      intervalHandle = null
    }
    if (firstHandle !== null) {
      clearTimeoutFn(firstHandle)
      firstHandle = null
    }
    verdict = { reason, sweeps: stats.sweeps, ms: now() - startedAt }
    log(`[cache-revalidate] ${reason} after ${verdict.sweeps} sweeps / ${verdict.ms}ms: ${counters()}`)
    return verdict
  }

  function run() {
    if (!active) return
    sweepOnce().catch(() => {})
    if (stats.sweeps >= maxSweeps || now() - startedAt >= sweepDeadlineMs) finish('cap')
  }

  function start() {
    if (active) return false
    active = true
    startedAt = now()
    verdict = null
    intervalHandle = setIntervalFn(run, CACHE_REVALIDATE_SWEEP_INTERVAL_MS)
    firstHandle = setTimeoutFn(() => {
      firstHandle = null
      run()
    }, CACHE_REVALIDATE_FIRST_SWEEP_MS)
    return true
  }

  return {
    sweepOnce,
    start,
    stop: () => finish('stopped'),
    restart: () => (active ? false : start()),
    getStats,
    get stopped() { return !active },
    get verdict() { return verdict },
    FIRST_SWEEP_MS: CACHE_REVALIDATE_FIRST_SWEEP_MS,
    SWEEP_INTERVAL_MS: CACHE_REVALIDATE_SWEEP_INTERVAL_MS,
    MAX_SWEEPS: maxSweeps,
    SWEEP_DEADLINE_MS: sweepDeadlineMs,
  }
}
