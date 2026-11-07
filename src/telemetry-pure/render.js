import { escapeLabelValue } from './histogram.js'

export function renderMetrics(sources = {}, collectors) {
  const lines = []
  const pushGauge = (name, help, value) => lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`)

  if (sources.tick != null) pushGauge('spoint_tick', 'Current server tick number', sources.tick)
  if (sources.tickRate != null) pushGauge('spoint_tick_rate_hz', 'Configured simulation tick rate in Hz', sources.tickRate)
  if (sources.players != null) pushGauge('spoint_players', 'Currently connected player count', sources.players)
  if (sources.entities != null) pushGauge('spoint_entities', 'Live AppRuntime entity count (appRuntime.entities.size)', sources.entities)
  if (sources.sessionCount != null) pushGauge('spoint_sessions', 'Active session count', sources.sessionCount)
  if (sources.uptimeSec != null) pushGauge('spoint_uptime_seconds', 'Process uptime in seconds', sources.uptimeSec)

  if (typeof sources.memoryUsage === 'function') {
    const mem = sources.memoryUsage()
    pushGauge('spoint_process_heap_used_bytes', 'process.memoryUsage().heapUsed', mem.heapUsed)
    pushGauge('spoint_process_heap_total_bytes', 'process.memoryUsage().heapTotal', mem.heapTotal)
    pushGauge('spoint_process_rss_bytes', 'process.memoryUsage().rss', mem.rss)
    pushGauge('spoint_process_external_bytes', 'process.memoryUsage().external', mem.external)
    pushGauge('spoint_process_arraybuffers_bytes', 'process.memoryUsage().arrayBuffers', mem.arrayBuffers || 0)
  }

  if (sources.tickTiming) {
    const t = sources.tickTiming
    lines.push('# HELP spoint_tick_phase_avg_ms Average per-tick phase duration in milliseconds, over the current profiling window', '# TYPE spoint_tick_phase_avg_ms gauge')
    lines.push(`spoint_tick_phase_avg_ms{phase="total"} ${t.avgTotalMs.toFixed(4)}`)
    lines.push(`spoint_tick_phase_avg_ms{phase="mv"} ${t.avgMvMs.toFixed(4)}`)
    lines.push(`spoint_tick_phase_avg_ms{phase="phys"} ${t.avgPhysMs.toFixed(4)}`)
    lines.push(`spoint_tick_phase_avg_ms{phase="snap"} ${t.avgSnapMs.toFixed(4)}`)
    pushGauge('spoint_tick_phase_sample_count', 'Number of ticks accumulated into the current spoint_tick_phase_avg_ms window', t.sampleCount)
  }

  lines.push(...collectors.renderCollected())

  if (Array.isArray(sources.rooms)) {
    const roomLabels = (room) => `room_id="${escapeLabelValue(room.roomId)}",world="${escapeLabelValue(room.worldName)}"`
    lines.push('# HELP spoint_room_tick Per-room current tick number (RoomDirectory.getStatus())', '# TYPE spoint_room_tick gauge')
    for (const room of sources.rooms) lines.push(`spoint_room_tick{${roomLabels(room)}} ${room.tick}`)
    lines.push('# HELP spoint_room_players Per-room connected player count', '# TYPE spoint_room_players gauge')
    for (const room of sources.rooms) lines.push(`spoint_room_players{${roomLabels(room)}} ${room.players}`)
    lines.push('# HELP spoint_room_entities Per-room live entity count', '# TYPE spoint_room_entities gauge')
    for (const room of sources.rooms) lines.push(`spoint_room_entities{${roomLabels(room)}} ${room.entities}`)
    lines.push('# HELP spoint_room_uptime_seconds Per-room uptime in seconds since boot', '# TYPE spoint_room_uptime_seconds gauge')
    for (const room of sources.rooms) lines.push(`spoint_room_uptime_seconds{${roomLabels(room)}} ${(room.uptimeMs / 1000).toFixed(3)}`)
  }

  return lines.join('\n') + '\n'
}
