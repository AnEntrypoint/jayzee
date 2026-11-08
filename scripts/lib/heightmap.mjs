import { createHeightSampler } from '../../src/packages/mapspinner/height-cpu.js'

export function dirFromLatLon(latDeg, lonDeg) {
  const la = latDeg * Math.PI / 180
  const lo = lonDeg * Math.PI / 180
  const cl = Math.cos(la)
  return [cl * Math.cos(lo), Math.sin(la), cl * Math.sin(lo)]
}

export function sampleField({ res, radius, seed, hashVersion, center, span }) {
  const sampler = createHeightSampler({ radius, seed, hashVersion })
  let w, h, latOf, lonOf
  if (center) {
    const [clat, clon] = center
    w = res
    h = res
    latOf = (px, py) => clat + (0.5 - py / (h - 1)) * span
    lonOf = (px, py) => clon + (px / (w - 1) - 0.5) * span
  } else {
    w = res * 2
    h = res
    latOf = (px, py) => 90 - (py / (h - 1)) * 180
    lonOf = (px, py) => (px / (w - 1)) * 360 - 180
  }
  const elev = new Float64Array(w * h)
  let min = Infinity, max = -Infinity, sum = 0, land = 0
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const e = sampler.heightAt(dirFromLatLon(latOf(px, py), lonOf(px, py)))
      elev[py * w + px] = e
      if (e < min) min = e
      if (e > max) max = e
      sum += e
      if (e > 0) land++
    }
  }
  return { w, h, elev, min, max, mean: sum / (w * h), landFrac: land / (w * h), radius }
}

export function toGray(field, hillshade) {
  const { w, h, elev, min, max } = field
  const g = new Uint8Array(w * h)
  const span = (max - min) || 1
  if (!hillshade) {
    for (let i = 0; i < w * h; i++) g[i] = Math.max(0, Math.min(255, Math.round((elev[i] - min) / span * 255)))
    return g
  }
  const lx = -0.5, ly = -0.5, lz = 0.7, ll = Math.hypot(lx, ly, lz)
  const scale = 255 / span
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1)
      const yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1)
      const dzdx = (elev[y * w + xr] - elev[y * w + xl]) * scale
      const dzdy = (elev[yd * w + x] - elev[yu * w + x]) * scale
      const nx = -dzdx, ny = -dzdy, nz = 2.0
      const nl = Math.hypot(nx, ny, nz) || 1
      const lum = (nx * lx + ny * ly + nz * lz) / (nl * ll)
      const base = (elev[y * w + x] - min) / span
      const v = Math.max(0, Math.min(1, 0.35 * base + 0.65 * Math.max(0, lum)))
      g[y * w + x] = Math.round(v * 255)
    }
  }
  return g
}
