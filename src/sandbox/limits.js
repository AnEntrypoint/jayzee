export const SPAWN_MEMORY_CAP_BYTES = 32 * 1024 * 1024
export const SPAWN_KILL_AFTER_MS = 5000

export class LimitError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LimitError'
    this.code = code
  }
}

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

export const createScriptLimits = ({
  maxStepsPerTick,
  maxMemoryBytes = SPAWN_MEMORY_CAP_BYTES,
  killAfterMs = SPAWN_KILL_AFTER_MS,
  clock,
  memoryOf,
}) => {
  if (!Number.isInteger(maxStepsPerTick) || maxStepsPerTick < 1) throw new RangeError('maxStepsPerTick must be a positive integer')
  if (!isFiniteNumber(maxMemoryBytes) || maxMemoryBytes < 1) throw new RangeError('maxMemoryBytes must be a positive number')
  if (!isFiniteNumber(killAfterMs) || killAfterMs <= 0) throw new RangeError('killAfterMs must be a positive number of milliseconds')
  if (typeof clock !== 'function') throw new TypeError('clock must be a function returning milliseconds')
  if (typeof memoryOf !== 'function') throw new TypeError('memoryOf must be a function returning bytes')

  let startedAt = null
  let lastNow = null
  let steps = 0

  const now = () => {
    const t = clock()
    if (!isFiniteNumber(t)) throw new TypeError('clock must return a finite number of milliseconds')
    if (lastNow !== null && t < lastNow) throw new LimitError('clock-backwards', 'clock went back: ' + lastNow + ' then ' + t)
    lastNow = t
    return t
  }

  return {
    start() {
      startedAt = now()
      steps = 0
    },
    beginTick() {
      steps = 0
    },
    charge(count = 1) {
      if (!Number.isInteger(count) || count < 0) throw new RangeError('charge takes a non-negative integer')
      steps += count
      if (steps > maxStepsPerTick) throw new LimitError('step-budget', 'step budget exceeded: ' + steps + ' > ' + maxStepsPerTick + ' in one tick')
    },
    checkMemory() {
      const bytes = memoryOf()
      if (!isFiniteNumber(bytes)) throw new TypeError('memoryOf must return a finite number of bytes')
      if (bytes > maxMemoryBytes) throw new LimitError('memory', 'memory ' + bytes + ' bytes exceeds the cap of ' + maxMemoryBytes)
    },
    checkTime() {
      if (startedAt === null) throw new RangeError('start() must be called before checkTime()')
      const elapsed = now() - startedAt
      if (elapsed > killAfterMs) throw new LimitError('kill', 'script ran ' + elapsed + ' ms, past the ' + killAfterMs + ' ms kill')
      return elapsed
    },
  }
}
