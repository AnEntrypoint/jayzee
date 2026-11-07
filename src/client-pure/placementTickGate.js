export const PLACEMENT_INTERVAL_MS = 250
export const MIN_TICK_GAP_MS = 40
const MIN_DT_S = 0.001
const MAX_DT_S = 1.0

export function createPlacementTickGate() {
  let lastTickAtMs = -Infinity
  let lastRealMs = null

  function shouldTick(nowMs) {
    if (nowMs - lastTickAtMs < MIN_TICK_GAP_MS) return false
    lastTickAtMs = nowMs
    return true
  }

  function takeDeltaSeconds(nowMs) {
    const dt = lastRealMs == null ? 0 : Math.min(Math.max((nowMs - lastRealMs) / 1000, MIN_DT_S), MAX_DT_S)
    lastRealMs = nowMs
    return dt
  }

  return { shouldTick, takeDeltaSeconds }
}
