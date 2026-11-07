import { createCounter, createHistogram, SNAP_BYTES_BUCKETS, TICK_MS_BUCKETS } from './histogram.js'
import { createGcAggregator } from './gc.js'
import { renderMetrics } from './render.js'

export function createTelemetryRegistry({ gcKindNames = {} } = {}) {
  const snapshotBytesHist = createHistogram('spoint_snapshot_bytes', 'Encoded+packed snapshot payload size in bytes, per SnapshotEncoder.js packSnapshot() call (every outgoing snapshot, all send branches)', SNAP_BYTES_BUCKETS)
  const snapshotBytesTotal = createCounter('spoint_snapshot_bytes_total', 'Cumulative bytes sent across all packed snapshot payloads')
  const gc = createGcAggregator(gcKindNames)
  const tickPhaseHistograms = new Map()
  const tickPhaseByName = Object.create(null)

  const recordSnapshotBytes = (byteLength) => {
    snapshotBytesHist.observe(byteLength)
    snapshotBytesTotal.inc(byteLength)
  }

  const recordTickPhase = (phase, ms) => {
    let hist = tickPhaseByName[phase]
    if (hist === undefined) {
      hist = createHistogram('spoint_tick_phase_ms', 'Per-tick phase duration in milliseconds', TICK_MS_BUCKETS)
      tickPhaseHistograms.set(phase, hist)
      tickPhaseByName[phase] = hist
    }
    hist.observe(ms)
  }

  const renderTickPhases = () => {
    if (tickPhaseHistograms.size === 0) return []
    const lines = ['# HELP spoint_tick_phase_ms Per-tick phase duration in milliseconds, full distribution by phase label', '# TYPE spoint_tick_phase_ms histogram']
    for (const [phase, hist] of tickPhaseHistograms) lines.push(hist.renderBody({ phase }))
    return lines
  }

  const renderCollected = () => [snapshotBytesHist.render(), snapshotBytesTotal.render(), gc.render(), ...renderTickPhases()]

  const registry = {
    recordSnapshotBytes,
    recordTickPhase,
    gc,
    renderCollected,
    render: (sources = {}) => renderMetrics(sources, registry),
  }
  return registry
}
