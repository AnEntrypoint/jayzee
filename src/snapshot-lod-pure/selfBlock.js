const AXIS_SCALE = 127
const OFFSET_UNITS_PER_M = 1000
const NO_INPUT_DEPTH = -1

const toI8 = (v) => Math.max(-AXIS_SCALE, Math.min(AXIS_SCALE, Math.round((Number.isFinite(v) ? v : 0) * AXIS_SCALE)))

export const packGroundNormal = (n) => {
  if (!n) return 0
  return ((toI8(n[0]) & 0xff) << 8) | (toI8(n[2]) & 0xff)
}

export const unpackGroundNormal = (packed, out) => {
  const nx = (((packed >> 8) & 0xff) << 24 >> 24) / AXIS_SCALE
  const nz = ((packed & 0xff) << 24 >> 24) / AXIS_SCALE
  out[0] = nx
  out[2] = nz
  out[1] = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz))
  return out
}

const unpackAxis = (packed, shift) => (((packed >> shift) & 0xff) << 24 >> 24) / AXIS_SCALE

const quantizedNormal = (packed, out, k) => {
  const nx = unpackAxis(packed, 8), nz = unpackAxis(packed, 0)
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
    out.push(packed, Math.round((planeScratch[0] * position[0] + planeScratch[1] * position[2]) * OFFSET_UNITS_PER_M))
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
    out[k + 2] = wire[i + 1] / OFFSET_UNITS_PER_M
  }
  return out
}

const hasInputDepth = (depth) => typeof depth === 'number' && depth >= 0 && depth <= 255 && (depth | 0) === depth

const inputDepthFromWire = (depth) => (hasInputDepth(depth) ? depth : NO_INPUT_DEPTH)

const inputBufferByte = (depth) => (hasInputDepth(depth) ? depth : null)

export const encodeSelfBlock = (p) => (p
  ? [p.inputSequence, inputBufferByte(p.inputBuffer), packGroundNormal(p.groundNormal), packWallPlanes(p.wallNormals, p.position)]
  : undefined)

export const decodeSelfBlock = (me, out) => {
  out.inputSequence = me[0]
  out.inputBuffer = inputDepthFromWire(me[1])
  out.groundNormal = unpackGroundNormal(me[2] || 0, out.groundNormal || [0, 1, 0])
  out.wallPlanes = unpackWallPlanes(me[3], out.wallPlanes || [])
  return out
}
