export const SAMPLE_CAP = 240

export function isDynamicShadowCaster(object) {
  let current = object
  while (current) {
    if (current.userData && current.userData.isDynamicShadowCaster !== undefined) return !!current.userData.isDynamicShadowCaster
    current = current.parent
  }
  return false
}

export function classifyShadowCasters(objects) {
  const staticObjs = []
  const dynamicObjs = []
  for (const o of objects) {
    if (!o.isMesh && !o.isInstancedMesh) continue
    if (!o.castShadow) continue
    if (isDynamicShadowCaster(o)) dynamicObjs.push(o)
    else staticObjs.push(o)
  }
  return { staticObjs, dynamicObjs }
}

export function summarizePassSamples(samples) {
  const n = samples.length
  if (n === 0) return { avg: null, p95: null, max: null }
  const sorted = samples.slice().sort((a, b) => a - b)
  return {
    avg: +(sorted.reduce((a, b) => a + b, 0) / n).toFixed(3),
    p95: +sorted[Math.min(n - 1, Math.floor(0.95 * n))].toFixed(3),
    max: +sorted[n - 1].toFixed(3),
  }
}

export function createPassSampleRing(cap = SAMPLE_CAP) {
  let samples = []
  return {
    push(ms) {
      samples.push(ms)
      if (samples.length > cap) samples.shift()
    },
    list() { return samples.slice() },
    reset() { samples = [] },
  }
}

export function splitShares(staticMs, dynamicMs, combinedMs) {
  return {
    staticShareOfCombined: combinedMs > 0 ? +((staticMs / combinedMs) * 100).toFixed(1) : null,
    dynamicShareOfCombined: combinedMs > 0 ? +((dynamicMs / combinedMs) * 100).toFixed(1) : null,
  }
}

export function buildSplitResult({ staticOnly, dynamicOnly, combined, staticObjs, dynamicObjs, cascadeCount, ts }) {
  return {
    staticMs: +staticOnly.ms.toFixed(3),
    dynamicMs: +dynamicOnly.ms.toFixed(3),
    combinedMs: +combined.ms.toFixed(3),
    staticObjects: staticObjs.length,
    dynamicObjects: dynamicObjs.length,
    ...splitShares(staticOnly.ms, dynamicOnly.ms, combined.ms),
    staticCalls: staticOnly.calls,
    staticTriangles: staticOnly.triangles,
    dynamicCalls: dynamicOnly.calls,
    dynamicTriangles: dynamicOnly.triangles,
    combinedCalls: combined.calls,
    combinedTriangles: combined.triangles,
    cascadeCount,
    ts,
  }
}
