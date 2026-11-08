export const NORMAL_AXIS_SCALE = 127

const toI8 = (v) => Math.max(-NORMAL_AXIS_SCALE, Math.min(NORMAL_AXIS_SCALE, Math.round((Number.isFinite(v) ? v : 0) * NORMAL_AXIS_SCALE)))

export const packGroundNormal = (n) => {
  if (!n) return 0
  return ((toI8(n[0]) & 0xff) << 8) | (toI8(n[2]) & 0xff)
}

export const unpackGroundNormal = (packed, out) => {
  const nx = (((packed >> 8) & 0xff) << 24 >> 24) / NORMAL_AXIS_SCALE
  const nz = ((packed & 0xff) << 24 >> 24) / NORMAL_AXIS_SCALE
  out[0] = nx
  out[2] = nz
  out[1] = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz))
  return out
}
