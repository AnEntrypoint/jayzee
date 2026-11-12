export const TIMERS_FULL = 'timers-full'
const TICK_EPSILON = 1e-9
const NO_OWNER = -1

export const secondsToTicks = (seconds, tickDt) => Math.max(1, Math.ceil(seconds / tickDt - TICK_EPSILON))

export function createTimeApi({ tickDt, capacity = 256 } = {}) {
  if (!(typeof tickDt === 'number' && tickDt > 0 && Number.isFinite(tickDt))) throw new RangeError('tickDt must be a positive finite number')
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive whole number of timers')
  const due = new Float64Array(capacity)
  const period = new Float64Array(capacity)
  const sequence = new Float64Array(capacity)
  const owner = new Float64Array(capacity).fill(NO_OWNER)
  const generation = new Uint32Array(capacity)
  const alive = new Uint8Array(capacity)
  const callbacks = new Array(capacity).fill(null)
  const payloads = new Array(capacity).fill(null)
  let tick = 0
  let nextSequence = 0
  let liveCount = 0
  let fired = 0

  const schedule = (seconds, fn, repeat, ownerId, payload) => {
    if (!(typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0)) throw new RangeError('seconds must be a finite number at or above zero')
    if (typeof fn !== 'function') throw new TypeError('a timer needs a function to call')
    let slot = -1
    for (let i = 0; i < capacity; i++) {
      if (alive[i] === 0) {
        slot = i
        break
      }
    }
    if (slot < 0) {
      const error = new RangeError('all ' + capacity + ' timers are in use')
      error.code = TIMERS_FULL
      throw error
    }
    const ticks = secondsToTicks(seconds, tickDt)
    alive[slot] = 1
    due[slot] = tick + ticks
    period[slot] = repeat ? ticks : 0
    sequence[slot] = nextSequence
    owner[slot] = ownerId
    callbacks[slot] = fn
    payloads[slot] = payload
    nextSequence += 1
    liveCount += 1
    return slot + generation[slot] * capacity
  }

  const release = (slot) => {
    alive[slot] = 0
    callbacks[slot] = null
    payloads[slot] = null
    owner[slot] = NO_OWNER
    generation[slot] += 1
    liveCount -= 1
  }

  const cancel = (id) => {
    if (!Number.isInteger(id) || id < 0) return false
    const slot = id % capacity
    if (alive[slot] === 0 || generation[slot] !== Math.floor(id / capacity)) return false
    release(slot)
    return true
  }

  const cancelOwner = (ownerId) => {
    let cancelled = 0
    for (let slot = 0; slot < capacity; slot++) {
      if (alive[slot] === 1 && owner[slot] === ownerId) {
        release(slot)
        cancelled += 1
      }
    }
    return cancelled
  }

  const setTick = (toTick) => {
    if (!Number.isInteger(toTick) || toTick < tick) throw new RangeError('tick ' + toTick + ' is behind the clock at ' + tick)
    tick = toTick
  }

  const advance = (toTick, onError = null) => {
    setTick(toTick)
    let ran = 0
    for (;;) {
      let pick = -1
      for (let slot = 0; slot < capacity; slot++) {
        if (alive[slot] === 0 || due[slot] > tick) continue
        if (pick < 0 || due[slot] < due[pick] || (due[slot] === due[pick] && sequence[slot] < sequence[pick])) pick = slot
      }
      if (pick < 0) break
      const fn = callbacks[pick]
      const payload = payloads[pick]
      const ownerId = owner[pick]
      if (period[pick] > 0) {
        due[pick] += period[pick]
        sequence[pick] = nextSequence
        nextSequence += 1
      } else {
        release(pick)
      }
      ran += 1
      fired += 1
      try {
        fn(payload)
      } catch (error) {
        if (onError === null) throw error
        onError(ownerId, error)
      }
    }
    return ran
  }

  const view = (ownerId = NO_OWNER) => ({
    get tick() { return tick },
    get deltaTime() { return tickDt },
    get elapsed() { return tick * tickDt },
    after: (seconds, fn, payload = null) => schedule(seconds, fn, false, ownerId, payload),
    every: (seconds, fn, payload = null) => schedule(seconds, fn, true, ownerId, payload),
    cancel,
  })

  return {
    view,
    setTick,
    advance,
    cancel,
    cancelOwner,
    after: (seconds, fn, payload = null) => schedule(seconds, fn, false, NO_OWNER, payload),
    every: (seconds, fn, payload = null) => schedule(seconds, fn, true, NO_OWNER, payload),
    get tick() { return tick },
    get deltaTime() { return tickDt },
    get elapsed() { return tick * tickDt },
    get pending() { return liveCount },
    get fired() { return fired },
    capacity,
  }
}
