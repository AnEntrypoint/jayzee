const BYTES_PER_MB = 1048576

const fixed2 = (value) => (value || 0).toFixed(2)
const megabytes = (bytes) => (bytes / BYTES_PER_MB).toFixed(1)

export const averageText = (sum, count) => (count > 0 ? (sum / count).toFixed(2) : '0')

export function createProfileLogGate(interval) {
  let logs = 0
  return (enabled) => {
    if (!enabled) return false
    logs++
    return logs % interval === 0
  }
}

export function formatTickProfileLine({ tick, players, idle, physSkip, entities, dynIds, activeDyn, phases, sums, count, memory }) {
  const avg = (key) => averageText(sums[key], count)
  return `[tick-profile] tick:${tick} players:${players} idle:${idle} physSkip:${physSkip} entities:${entities} dynIds:${dynIds} activeDyn:${activeDyn} total:${fixed2(phases.total)}ms(avg:${avg('total')}) | mv:${fixed2(phases.mv)}(avg:${avg('mv')}) col:${fixed2(phases.col)} phys:${fixed2(phases.phys)}(avg:${avg('phys')}) app:${fixed2(phases.app)} sync:${fixed2(phases.sync)} respawn:${fixed2(phases.respawn)} spatial:${fixed2(phases.spatial)} col2:${fixed2(phases.col2)} int:${fixed2(phases.int)} snap:${fixed2(phases.snap)}(avg:${avg('snap')}) | heap:${megabytes(memory.heapUsed)}MB rss:${megabytes(memory.rss)}MB ext:${megabytes(memory.external)}MB ab:${megabytes(memory.arrayBuffers)}MB`
}
