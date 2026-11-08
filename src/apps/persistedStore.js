const DEFAULT_PERSIST_DEBOUNCE_MS = 500

export function createPersistedStore(storage, key, initial, { debounceMs = DEFAULT_PERSIST_DEBOUNCE_MS, timers, log } = {}) {
  if (!timers || typeof timers.schedule !== 'function' || typeof timers.cancel !== 'function') {
    throw new TypeError('persistedStore: timers must provide schedule and cancel')
  }
  if (typeof log !== 'function') throw new TypeError('persistedStore: log must be a function')
  let value = initial
  let timer = null
  const write = async () => {
    try { await storage?.set(key, value) } catch (e) { log(`[persisted] ${key} write error: ${e.message}`) }
  }
  const ready = (async () => {
    try {
      const saved = await storage?.get(key)
      if (saved !== undefined && saved !== null && typeof saved === typeof initial) value = saved
    } catch (e) { log(`[persisted] ${key} load error: ${e.message}`) }
  })()
  return {
    ready,
    get value() { return value },
    set value(v) { value = v },
    save() {
      if (timer !== null) timers.cancel(timer)
      timer = timers.schedule(() => { timer = null; write() }, debounceMs)
    },
    async flush() {
      if (timer !== null) { timers.cancel(timer); timer = null }
      await ready
      await write()
    }
  }
}
