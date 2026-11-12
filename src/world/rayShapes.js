const EPSILON = 1e-12
const STACK_DEPTH = 64
const LEAF_SIZE = 4

export const rayTriangle = (origin, direction, positions, a, b, c, maxDistance, backFaces = true) => {
  const ax = positions[a]
  const ay = positions[a + 1]
  const az = positions[a + 2]
  const e1x = positions[b] - ax
  const e1y = positions[b + 1] - ay
  const e1z = positions[b + 2] - az
  const e2x = positions[c] - ax
  const e2y = positions[c + 1] - ay
  const e2z = positions[c + 2] - az
  const px = direction[1] * e2z - direction[2] * e2y
  const py = direction[2] * e2x - direction[0] * e2z
  const pz = direction[0] * e2y - direction[1] * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (backFaces ? Math.abs(det) < EPSILON : det < EPSILON) return -1
  const inv = 1 / det
  const tx = origin[0] - ax
  const ty = origin[1] - ay
  const tz = origin[2] - az
  const u = (tx * px + ty * py + tz * pz) * inv
  if (u < 0 || u > 1) return -1
  const qx = ty * e1z - tz * e1y
  const qy = tz * e1x - tx * e1z
  const qz = tx * e1y - ty * e1x
  const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) * inv
  if (v < 0 || u + v > 1) return -1
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv
  if (t < 0 || t > maxDistance) return -1
  return t
}

export const rayCapsule = (origin, direction, a, b, radius, maxDistance) => {
  const bax = b[0] - a[0]
  const bay = b[1] - a[1]
  const baz = b[2] - a[2]
  const oax = origin[0] - a[0]
  const oay = origin[1] - a[1]
  const oaz = origin[2] - a[2]
  const baba = bax * bax + bay * bay + baz * baz
  const bard = bax * direction[0] + bay * direction[1] + baz * direction[2]
  const baoa = bax * oax + bay * oay + baz * oaz
  const rdoa = direction[0] * oax + direction[1] * oay + direction[2] * oaz
  const oaoa = oax * oax + oay * oay + oaz * oaz
  const clamped = baba > 0 ? Math.min(Math.max(baoa / baba, 0), 1) : 0
  const sx = oax - bax * clamped
  const sy = oay - bay * clamped
  const sz = oaz - baz * clamped
  if (sx * sx + sy * sy + sz * sz <= radius * radius) return { distance: 0, normal: [0, 0, 0] }
  let t = -1
  let axisPoint = 0
  if (baba > 0) {
    const qa = baba - bard * bard
    const qb = baba * rdoa - baoa * bard
    const qc = baba * oaoa - baoa * baoa - radius * radius * baba
    const h = qb * qb - qa * qc
    if (qa > EPSILON && h >= 0) {
      const tBody = (-qb - Math.sqrt(h)) / qa
      const y = baoa + tBody * bard
      if (y > 0 && y < baba && tBody >= 0) {
        t = tBody
        axisPoint = y / baba
      }
    }
  }
  if (t < 0) {
    for (let end = 0; end < 2; end++) {
      const cx = end === 0 ? oax : oax - bax
      const cy = end === 0 ? oay : oay - bay
      const cz = end === 0 ? oaz : oaz - baz
      const hb = direction[0] * cx + direction[1] * cy + direction[2] * cz
      const hc = cx * cx + cy * cy + cz * cz - radius * radius
      const hh = hb * hb - hc
      if (hh < 0) continue
      const tCap = -hb - Math.sqrt(hh)
      if (tCap < 0) continue
      if (t < 0 || tCap < t) {
        t = tCap
        axisPoint = end
      }
    }
  }
  if (t < 0 || t > maxDistance) return null
  const nx = (oax + direction[0] * t - bax * axisPoint) / radius
  const ny = (oay + direction[1] * t - bay * axisPoint) / radius
  const nz = (oaz + direction[2] * t - baz * axisPoint) / radius
  return { distance: t, normal: [nx, ny, nz] }
}

const isIndexArray = (value) => value instanceof Uint16Array || value instanceof Uint32Array || value instanceof Uint8Array

export const createTriangleMesh = ({ positions, indices }) => {
  if (!(positions instanceof Float32Array || positions instanceof Float64Array) || positions.length % 3 !== 0) throw new TypeError('positions must be a Float32Array or Float64Array of xyz triples')
  if (!isIndexArray(indices) || indices.length % 3 !== 0 || indices.length === 0) throw new TypeError('indices must be a non-empty unsigned typed array of triangle triples')
  const vertexCount = positions.length / 3
  for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i])) throw new RangeError('position ' + i + ' is not finite')
  for (let i = 0; i < indices.length; i++) if (indices[i] >= vertexCount) throw new RangeError('index ' + i + ' names vertex ' + indices[i] + ' of ' + vertexCount)
  const triangleCount = indices.length / 3
  const order = new Uint32Array(triangleCount)
  const centroid = new Float64Array(triangleCount * 3)
  const triMin = new Float64Array(triangleCount * 3)
  const triMax = new Float64Array(triangleCount * 3)
  for (let t = 0; t < triangleCount; t++) {
    order[t] = t
    for (let k = 0; k < 3; k++) {
      const p = positions[indices[t * 3] * 3 + k]
      const q = positions[indices[t * 3 + 1] * 3 + k]
      const r = positions[indices[t * 3 + 2] * 3 + k]
      triMin[t * 3 + k] = Math.min(p, q, r)
      triMax[t * 3 + k] = Math.max(p, q, r)
      centroid[t * 3 + k] = (p + q + r) / 3
    }
  }
  const maxNodes = Math.max(1, 2 * triangleCount)
  const bounds = new Float64Array(maxNodes * 6)
  const first = new Uint32Array(maxNodes)
  const size = new Uint32Array(maxNodes)
  const left = new Uint32Array(maxNodes)
  let nodeCount = 0
  let depthSeen = 0

  const build = (start, end, depth) => {
    const node = nodeCount++
    if (depth > depthSeen) depthSeen = depth
    const o = node * 6
    for (let k = 0; k < 3; k++) {
      bounds[o + k] = Infinity
      bounds[o + 3 + k] = -Infinity
    }
    for (let i = start; i < end; i++) {
      const t = order[i]
      for (let k = 0; k < 3; k++) {
        if (triMin[t * 3 + k] < bounds[o + k]) bounds[o + k] = triMin[t * 3 + k]
        if (triMax[t * 3 + k] > bounds[o + 3 + k]) bounds[o + 3 + k] = triMax[t * 3 + k]
      }
    }
    const span = end - start
    if (span <= LEAF_SIZE || depth >= STACK_DEPTH - 2) {
      first[node] = start
      size[node] = span
      return node
    }
    let axis = 0
    let widest = -1
    for (let k = 0; k < 3; k++) {
      const extent = bounds[o + 3 + k] - bounds[o + k]
      if (extent > widest) {
        widest = extent
        axis = k
      }
    }
    const slice = order.subarray(start, end)
    slice.sort((p, q) => centroid[p * 3 + axis] - centroid[q * 3 + axis] || p - q)
    const mid = start + (span >> 1)
    size[node] = 0
    left[node] = build(start, mid, depth + 1)
    first[node] = build(mid, end, depth + 1)
    return node
  }
  build(0, triangleCount, 0)

  const stack = new Int32Array(STACK_DEPTH)
  const hit = { distance: 0, triangle: -1, normal: [0, 0, 0] }
  let visited = 0

  const slab = (origin, direction, node, limit) => {
    const o = node * 6
    let near = 0
    let far = limit
    for (let k = 0; k < 3; k++) {
      const d = direction[k]
      if (d === 0) {
        if (origin[k] < bounds[o + k] || origin[k] > bounds[o + 3 + k]) return false
        continue
      }
      let t1 = (bounds[o + k] - origin[k]) / d
      let t2 = (bounds[o + 3 + k] - origin[k]) / d
      if (t1 > t2) {
        const swap = t1
        t1 = t2
        t2 = swap
      }
      if (t1 > near) near = t1
      if (t2 < far) far = t2
      if (near > far) return false
    }
    return true
  }

  const raycast = (origin, direction, maxDistance = Infinity, backFaces = true) => {
    let best = maxDistance
    let bestTriangle = -1
    let top = 0
    stack[top++] = 0
    visited = 0
    while (top > 0) {
      const node = stack[--top]
      if (!slab(origin, direction, node, best)) continue
      visited += 1
      if (size[node] === 0) {
        stack[top++] = first[node]
        stack[top++] = left[node]
        continue
      }
      for (let i = first[node]; i < first[node] + size[node]; i++) {
        const t = order[i]
        const distance = rayTriangle(origin, direction, positions, indices[t * 3] * 3, indices[t * 3 + 1] * 3, indices[t * 3 + 2] * 3, best, backFaces)
        if (distance < 0) continue
        if (distance < best || (distance === best && (bestTriangle === -1 || t < bestTriangle))) {
          best = distance
          bestTriangle = t
        }
      }
    }
    if (bestTriangle === -1) return null
    const a = indices[bestTriangle * 3] * 3
    const b = indices[bestTriangle * 3 + 1] * 3
    const c = indices[bestTriangle * 3 + 2] * 3
    const e1x = positions[b] - positions[a]
    const e1y = positions[b + 1] - positions[a + 1]
    const e1z = positions[b + 2] - positions[a + 2]
    const e2x = positions[c] - positions[a]
    const e2y = positions[c + 1] - positions[a + 1]
    const e2z = positions[c + 2] - positions[a + 2]
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
    const facing = nx * direction[0] + ny * direction[1] + nz * direction[2] > 0 ? -1 : 1
    hit.distance = best
    hit.triangle = bestTriangle
    hit.normal[0] = (nx / length) * facing
    hit.normal[1] = (ny / length) * facing
    hit.normal[2] = (nz / length) * facing
    return hit
  }

  return {
    raycast,
    triangleCount,
    get nodeCount() {
      return nodeCount
    },
    get depth() {
      return depthSeen
    },
    get visited() {
      return visited
    },
    min: [bounds[0], bounds[1], bounds[2]],
    max: [bounds[3], bounds[4], bounds[5]],
  }
}
