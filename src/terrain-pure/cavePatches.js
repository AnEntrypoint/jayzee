import { marchBox } from './marchingCubes.js'

export function sdfSphere(wx, wy, wz, cx, cy, cz, r) {
  const dx = wx - cx
  const dy = wy - cy
  const dz = wz - cz
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r
}

export function sdfCylinder(wx, wy, wz, cx, cy, cz, r, h) {
  const dx = wx - cx
  const dz = wz - cz
  const dxy = Math.sqrt(dx * dx + dz * dz) - r
  const dy = wy - cy
  const dh = Math.abs(dy - h / 2) - h / 2
  return Math.max(dxy, dh)
}

export function sdfTorus(wx, wy, wz, cx, cy, cz, R, r) {
  const dx = wx - cx
  const dy = wy - cy
  const dz = wz - cz
  const qx = Math.sqrt(dx * dx + dz * dz) - R
  return Math.sqrt(qx * qx + dy * dy) - r
}

export function unionSDF(...sdfs) {
  return (wx, wy, wz) => {
    let d = Infinity
    for (const sdf of sdfs) {
      const v = sdf(wx, wy, wz)
      if (v < d) d = v
    }
    return d
  }
}

export function subtractCaveFromHeightfield(heights, width, spacing, cornerX, cornerZ, sdf, cutDepth = 50) {
  if (!heights || width < 2 || !Number.isFinite(spacing) || spacing <= 0) return heights
  if (typeof sdf !== 'function') return heights

  const n = width
  const out = new Float32Array(heights)

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const idx = iz * n + ix
      const h = out[idx]
      if (!Number.isFinite(h)) continue

      const wx = cornerX + ix * spacing
      const wz = cornerZ + iz * spacing
      const d = sdf(wx, h, wz)
      if (d < 0) {
        const penetration = Math.min(-d, cutDepth)
        out[idx] = h - penetration
      }
    }
  }

  return out
}

export function marchCaveSurface(res, sdf, x0, x1, y0, y1, z0, z1) {
  return marchBox(res, sdf, x0, x1, y0, y1, z0, z1)
}

export function createSphericalCave(heights, width, spacing, cornerX, cornerZ, cx, cy, cz, radius, opts = {}) {
  const { cutDepth, meshRes = 16 } = opts

  const sdf = (wx, wy, wz) => sdfSphere(wx, wy, wz, cx, cy, cz, radius)

  const newHeights = subtractCaveFromHeightfield(heights, width, spacing, cornerX, cornerZ, sdf, cutDepth)

  const margin = radius * 0.2
  const caveGeo = marchCaveSurface(
    meshRes, sdf,
    cx - radius - margin, cx + radius + margin,
    cy - radius - margin, cy + radius + margin,
    cz - radius - margin, cz + radius + margin
  )

  return { heights: newHeights, caveGeometry: caveGeo }
}
