import { createHistogram, TICK_MS_BUCKETS } from './histogram.js'

export function createGcAggregator(kindNames = {}) {
  const durationHist = createHistogram('spoint_gc_pause_ms', 'Node GC pause duration in milliseconds, from perf_hooks PerformanceObserver(\'gc\') entries', TICK_MS_BUCKETS)
  const countByKind = new Map()

  const observe = (entries) => {
    for (const entry of entries) {
      durationHist.observe(entry.duration)
      const kindLabel = kindNames[entry.kind] || `unknown_${entry.kind}`
      countByKind.set(kindLabel, (countByKind.get(kindLabel) || 0) + 1)
    }
  }

  const render = () => {
    const lines = [durationHist.render()]
    lines.push('# HELP spoint_gc_events_total Count of Node GC events observed, by kind', '# TYPE spoint_gc_events_total counter')
    if (countByKind.size === 0) {
      lines.push('spoint_gc_events_total{kind="none"} 0')
    } else {
      for (const [kind, n] of countByKind) lines.push(`spoint_gc_events_total{kind="${kind}"} ${n}`)
    }
    return lines.join('\n')
  }

  return { durationHist, countByKind, observe, render }
}
