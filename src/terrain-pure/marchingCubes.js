import { EDGE_TABLE } from './marchingEdges.js'
import { TRI_TABLE } from './rockTriTable.js'

const VERTEX_KEY_SCALE = 100
const VERTEX_KEY_OFFSET = 512
const VERTEX_KEY_SHIFT = 10
const VERTEX_KEY_SHIFT_HIGH = 20
const EDGE_CORNERS = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
]

export function marchBox(res, sdf, x0, x1, y0, y1, z0, z1) {
  if (res < 2) return { positions: new Float32Array(0), vc: 0, indices: new Uint32Array(0), ic: 0 }

  const dx = (x1 - x0) / (res - 1)
  const dy = (y1 - y0) / (res - 1)
  const dz = (z1 - z0) / (res - 1)

  const field = new Float32Array(res * res * res)
  for (let k = 0, idx = 0; k < res; k++) {
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++, idx++) {
        field[idx] = sdf(x0 + i * dx, y0 + j * dy, z0 + k * dz)
      }
    }
  }

  const capacity = res * res * res * 5
  const positions = new Float32Array(capacity * 3)
  const indices = new Uint32Array(capacity * 3)
  let vc = 0
  let ic = 0

  const vertexByKey = new Map()
  const vertexIndex = (x, y, z) => {
    const ix = (x * VERTEX_KEY_SCALE) | 0
    const iy = (y * VERTEX_KEY_SCALE) | 0
    const iz = (z * VERTEX_KEY_SCALE) | 0
    const key = ((ix + VERTEX_KEY_OFFSET) << VERTEX_KEY_SHIFT_HIGH) | ((iy + VERTEX_KEY_OFFSET) << VERTEX_KEY_SHIFT) | (iz + VERTEX_KEY_OFFSET)
    if (vertexByKey.has(key)) return vertexByKey.get(key)
    const idx = vc
    positions[vc * 3] = x
    positions[vc * 3 + 1] = y
    positions[vc * 3 + 2] = z
    vc++
    vertexByKey.set(key, idx)
    return idx
  }

  const interpolate = (p1, p2, v1, v2, out) => {
    const t = Math.abs(v1 - v2) < 1e-10 ? 0 : -v1 / (v2 - v1)
    out[0] = p1[0] + t * (p2[0] - p1[0])
    out[1] = p1[1] + t * (p2[1] - p1[1])
    out[2] = p1[2] + t * (p2[2] - p1[2])
  }

  const corners = Array.from({ length: 8 }, () => [0, 0, 0])
  const edgePoints = Array.from({ length: 12 }, () => [0, 0, 0])
  const values = new Float32Array(8)

  for (let k = 0; k < res - 1; k++) {
    for (let j = 0; j < res - 1; j++) {
      for (let i = 0; i < res - 1; i++) {
        const x = x0 + i * dx
        const y = y0 + j * dy
        const z = z0 + k * dz
        corners[0][0] = x; corners[0][1] = y; corners[0][2] = z
        corners[1][0] = x + dx; corners[1][1] = y; corners[1][2] = z
        corners[2][0] = x + dx; corners[2][1] = y + dy; corners[2][2] = z
        corners[3][0] = x; corners[3][1] = y + dy; corners[3][2] = z
        corners[4][0] = x; corners[4][1] = y; corners[4][2] = z + dz
        corners[5][0] = x + dx; corners[5][1] = y; corners[5][2] = z + dz
        corners[6][0] = x + dx; corners[6][1] = y + dy; corners[6][2] = z + dz
        corners[7][0] = x; corners[7][1] = y + dy; corners[7][2] = z + dz

        const base = k * res * res + j * res + i
        values[0] = field[base]
        values[1] = field[base + 1]
        values[2] = field[base + 1 + res]
        values[3] = field[base + res]
        values[4] = field[base + res * res]
        values[5] = field[base + 1 + res * res]
        values[6] = field[base + 1 + res + res * res]
        values[7] = field[base + res + res * res]

        let cubeIndex = 0
        for (let n = 0; n < 8; n++) if (values[n] < 0) cubeIndex |= 1 << n
        const edgeMask = EDGE_TABLE[cubeIndex]
        if (!edgeMask) continue

        for (let e = 0; e < 12; e++) {
          if (edgeMask & (1 << e)) {
            const [a, b] = EDGE_CORNERS[e]
            interpolate(corners[a], corners[b], values[a], values[b], edgePoints[e])
          }
        }

        const tri = TRI_TABLE[cubeIndex]
        for (let t = 0; tri[t] !== -1; t += 3) {
          const a = edgePoints[tri[t]]
          const b = edgePoints[tri[t + 1]]
          const c = edgePoints[tri[t + 2]]
          const ia = vertexIndex(a[0], a[1], a[2])
          const ib = vertexIndex(b[0], b[1], b[2])
          const ic2 = vertexIndex(c[0], c[1], c[2])
          if (ia !== ib && ib !== ic2 && ic2 !== ia) {
            indices[ic++] = ia
            indices[ic++] = ic2
            indices[ic++] = ib
          }
        }
      }
    }
  }

  return {
    positions: positions.subarray(0, vc * 3),
    vc,
    indices: indices.subarray(0, ic),
    ic,
  }
}
