import { collapseDegenerateTriangles } from './degenerate-triangles.js'

const IDENTITY_ELEMENTS = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const IDENTITY_MATRIX = Object.freeze({ elements: IDENTITY_ELEMENTS })

const elementsOf = (matrix) => (Array.isArray(matrix) || ArrayBuffer.isView(matrix) ? matrix : matrix.elements)

function isIdentity(elements) {
  for (let i = 0; i < 16; i++) if (elements[i] !== IDENTITY_ELEMENTS[i]) return false
  return true
}

export function normalMatrixOf(elements) {
  const n11 = elements[0], n21 = elements[1], n31 = elements[2]
  const n12 = elements[4], n22 = elements[5], n32 = elements[6]
  const n13 = elements[8], n23 = elements[9], n33 = elements[10]
  const t11 = n33 * n22 - n32 * n23
  const t12 = n32 * n13 - n33 * n12
  const t13 = n23 * n12 - n22 * n13
  const det = n11 * t11 + n21 * t12 + n31 * t13
  if (det === 0) return [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const detInv = 1 / det
  return [
    t11 * detInv, t12 * detInv, t13 * detInv,
    (n31 * n23 - n33 * n21) * detInv, (n33 * n11 - n31 * n13) * detInv, (n21 * n13 - n23 * n11) * detInv,
    (n32 * n21 - n31 * n22) * detInv, (n31 * n12 - n32 * n11) * detInv, (n22 * n11 - n21 * n12) * detInv,
  ]
}

function normalized(x, y, z) {
  const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1)
  return [x * scale, y * scale, z * scale]
}

function transformPoint(e, x, y, z) {
  const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15])
  return [
    (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
    (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
    (e[2] * x + e[6] * y + e[10] * z + e[14]) * w,
  ]
}

function flattenAttribute(attribute) {
  const { count, itemSize } = attribute
  if (!attribute.isInterleavedBufferAttribute && attribute.array instanceof Float32Array) {
    return Float32Array.from(attribute.array)
  }
  const out = new Float32Array(count * itemSize)
  for (let i = 0; i < count; i++) {
    if (itemSize >= 1) out[i * itemSize + 0] = attribute.getX(i)
    if (itemSize >= 2) out[i * itemSize + 1] = attribute.getY(i)
    if (itemSize >= 3) out[i * itemSize + 2] = attribute.getZ(i)
    if (itemSize >= 4) out[i * itemSize + 3] = attribute.getW(i)
  }
  return out
}

function bakeVectors(source, itemSize, out, transform) {
  const count = source.length / itemSize
  for (let i = 0; i < count; i++) {
    const o = i * itemSize
    const [x, y, z] = transform(source[o], source[o + 1], source[o + 2])
    out[o] = x
    out[o + 1] = y
    out[o + 2] = z
    for (let c = 3; c < itemSize; c++) out[o + c] = source[o + c]
  }
}

export function bakeAttribute(name, source, itemSize, matrix, normalMatrix) {
  const e = elementsOf(matrix)
  const out = new Float32Array(source.length)
  if (name === 'position') {
    bakeVectors(source, itemSize, out, (x, y, z) => transformPoint(e, x, y, z))
  } else if (name === 'normal') {
    const n = normalMatrix
    bakeVectors(source, itemSize, out, (x, y, z) => normalized(n[0] * x + n[3] * y + n[6] * z, n[1] * x + n[4] * y + n[7] * z, n[2] * x + n[5] * y + n[8] * z))
  } else if (name === 'tangent') {
    bakeVectors(source, itemSize, out, (x, y, z) => normalized(...normalized(e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z)))
  } else {
    out.set(source)
  }
  return out
}

export function transformAabb(aabb, matrix) {
  const [minX, minY, minZ, maxX, maxY, maxZ] = aabb
  if (maxX < minX || maxY < minY || maxZ < minZ) return [minX, minY, minZ, maxX, maxY, maxZ]
  const e = elementsOf(matrix)
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (const x of [minX, maxX]) {
    for (const y of [minY, maxY]) {
      for (const z of [minZ, maxZ]) {
        const point = transformPoint(e, x, y, z)
        for (let k = 0; k < 3; k++) {
          box[k] = Math.min(box[k], point[k])
          box[k + 3] = Math.max(box[k + 3], point[k])
        }
      }
    }
  }
  return box
}

export function transformSphere(sphere, matrix, scale) {
  const [x, y, z] = transformPoint(elementsOf(matrix), sphere[0], sphere[1], sphere[2])
  return [x, y, z, sphere[3] * scale]
}

function maxScaleOf(e) {
  const sq0 = e[0] * e[0] + e[1] * e[1] + e[2] * e[2]
  const sq1 = e[4] * e[4] + e[5] * e[5] + e[6] * e[6]
  const sq2 = e[8] * e[8] + e[9] * e[9] + e[10] * e[10]
  return Math.sqrt(Math.max(sq0, sq1, sq2))
}

export function boundsOfPositions(positions, itemSize = 3) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const count = Math.floor(positions.length / itemSize)
  for (let v = 0; v < count; v++) {
    const i = v * itemSize
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k])
      max[k] = Math.max(max[k], positions[i + k])
    }
  }
  const center = [(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5]
  let maxRadiusSq = 0
  for (let v = 0; v < count; v++) {
    const i = v * itemSize
    const dx = center[0] - positions[i], dy = center[1] - positions[i + 1], dz = center[2] - positions[i + 2]
    maxRadiusSq = Math.max(maxRadiusSq, dx * dx + dy * dy + dz * dz)
  }
  return { boundingBox: { min, max }, boundingSphere: { center, radius: Math.sqrt(maxRadiusSq) } }
}

function sharedAttributeNames(entries) {
  let names = null
  for (const entry of entries) {
    const own = Object.keys(entry.geometry.attributes)
    names = names === null ? new Set(own) : new Set(own.filter((name) => names.has(name)))
  }
  return names
}

function streamCounts(clusterSet) {
  let lod0 = 0, coarse = 0
  for (const cluster of clusterSet.clusters) {
    for (const lod of cluster.lods) {
      if (lod.stream === 1) coarse += lod.count
      else lod0 += lod.count
    }
  }
  return { lod0, coarse }
}

function needsUint32(totalVerts, perSource) {
  if (totalVerts > 65535) return true
  for (const source of perSource) {
    const array = source.indexArray
    for (let i = 0; i < array.length; i++) if (array[i] > 65535) return true
  }
  return false
}

export function mergeGroup(entries, options = {}) {
  const material = entries[0].material
  const attributeNames = sharedAttributeNames(entries)
  if (!attributeNames || !attributeNames.has('position')) return null

  let totalVerts = 0
  let lod0TotalIndices = 0, coarseTotalIndices = 0
  const perSource = []
  for (const entry of entries) {
    const vertexCount = entry.geometry.attributes.position.count
    const matrix = elementsOf(entry.matrix)
    const identity = isIdentity(matrix)
    const normalMatrix = identity ? null : normalMatrixOf(matrix)
    const scale = identity ? 1 : maxScaleOf(matrix)
    const baked = {}
    for (const name of attributeNames) {
      const attribute = entry.geometry.attributes[name]
      const flat = flattenAttribute(attribute)
      baked[name] = identity ? flat : bakeAttribute(name, flat, attribute.itemSize, matrix, normalMatrix)
    }
    const indexAttribute = entry.geometry.index
    if (!indexAttribute) return null
    perSource.push({ entry, baked, vertexOffset: totalVerts, indexArray: indexAttribute.array, identity, matrix, scale })
    totalVerts += vertexCount
    const counts = streamCounts(entry.clusterSet)
    lod0TotalIndices += counts.lod0
    coarseTotalIndices += counts.coarse
  }

  if (totalVerts === 0) return null

  const IndexArray = needsUint32(totalVerts, perSource) ? Uint32Array : Uint16Array
  const attributes = {}
  for (const name of attributeNames) {
    const itemSize = entries[0].geometry.attributes[name].itemSize
    const array = new Float32Array(totalVerts * itemSize)
    for (const source of perSource) array.set(source.baked[name], source.vertexOffset * itemSize)
    attributes[name] = { array, itemSize }
  }

  const index = new IndexArray(lod0TotalIndices + coarseTotalIndices)
  const clusters = []
  let lod0Write = 0, coarseWrite = lod0TotalIndices
  for (const source of perSource) {
    const { entry, vertexOffset, indexArray } = source
    for (const cluster of entry.clusterSet.clusters) {
      const lods = []
      for (const lod of cluster.lods) {
        const coarse = lod.stream === 1
        const sourceBase = coarse ? entry.lod0Count : 0
        const writeStart = coarse ? coarseWrite : lod0Write
        for (let i = 0; i < lod.count; i++) index[writeStart + i] = indexArray[sourceBase + lod.offset + i] + vertexOffset
        lods.push({ offset: writeStart - (coarse ? lod0TotalIndices : 0), count: lod.count, stream: lod.stream })
        if (coarse) coarseWrite += lod.count
        else lod0Write += lod.count
      }
      const aabb = source.identity ? cluster.aabb : transformAabb(cluster.aabb, source.matrix)
      const sphere = source.identity ? cluster.sphere : transformSphere(cluster.sphere, source.matrix, source.scale)
      clusters.push({ aabb, sphere, lods })
    }
  }

  const degenerate = collapseDegenerateTriangles(index, attributes.position.array)
  if (degenerate && options.warn) options.warn(`[cluster-material-merge] collapsed ${degenerate} degenerate (zero-area) triangle(s) after merging ${entries.length} source(s)`)

  return {
    geometry: { attributes, index, ...boundsOfPositions(attributes.position.array, attributes.position.itemSize) },
    material,
    clusterSet: { clusters, materialBucket: entries[0].clusterSet.materialBucket || null },
    lod0Count: lod0TotalIndices,
    materialBucket: entries[0].materialBucket || null,
    degenerateCollapsed: degenerate,
    _mergedSourceCount: entries.length,
    _sourceIndices: entries.map((entry) => entry._origIndex).sort((a, b) => a - b),
  }
}

export function mergeClusterMeshesByMaterial(clusterMeshes, nodeMatrices, options = {}) {
  if (!clusterMeshes || !clusterMeshes.length) return clusterMeshes || []

  const byMaterial = new Map()
  for (let i = 0; i < clusterMeshes.length; i++) {
    const material = clusterMeshes[i].material
    let list = byMaterial.get(material)
    if (!list) {
      list = []
      byMaterial.set(material, list)
    }
    list.push(i)
  }

  const out = []
  const consumed = new Set()
  for (const [, indices] of byMaterial) {
    if (indices.length < 2) continue
    const entries = indices.map((i) => ({
      ...clusterMeshes[i],
      matrix: (nodeMatrices && nodeMatrices[i]) || IDENTITY_MATRIX,
      _origIndex: i,
    }))
    const merged = mergeGroup(entries, options)
    if (merged) {
      out.push(merged)
      for (const i of indices) consumed.add(i)
    }
  }

  for (let i = 0; i < clusterMeshes.length; i++) {
    if (!consumed.has(i)) out.push({ ...clusterMeshes[i], _sourceIndices: [i] })
  }

  out.sort((a, b) => a._sourceIndices[0] - b._sourceIndices[0])
  return out
}
