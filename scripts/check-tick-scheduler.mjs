import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  MAX_CATCH_UP_STEPS,
  FINE_TIMER_MS,
  DEFAULT_COARSE_TIMER_MS,
  REASON_CATCH_UP,
  catchUpDrop,
  earlyToleranceMs,
  planWake,
  probeTimerGranularity,
  createTickScheduler,
} from '../src/tick-pure/tickScheduler.js'

const TICK_60 = 1000 / 60

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const near = (actual, expected, label = 'value') => {
  assert(Math.abs(actual - expected) < 1e-6, label + ' is ' + actual + ', expected ' + expected)
}
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}

const recorder = () => {
  const errors = []
  return { errors, error: (...args) => errors.push(args) }
}

const harness = () => {
  let now = 0
  let pending = []
  let nextId = 0
  const clock = { now: () => now }
  const setTimer = (fn, ms) => {
    const handle = { id: nextId++, at: now + ms, fn, cancelled: false, unref() {} }
    pending.push(handle)
    return handle
  }
  const clearTimer = (handle) => {
    handle.cancelled = true
  }
  const earliestDue = (limit) => {
    pending = pending.filter((handle) => !handle.cancelled)
    return pending.filter((handle) => handle.at <= limit).sort((a, b) => a.at - b.at || a.id - b.id)[0] ?? null
  }
  const fireUntil = (limit) => {
    for (let fired = 0; fired < 10000; fired++) {
      const due = earliestDue(limit)
      if (!due) {
        now = Math.max(now, limit)
        return
      }
      pending = pending.filter((handle) => handle !== due)
      now = Math.max(now, due.at)
      due.fn()
    }
    throw new Error('timer loop did not settle')
  }
  return {
    clock,
    setTimer,
    clearTimer,
    fireUntil,
    setNow: (value) => {
      now = value
    },
    pendingCount: () => pending.filter((handle) => !handle.cancelled).length,
  }
}

const build = (h, extra = {}) => {
  const logger = recorder()
  const scheduler = createTickScheduler({ tickRate: 60, clock: h.clock, setTimer: h.setTimer, clearTimer: h.clearTimer, logger, ...extra })
  return { scheduler, logger }
}

let probeClock = 0
let probeStep = 0
const probeScript = [1, 3, 2, 1, 1]
const probeGranularity = await probeTimerGranularity({
  now: () => probeClock,
  setTimer: (fn) => {
    probeClock += probeScript[probeStep++]
    fn()
    return null
  },
})

gate('constants match spoint TickSystemBase', () => {
  same(MAX_CATCH_UP_STEPS, 4, 'MAX_CATCH_UP_STEPS')
  same(FINE_TIMER_MS, 2, 'FINE_TIMER_MS')
  same(DEFAULT_COARSE_TIMER_MS, 16, 'DEFAULT_COARSE_TIMER_MS')
  same(REASON_CATCH_UP, 'tick-catch-up-exceeded', 'reasonCode')
})

gate('early tolerance is half a tick or half the granularity, and zero when precise waiting applies', () => {
  near(earlyToleranceMs({ precise: false, hasYield: true, tickDuration: TICK_60, granularityMs: 16 }), 8, 'coarse 16')
  near(earlyToleranceMs({ precise: false, hasYield: true, tickDuration: TICK_60, granularityMs: 4 }), 2, 'coarse 4')
  near(earlyToleranceMs({ precise: false, hasYield: true, tickDuration: TICK_60, granularityMs: null }), 8, 'unprobed')
  same(earlyToleranceMs({ precise: true, hasYield: true, tickDuration: TICK_60, granularityMs: 16 }), 0, 'precise')
  near(earlyToleranceMs({ precise: true, hasYield: false, tickDuration: TICK_60, granularityMs: 16 }), 8, 'precise without yield')
  near(earlyToleranceMs({ precise: true, hasYield: true, tickDuration: TICK_60, granularityMs: 2 }), 1, 'granularity at the fine limit')
})

gate('wake plan spins only inside the precise window and otherwise waits the early-adjusted remainder', () => {
  const precise = { precise: true, hasYield: true, tickDuration: TICK_60, granularityMs: 16 }
  same(planWake({ ...precise, remaining: 10 }).kind, 'spin', 'inside window')
  const outside = planWake({ ...precise, remaining: 40 })
  same(outside.kind, 'timer', 'outside window kind')
  near(outside.waitMs, 22, 'precise wait')
  const coarse = { precise: false, hasYield: true, tickDuration: TICK_60, granularityMs: 16 }
  near(planWake({ ...coarse, remaining: 40 }).waitMs, 32, 'coarse wait')
  same(planWake({ ...coarse, remaining: 3 }).waitMs, 0, 'coarse wait floor')
  mustReject(() => same(planWake({ ...precise, remaining: 10 }).kind, 'timer', 'inside window'))
})

gate('catch-up drop is the overdue time beyond four ticks and nothing within that cap', () => {
  same(catchUpDrop({ now: 30, nextDueMs: 16, tickDuration: TICK_60 }), 0, 'within cap')
  near(catchUpDrop({ now: 1000, nextDueMs: TICK_60, tickDuration: TICK_60 }), 1000 - TICK_60 - 4 * TICK_60, 'beyond cap')
  mustReject(() => near(catchUpDrop({ now: 1000, nextDueMs: TICK_60, tickDuration: TICK_60 }), 1000 - TICK_60 - 8 * TICK_60, 'eight-tick cap'))
})

gate('timer probe reports the worst of five one-millisecond waits', () => {
  near(probeGranularity, 3, 'worst sample')
  mustReject(() => near(probeGranularity, 1, 'worst sample'))
})

gate('catch-up runs at most four ticks in one wake, drops the rest and records it', () => {
  const h = harness()
  const drops = []
  const { scheduler } = build(h)
  scheduler.onTickDrop((detail) => drops.push(detail))
  scheduler.start()
  h.setNow(1000)
  h.fireUntil(1000)
  const stats = scheduler.getSchedulerStats()
  same(stats.reasonCode, 'tick-catch-up-exceeded', 'reasonCode')
  near(stats.droppedMs, 1000 - TICK_60 - 4 * TICK_60, 'droppedMs')
  near(stats.droppedTicks, 55, 'droppedTicks')
  same(drops.length, 1, 'drop listener calls')
  same(drops[0].reasonCode, 'tick-catch-up-exceeded', 'detail reasonCode')
  same(drops[0].currentTick, 0, 'detail currentTick')
  same(drops[0].maxCatchUpSteps, 4, 'detail maxCatchUpSteps')
  same(scheduler.snapshot().currentTick, 5, 'ticks after catch-up')
  same(stats.timerWakeups, 2, 'wakes for the catch-up')
  mustReject(() => same(stats.timerWakeups, 1, 'wakes for the catch-up'))
})

gate('ticks on time run once per tick duration and never drop', () => {
  const h = harness()
  const { scheduler } = build(h)
  scheduler.start()
  h.fireUntil(1000)
  same(scheduler.snapshot().currentTick, 60, 'ticks in one second')
  same(scheduler.getSchedulerStats().droppedMs, 0, 'droppedMs')
  same(scheduler.getSchedulerStats().reasonCode, null, 'reasonCode')
})

gate('a throwing tick callback is logged and the other callbacks still run', () => {
  const h = harness()
  const { scheduler, logger } = build(h)
  let seen = 0
  scheduler.onTick(() => {
    throw new Error('boom')
  })
  scheduler.onTick(() => {
    seen++
  })
  scheduler.start()
  h.fireUntil(20)
  same(seen, 1, 'second callback runs')
  same(logger.errors.length, 1, 'logged errors')
  same(logger.errors[0][0], '[tick]', 'error tag')
})

gate('an invalid drop listener throws with its reason code', () => {
  const { scheduler } = build(harness())
  let reason = null
  try {
    scheduler.onTickDrop('nope')
  } catch (error) {
    reason = error.reasonCode
  }
  same(reason, 'tick-drop-listener-invalid', 'reasonCode')
})

gate('stop cancels the pending wake and no tick runs afterwards', () => {
  const h = harness()
  const { scheduler } = build(h)
  scheduler.start()
  scheduler.stop()
  same(h.pendingCount(), 0, 'pending wakes')
  h.fireUntil(100)
  same(scheduler.snapshot().currentTick, 0, 'ticks after stop')
  same(scheduler.snapshot().running, false, 'running after stop')
})

gate('pause holds ticks and arms no wake, and resume restarts from the resume time', () => {
  const h = harness()
  const { scheduler } = build(h)
  scheduler.start()
  scheduler.pauseForReload()
  same(scheduler.snapshot().state, 'paused', 'state')
  h.fireUntil(100)
  same(scheduler.snapshot().currentTick, 0, 'ticks while paused')
  same(h.pendingCount(), 0, 'wakes while paused')
  scheduler.resumeAfterReload()
  h.fireUntil(200)
  same(scheduler.snapshot().currentTick, 6, 'ticks after resume')
})

gate('changing the tick rate keeps the phase of the next due tick and ignores invalid rates', () => {
  const h = harness()
  const { scheduler } = build(h)
  scheduler.start()
  scheduler.setTickRate(30)
  near(scheduler.snapshot().tickDuration, 1000 / 30, 'tickDuration')
  near(scheduler.snapshot().nextDueMs, 1000 / 30, 'nextDueMs')
  scheduler.setTickRate(0)
  scheduler.setTickRate(Number.NaN)
  scheduler.setTickRate(-5)
  same(scheduler.snapshot().tickRate, 30, 'tickRate after invalid rates')
})

gate('scheduler stats are frozen and report no reason before any drop', () => {
  const { scheduler } = build(harness())
  const stats = scheduler.getSchedulerStats()
  same(Object.isFrozen(stats), true, 'frozen')
  same(stats.reasonCode, null, 'reasonCode')
  same(stats.droppedTicks, 0, 'droppedTicks')
  same(stats.maxCatchUpSteps, 4, 'maxCatchUpSteps')
})

gate('the scheduler refuses a missing clock, timer or logger instead of reading host globals', () => {
  const h = harness()
  mustReject(() => createTickScheduler({ clock: null, setTimer: h.setTimer, clearTimer: h.clearTimer, logger: recorder() }))
  mustReject(() => createTickScheduler({ clock: h.clock, setTimer: null, clearTimer: h.clearTimer, logger: recorder() }))
  mustReject(() => createTickScheduler({ clock: h.clock, setTimer: h.setTimer, clearTimer: h.clearTimer, logger: {} }))
  mustReject(() => createTickScheduler({ clock: h.clock, setTimer: h.setTimer, clearTimer: h.clearTimer, logger: recorder(), tickRate: 0 }))
})

finish()
