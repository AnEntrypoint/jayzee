import { NORMAL_AXIS_SCALE, packGroundNormal } from './groundNormalWire.js'

export const WALL_OFFSET_UNITS_PER_M = 1000

const unpackAxis = (packed, shift) => (((packed >> shift) & 0xff) << 24 >> 24) / NORMAL_AXIS_SCALE

const quantizedNormal = (packed, out, k) => {
  const nx = unpackAxis(packed, 8)
  const nz = unpackAxis(packed, 0)
  const len = Math.hypot(nx, nz)
  out[k] = len > 0 ? nx / len : 0
  out[k + 1] = len > 0 ? nz / len : 0
  return len > 0
}

const planeScratch = [0, 0]

export const packWallPlanes = (wallNormals, position) => {
  if (!wallNormals || !wallNormals.length || !position) return 0
  const out = []
  for (let i = 0; i + 1 < wallNormals.length; i += 2) {
    const packed = packGroundNormal([wallNormals[i], 0, wallNormals[i + 1]])
    if (!quantizedNormal(packed, planeScratch, 0)) continue
    out.push(packed, Math.round((planeScratch[0] * position[0] + planeScratch[1] * position[2]) * WALL_OFFSET_UNITS_PER_M))
  }
  return out.length ? out : 0
}

export const unpackWallPlanes = (wire, out) => {
  out.length = 0
  if (!Array.isArray(wire)) return out
  for (let i = 0; i + 1 < wire.length; i += 2) {
    const k = out.length
    out.length = k + 3
    if (!quantizedNormal(wire[i] | 0, out, k)) {
      out.length = k
      continue
    }
    out[k + 2] = wire[i + 1] / WALL_OFFSET_UNITS_PER_M
  }
  return out
}
