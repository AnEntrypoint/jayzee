export const MAX_CATCH_UP_MS = 250

const requireFunction = (value, message) => {
  if (typeof value !== 'function') throw new TypeError(message)
}

const validPeriod = (period) => {
  if (!Number.isFinite(period) || period <= 0) {
    throw new RangeError(`createInputStepper: getPeriodMs must return a positive finite number, got ${period}`)
  }
  return period
}

export function createInputStepper(options) {
  const { now, setTimer, clearTimer, getPeriodMs, onStep, onError } = options
  requireFunction(now, 'createInputStepper needs a clock with now()')
  requireFunction(setTimer, 'createInputStepper needs setTimer(fn, ms)')
  requireFunction(clearTimer, 'createInputStepper needs clearTimer(handle)')
  requireFunction(getPeriodMs, 'createInputStepper needs getPeriodMs()')
  requireFunction(onStep, 'createInputStepper needs onStep(stepAt, periodMs)')
  requireFunction(onError, 'createInputStepper needs onError(error), which receives a throw from onStep')

  let nextDue = null
  let timer = null
  let running = false

  const cancelTimer = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  const armTimer = () => {
    const delayMs = Math.max(0, nextDue - now())
    timer = setTimer(() => {
      timer = null
      loop()
    }, delayMs)
  }

  function loop() {
    cancelTimer()
    if (!running) return
    let period
    try {
      period = validPeriod(getPeriodMs())
    } catch (error) {
      running = false
      throw error
    }
    const maxSteps = Math.max(1, Math.ceil(MAX_CATCH_UP_MS / period))
    let at = now()
    if (nextDue === null) nextDue = at
    if (at - nextDue > MAX_CATCH_UP_MS) nextDue = at - MAX_CATCH_UP_MS
    let steps = 0
    while (running && at >= nextDue && steps < maxSteps) {
      try {
        onStep(nextDue, period)
      } catch (error) {
        onError(error)
      }
      nextDue += period
      steps++
      at = now()
    }
    if (running) armTimer()
  }

  return {
    start() {
      if (running) return
      running = true
      nextDue = null
      loop()
    },
    stop() {
      running = false
      cancelTimer()
    },
    pump() {
      if (running && nextDue !== null && now() >= nextDue) loop()
    },
    get running() {
      return running
    },
  }
}
