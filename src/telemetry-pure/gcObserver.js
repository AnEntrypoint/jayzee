export const GC_ENTRY_TYPE = 'gc'

export function installGcObserver({ PerformanceObserver, aggregator }) {
  if (typeof PerformanceObserver !== 'function') {
    return { installed: false, reason: 'performance-observer-unavailable', disconnect: () => {} }
  }
  let observer = null
  try {
    observer = new PerformanceObserver((list) => aggregator.observe(list.getEntries()))
    observer.observe({ entryTypes: [GC_ENTRY_TYPE], buffered: false })
  } catch (error) {
    return { installed: false, reason: error?.message || String(error), disconnect: () => {} }
  }
  return {
    installed: true,
    reason: null,
    disconnect: () => {
      try {
        observer.disconnect()
      } catch (_) {}
    },
  }
}
