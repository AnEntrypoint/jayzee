export function createCorrectionObserver({ connected, localPlayerId }) {
  if (typeof connected !== 'function') throw new Error('createCorrectionObserver: connected() required')
  const stats = { count: 0, sumM: 0, maxM: 0, remoteSumM: 0, remoteMaxM: 0 }
  return {
    before() {
      return new Map(connected().map((player) => [player.id, [...player.position]]))
    },
    after(before) {
      for (const player of connected()) {
        const start = before.get(player.id)
        if (!start) continue
        const d = Math.hypot(player.position[0] - start[0], player.position[1] - start[1], player.position[2] - start[2])
        stats.count++
        stats.sumM += d
        if (d > stats.maxM) stats.maxM = d
        if (player.id !== localPlayerId) {
          stats.remoteSumM += d
          if (d > stats.remoteMaxM) stats.remoteMaxM = d
        }
      }
    },
    snapshot() {
      return { ...stats }
    },
  }
}
