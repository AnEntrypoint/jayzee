const RING_SIZE = 240
const SESSION_SAMPLE_CAP = 10000
const REFRESH_MEDIAN_WINDOW = 120
const SIXTY_HZ_INTERVAL_MS = 16.6667
const MAX_PLAUSIBLE_PRESENT_GAP_MS = 250
const MISS_THRESHOLD = 1.5
const JS_SHORT_FACTOR = 0.85
const MAX_RECENT_MISSES = 20

export function createPerfTracker(opts = {}) {
  const heapUsedBytes = typeof opts.heapUsedBytes === 'function' ? opts.heapUsedBytes : null
  const ring = new Float32Array(RING_SIZE)
  const sortBuf = new Float32Array(RING_SIZE)
  let idx = 0, count = 0, lastMs = 0, drawCalls = 0, tris = 0, players = 0, entities = 0
  const sessionSamples = []
  const heapRing = heapUsedBytes ? new Float32Array(RING_SIZE) : null
  let heapIdx = 0, heapCount = 0, lastHeap = heapUsedBytes ? heapUsedBytes() : 0

  return {
    get lastMs() { return lastMs },
    sample(ms, renderInfo, np, ne) {
      lastMs = ms
      ring[idx] = ms
      idx = (idx + 1) % RING_SIZE
      if (count < RING_SIZE) count++
      drawCalls = renderInfo.drawCalls !== undefined ? renderInfo.drawCalls : renderInfo.calls
      tris = renderInfo.triangles
      players = np
      entities = ne
      if (sessionSamples.length < SESSION_SAMPLE_CAP) sessionSamples.push(ms)
      if (heapUsedBytes) {
        const cur = heapUsedBytes()
        const delta = cur - lastHeap
        lastHeap = cur
        heapRing[heapIdx] = delta > 0 ? delta : 0
        heapIdx = (heapIdx + 1) % RING_SIZE
        if (heapCount < RING_SIZE) heapCount++
      }
    },
    stats() {
      if (count === 0) return { count: 0 }
      for (let i = 0; i < count; i++) sortBuf[i] = ring[i]
      const a = sortBuf.subarray(0, count)
      a.sort()
      let sum = 0
      for (let i = 0; i < count; i++) sum += a[i]
      const pct = p => a[Math.min(count - 1, Math.floor(p * count))]
      const avg = sum / count
      const out = {
        count,
        avgMs: +avg.toFixed(3),
        fps: +(1000 / avg).toFixed(1),
        p50Ms: +pct(0.5).toFixed(3),
        p95Ms: +pct(0.95).toFixed(3),
        p99Ms: +pct(0.99).toFixed(3),
        maxMs: +a[count - 1].toFixed(3),
        drawCalls,
        triangles: tris,
        players,
        entities,
      }
      if (heapUsedBytes && heapCount > 0) {
        let hsum = 0, hmax = 0
        for (let i = 0; i < heapCount; i++) {
          const v = heapRing[i]
          hsum += v
          if (v > hmax) hmax = v
        }
        const avgBytesPerFrame = hsum / heapCount
        out.gc = {
          avgBytesPerFrame: Math.round(avgBytesPerFrame),
          maxBytesPerFrame: Math.round(hmax),
          avgBytesPerSec: Math.round(avgBytesPerFrame * (1000 / avg)),
        }
      }
      return out
    },
    exportSession() {
      if (sessionSamples.length === 0) return null
      const s = new Float64Array(sessionSamples)
      s.sort()
      const sum = s.reduce((a, b) => a + b, 0)
      const pct = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]
      return {
        duration: +(sum / 1000).toFixed(1),
        samples: s.length,
        avgMs: +(sum / s.length).toFixed(3),
        fps: +(1000 / (sum / s.length)).toFixed(1),
        minMs: +s[0].toFixed(3),
        p50Ms: +pct(0.5).toFixed(3),
        p95Ms: +pct(0.95).toFixed(3),
        p99Ms: +pct(0.99).toFixed(3),
        maxMs: +s[s.length - 1].toFixed(3),
      }
    },
    reset() {
      idx = 0
      count = 0
      sessionSamples.length = 0
      heapIdx = 0
      heapCount = 0
      if (heapUsedBytes) lastHeap = heapUsedBytes()
    },
  }
}

export function createVsyncMonitor() {
  const deltas = new Float32Array(REFRESH_MEDIAN_WINDOW)
  const sortBuf = new Float32Array(REFRESH_MEDIAN_WINDOW)
  const recentMisses = []
  let sortView = sortBuf.subarray(0, 0)
  let idx = 0, filled = 0
  let lastTs = -1
  let inferredIntervalMs = SIXTY_HZ_INTERVAL_MS
  let missStreak = 0, maxMissStreak = 0
  let missCount = 0, frameCount = 0
  let lastExpectedMs = 0, lastDeltaMs = 0, lastIsMiss = false, lastIsCompositorStall = false, lastMissedFrames = 0
  const ticked = { isMiss: false, isCompositorStall: false, deltaMs: 0, expectedMs: 0, missedFrames: 0 }

  function median() {
    if (filled === 0) return inferredIntervalMs
    for (let i = 0; i < filled; i++) sortBuf[i] = deltas[i]
    if (sortView.length !== filled) sortView = sortBuf.subarray(0, filled)
    sortView.sort()
    return sortView[Math.floor(filled / 2)]
  }

  function tick(ts, jsMs) {
    frameCount++
    if (lastTs < 0) {
      lastTs = ts
      ticked.isMiss = false
      ticked.isCompositorStall = false
      ticked.deltaMs = 0
      ticked.expectedMs = inferredIntervalMs
      ticked.missedFrames = 0
      return ticked
    }
    const deltaMs = ts - lastTs
    lastTs = ts
    if (deltaMs > 0 && deltaMs < MAX_PLAUSIBLE_PRESENT_GAP_MS) {
      deltas[idx] = deltaMs
      idx = (idx + 1) % REFRESH_MEDIAN_WINDOW
      if (filled < REFRESH_MEDIAN_WINDOW) filled++
      inferredIntervalMs = median()
    }
    const expectedMs = inferredIntervalMs
    const isMiss = deltaMs > expectedMs * MISS_THRESHOLD
    const missedFrames = isMiss ? Math.max(1, Math.round(deltaMs / expectedMs) - 1) : 0
    const jsWasShort = typeof jsMs === 'number' && jsMs < expectedMs * JS_SHORT_FACTOR
    const isCompositorStall = isMiss && jsWasShort
    if (isMiss) {
      missCount++
      missStreak++
      if (missStreak > maxMissStreak) maxMissStreak = missStreak
      recentMisses.push({ frame: frameCount, deltaMs: +deltaMs.toFixed(2), expectedMs: +expectedMs.toFixed(2), jsMs: typeof jsMs === 'number' ? +jsMs.toFixed(2) : null, compositorStall: isCompositorStall, missedFrames })
      if (recentMisses.length > MAX_RECENT_MISSES) recentMisses.shift()
    } else {
      missStreak = 0
    }
    lastExpectedMs = expectedMs
    lastDeltaMs = deltaMs
    lastIsMiss = isMiss
    lastIsCompositorStall = isCompositorStall
    lastMissedFrames = missedFrames
    ticked.isMiss = isMiss
    ticked.isCompositorStall = isCompositorStall
    ticked.deltaMs = deltaMs
    ticked.expectedMs = expectedMs
    ticked.missedFrames = missedFrames
    return ticked
  }

  function state() {
    return {
      refreshIntervalMs: lastExpectedMs,
      refreshHz: lastExpectedMs > 0 ? 1000 / lastExpectedMs : 0,
      lastDeltaMs,
      isMiss: lastIsMiss,
      isCompositorStall: lastIsCompositorStall,
      missedFrames: lastMissedFrames,
      missCount,
      missStreak,
      maxMissStreak,
      frameCount,
      missRate: frameCount > 0 ? missCount / frameCount : 0,
      recent: recentMisses.slice(),
    }
  }

  function reset() {
    idx = 0
    filled = 0
    lastTs = -1
    missStreak = 0
    maxMissStreak = 0
    missCount = 0
    frameCount = 0
    recentMisses.length = 0
  }

  return { tick, reset, state }
}
