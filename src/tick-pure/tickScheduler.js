export const MAX_CATCH_UP_STEPS = 4
export const FINE_TIMER_MS = 2
export const DEFAULT_COARSE_TIMER_MS = 16
export const TIMER_PROBE_SAMPLES = 5
export const REASON_CATCH_UP = 'tick-catch-up-exceeded'
export const REASON_DROP_LISTENER = 'tick-drop-listener-invalid'

const granularityOf = (granularityMs) => granularityMs ?? DEFAULT_COARSE_TIMER_MS

export const usePreciseWait = ({ precise, hasYield, granularityMs }) =>
  Boolean(precise) && Boolean(hasYield) && granularityOf(granularityMs) > FINE_TIMER_MS

export const earlyToleranceMs = ({ precise, hasYield, tickDuration, granularityMs }) => {
  if (usePreciseWait({ precise, hasYield, granularityMs })) return 0
  return Math.min(tickDuration / 2, granularityOf(granularityMs) / 2)
}

export const planWake = ({ remaining, precise, hasYield, tickDuration, granularityMs }) => {
  const granularity = granularityOf(granularityMs)
  if (usePreciseWait({ precise, hasYield, granularityMs })) {
    if (remaining <= granularity + FINE_TIMER_MS) return { kind: 'spin' }
    return { kind: 'timer', waitMs: Math.max(0, remaining - granularity - FINE_TIMER_MS) }
  }
  const early = earlyToleranceMs({ precise, hasYield, tickDuration, granularityMs })
  return { kind: 'timer', waitMs: Math.max(0, remaining - early) }
}

export const catchUpDrop = ({ now, nextDueMs, tickDuration }) => {
  const overdue = now - nextDueMs
  const limit = tickDuration * MAX_CATCH_UP_STEPS
  return overdue > limit ? overdue - limit : 0
}

export async function probeTimerGranularity({ now, setTimer, samples = TIMER_PROBE_SAMPLES }) {
  let worst = 0
  for (let i = 0; i < samples; i++) {
    const started = now()
    await new Promise((resolve) => setTimer(resolve, 1))
    worst = Math.max(worst, now() - started)
  }
  return worst
}

export function createTickScheduler(options) {
  const { clock, setTimer, clearTimer, logger } = options
  if (typeof clock?.now !== 'function') throw new TypeError('createTickScheduler needs a clock with now()')
  if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') throw new TypeError('createTickScheduler needs setTimer and clearTimer')
  if (typeof logger?.error !== 'function') throw new TypeError('createTickScheduler needs a logger with error()')
  const tickRateOption = options.tickRate ?? 60
  if (!Number.isFinite(tickRateOption) || tickRateOption <= 0) throw new TypeError('createTickScheduler needs a positive tickRate')

  const yieldFn = typeof options.yieldFn === 'function' ? options.yieldFn : null
  const hasYield = yieldFn !== null
  const precise = options.precise === true
  const tickErrorTag = options.tickErrorTag ?? '[tick]'
  const onTickMeasured = options.onTickMeasured ?? (() => {})

  let tickRate = tickRateOption
  let tickDuration = 1000 / tickRate
  const computeDt = options.computeDt ?? (() => tickDuration / 1000)

  let state = 'stopped'
  let currentTick = 0
  let lastTickTime = 0
  let nextDueMs = 0
  let timer = null
  let spinArmed = false
  let tickInProgress = false
  let reloadResolve = null
  let granularityMs = null
  let granularityProbe = null
  const callbacks = []
  let dropCallbacks = []
  const stats = { ticks: 0, droppedMs: 0, maxLateMs: 0, spinWakeups: 0, timerWakeups: 0 }

  const planNext = () => planWake({ remaining: nextDueMs - clock.now(), precise, hasYield, tickDuration, granularityMs })
  const tolerance = () => earlyToleranceMs({ precise, hasYield, tickDuration, granularityMs })

  const runOneTick = () => {
    const dt = computeDt()
    tickInProgress = true
    currentTick++
    lastTickTime = clock.now()
    stats.ticks++
    const started = lastTickTime
    for (const callback of callbacks) {
      try {
        callback(currentTick, dt)
      } catch (error) {
        logger.error(tickErrorTag, error?.stack || error?.message || error)
      }
    }
    onTickMeasured(clock.now() - started)
    tickInProgress = false
    if (reloadResolve) {
      reloadResolve()
      reloadResolve = null
    }
  }

  const runDueTicks = () => {
    let now = clock.now()
    const drop = catchUpDrop({ now, nextDueMs, tickDuration })
    if (drop > 0) {
      stats.droppedMs += drop
      nextDueMs += drop
      const detail = Object.freeze({
        droppedMs: drop,
        droppedTicks: drop / tickDuration,
        totalDroppedMs: stats.droppedMs,
        maxCatchUpSteps: MAX_CATCH_UP_STEPS,
        reasonCode: REASON_CATCH_UP,
        currentTick,
      })
      for (const callback of dropCallbacks) {
        try {
          callback(detail)
        } catch (error) {
          logger.error('[tick] drop listener failed:', error?.message || error)
        }
      }
    }
    let steps = 0
    const early = tolerance()
    while (now >= nextDueMs - early && steps < MAX_CATCH_UP_STEPS && state === 'running') {
      const late = now - nextDueMs
      if (late > stats.maxLateMs) stats.maxLateMs = late
      nextDueMs += tickDuration
      runOneTick()
      steps++
      now = clock.now()
    }
  }

  const onWake = () => {
    if (state === 'stopped') return
    if (state === 'running') runDueTicks()
    schedule()
  }

  const schedule = () => {
    if (state !== 'running') return
    if (timer !== null || spinArmed) return
    const plan = planNext()
    if (plan.kind === 'spin') {
      spinArmed = true
      yieldFn(() => {
        spinArmed = false
        stats.spinWakeups++
        onWake()
      })
      return
    }
    timer = setTimer(() => {
      timer = null
      stats.timerWakeups++
      onWake()
    }, plan.waitMs)
    timer?.unref?.()
  }

  const start = () => {
    if (state === 'running') return
    state = 'running'
    lastTickTime = clock.now()
    nextDueMs = lastTickTime + tickDuration
    schedule()
  }

  const stop = () => {
    state = 'stopped'
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  const pauseForReload = () => {
    state = 'paused'
    if (!tickInProgress) return Promise.resolve()
    return new Promise((resolve) => {
      reloadResolve = resolve
    })
  }

  const resumeAfterReload = () => {
    state = 'running'
    lastTickTime = clock.now()
    nextDueMs = lastTickTime + tickDuration
    schedule()
  }

  const setTickRate = (rate) => {
    if (!Number.isFinite(rate) || rate <= 0) return
    const now = clock.now()
    const phase = state === 'running' ? (nextDueMs - now) / tickDuration : 1
    tickRate = rate
    tickDuration = 1000 / rate
    if (state === 'running') nextDueMs = now + Math.max(0, phase) * tickDuration
  }

  const calibrate = () => {
    if (granularityMs !== null) return Promise.resolve(granularityMs)
    if (granularityProbe === null) {
      granularityProbe = probeTimerGranularity({ now: () => clock.now(), setTimer }).then((worst) => {
        granularityMs = worst
        return worst
      })
    }
    return granularityProbe
  }

  const onTick = (callback) => {
    if (callbacks.includes(callback)) return
    callbacks.push(callback)
  }

  const onTickDrop = (callback) => {
    if (typeof callback !== 'function') {
      const error = new TypeError('[tick] onTickDrop needs a function')
      error.reasonCode = REASON_DROP_LISTENER
      throw error
    }
    dropCallbacks.push(callback)
    return () => {
      dropCallbacks = dropCallbacks.filter((listener) => listener !== callback)
    }
  }

  const getSchedulerStats = () => Object.freeze({
    ...stats,
    droppedTicks: stats.droppedMs / tickDuration,
    maxCatchUpSteps: MAX_CATCH_UP_STEPS,
    reasonCode: stats.droppedMs > 0 ? REASON_CATCH_UP : null,
  })

  const snapshot = () => ({
    running: state === 'running',
    state,
    tickRate,
    tickDuration,
    currentTick,
    lastTickTime,
    nextDueMs,
    granularityMs,
  })

  return {
    start,
    stop,
    pauseForReload,
    resumeAfterReload,
    setTickRate,
    calibrate,
    onTick,
    onTickDrop,
    getSchedulerStats,
    snapshot,
    getTick: () => currentTick,
  }
}
