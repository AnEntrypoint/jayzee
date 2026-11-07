export const NO_MESH_TIER = -1
export const BAND_UNSET = -2
export const LEAF_GATE_HYSTERESIS = 0.05
export const SHADOW_NONE = 0
export const SHADOW_ALL = 1
export const SHADOW_MIXED = 2

export function createLodBandPolicy(opts = {}) {
  const levels = opts.levels
  if (!Array.isArray(levels) || levels.length === 0) throw new Error('WebGPULodInstancer: at least one LOD level is required')
  const hysteresis = Number.isFinite(opts.hysteresis) ? opts.hysteresis : 0
  const shadowDistance = opts.shadowDistance
  const shadowEnabled = Number.isFinite(shadowDistance)
  const shadowOnSq = shadowEnabled ? (shadowDistance * (1 - hysteresis)) ** 2 : -1
  const shadowOffSq = shadowEnabled ? (shadowDistance * (1 + hysteresis)) ** 2 : -1
  const thresholdsSq = levels.map(lv => {
    const d = Number.isFinite(lv.distance) ? lv.distance : 0
    const t = d + d * hysteresis
    return t * t
  })
  const leaveSq = levels.map(lv => {
    const d = Number.isFinite(lv.distance) ? lv.distance : 0
    const t = d - d * hysteresis
    return t * t
  })

  let meshReentryDist = NaN
  let meshFarSq = Infinity
  let meshFarDist = Infinity
  let meshInSq = Infinity
  let leafGateSq = Infinity
  let leafGateDist = Infinity
  let leafGateInSq = Infinity

  function lodTierFor(dsq) {
    for (let i = thresholdsSq.length - 1; i > 0; i--) if (dsq >= thresholdsSq[i]) return i
    return 0
  }

  function tierFor(dsq, current) {
    if (dsq >= meshFarSq) return NO_MESH_TIER
    const raw = lodTierFor(dsq)
    if (current === BAND_UNSET) return raw
    if (current === NO_MESH_TIER) return dsq >= meshInSq ? NO_MESH_TIER : raw
    return current > raw && dsq >= leaveSq[current] ? current : raw
  }

  function shadowWantedOf(dsq, current) {
    if (dsq <= shadowOnSq) return true
    return current === true && dsq <= shadowOffSq
  }

  function cellShadowMode(dminSq, dmaxSq) {
    if (!shadowEnabled) return SHADOW_NONE
    if (dmaxSq <= shadowOnSq) return SHADOW_ALL
    return dminSq > shadowOffSq ? SHADOW_NONE : SHADOW_MIXED
  }

  function cellCrossesBand(dminSq, dmaxSq) {
    if (leafGateDist !== Infinity && dmaxSq >= leafGateInSq && dminSq < leafGateSq) return true
    if (dmaxSq >= meshInSq && dminSq < meshFarSq) return true
    for (let i = 1; i < thresholdsSq.length; i++) if (dmaxSq >= leaveSq[i] && dminSq < thresholdsSq[i]) return true
    return false
  }

  function gateAt(dsq, wasGated) {
    if (leafGateDist === Infinity) return false
    if (dsq >= leafGateSq) return true
    return dsq > leafGateInSq ? wasGated === true : false
  }

  function leafGatedTier(tier, dsq, gated) {
    if (gated === true) return NO_MESH_TIER
    if (gated === false || leafGateSq === Infinity) return tier
    return dsq >= leafGateSq ? NO_MESH_TIER : tier
  }

  function setMeshFarEdges(d, reentry) {
    const nominal = d / (1 + hysteresis)
    const hysteresisIn = nominal * (1 - hysteresis)
    const inDist = Number.isFinite(reentry) ? Math.max(hysteresisIn, reentry) : hysteresisIn
    meshFarSq = d * d
    meshFarDist = d
    meshReentryDist = reentry
    meshInSq = inDist * inDist
  }

  function setLeafDrawDistance(m) {
    const on = Number.isFinite(m) && m > 0
    leafGateDist = on ? m : Infinity
    leafGateSq = on ? m * m : Infinity
    leafGateInSq = on ? (m * (1 - LEAF_GATE_HYSTERESIS)) ** 2 : Infinity
  }

  return {
    lodTierFor,
    tierFor,
    shadowWantedOf,
    cellShadowMode,
    cellCrossesBand,
    gateAt,
    leafGatedTier,
    meshOutOfRange: dsq => dsq >= meshFarSq,
    setMeshFarEdges,
    setLeafDrawDistance,
    meshFarDist: () => meshFarDist,
    meshReentryDist: () => meshReentryDist,
    leafDrawDistance: () => leafGateDist,
  }
}
