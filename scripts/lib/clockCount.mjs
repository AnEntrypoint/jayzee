import { getEnvironmentData, isMainThread, setEnvironmentData } from 'node:worker_threads'

export const CLOCK_COUNT_KEY = 'jayzee-clock-count'
export const CLOCK_WINDOW_OPEN = 0
export const CLOCK_CALLS_IN_WINDOW = 1
export const CLOCK_CALLS_TOTAL = 2
export const CLOCK_MAIN_CALLS_IN_WINDOW = 3
export const CLOCK_WORKER_HOOKS = 4
export const CLOCK_MAIN_HOOKS = 5
const CLOCK_SLOTS = 6

const held = () => {
  if (!isMainThread) return getEnvironmentData(CLOCK_COUNT_KEY)
  const existing = getEnvironmentData(CLOCK_COUNT_KEY)
  if (existing) return existing
  const made = new Int32Array(new SharedArrayBuffer(CLOCK_SLOTS * Int32Array.BYTES_PER_ELEMENT))
  setEnvironmentData(CLOCK_COUNT_KEY, made)
  return made
}

const counters = held()

if (counters && !performance.now.clockCounted) {
  const original = performance.now.bind(performance)
  const counted = () => {
    Atomics.add(counters, CLOCK_CALLS_TOTAL, 1)
    if (Atomics.load(counters, CLOCK_WINDOW_OPEN) === 1) {
      Atomics.add(counters, CLOCK_CALLS_IN_WINDOW, 1)
      if (isMainThread) Atomics.add(counters, CLOCK_MAIN_CALLS_IN_WINDOW, 1)
    }
    return original()
  }
  counted.clockCounted = true
  performance.now = counted
  Atomics.add(counters, isMainThread ? CLOCK_MAIN_HOOKS : CLOCK_WORKER_HOOKS, 1)
}

export const clockCounters = () => counters
