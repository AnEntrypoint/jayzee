export const CLUSTER_SELECT_DEFAULTS = Object.freeze({
  lodBase: 8,
  hysteresis: 0.1,
})

const PLANE_WORDS = 24
const MIN_RADIUS = 1e-6

export class ClusterSelectError extends Error {
  constructor(code, message) {
    super(code + ': ' + message)
    this.name = 'ClusterSelectError'
    this.code = code
  }
}

const refuse = (code, message) => {
  throw new ClusterSelectError(code, message)
}

export function createClusterLodSelector(record, options = {}) {
  if (!record || !Array.isArray(record.clusters) || record.clusters.length === 0) refuse('cluster-select-record', 'the selector needs a parsed EP_cluster_lod record with at least one cluster')
  const lodBase = options.lodBase ?? CLUSTER_SELECT_DEFAULTS.lodBase
  const hysteresis = options.hysteresis ?? CLUSTER_SELECT_DEFAULTS.hysteresis
  if (!Number.isFinite(lodBase) || lodBase <= 0) refuse('cluster-select-option', 'lodBase must be a finite number greater than 0, got ' + String(lodBase))
  if (!Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis >= 0.5) refuse('cluster-select-option', 'hysteresis must be at least 0 and below 0.5, got ' + String(hysteresis))

  const clusterCount = record.clusters.length
  let maxLods = 0
  for (const cluster of record.clusters) if (cluster.lods.length > maxLods) maxLods = cluster.lods.length
  const spheres = new Float64Array(clusterCount * 4)
  const lodCounts = new Uint8Array(clusterCount)
  const lodOffset = new Int32Array(clusterCount * maxLods)
  const lodCount = new Int32Array(clusterCount * maxLods)
  const lodStream = new Uint8Array(clusterCount * maxLods)
  record.clusters.forEach((cluster, c) => {
    spheres[c * 4] = cluster.sphere[0]; spheres[c * 4 + 1] = cluster.sphere[1]; spheres[c * 4 + 2] = cluster.sphere[2]; spheres[c * 4 + 3] = cluster.sphere[3]
    lodCounts[c] = cluster.lods.length
    cluster.lods.forEach((lod, l) => {
      lodOffset[c * maxLods + l] = lod.offset
      lodCount[c * maxLods + l] = lod.count
      lodStream[c * maxLods + l] = lod.stream || 0
    })
  })

  const offsets = new Int32Array(clusterCount)
  const counts = new Int32Array(clusterCount)
  const streams = new Uint8Array(clusterCount)
  const levelOf = new Int8Array(clusterCount).fill(-1)
  const stats = { selections: 0, repeats: 0, visible: 0, culled: 0, indices: 0, draws: 0 }
  let lastFrame = -1
  let draws = 0

  function select({ frame, eye, planes = null }) {
    if (!Number.isInteger(frame) || frame < 0) refuse('cluster-select-frame', 'frame must be an integer of at least 0, got ' + String(frame))
    if (frame === lastFrame) {
      stats.repeats++
      return draws
    }
    if (!eye || !Number.isFinite(eye[0]) || !Number.isFinite(eye[1]) || !Number.isFinite(eye[2])) refuse('cluster-select-eye', 'eye must hold three finite numbers')
    if (planes !== null && planes.length !== PLANE_WORDS) refuse('cluster-select-planes', 'planes must be null or 24 numbers: six planes of nx, ny, nz, d')
    lastFrame = frame
    draws = 0
    let visible = 0, culled = 0, indices = 0
    for (let c = 0; c < clusterCount; c++) {
      const cx = spheres[c * 4], cy = spheres[c * 4 + 1], cz = spheres[c * 4 + 2], radius = spheres[c * 4 + 3]
      let inside = true
      if (planes !== null) {
        for (let p = 0; p < PLANE_WORDS; p += 4) {
          if (planes[p] * cx + planes[p + 1] * cy + planes[p + 2] * cz + planes[p + 3] < -radius) { inside = false; break }
        }
      }
      if (!inside) {
        culled++
        levelOf[c] = -1
        continue
      }
      visible++
      const gap = Math.hypot(eye[0] - cx, eye[1] - cy, eye[2] - cz) - radius
      const measure = gap <= 0 ? -Infinity : Math.log2(gap / (lodBase * Math.max(radius, MIN_RADIUS)))
      const top = lodCounts[c] - 1
      const previous = levelOf[c]
      let level
      if (previous >= 0 && measure >= previous - hysteresis && measure < previous + 1 + hysteresis) level = previous
      else level = measure < 0 ? 0 : Math.floor(measure)
      if (level > top) level = top
      levelOf[c] = level
      const count = lodCount[c * maxLods + level]
      if (count === 0) continue
      const offset = lodOffset[c * maxLods + level]
      const stream = lodStream[c * maxLods + level]
      indices += count
      if (draws > 0 && streams[draws - 1] === stream && offsets[draws - 1] + counts[draws - 1] === offset) {
        counts[draws - 1] += count
        continue
      }
      offsets[draws] = offset
      counts[draws] = count
      streams[draws] = stream
      draws++
    }
    stats.selections++
    stats.visible = visible
    stats.culled = culled
    stats.indices = indices
    stats.draws = draws
    return draws
  }

  return {
    clusterCount,
    maxLods,
    offsets,
    counts,
    streams,
    levelOf,
    select,
    get lastFrame() { return lastFrame },
    getStats() { return { ...stats } },
  }
}
