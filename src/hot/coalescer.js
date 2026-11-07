import { updateKey } from './updateKey.js'

export const createCoalescer = ({ apply, keyOf = updateKey, coalesced = true }) => {
  const pending = new Map()
  let queue = Promise.resolve()
  let draining = false
  let enabled = Boolean(coalesced)

  const drainPending = async () => {
    while (pending.size) {
      const batch = [...pending.values()]
      pending.clear()
      for (const ev of batch) await apply(ev)
    }
    draining = false
  }

  const enqueue = (ev) => {
    if (!enabled) {
      queue = queue.then(() => apply(ev))
      return queue
    }
    pending.set(keyOf(ev), ev)
    if (draining) return queue
    draining = true
    queue = queue.then(drainPending)
    return queue
  }

  return {
    enqueue,
    settled: () => queue,
    pendingCount: () => pending.size,
    isCoalesced: () => enabled,
    setCoalesced: (on) => {
      enabled = Boolean(on)
      return enabled
    },
  }
}
