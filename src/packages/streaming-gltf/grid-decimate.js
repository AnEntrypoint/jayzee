export const GRID_RESOLUTIONS_FINEST_FIRST = Object.freeze([48, 24, 12, 8, 6, 4, 2])
const COMPONENT_GETTERS = ['getX', 'getY', 'getZ', 'getW']

function sequentialIndex(count) {
  const sequence = new Uint32Array(count)
  for (let i = 0; i < count; i++) sequence[i] = i
  return sequence
}

function boundsOf(position) {
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
    if (x < bounds[0]) bounds[0] = x
    if (x > bounds[3]) bounds[3] = x
    if (y < bounds[1]) bounds[1] = y
    if (y > bounds[4]) bounds[4] = y
    if (z < bounds[2]) bounds[2] = z
    if (z > bounds[5]) bounds[5] = z
  }
  return bounds
}

function clusterVertices(position, bounds, resolution) {
  const spanX = (bounds[3] - bounds[0]) || 1
  const spanY = (bounds[4] - bounds[1]) || 1
  const spanZ = (bounds[5] - bounds[2]) || 1
  const cellOfVertex = new Int32Array(position.count)
  const cellIds = new Map()
  for (let i = 0; i < position.count; i++) {
    const gx = Math.min(resolution - 1, ((position.getX(i) - bounds[0]) / spanX * resolution) | 0)
    const gy = Math.min(resolution - 1, ((position.getY(i) - bounds[1]) / spanY * resolution) | 0)
    const gz = Math.min(resolution - 1, ((position.getZ(i) - bounds[2]) / spanZ * resolution) | 0)
    const key = (gx * resolution + gy) * resolution + gz
    let cell = cellIds.get(key)
    if (cell === undefined) {
      cell = cellIds.size
      cellIds.set(key, cell)
    }
    cellOfVertex[i] = cell
  }
  return { cellOfVertex, cellCount: cellIds.size }
}

function uniqueCellTriangles(index, cellOfVertex, cellCount) {
  const triangles = []
  const seen = new Set()
  for (let t = 0; t + 2 < index.length; t += 3) {
    let a = cellOfVertex[index[t]], b = cellOfVertex[index[t + 1]], c = cellOfVertex[index[t + 2]]
    if (a === b || b === c || a === c) continue
    if (b < a && b < c) {
      const first = a
      a = b
      b = c
      c = first
    } else if (c < a && c < b) {
      const last = c
      c = b
      b = a
      a = last
    }
    const key = (a * cellCount + b) * cellCount + c
    if (seen.has(key)) continue
    seen.add(key)
    triangles.push(a, b, c)
  }
  return triangles
}

function representativeAttributes(attributes, cellOfVertex, cellCount) {
  const representativeOfCell = new Int32Array(cellCount).fill(-1)
  for (let i = 0; i < cellOfVertex.length; i++) {
    if (representativeOfCell[cellOfVertex[i]] === -1) representativeOfCell[cellOfVertex[i]] = i
  }
  const rebuilt = {}
  for (const name of Object.keys(attributes)) {
    const attribute = attributes[name]
    const itemSize = attribute.itemSize
    const array = new Float32Array(cellCount * itemSize)
    for (let cell = 0; cell < cellCount; cell++) {
      const source = representativeOfCell[cell]
      for (let k = 0; k < itemSize; k++) array[cell * itemSize + k] = attribute[COMPONENT_GETTERS[k]](source)
    }
    rebuilt[name] = { array, itemSize }
  }
  return rebuilt
}

export function gridDecimate(attributes, index, triCap) {
  const position = attributes.position
  if (!position || position.count === 0) return null
  const triangleIndex = index || sequentialIndex(position.count)
  if (triangleIndex.length / 3 <= triCap) return null
  const bounds = boundsOf(position)
  const last = GRID_RESOLUTIONS_FINEST_FIRST.length - 1
  for (let r = 0; r <= last; r++) {
    const resolution = GRID_RESOLUTIONS_FINEST_FIRST[r]
    const { cellOfVertex, cellCount } = clusterVertices(position, bounds, resolution)
    const triangles = uniqueCellTriangles(triangleIndex, cellOfVertex, cellCount)
    if (triangles.length / 3 > triCap && r < last) continue
    if (triangles.length === 0) return null
    return {
      resolution,
      attributes: representativeAttributes(attributes, cellOfVertex, cellCount),
      index: cellCount > 65535 ? new Uint32Array(triangles) : new Uint16Array(triangles),
    }
  }
  return null
}

export function applyGridDecimate(geometry, triCap, BufferAttribute) {
  const decimated = gridDecimate(geometry.attributes, geometry.index ? geometry.index.array : null, triCap)
  if (!decimated) return null
  for (const name of Object.keys(decimated.attributes)) {
    const { array, itemSize } = decimated.attributes[name]
    geometry.setAttribute(name, new BufferAttribute(array, itemSize, false))
  }
  geometry.setIndex(new BufferAttribute(decimated.index, 1))
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return decimated.resolution
}
