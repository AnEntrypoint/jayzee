export const CASCADE_BLEND_M = 4.0
export const SHADOW_CASTER_ONLY_LAYER = 30
export const MAX_CASCADES = 3
export const CASCADE_SPLIT = 3.2
export const SHADOW_REDRAW_CASTER_HEIGHT_M = 20
export const FAR_CASCADE_LATERAL_STEP_M = 1
export const DEPTH_STEP_DIVISOR = 16
export const FAR_CASCADE_REDRAWS_PER_FRAME = 1
export const FAR_CASCADE_MAX_DEFER_FRAMES = 2
export const DEFAULT_CASCADE_EXTENT_M = 60
const SPLITS_RE = /SPOINT_CASCADE_SPLITS\[3\] = float\[3\]\([^)]*\)/

export function shaderCascadeCount(cascadeCount) {
  if (!Number.isFinite(cascadeCount) || cascadeCount <= 1) return 1
  return Math.max(1, Math.min(MAX_CASCADES, Math.round(cascadeCount)))
}

export function pipelineCascadeCount(requested, castShadow) {
  const requestedCascades = Number.isFinite(requested) ? requested : 1
  if (castShadow === false) return 1
  return Math.max(1, Math.min(MAX_CASCADES, Math.round(requestedCascades)))
}

export function resolveBaseExtent(extent) {
  return Number.isFinite(extent) ? extent : DEFAULT_CASCADE_EXTENT_M
}

export function cascadeExtents(baseExtent, count) {
  const extents = []
  for (let i = 0; i < count; i++) extents.push(baseExtent * Math.pow(CASCADE_SPLIT, i))
  return extents
}

export function resolveFarRedrawBudget(raw = FAR_CASCADE_REDRAWS_PER_FRAME) {
  return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : Infinity
}

export function texelWorldM(extent, mapSizePx) {
  return (2 * extent) / mapSizePx
}

export function casterShadowReachM(offset) {
  const horiz = Math.hypot(offset.x, offset.z)
  const vert = Math.abs(offset.y)
  if (!(vert > 1e-6)) return Infinity
  return SHADOW_REDRAW_CASTER_HEIGHT_M * (horiz / vert)
}

export function cascadeBandReachesCaster(index, dist, reach, extents) {
  const lo = index === 0 ? 0 : extents[index - 1] - CASCADE_BLEND_M - reach
  const hi = extents[index] + CASCADE_BLEND_M + reach
  return dist >= lo && dist <= hi
}

function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z }
function lengthSq3(a) { return a.x * a.x + a.y * a.y + a.z * a.z }

export function angleBetween(a, b) {
  const denominator = Math.sqrt(lengthSq3(a) * lengthSq3(b))
  if (denominator === 0) return Math.PI / 2
  const theta = dot3(a, b) / denominator
  return Math.acos(Math.max(-1, Math.min(1, theta)))
}

export function sunDirectionMoved(currentOffset, requestedOffset, texelWorldAtZero) {
  return !(angleBetween(requestedOffset, currentOffset) <= texelWorldAtZero / SHADOW_REDRAW_CASTER_HEIGHT_M)
}

export function planCascadeUpdates(cascades, farRedrawBudget, updateCascade) {
  let anyMoved = false
  let farIssued = 0
  for (const cascade of cascades) {
    if (cascade.index > 0 && !(cascade.pendingFrames >= FAR_CASCADE_MAX_DEFER_FRAMES) && farIssued >= farRedrawBudget) {
      cascade.pendingFrames++
      continue
    }
    if (!updateCascade(cascade)) {
      cascade.pendingFrames = 0
      continue
    }
    anyMoved = true
    if (cascade.index > 0) farIssued++
    cascade.pendingFrames = 0
  }
  return anyMoved
}

export function splitLiteral(extents) {
  const e = [extents[0] || 0, extents[1] || 0, extents[2] || 0]
  return 'SPOINT_CASCADE_SPLITS[3] = float[3](' + e.map(v => v.toFixed(2)).join(', ') + ')'
}

export function patchCascadeSplits(source, extents) {
  if (!Array.isArray(extents)) return source
  return source.replace(SPLITS_RE, splitLiteral(extents))
}

export function smoothstep(edge0, edge1, x) {
  const t = edge1 === edge0 ? (x >= edge0 ? 1 : 0) : Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function cascadeWeight(idx, camDist, splits, blendM = CASCADE_BLEND_M) {
  const farEdge = splits[Math.min(idx, 2)]
  let w = 1
  if (farEdge > 0) w *= 1 - smoothstep(farEdge - blendM, farEdge, camDist)
  if (idx > 0) {
    const nearEdge = splits[idx - 1]
    w *= smoothstep(nearEdge - blendM, nearEdge, camDist)
  }
  return w
}
