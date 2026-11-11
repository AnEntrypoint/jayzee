const MIB = 1024 * 1024

export const RECLAIM_DEFAULTS = Object.freeze({ nudgeBytes: 32 * MIB, mostNudges: 64, settleTurns: 8, turnMs: 5 })

export const watchCollected = (targets, options = {}) => {
  const nudgeBytes = options.nudgeBytes ?? RECLAIM_DEFAULTS.nudgeBytes
  const mostNudges = options.mostNudges ?? RECLAIM_DEFAULTS.mostNudges
  const settleTurns = options.settleTurns ?? RECLAIM_DEFAULTS.settleTurns
  const turnMs = options.turnMs ?? RECLAIM_DEFAULTS.turnMs
  const yieldToLoop = options.yieldToLoop ?? (() => new Promise((done) => setTimeout(done, turnMs)))
  const makeBuffer = options.makeBuffer ?? ((bytes) => new ArrayBuffer(bytes))
  const now = options.now ?? (() => performance.now())
  if (!Number.isInteger(mostNudges) || mostNudges < 0) throw new RangeError('mostNudges must be a whole number of zero or more')
  if (!Number.isInteger(nudgeBytes) || nudgeBytes < 1) throw new RangeError('nudgeBytes must be a whole number of at least 1')
  let pending = 0
  const registry = new FinalizationRegistry(() => {
    pending -= 1
  })
  for (const target of targets) {
    if (target === null || typeof target !== 'object') continue
    registry.register(target, 0)
    pending += 1
  }
  const watched = pending
  const waiting = () => registry !== null && pending > 0
  return async () => {
    const started = now()
    let nudges = 0
    while (waiting() && nudges < mostNudges) {
      makeBuffer(nudgeBytes)
      nudges += 1
      await yieldToLoop()
    }
    const collected = !waiting()
    if (collected) {
      for (let turn = 0; turn < settleTurns; turn++) await yieldToLoop()
    }
    return { collected, watched, nudges, ms: now() - started }
  }
}
