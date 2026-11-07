export const EPS_AREA = 1e-4
export const FAN_EDGE_MAX_CLUSTER_DIAGONALS = 3

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const transformedCorners = new Float64Array(9)

function transformCorner(slot, positions, vertex, matrix) {
  const x = positions[vertex * 3]
  const y = positions[vertex * 3 + 1]
  const z = positions[vertex * 3 + 2]
  transformedCorners[slot] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]
  transformedCorners[slot + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]
  transformedCorners[slot + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
}

export function triangleArea(positions, a, b, c, matrix = IDENTITY_MATRIX) {
  transformCorner(0, positions, a, matrix)
  transformCorner(3, positions, b, matrix)
  transformCorner(6, positions, c, matrix)
  const t = transformedCorners
  const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2]
  const vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2]
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
}

function isDegenerateUnderAll(positions, a, b, c, worldMatrices) {
  if (!worldMatrices.length) return triangleArea(positions, a, b, c) < EPS_AREA
  return worldMatrices.every((matrix) => triangleArea(positions, a, b, c, matrix) < EPS_AREA)
}

function isCollapsed(index, i) {
  return index[i + 1] === index[i] && index[i + 2] === index[i]
}

function collapse(index, i) {
  index[i + 1] = index[i]
  index[i + 2] = index[i]
}

function edgeExceeds(positions, a, b, limitSquared) {
  const dx = positions[a * 3] - positions[b * 3]
  const dy = positions[a * 3 + 1] - positions[b * 3 + 1]
  const dz = positions[a * 3 + 2] - positions[b * 3 + 2]
  return dx * dx + dy * dy + dz * dz > limitSquared
}

export function collapseDegenerateTriangles(index, positions, worldMatrices = []) {
  let collapsed = 0
  for (let i = 0; i + 2 < index.length; i += 3) {
    if (isCollapsed(index, i)) continue
    if (isDegenerateUnderAll(positions, index[i], index[i + 1], index[i + 2], worldMatrices)) {
      collapse(index, i)
      collapsed++
    }
  }
  return collapsed
}

export function dropDegenerateTriangles(index, positions, worldMatrices = []) {
  const kept = []
  let dropped = 0
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2]
    if (isDegenerateUnderAll(positions, a, b, c, worldMatrices)) {
      dropped++
      continue
    }
    kept.push(a, b, c)
  }
  if (!dropped) return { index, dropped }
  return { index: Array.isArray(index) ? kept : new index.constructor(kept), dropped }
}

export function collapseFanTriangles(clusters, positions, streamIndex, streamBase) {
  let collapsed = 0
  for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex++) {
    const [minX, minY, minZ, maxX, maxY, maxZ] = clusters[clusterIndex].aabb
    const reach = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * FAN_EDGE_MAX_CLUSTER_DIAGONALS
    const reachSquared = reach * reach
    for (const lod of clusters[clusterIndex].lods) {
      const index = streamIndex[lod.stream]
      const base = streamBase[lod.stream]
      if (!Number.isFinite(base)) {
        throw new RangeError(`collapseFanTriangles: cluster ${clusterIndex} lod stream=${lod.stream} has no streamBase entry`)
      }
      if (!Number.isFinite(lod.offset) || !Number.isFinite(lod.count)) {
        throw new RangeError(`collapseFanTriangles: cluster ${clusterIndex} lod stream=${lod.stream} has non-finite offset=${lod.offset} or count=${lod.count}`)
      }
      const start = base + lod.offset
      const end = start + lod.count
      if (!index || end > index.length) {
        throw new RangeError(`collapseFanTriangles: cluster ${clusterIndex} lod stream=${lod.stream} range [${start},${end}) outside index stream of length ${index ? index.length : 'none'}`)
      }
      for (let i = start; i + 2 < end; i += 3) {
        if (isCollapsed(index, i)) continue
        const a = index[i], b = index[i + 1], c = index[i + 2]
        if (edgeExceeds(positions, a, b, reachSquared) || edgeExceeds(positions, b, c, reachSquared) || edgeExceeds(positions, a, c, reachSquared)) {
          collapse(index, i)
          collapsed++
        }
      }
    }
  }
  return collapsed
}
