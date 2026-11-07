import { FACE_FRAME, packCellKey, resolveCell, worldToCell } from './cubeSphereCells.js'

const ATAN_K = Math.PI / 4.0

export function flatCellKey(cx, cz) {
  if (cx >= -32768 && cx <= 32767 && cz >= -32768 && cz <= 32767) return (cx * 65536 + cz) | 0
  return `${cx},${cz}`
}

export function resolvePlayerCell(viewerPos, planetRadius, relevanceRadius) {
  if (planetRadius > 0) {
    const c = worldToCell(viewerPos[0], viewerPos[1], viewerPos[2], planetRadius, relevanceRadius)
    const cellsPerFace = Math.ceil((2 * planetRadius) / relevanceRadius)
    const r = resolveCell(c.face, c.cx, c.cy, cellsPerFace)
    return { cellKey: packCellKey(r.face, r.cx, r.cy, cellsPerFace), cellFace: r.face, cellCx: r.cx, cellCy: r.cy, cellsPerFace }
  }
  const cx = Math.floor(viewerPos[0] / relevanceRadius), cz = Math.floor(viewerPos[2] / relevanceRadius)
  return { cellKey: flatCellKey(cx, cz), cellFace: -1, cellCx: cx, cellCy: cz, cellsPerFace: 0 }
}

export function cellCenterWorld(face, wx, wy, R, dist) {
  const F = FACE_FRAME[face]
  const dx = wx * F.u[0] + wy * F.v[0] + R * F.c[0]
  const dy = wx * F.u[1] + wy * F.v[1] + R * F.c[1]
  const dz = wx * F.u[2] + wy * F.v[2] + R * F.c[2]
  const len = Math.hypot(dx, dy, dz) || 1
  return [(dx / len) * dist, (dy / len) * dist, (dz / len) * dist]
}

export function solveCellViewer(face, cx, cy, planetRadius, relevanceRadius) {
  if (planetRadius > 0) {
    const foX = (cx + 0.5) * relevanceRadius - planetRadius
    const foY = (cy + 0.5) * relevanceRadius - planetRadius
    const wx = planetRadius * Math.tan((foX / planetRadius) * ATAN_K)
    const wy = planetRadius * Math.tan((foY / planetRadius) * ATAN_K)
    return cellCenterWorld(face, wx, wy, planetRadius, planetRadius)
  }
  return [(cx + 0.5) * relevanceRadius, 0, (cy + 0.5) * relevanceRadius]
}
